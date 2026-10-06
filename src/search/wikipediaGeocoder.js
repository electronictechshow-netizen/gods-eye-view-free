/**
 * Famous place names answered by Wikipedia — "the Colosseum", "the Kremlin",
 * "the Hollywood sign", "Chernobyl" — in front of the OpenStreetMap geocoders.
 *
 * Why this exists: a geocoder that ranks by text match has no idea which
 * "Colosseum" is the one people mean. Photon puts a locality in Queensland first
 * and Nominatim a pedestrian lane; "Chernobyl" lands in South Africa, "Petra" in
 * Surrey and "the Hollywood sign" in Ireland. Google's place search knows, and
 * the paid original leans on that. Wikipedia's search ranks by what readers
 * actually look up and carries a coordinate for every notable place, which is the
 * same piece of knowledge, free and without a key.
 *
 * It answers only when it is sure it has the right thing:
 *
 *  - the article's title IS the name asked for (an article, parentheses and
 *    accents aside), or the name is a Wikipedia redirect to it ("Pyramids of
 *    Giza" → "Giza pyramid complex"), and it carries an Earth coordinate —
 *    "Springfield" is a disambiguation page and "Sixth Street" has no article of
 *    that name, so both go on to the geocoders that can weigh the view;
 *  - for a country, state, city, county or island — which a bare point would
 *    frame as a street corner — it answers only when OpenStreetMap confirms the
 *    place near that coordinate, so the framing box comes with it. Countries were
 *    once left to the geocoders, but Photon answered "Japan" with a town in
 *    Missouri and "Egypt" with one in Arkansas.
 *
 * What Wikipedia says is WHICH place; how to frame it is the OpenStreetMap
 * geometry's job, so an accepted hit is looked up once more in Photon, biased to
 * the Wikipedia coordinate. The feature there that carries the same name — or,
 * for a name Photon holds in another language ("Colosseo", "Чорнобиль"), the
 * nearest notable one — is used when it is close enough (its bounding box is what
 * frames a lake, a reef or a city). A river, a reef or a desert is only ever
 * framed by a natural feature of its own name: the nearest notable thing to the
 * Nile's article point is a Cairo marina. Without such a feature the Wikipedia
 * point stands, except for the administrative kinds above, which are handed on.
 *
 * Reads no application state; `fetchImpl` is injected like the other geocoders.
 */
import {
  normalizePhotonFeature,
  normalizeToponym,
  photonSearchUrl,
} from '../keylessGeocoder.js';

const WIKIPEDIA_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_ENDPOINT = 'https://www.wikidata.org/w/api.php';

/**
 * Each request has its own budget; the whole chain still has twelve seconds.
 * Four seconds tripped in a busy page (a starved main thread delays the
 * response handler, not the network), and two such trips pause the lookup.
 */
const REQUEST_TIMEOUT_MS = 6000;

/** Same shape as the other geocoders' memo: answers for five minutes, misses for thirty seconds. */
const HIT_TTL_MS = 300_000;
const MISS_TTL_MS = 30_000;
const CACHE_MAX = 64;

/** Unanswered searches in a row that pause the lookup, and for how long. */
const UNANSWERED_BEFORE_PAUSE = 2;
const PAUSE_MS = 60_000;

/** A landmark name is a handful of words; anything longer is an address or a sentence. */
const MAX_QUERY_WORDS = 6;

/** Candidates inspected per search; the article asked for is nearly always first. */
const RESULT_LIMIT = 4;

/**
 * Wikipedia coordinate types that are populated or administrative places, with
 * how far (km) the confirming OpenStreetMap feature may sit from the article's
 * point. A bare point would frame these as a street corner, so they are answered
 * only with the OpenStreetMap geometry behind them.
 */
const ADMINISTRATIVE_LIMIT_KM = {
  country: 2500,
  adm1st: 1200,
  city: 60,
  isle: 300,
  adm3rd: 150,
  adm2nd: 300,
};

/** Not answered here at all: a battle or a disaster is not a place to fly to. */
const HANDED_ON = new Set(['event']);

/** Words kept lower-case when a name is written the way Wikipedia titles it. */
const TITLE_SMALL_WORDS = new Set([
  'of',
  'the',
  'and',
  'in',
  'on',
  'at',
  'de',
  'la',
  'le',
  'du',
  'del',
  'da',
  'di',
  'for',
  'to',
]);

/** Coordinate `type` → the Google place types the camera framing reads. */
const COORDINATE_TYPES = {
  mountain: ['natural_feature'],
  river: ['natural_feature'],
  waterbody: ['natural_feature'],
  forest: ['natural_feature'],
  glacier: ['natural_feature'],
  pass: ['natural_feature'],
  airport: ['airport'],
  edu: ['university'],
  railwaystation: ['train_station', 'transit_station'],
};

/** Wikidata's one-line description of something that is an area, not a point. */
const AREA_DESCRIPTION =
  /\b(mountains?|range|desert|reef|rainforest|forest|river|lake|reservoir|sea|bay|gulf|strait|valley|plateau|plain|archipelago|peninsula|canyon|gorge|waterfall|falls|glacier|volcano|basin|delta|canal|wilderness|wetland|marsh|steppe|tundra|park)\b/i;

/** A description of a road: only then may a street be the OpenStreetMap feature of the same name. */
const STREET_DESCRIPTION =
  /\b(street|avenue|boulevard|road|highway|route|promenade|lane|drive|boardwalk|thoroughfare|freeway|expressway|parkway)\b/i;

/** OpenStreetMap keys that mark something notable enough to stand in for a differently-named article. */
const NOTABLE_KEYS = new Set([
  'place',
  'boundary',
  'historic',
  'tourism',
  'natural',
  'leisure',
  'waterway',
  'aeroway',
  'military',
  'landuse',
  'man_made',
  'building',
]);

/**
 * The same for an article about an AREA (a river, a reef, a forest): a tower or a
 * restaurant that merely has the river's name in its own is not the river.
 */
const AREA_NOTABLE_KEYS = new Set([
  'natural',
  // Lakes and reservoirs: Photon reports the Dead Sea as water=lake.
  'water',
  'waterway',
  'boundary',
  'place',
  'leisure',
  'landuse',
]);

/**
 * Wikidata's one-line description of a place you can fly to. An article with no
 * coordinate of its own is looked up on Wikidata only when it reads like one —
 * a company or a band must not borrow its headquarters' coordinate.
 */
const PLACE_DESCRIPTION =
  /\b(city|town|village|settlement|site|ruins?|monument|memorial|castle|fort|fortress|palace|temple|church|cathedral|mosque|shrine|museum|bridge|tower|dam|canal|airport|station|stadium|park|garden|island|mountains?|volcano|lake|river|reef|forest|desert|valley|canyon|cave|waterfall|beach|bay|harbou?r|port|square|plaza|street|avenue|landmark|building|skyscraper|complex|campus|university|prison|lighthouse|pyramid|wall|gate|arch|tomb|mausoleum|necropolis|archaeological|amphitheat\w+)\b/i;

/** The Wikidata item of the Earth, the only `globe` a place here may be on. */
const EARTH_ITEM = 'http://www.wikidata.org/entity/Q2';

/** How far (km) the OpenStreetMap feature confirming a Wikidata-only coordinate may sit. */
const WIKIDATA_CONFIRM_KM = 60;

/** Smallest coordinate extent (metres) worth turning into a framing box. */
const MIN_FRAMING_EXTENT_M = 5000;

/** How far (km) the OpenStreetMap feature may sit from the Wikipedia point. */
const POINT_MATCH_KM = 30;
const AREA_MATCH_KM = 600;

/** How near (km) a feature of another name must be to be taken for the same place. */
const POINT_NEAR_KM = 3;
const AREA_NEAR_KM = 40;
const ADMINISTRATIVE_NEAR_KM = 25;

function fold(value) {
  return normalizeToponym(String(value ?? '').replace(/\([^)]*\)/g, ' '))
    .replace(/^(the|a|an) /, '')
    .trim();
}

function distanceKm(latA, lonA, latB, lonB) {
  const toRad = Math.PI / 180;
  const dLat = (latB - latA) * toRad;
  const dLon = (lonB - lonA) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * toRad) * Math.cos(latB * toRad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The Wikipedia search URL: top pages with their coordinates and one-line description. */
function searchUrl(query, endpoint) {
  const url = new URL(endpoint);
  const set = (key, value) => url.searchParams.set(key, value);
  set('action', 'query');
  set('format', 'json');
  set('formatversion', '2');
  set('origin', '*');
  set('generator', 'search');
  set('gsrsearch', query);
  set('gsrnamespace', '0');
  set('gsrlimit', String(RESULT_LIMIT));
  set('prop', 'coordinates|description|pageprops');
  set('coprop', 'type|dim|globe');
  set('colimit', String(RESULT_LIMIT));
  set('ppprop', 'disambiguation|wikibase_item');
  return url.toString();
}

/**
 * The spellings of a name Wikipedia may hold as a title or a redirect: as asked,
 * without a leading article, and capitalised the way titles are ("pyramids of
 * giza" → "Pyramids of Giza"). Titles are case-sensitive after the first letter.
 */
function titleVariants(text) {
  const bare = text.replace(/^(the|a|an)\s+/i, '');
  const titled = bare
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && TITLE_SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
  return [...new Set([text, bare, titled])];
}

/** The request that resolves names as titles, following redirects, with the same page details as a search. */
function titlesUrl(titles, endpoint) {
  const url = new URL(endpoint);
  const set = (key, value) => url.searchParams.set(key, value);
  set('action', 'query');
  set('format', 'json');
  set('formatversion', '2');
  set('origin', '*');
  set('titles', titles.join('|'));
  set('redirects', '1');
  set('prop', 'coordinates|description|pageprops');
  set('coprop', 'type|dim|globe');
  set('colimit', String(RESULT_LIMIT));
  set('ppprop', 'disambiguation|wikibase_item');
  return url.toString();
}

/** The page a title lookup resolved `title` to, following its normalisation and redirect. */
function resolvedPage(data, title) {
  let resolved = title;
  for (const step of [data?.query?.normalized, data?.query?.redirects])
    for (const entry of Array.isArray(step) ? step : [])
      if (entry?.from === resolved) resolved = entry.to;
  const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
  return (
    pages.find(
      (page) => page?.title === resolved && !page.missing && !page.invalid,
    ) ?? null
  );
}

/** The Wikidata request for one item's coordinate claim. */
function wikidataUrl(item, endpoint) {
  const url = new URL(endpoint);
  const set = (key, value) => url.searchParams.set(key, value);
  set('action', 'wbgetentities');
  set('ids', item);
  set('props', 'claims');
  set('format', 'json');
  set('origin', '*');
  return url.toString();
}

/** `{lat, lon}` from a Wikidata entity's coordinate-location claim (P625), or null. */
function wikidataPoint(data, item) {
  const value =
    data?.entities?.[item]?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  if (!value || (value.globe && value.globe !== EARTH_ITEM)) return null;
  const lat = Number(value.latitude);
  const lon = Number(value.longitude);
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
    ? { lat, lon }
    : null;
}

/**
 * The page that names the query, or null. A disambiguation page of that name
 * ends the search: the name is ambiguous, and which one is meant depends on the
 * view, which only the OpenStreetMap geocoders weigh. (The page "X
 * (disambiguation)" is no page named X — the article X, when there is one, is
 * Wikipedia's own answer to the bare name.)
 *
 * `confirmKm` is set for an administrative kind: how far the OpenStreetMap
 * feature that must confirm it may be. `item` is set for an article that carries
 * no coordinate but reads like a place: its Wikidata item, to ask for one.
 */
function pickPage(pages, target, { anyTitle = false } = {}) {
  const ranked = pages
    .filter(
      (page) =>
        page &&
        typeof page.title === 'string' &&
        !/\(disambiguation\)\s*$/i.test(page.title),
    )
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  let named = false;
  for (const page of ranked) {
    if (!anyTitle && fold(page.title) !== target) continue;
    named = true;
    if (page.pageprops && 'disambiguation' in page.pageprops) return null;
    const point = Array.isArray(page.coordinates) ? page.coordinates[0] : null;
    if (
      !point &&
      page.pageprops?.wikibase_item &&
      PLACE_DESCRIPTION.test(String(page.description || ''))
    )
      return {
        page,
        point: null,
        item: String(page.pageprops.wikibase_item),
        confirmKm: WIKIDATA_CONFIRM_KM,
      };
    if (
      !point ||
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lon) ||
      Math.abs(point.lat) > 90 ||
      Math.abs(point.lon) > 180
    )
      continue;
    // Moon, Mars and the rest carry a `globe`; only the Earth is a place here.
    if (point.globe && point.globe !== 'earth') continue;
    const type = String(point.type || '').toLowerCase();
    if (HANDED_ON.has(type)) return null;
    return { page, point, confirmKm: ADMINISTRATIVE_LIMIT_KM[type] ?? null };
  }
  // `undefined`: no page bears the name at all, so a redirect may still name it.
  return named ? null : undefined;
}

/** Framing types for a hit: the coordinate's own type, else what the description says it is. */
function placeTypes(point, description) {
  const mapped = COORDINATE_TYPES[String(point.type || '').toLowerCase()];
  if (mapped) return mapped;
  return AREA_DESCRIPTION.test(String(description || ''))
    ? ['natural_feature']
    : ['point_of_interest'];
}

/** A box around the point when the article states a real extent for the thing. */
function extentViewport(point) {
  const extent = Number(point.dim);
  if (!Number.isFinite(extent) || extent < MIN_FRAMING_EXTENT_M) return null;
  const halfLat = extent / 2 / 111320;
  const halfLon =
    extent /
    2 /
    (111320 * Math.max(0.05, Math.cos((point.lat * Math.PI) / 180)));
  if (Math.abs(point.lon) + halfLon > 180 || Math.abs(point.lat) + halfLat > 90)
    return null;
  return {
    southwest: { lat: point.lat - halfLat, lng: point.lon - halfLon },
    northeast: { lat: point.lat + halfLat, lng: point.lon + halfLon },
  };
}

/**
 * Answer well-known place names from Wikipedia.
 *
 * Two searches in a row that Wikipedia does not answer — a network that blocks
 * it, a rate limit — pause the lookup for a minute, so a search does not wait out
 * a request that is going nowhere before the geocoders behind it get their turn.
 *
 * @param {{fetchImpl?: Function, endpoint?: string, photonEndpoint?: string,
 *   timeoutMs?: number, now?: () => number}} [options]
 */
export function createWikipediaGeocoder({
  fetchImpl = (...args) => fetch(...args),
  endpoint = WIKIPEDIA_ENDPOINT,
  wikidataEndpoint = WIKIDATA_ENDPOINT,
  photonEndpoint,
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const cache = new Map();
  let unanswered = 0;
  let pausedUntil = 0;

  /** One JSON request, or null when the service did not answer. */
  async function ask(url, signal) {
    try {
      signal?.throwIfAborted();
      const deadline = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal
        ? AbortSignal.any([signal, deadline])
        : deadline;
      const response = await fetchImpl(url, { signal: requestSignal });
      if (!response?.ok) return null;
      const data = await response.json();
      requestSignal.throwIfAborted();
      return data && typeof data === 'object' ? data : null;
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }

  /**
   * The OpenStreetMap feature for this article, near its coordinate: the first
   * that carries the same name, else the nearest notable one (Photon holds the
   * name in the local language, and matched the query against the others).
   */
  async function osmFeature({ page, point, confirmKm }, target, signal) {
    const pad = 0.02;
    const data = await ask(
      photonSearchUrl(page.title, {
        bias: `${point.lat - pad},${point.lon - pad}|${point.lat + pad},${point.lon + pad}`,
        limit: 5,
        endpoint: photonEndpoint,
        // English names where OpenStreetMap has them, so "Japan" is found as
        // "Japan" rather than as 日本 and the same-name match can be made.
        lang: 'en',
      }),
      signal,
    );
    if (!Array.isArray(data?.features)) return null;
    const wanted = new Set([fold(page.title), target]);
    const area = placeTypes(point, page.description).includes(
      'natural_feature',
    );
    const limitKm = confirmKm ?? (area ? AREA_MATCH_KM : POINT_MATCH_KM);
    const nearKm =
      confirmKm !== null
        ? Math.min(confirmKm, ADMINISTRATIVE_NEAR_KM)
        : area
          ? AREA_NEAR_KM
          : POINT_NEAR_KM;
    const wantsStreet = STREET_DESCRIPTION.test(String(page.description || ''));

    let named = null;
    let nearest = null;
    let nearestKm = Infinity;
    for (const feature of data.features) {
      const place = normalizePhotonFeature(feature);
      if (!place) continue;
      // The lane beside the Colosseum is called "Colosseum" too, and framing a
      // monument as a street corridor is worse than the Wikipedia point.
      if (!wantsStreet && place.types.includes('route')) continue;
      const km = distanceKm(point.lat, point.lon, place.lat, place.lng);
      if (km > limitKm) continue;
      const key = String(feature.properties?.osm_key || '');
      // A river or a reef is framed by a natural feature or boundary of its
      // own name, or by its article's point — never by whatever notable thing
      // happens to sit near that point.
      if (area && !AREA_NOTABLE_KEYS.has(key)) continue;
      if (wanted.has(fold(place.name))) {
        named = place;
        break;
      }
      if (!area && km <= nearKm && km < nearestKm && NOTABLE_KEYS.has(key)) {
        nearest = place;
        nearestKm = km;
      }
    }
    return named ?? nearest;
  }

  return {
    async geocode(query, { signal } = {}) {
      signal?.throwIfAborted();
      const text = String(query ?? '').trim();
      const target = fold(text);
      if (
        !target ||
        /[\d,]/.test(text) ||
        text.split(/\s+/).length > MAX_QUERY_WORDS
      )
        return { place: null, answered: true };

      // An acronym is a case-sensitive title: "LAX" redirects to the airport,
      // while "Lax" — what a case-blind comparison takes it for — is a
      // disambiguation page. It is asked for exactly first, and remembered
      // apart from the word.
      const acronym = /^[A-Z]{2,6}$/.test(text);
      const key = acronym ? `=${text}` : target;
      const cached = cache.get(key);
      if (cached && cached.expires > now())
        return { place: cached.place, answered: true };
      cache.delete(key);
      if (now() < pausedUntil) return { place: null, answered: false };

      let hit;
      if (acronym) {
        const exact = await ask(titlesUrl([text], endpoint), signal);
        const resolved = exact ? resolvedPage(exact, text) : null;
        if (resolved)
          hit = pickPage([resolved], target, { anyTitle: true }) ?? undefined;
      }

      if (hit === undefined) {
        const data = await ask(searchUrl(text, endpoint), signal);
        // No answer is not "no such article": it is not remembered, and the
        // geocoders behind this one carry on.
        if (!data) {
          unanswered += 1;
          if (unanswered >= UNANSWERED_BEFORE_PAUSE) {
            unanswered = 0;
            pausedUntil = now() + PAUSE_MS;
          }
          return { place: null, answered: false };
        }
        unanswered = 0;
        const pages = Array.isArray(data.query?.pages) ? data.query.pages : [];
        hit = pickPage(pages, target);

        // No page bears the name, but the name may be a redirect to the article
        // ("Pyramids of Giza" → "Giza pyramid complex"), which the search lists
        // under the article's own title. Asking for the name as a title resolves it.
        if (hit === undefined) {
          const variants = titleVariants(text);
          const titles = await ask(titlesUrl(variants, endpoint), signal);
          if (!titles) return { place: null, answered: false };
          hit = null;
          for (const variant of variants) {
            const resolved = resolvedPage(titles, variant);
            if (!resolved) continue;
            hit = pickPage([resolved], target, { anyTitle: true }) ?? null;
            break;
          }
        }
      }

      // An article that reads like a place but carries no coordinate of its own
      // (Petra) borrows its Wikidata item's — and, like any administrative
      // kind, is answered only when OpenStreetMap confirms it nearby.
      if (hit && !hit.point) {
        const point = wikidataPoint(
          await ask(wikidataUrl(hit.item, wikidataEndpoint), signal),
          hit.item,
        );
        hit = point ? { ...hit, point } : null;
      }

      let place = null;
      if (hit) {
        place = await osmFeature(hit, target, signal);
        // An administrative place is framed by its OpenStreetMap box or not at
        // all; anything else may stand on the Wikipedia point.
        if (!place && hit.confirmKm === null)
          place = {
            lat: hit.point.lat,
            lng: hit.point.lon,
            name: hit.page.title,
            label: hit.page.title,
            types: placeTypes(hit.point, hit.page.description),
            viewport: extentViewport(hit.point),
          };
      }
      signal?.throwIfAborted();
      cache.set(key, {
        place,
        expires: now() + (place ? HIT_TTL_MS : MISS_TTL_MS),
      });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return { place, answered: true };
    },
  };
}
