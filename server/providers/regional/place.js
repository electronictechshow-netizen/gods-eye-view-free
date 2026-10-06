import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { coalesceProxyRequest } from '../common/http.js';
import { fetchRegionalJson } from './http.js';
import { naturalRegionAtPoint } from '../../../src/data/naturalEarthRegions.js';
import {
  nominatimToGeocodeResult,
  nominatimViewboxFromBounds,
} from '../../../src/nominatimGeocode.js';

/**
 * The usage policy for the public Nominatim instance asks for a User-Agent or
 * Referer that identifies the application, and states that stock library
 * agents will not do. Both are sent.
 */
const NOMINATIM_HEADERS = Object.freeze({
  'User-Agent':
    'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)',
  Referer: 'https://github.com/bilawalsidhu/gods-eye-view',
});

/**
 * Minimum spacing between upstream calls. The policy states an absolute
 * maximum of one request per second; 1.1 s keeps clock jitter from crossing it.
 */
const NOMINATIM_MIN_SPACING_MS = 1100;

/**
 * How many searches may be waiting for their turn.
 *
 * One request per second and an unbounded queue are incompatible: a burst of
 * searches would keep the upstream busy long after everyone who asked has given
 * up, which is exactly the load the policy asks callers not to create. Past
 * this depth a search is refused at once instead of being promised a slot
 * minutes away.
 */
const NOMINATIM_MAX_PENDING = 4;

/**
 * How long a queued search may wait before it is not worth sending. The
 * browser gives up well before this, so anything reaching the front later than
 * this is answering nobody.
 */
const NOMINATIM_MAX_WAIT_MS = 10_000;

const NOMINATIM_SEARCH_CACHE_MS = 5 * 60_000;

const NOMINATIM_SEARCH_MAX_CACHE = 80;

const NOMINATIM_SEARCH_MAX_QUERY = 200;

// The pacer is deliberately module state while everything else here is
// per-instance. One request per second is a budget for the whole application,
// not for each provider object: two instances each pacing themselves would
// send two requests a second between them. Only last-resort forward searches
// use this queue.
let _nominatimQueue = Promise.resolve();

let _nominatimLastRequestAt = 0;

let _nominatimPending = 0;

/** Raised when the queue is already as deep as it is allowed to get. */
function queueFullError() {
  return Object.assign(new Error('Place search queue is full'), {
    code: 'NOMINATIM_QUEUE_FULL',
  });
}

/** Raised when a queued search waited so long that nobody is left to answer. */
function abandonedError() {
  return Object.assign(new Error('Place search was abandoned'), {
    code: 'NOMINATIM_ABANDONED',
  });
}

/**
 * Run one piece of upstream work, never closer than the policy spacing to the
 * last one.
 *
 * `bounded` applies queue-depth and staleness limits to interactive forward searches.
 *
 * @param {() => Promise<unknown>} work
 * @param {{bounded?: boolean, signal?: AbortSignal}} [options]
 */
function enqueueNominatim(work, { bounded = false, signal } = {}) {
  if (bounded && _nominatimPending >= NOMINATIM_MAX_PENDING)
    return Promise.reject(queueFullError());
  if (bounded) _nominatimPending += 1;
  const queuedAt = Date.now();
  const task = _nominatimQueue.then(async () => {
    try {
      const waitMs = Math.max(
        0,
        NOMINATIM_MIN_SPACING_MS - (Date.now() - _nominatimLastRequestAt),
      );
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Nobody is waiting for this any more: sending it would spend the one
      // request per second the policy allows on an answer with no reader.
      if (bounded && Date.now() - queuedAt > NOMINATIM_MAX_WAIT_MS)
        throw abandonedError();
      if (signal?.aborted) throw abandonedError();
      _nominatimLastRequestAt = Date.now();
      return await work();
    } finally {
      if (bounded) _nominatimPending -= 1;
    }
  });
  _nominatimQueue = task.catch(() => null);
  return task;
}

/** Construct the offline regional context provider from bundled Natural Earth polygons. */
export function createRegionalPlaceProvider() {
  return (point) => naturalRegionAtPoint(point.latitude, point.longitude);
}

export const fetchRegionalPlace = createRegionalPlaceProvider();

/**
 * Construct the forward search adapter with a trusted endpoint.
 *
 * The policy asks that results be cached, and warns that a client repeating the
 * same query may be treated as faulty, so an answer is remembered and identical
 * searches already in flight share one upstream call rather than queueing
 * behind each other.
 */
export function createNominatimSearchProvider({
  endpoint = 'https://nominatim.openstreetmap.org/search',
  requestJson = fetchRegionalJson,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  const trimCache = () => {
    while (cache.size > NOMINATIM_SEARCH_MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  return async function fetchNominatimSearch(query, bounds, { signal } = {}) {
    const cacheKey = `${query.toLowerCase()}|${bounds || ''}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= NOMINATIM_SEARCH_CACHE_MS) {
      return { ...cached.payload, cached: true };
    }
    const { promise } = coalesceProxyRequest(inFlight, cacheKey, async () => {
      const params = new URLSearchParams({
        format: 'jsonv2',
        q: query,
        addressdetails: '1',
        limit: '1',
        'accept-language': 'en',
      });
      const viewbox = nominatimViewboxFromBounds(bounds);
      if (viewbox) params.set('viewbox', viewbox);
      const rows = await enqueueNominatim(
        () =>
          requestJson(`${endpoint}?${params}`, {
            headers: NOMINATIM_HEADERS,
            redirect: 'error',
          }),
        { bounded: true, signal },
      );
      const result = nominatimToGeocodeResult(
        Array.isArray(rows) ? rows[0] : null,
      );
      const payload = result
        ? { status: 'OK', results: [result] }
        : { status: 'ZERO_RESULTS', results: [] };
      cache.set(cacheKey, { payload, cachedAt: Date.now() });
      trimCache();
      return payload;
    });
    return await promise;
  };
}

export const fetchNominatimSearch = createNominatimSearchProvider();

/** Vite plugin: last-resort place search over the public Nominatim instance. */
export function geocodeProxy({ search = fetchNominatimSearch } = {}) {
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 30,
    globalMax: 90,
  });

  function install(middlewares) {
    middlewares.use('/api/geocode', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      if (!limiter(clientKey(req))) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '10',
        });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      const url = new URL(req.url || '', 'http://localhost');
      const query = String(url.searchParams.get('q') || '').trim();
      if (!query || query.length > NOMINATIM_SEARCH_MAX_QUERY) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'A place query of 1-200 characters is required',
          }),
        );
        return;
      }
      // A browser that gave up is no longer waiting; the queue reads this
      // before spending its slot.
      const abandoned = new AbortController();
      req.on?.('aborted', () => abandoned.abort());
      res.on?.('close', () => abandoned.abort());
      try {
        const payload = await search(query, url.searchParams.get('bounds'), {
          signal: abandoned.signal,
        });
        if (res.writableEnded) return;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': payload.cached ? 'public, max-age=60' : 'no-store',
        });
        res.end(
          JSON.stringify({ status: payload.status, results: payload.results }),
        );
      } catch (error) {
        if (res.writableEnded) return;
        const busy =
          error?.code === 'NOMINATIM_QUEUE_FULL' ||
          error?.code === 'NOMINATIM_ABANDONED';
        res.writeHead(busy ? 429 : 503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...(busy ? { 'Retry-After': '5' } : {}),
        });
        res.end(
          JSON.stringify({
            error: busy
              ? 'Place search is busy'
              : 'Place search is temporarily unavailable',
          }),
        );
      }
    });
  }

  return {
    name: 'geocode-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// Named administrative boundaries (state / country / county / city outlines)
// ---------------------------------------------------------------------------

/**
 * Nominatim `place_rank` a boundary of each scope usually has: a soft
 * preference, since a geocoder's guess at the scope can be one level off.
 */
const BOUNDARY_SCOPE_RANK = Object.freeze({
  country: 4,
  state: 8,
  county: 12,
  city: 16,
  neighborhood: 20,
  // A named thing with an outline of its own — a building, a park, a base —
  // asked for when the Overpass footprint lookup cannot answer.
  feature: null,
});

/** How far (km) a named feature's outline may lie from the point its name was geocoded to. */
const FEATURE_MAX_DISTANCE_KM = 1;

/**
 * `polygon_threshold` per scope, in degrees: Nominatim simplifies the outline
 * before sending it. A state is drawn at regional scale, where a kilometre of
 * simplification is invisible; a neighbourhood needs metres.
 */
const BOUNDARY_SCOPE_THRESHOLD = Object.freeze({
  country: 0.02,
  state: 0.01,
  county: 0.003,
  city: 0.001,
  neighborhood: 0.0002,
  feature: 0.00002,
});

const BOUNDARY_CACHE_MS = 24 * 60 * 60_000;
const BOUNDARY_MAX_CACHE = 100;
const BOUNDARY_MAX_QUERY = 120;
const BOUNDARY_RESULT_LIMIT = 5;

/** Words that say what kind of area it is, not which one. */
const BOUNDARY_GENERIC_WORDS = new Set([
  'the',
  'of',
  'state',
  'city',
  'county',
  'province',
  'republic',
  'kingdom',
]);

function boundaryWords(text) {
  return new Set(
    String(text ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((word) => word && !BOUNDARY_GENERIC_WORDS.has(word)),
  );
}

/** Even-odd ray cast of `[lon, lat]` against one ring of `[lon, lat]` pairs. */
function boundaryRingContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

/** Distance (km) from a point to the nearest vertex of a ring: close enough for a 1 km gate. */
function boundaryRingDistanceKm(ring, lon, lat) {
  const toRad = Math.PI / 180;
  let nearest = Infinity;
  for (const [x, y] of ring) {
    const dLat = (y - lat) * toRad;
    const dLon = (x - lon) * toRad;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * toRad) * Math.cos(y * toRad) * Math.sin(dLon / 2) ** 2;
    nearest = Math.min(nearest, 12742 * Math.asin(Math.min(1, Math.sqrt(h))));
  }
  return nearest;
}

/** Shoelace area of a ring in square degrees, scaled for latitude: only compared, never reported. */
function boundaryRingArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1)
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  const lat = ring[0]?.[1] ?? 0;
  return Math.abs(sum / 2) * Math.cos((lat * Math.PI) / 180);
}

/** The outer rings of a GeoJSON Polygon or MultiPolygon that are usable outlines. */
function boundaryOuterRings(geojson) {
  const polygons =
    geojson?.type === 'Polygon'
      ? [geojson.coordinates]
      : geojson?.type === 'MultiPolygon'
        ? geojson.coordinates
        : [];
  return (Array.isArray(polygons) ? polygons : [])
    .map((polygon) => (Array.isArray(polygon) ? polygon[0] : null))
    .filter(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(
          (point) =>
            Array.isArray(point) &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1]) &&
            Math.abs(point[0]) <= 180 &&
            Math.abs(point[1]) <= 90,
        ),
    );
}

/**
 * Pick the boundary a name means from Nominatim rows, and the ring to draw.
 *
 * The name must be (most of) what the row is called. Containing the point the
 * name was geocoded to is a strong preference, not a requirement: a geocoder
 * that answers with a box gives its centre, and the centre of Norway's box lies
 * in Sweden. Of a multi-part area (Japan, Hawaii) the part holding the point is
 * drawn, else the largest.
 *
 * @param {object[]} rows - Nominatim jsonv2 rows with `geojson`.
 * @param {{name: string, lat?: number, lon?: number, scope?: string}} wanted
 * @returns {null | {name: string, osm: string, ring: number[][]}}
 */
export function selectNominatimBoundary(rows, { name, lat, lon, scope } = {}) {
  const wanted = boundaryWords(name);
  if (!wanted.size) return null;
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
  const expectedRank = BOUNDARY_SCOPE_RANK[scope];
  let best = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const rings = boundaryOuterRings(row?.geojson);
    if (!rings.length) continue;
    const kind = String(row.category ?? row.class ?? '').toLowerCase();
    const feature = scope === 'feature';
    if (!feature && kind !== 'boundary' && kind !== 'place') continue;
    const names = boundaryWords(row.name);
    let overlap = 0;
    for (const word of wanted) if (names.has(word)) overlap += 1;
    if (overlap / wanted.size < 0.5) continue;
    const exact = overlap === wanted.size && names.size === wanted.size;
    const holding = hasPoint
      ? rings.find((ring) => boundaryRingContains(ring, lon, lat))
      : null;
    // A feature is the one at the geocoded point, not a namesake elsewhere.
    if (
      feature &&
      hasPoint &&
      !holding &&
      Math.min(...rings.map((ring) => boundaryRingDistanceKm(ring, lon, lat))) >
        FEATURE_MAX_DISTANCE_KM
    )
      continue;
    const rank = Number(row.place_rank);
    const score =
      (holding ? 1000 : 0) +
      (exact ? 300 : 0) +
      (kind === 'boundary' ? 100 : 0) +
      (overlap / wanted.size) * 100 -
      (expectedRank && Number.isFinite(rank)
        ? Math.abs(rank - expectedRank) * 15
        : 0);
    if (best && score <= best.score) continue;
    const ring =
      holding ??
      rings.reduce((a, b) =>
        boundaryRingArea(b) > boundaryRingArea(a) ? b : a,
      );
    best = {
      score,
      result: {
        name: String(row.name ?? ''),
        osm: `${row.osm_type ?? ''}/${row.osm_id ?? ''}`,
        category: kind,
        ring: ring.map(([x, y]) => [x, y]),
      },
    };
  }
  return best ? best.result : null;
}

/**
 * Construct the named-boundary lookup over the public Nominatim instance.
 *
 * Every Overpass-backed outline (a state, a country) used to fail on networks
 * where the Overpass mirrors refuse or cannot be reached. Nominatim — the OSM
 * Foundation's own geocoder — returns the same OpenStreetMap boundary, already
 * simplified, in one request. It shares the search route's one-request-per-
 * second queue, and answers are remembered for a day: a boundary is looked up
 * about once per session, not once per question.
 */
export function createNominatimBoundaryProvider({
  endpoint = 'https://nominatim.openstreetmap.org/search',
  requestJson = fetchRegionalJson,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  return async function fetchNominatimBoundary(
    { name, lat, lon, scope },
    { signal } = {},
  ) {
    const point =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? `${lat.toFixed(1)},${lon.toFixed(1)}`
        : '';
    const cacheKey = `${scope || ''}|${name.toLowerCase()}|${point}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= BOUNDARY_CACHE_MS)
      return { ...cached.payload, cached: true };
    const { promise } = coalesceProxyRequest(inFlight, cacheKey, async () => {
      // "the Colosseum" finds its namesakes titled with the article first, but
      // the Pentagon is called "The Pentagon": the name without its article is
      // asked first, and as given only when that finds nothing.
      const bare = name.replace(/^(the|a|an)\s+/i, '');
      let chosen = null;
      for (const q of bare === name ? [name] : [bare, name]) {
        const params = new URLSearchParams({
          format: 'jsonv2',
          q,
          polygon_geojson: '1',
          polygon_threshold: String(BOUNDARY_SCOPE_THRESHOLD[scope] ?? 0.005),
          limit: String(BOUNDARY_RESULT_LIMIT),
          'accept-language': 'en',
        });
        const rows = await enqueueNominatim(
          () =>
            requestJson(`${endpoint}?${params}`, {
              headers: NOMINATIM_HEADERS,
              redirect: 'error',
              timeoutMs: 12_000,
              maxBytes: 8 * 1024 * 1024,
            }),
          { bounded: true, signal },
        );
        chosen = selectNominatimBoundary(rows, { name, lat, lon, scope });
        if (chosen) break;
      }
      const payload = chosen
        ? {
            name: chosen.name,
            osm: chosen.osm,
            category: chosen.category,
            ring: chosen.ring,
          }
        : { ring: null };
      cache.set(cacheKey, { payload, cachedAt: Date.now() });
      while (cache.size > BOUNDARY_MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return payload;
    });
    return await promise;
  };
}

export const fetchNominatimBoundary = createNominatimBoundaryProvider();

/** Vite plugin: named administrative boundaries over the public Nominatim instance. */
export function boundaryProxy({ lookup = fetchNominatimBoundary } = {}) {
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 20,
    globalMax: 60,
  });

  function install(middlewares) {
    middlewares.use('/api/boundary', async (req, res) => {
      const reply = (status, body, headers = {}) => {
        if (res.writableEnded) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...headers,
        });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET')
        return reply(405, { error: 'Method Not Allowed' });
      if (!limiter(clientKey(req)))
        return reply(
          429,
          { error: 'Rate limit exceeded' },
          { 'Retry-After': '10' },
        );
      const url = new URL(req.url || '', 'http://localhost');
      const name = String(url.searchParams.get('q') || '').trim();
      if (!name || name.length > BOUNDARY_MAX_QUERY)
        return reply(400, {
          error: 'A boundary name of 1-120 characters is required',
        });
      const scope = String(url.searchParams.get('scope') || '');
      if (scope && !Object.hasOwn(BOUNDARY_SCOPE_RANK, scope))
        return reply(400, { error: 'Unknown boundary scope' });
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      const point =
        url.searchParams.has('lat') &&
        url.searchParams.has('lon') &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180;
      const abandoned = new AbortController();
      req.on?.('aborted', () => abandoned.abort());
      res.on?.('close', () => abandoned.abort());
      try {
        const payload = await lookup(
          {
            name,
            scope: scope || undefined,
            ...(point ? { lat, lon } : {}),
          },
          { signal: abandoned.signal },
        );
        reply(200, {
          name: payload.name ?? null,
          osm: payload.osm ?? null,
          category: payload.category ?? null,
          ring: payload.ring ?? null,
        });
      } catch (error) {
        const busy =
          error?.code === 'NOMINATIM_QUEUE_FULL' ||
          error?.code === 'NOMINATIM_ABANDONED';
        reply(
          busy ? 429 : 503,
          {
            error: busy
              ? 'Boundary lookup is busy'
              : 'Boundary lookup is temporarily unavailable',
          },
          busy ? { 'Retry-After': '5' } : {},
        );
      }
    });
  }

  return {
    name: 'boundary-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { NOMINATIM_MAX_PENDING };
