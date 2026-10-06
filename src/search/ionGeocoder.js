/**
 * Google- and Bing-grade place search through the Cesium ion token the app
 * already uses for its 3D tiles — no further key.
 *
 * Why this exists: the keyless geocoders rank by text, so "the Colosseum",
 * "Cairo" or "Japan" can land on a same-named hamlet a continent away, and
 * Wikipedia only knows famous names. Cesium ion geocodes with Google or Bing
 * behind the same token (the Community plan includes a monthly geocode quota),
 * which is the piece of knowledge the paid original got from its Google key.
 * Google's Photorealistic 3D Tiles are also meant to be searched with Google's
 * geocoder; CesiumJS warns when they are not.
 *
 * This module never talks to Cesium. The caller injects
 * `search(query, {provider, signal})`, which runs CesiumJS's own
 * `IonGeocoderService` (as Cesium asks geocoding to be used) and resolves to
 * plain results in degrees — `{label, west, south, east, north}` or
 * `{label, lat, lng}` — so this package keeps reading no application state.
 *
 * An answer is used only when its label names what was asked: ion's Google
 * route is an address geocoder, and for a name it does not know it can return
 * an unrelated street ("the Suez Canal" came back as a house in The Hague).
 * Such an answer is handed on, like no answer, to the geocoders behind this one.
 * Ion results carry no place types, so the framing types are read from the
 * label and the size of the box.
 */
import { normalizeToponym } from '../keylessGeocoder.js';

/** Ion requests carry no deadline of their own; the whole chain has twelve seconds. */
const REQUEST_TIMEOUT_MS = 6000;

/** Same shape as the other geocoders' memo: answers for five minutes, misses for thirty seconds. */
const HIT_TTL_MS = 300_000;
const MISS_TTL_MS = 30_000;
const CACHE_MAX = 64;

/** Unanswered searches in a row that pause the lookup, and for how long. */
const UNANSWERED_BEFORE_PAUSE = 2;
const PAUSE_MS = 60_000;

/** A token without the geocode scope, or a used-up quota, does not fix itself in a minute. */
const REFUSED_PAUSE_MS = 15 * 60_000;

/** Words that say nothing about which place is meant. */
const STOPWORDS = new Set([
  'the',
  'of',
  'a',
  'an',
  'and',
  'at',
  'in',
  'on',
  'to',
  'for',
  'de',
  'del',
  'la',
  'le',
  'el',
  'los',
  'las',
  'du',
  'des',
]);

/** A label head that names a natural feature: framed as an area, never outlined as a state. */
const NATURAL_HEAD =
  /\b(lake|lagoon|river|sea|ocean|gulf|bay|strait|channel|canal|mount|mountains?|range|peak|volcano|desert|canyon|gorge|valley|glacier|reef|falls|waterfall|forest|rainforest|islands?|archipelago|peninsula|plateau|basin|trench|delta)\b/i;

/** A settlement whose name holds one of those words ("Salt Lake City", "Park City"). */
const SETTLEMENT_HEAD = /\b(city|town|village|county|borough)\b/i;

/** A label head that names a park or reserve. */
const PARK_HEAD = /\b(park|gardens?|reserve|preserve|sanctuary)\b/i;

/** A label head that names a road. */
const STREET_HEAD =
  /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|hwy|highway|pkwy|parkway|way|promenade)\.?$/i;

/** A label head that names a district of a city ("District of Columbia" is not one). */
const DISTRICT_HEAD =
  /\b(district|quarter|neighbou?rhood)\b(?! of)|\b(downtown|midtown)\b/i;

function words(text) {
  return normalizeToponym(text).split(' ').filter(Boolean);
}

/** The words of a query that identify the place: no articles, nothing shorter than three letters but numbers. */
function significantWords(text) {
  return words(text).filter(
    (word) => !STOPWORDS.has(word) && (word.length >= 3 || /\d/.test(word)),
  );
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length];
}

/** The same word, allowing a plural and, for a long word, a spelling variant ("Chernobyl", "Chornobyl"). */
function sameWord(a, b) {
  if (a === b) return true;
  const stem = (word) => word.replace(/(es|s)$/, '');
  if (a.length >= 4 && b.length >= 4 && stem(a) === stem(b)) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 6) return false;
  return editDistance(a, b) <= (shorter >= 9 ? 2 : 1);
}

/**
 * Whether a result's label names what was asked: one identifying word of the
 * query in the label, or an acronym ("MIT") that the label's name spells out.
 * A query with no identifying word (a two-letter code, another script) is not
 * second-guessed.
 * @param {string} query
 * @param {string} label
 * @returns {boolean}
 */
export function labelNamesQuery(query, label) {
  const wanted = significantWords(query);
  if (!wanted.length) return true;
  const have = words(label);
  if (wanted.some((word) => have.some((other) => sameWord(word, other))))
    return true;
  if (wanted.length === 1 && /^[a-z]{2,6}$/.test(wanted[0])) {
    const initials = words(String(label ?? '').split(',')[0])
      .filter((word) => !STOPWORDS.has(word))
      .map((word) => word[0])
      .join('');
    if (initials === wanted[0]) return true;
  }
  return false;
}

/** A US state and ZIP code in a label: an address, never a lake or a mountain. */
const US_POSTAL = /\b[A-Z]{2} \d{5}\b/;

/**
 * Whether an answer that does carry the asked-for name is still a namesake:
 * a town named after the feature ("Lake Geneva, WI 53147" for Lake Geneva),
 * or a place spelled with an acronym's letters ("Lax, Switzerland" for LAX).
 * Such answers are handed on, like a wrong one: Wikipedia knows the lake and
 * that LAX is the airport.
 * @param {string} query
 * @param {string} label
 * @returns {boolean}
 */
export function isNamesake(query, label) {
  const text = String(query ?? '').trim();
  const head = String(label ?? '')
    .split(',')[0]
    .trim();
  if (NATURAL_HEAD.test(text) && US_POSTAL.test(String(label ?? '')))
    return true;
  return (
    /^[A-Z]{2,5}$/.test(text) &&
    head !== text &&
    head.toLowerCase() === text.toLowerCase()
  );
}

/**
 * Google-style place types for an ion result, read from its label and the size
 * of its box (km across). `geocodeNavigationMode` and the annotation scope read
 * these, so a country frames as a region and a monument as a point.
 * @param {string} label
 * @param {number} spanKm
 * @returns {string[]}
 */
export function ionResultTypes(label, spanKm) {
  const text = String(label ?? '');
  const head = text.split(',')[0].trim();
  if (/^\d/.test(head)) return ['street_address'];
  if (STREET_HEAD.test(head)) return ['route'];
  if (/\bairport\b/i.test(head)) return ['airport'];
  if (/\b(university|college|institute of)\b/i.test(head))
    return ['university'];
  if (/\bstadium\b/i.test(head)) return ['stadium'];
  const settlement = SETTLEMENT_HEAD.test(head);
  if (!settlement && PARK_HEAD.test(head)) return ['park'];
  if (!settlement && NATURAL_HEAD.test(head)) return ['natural_feature'];
  if (DISTRICT_HEAD.test(head)) return ['sublocality', 'political'];
  // A country is labelled by its name alone; "Alaska, USA" is a state however
  // large its box.
  if (!text.includes(',') && spanKm >= 300) return ['country', 'political'];
  if (spanKm >= 100) return ['administrative_area_level_1', 'political'];
  if (spanKm >= 5) return ['locality', 'political'];
  if (spanKm >= 0.5) return ['park'];
  return ['point_of_interest'];
}

/**
 * One ion result as the place shape every geocoder in the chain returns, or
 * null when it carries no usable position. A box that crosses the 180th
 * meridian (Alaska, Fiji) is centred across it and framed without a viewport,
 * as the other geocoders do until framing supports wrapped boxes.
 */
export function normalizeIonResult(result) {
  const label = String(result?.label ?? '').trim();
  const box = ['west', 'south', 'east', 'north'].map((key) =>
    Number(result?.[key]),
  );
  if (box.every(Number.isFinite)) {
    const [west, south, east, north] = box;
    if (
      Math.abs(south) > 90 ||
      Math.abs(north) > 90 ||
      Math.abs(west) > 180 ||
      Math.abs(east) > 180 ||
      south > north
    )
      return null;
    const wraps = west > east;
    const lonSpan = wraps ? east + 360 - west : east - west;
    let lng = west + lonSpan / 2;
    if (lng > 180) lng -= 360;
    const lat = (south + north) / 2;
    const spanKm = Math.max(
      (north - south) * 111.32,
      lonSpan * 111.32 * Math.cos((lat * Math.PI) / 180),
    );
    const point = spanKm < 0.01;
    return {
      lat,
      lng,
      name: label.split(',')[0].trim(),
      label,
      types: ionResultTypes(label, spanKm),
      viewport:
        wraps || point
          ? null
          : {
              southwest: { lat: south, lng: west },
              northeast: { lat: north, lng: east },
            },
    };
  }
  const lat = Number(result?.lat);
  const lng = Number(result?.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return {
    lat,
    lng,
    name: label.split(',')[0].trim(),
    label,
    types: ionResultTypes(label, 0),
    viewport: null,
  };
}

/** Settle `promise` within `ms`, else reject; the injected search takes no deadline of its own. */
function within(promise, ms, signal) {
  let timer;
  let onAbort;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Ion geocoder timed out')), ms);
    if (signal) {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  return Promise.race([promise, deadline]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/**
 * Answer place names through Cesium ion's Google or Bing geocoder.
 *
 * `search` is the injected ion transport; it resolves to an array of results
 * (see above), or to null when it cannot run yet (no globe to credit the answer
 * on), which is "did not answer". An error carrying `status` 401 or 403 means
 * the token may not geocode, and 429 that its quota is spent: the lookup then
 * rests for a quarter of an hour instead of failing every search in between.
 *
 * @param {{search: Function, provider?: 'google'|'bing', timeoutMs?: number,
 *   now?: () => number}} options
 */
export function createIonGeocoder({
  search,
  provider = 'google',
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  if (typeof search !== 'function')
    throw new TypeError('An ion geocode transport is required');
  if (provider !== 'google' && provider !== 'bing')
    throw new TypeError('Unsupported ion geocode provider');
  const cache = new Map();
  let unanswered = 0;
  let pausedUntil = 0;

  return {
    async geocode(query, { signal } = {}) {
      signal?.throwIfAborted();
      const text = String(query ?? '').trim();
      if (!text) return { place: null, answered: true };
      const key = text.toLowerCase();
      const cached = cache.get(key);
      if (cached && cached.expires > now())
        return { place: cached.place, answered: true };
      cache.delete(key);
      if (now() < pausedUntil) return { place: null, answered: false };

      let results;
      try {
        results = await within(
          Promise.resolve(search(text, { provider, signal })),
          timeoutMs,
          signal,
        );
      } catch (error) {
        signal?.throwIfAborted();
        const status = Number(error?.status ?? error?.statusCode);
        if (status === 401 || status === 403 || status === 429) {
          unanswered = 0;
          pausedUntil = now() + REFUSED_PAUSE_MS;
        } else {
          unanswered += 1;
          if (unanswered >= UNANSWERED_BEFORE_PAUSE) {
            unanswered = 0;
            pausedUntil = now() + PAUSE_MS;
          }
        }
        return { place: null, answered: false };
      }
      signal?.throwIfAborted();
      // Not ready to search (no globe yet): not a verdict, and not remembered.
      if (!Array.isArray(results)) return { place: null, answered: false };
      unanswered = 0;

      let place = null;
      for (const result of results.slice(0, 3)) {
        const candidate = normalizeIonResult(result);
        if (
          candidate &&
          labelNamesQuery(text, candidate.label) &&
          !isNamesake(text, candidate.label)
        ) {
          // The name stays what was asked when the label leads with a district
          // ("Al Haram, Giza Governorate" for the Pyramids of Giza): outlines
          // and voice replies match on it.
          if (!labelNamesQuery(text, candidate.name)) candidate.name = text;
          place = candidate;
          break;
        }
      }
      cache.set(key, {
        place,
        expires: now() + (place ? HIT_TTL_MS : MISS_TTL_MS),
      });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return { place, answered: true };
    },
  };
}
