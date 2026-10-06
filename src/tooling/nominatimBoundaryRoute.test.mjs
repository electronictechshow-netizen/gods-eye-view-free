// NAMED BOUNDARIES — state, country, county and city outlines (and "how many
// flights over Texas") from the keyless Nominatim route, so they work where
// every Overpass mirror refuses or cannot be reached.
//
// What matters here: the boundary chosen is the one the name means (its name,
// the point it was geocoded to, the scope), the route keeps to the public
// instance's policy (one shared queue, answers remembered), and the resolver
// asks it first for named admin scopes and as a fallback when Overpass fails.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryProxy,
  createNominatimBoundaryProvider,
  selectNominatimBoundary,
} from '../../server/providers/regional/place.js';
import { localProviderPlugins } from '../../server/providers/local.js';
import { createApplicationRequestServices } from '../services/requests.js';
import { createAnnotationResolver } from '../annotations/resolver.js';
import { FEATURE_SOURCE_METHODS } from '../sources/featureSource.js';

/** A square ring of `[lon, lat]` around a centre. */
const square = (lon, lat, half) => [
  [lon - half, lat - half],
  [lon + half, lat - half],
  [lon + half, lat + half],
  [lon - half, lat + half],
  [lon - half, lat - half],
];
const row = (name, ring, extra = {}) => ({
  name,
  category: 'boundary',
  type: 'administrative',
  place_rank: 8,
  osm_type: 'relation',
  osm_id: 1,
  geojson: { type: 'Polygon', coordinates: [ring] },
  ...extra,
});

test('the boundary is the one the name means, holding the point it was geocoded to', () => {
  const georgiaState = row('Georgia', square(-83.5, 32.7, 2), {
    osm_id: 2,
    place_rank: 8,
  });
  const georgiaCountry = row('Georgia', square(43.5, 42.3, 2), {
    osm_id: 3,
    place_rank: 4,
  });
  const rows = [georgiaCountry, georgiaState];
  assert.equal(
    selectNominatimBoundary(rows, {
      name: 'Georgia',
      lat: 32.7,
      lon: -83.5,
      scope: 'state',
    }).osm,
    'relation/2',
  );
  assert.equal(
    selectNominatimBoundary(rows, {
      name: 'Georgia',
      lat: 42.3,
      lon: 43.5,
      scope: 'country',
    }).osm,
    'relation/3',
  );
  assert.equal(
    selectNominatimBoundary(rows, { name: 'Georgia', scope: 'country' }).osm,
    'relation/3',
    'without a point the scope decides',
  );
});

test("a point outside every part still finds the named area (Norway's box centre is in Sweden)", () => {
  const norway = row('Norway', square(10, 61, 3), { place_rank: 4 });
  const chosen = selectNominatimBoundary([norway], {
    name: 'Norway',
    lat: 64.5,
    lon: 17.8,
    scope: 'country',
  });
  assert.equal(chosen.name, 'Norway');
  assert.equal(chosen.ring.length, 5);
});

test('of a multi-part area, the part holding the point is drawn, else the largest', () => {
  const japan = {
    ...row('Japan', square(0, 0, 0), { place_rank: 4 }),
    geojson: {
      type: 'MultiPolygon',
      coordinates: [
        [square(130.7, 32.6, 1)],
        [square(138.5, 36, 3)],
        [square(142.8, 43.4, 1.5)],
      ],
    },
  };
  assert.deepEqual(
    selectNominatimBoundary([japan], { name: 'Japan', lat: 43.4, lon: 142.8 })
      .ring[0],
    [141.3, 41.9],
  );
  assert.deepEqual(
    selectNominatimBoundary([japan], { name: 'Japan' }).ring[0],
    [135.5, 33],
    'the largest part when no point is given',
  );
});

test('a different name, a point feature or a non-boundary is never the outline', () => {
  for (const candidate of [
    row('Oklahoma', square(-97.5, 35.5, 2)),
    { ...row('Texas', square(-99, 31, 4)), geojson: { type: 'Point' } },
    { ...row('Texas', square(-99, 31, 4)), category: 'amenity' },
    {
      ...row('Texas', square(-99, 31, 4)),
      geojson: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      },
    },
  ])
    assert.equal(
      selectNominatimBoundary([candidate], { name: 'Texas', scope: 'state' }),
      null,
      JSON.stringify(candidate).slice(0, 80),
    );
  assert.equal(selectNominatimBoundary([], { name: '' }), null);
});

test('the provider asks for simplified polygons, remembers answers and shares one request', async () => {
  const urls = [];
  const lookup = createNominatimBoundaryProvider({
    requestJson: async (url) => {
      urls.push(new URL(url));
      return [row('Texas', square(-99, 31, 4))];
    },
  });
  const ask = () =>
    lookup({ name: 'Texas', lat: 31.1, lon: -99.2, scope: 'state' });
  const [first, second] = await Promise.all([ask(), ask()]);
  const third = await ask();
  assert.equal(urls.length, 1, 'identical lookups share one upstream call');
  assert.equal(first.name, 'Texas');
  assert.deepEqual(second.ring, first.ring);
  assert.equal(third.cached, true);
  const params = urls[0].searchParams;
  assert.equal(params.get('polygon_geojson'), '1');
  assert.equal(params.get('polygon_threshold'), '0.01');
  assert.equal(params.get('format'), 'jsonv2');
  assert.equal(params.get('q'), 'Texas');

  const none = await createNominatimBoundaryProvider({
    requestJson: async () => [],
  })({ name: 'Atlantis', scope: 'country' });
  assert.deepEqual(none, { ring: null });
});

/** Mount the boundary route the way the dev server does. */
function mountBoundary(lookup) {
  const routes = new Map();
  boundaryProxy({ lookup }).configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  let client = 0;
  return async (path) => {
    client += 1;
    const handler = routes.get('/api/boundary');
    const requested = new URL(path, 'http://localhost');
    return await new Promise((resolve) => {
      let status = 200;
      const res = {
        writableEnded: false,
        on() {},
        writeHead(code) {
          status = code;
        },
        end(body) {
          res.writableEnded = true;
          resolve({ status, body: JSON.parse(body) });
        },
      };
      handler(
        {
          method: 'GET',
          url: requested.search || '/',
          headers: {},
          socket: { remoteAddress: `10.1.0.${client}` },
          on() {},
        },
        res,
      );
    });
  };
}

test('the route validates its input and reports an upstream failure as unavailable', async () => {
  const asked = [];
  const request = mountBoundary(async (query) => {
    asked.push(query);
    if (query.name === 'Down') throw new Error('upstream 502');
    return { name: 'Texas', osm: 'relation/114690', ring: square(-99, 31, 4) };
  });
  const ok = await request(
    '/api/boundary?q=Texas&lat=31.1&lon=-99.2&scope=state',
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, 'Texas');
  assert.equal(ok.body.ring.length, 5);
  assert.deepEqual(asked[0], {
    name: 'Texas',
    scope: 'state',
    lat: 31.1,
    lon: -99.2,
  });
  assert.equal((await request('/api/boundary')).status, 400);
  assert.equal(
    (await request('/api/boundary?q=Texas&scope=galaxy')).status,
    400,
  );
  assert.equal((await request('/api/boundary?q=Down')).status, 503);
  assert.equal(asked.at(-1).lat, undefined, 'no point, no point sent');
});

test('the dev server mounts the boundary route', () => {
  assert.ok(
    localProviderPlugins().some((plugin) => plugin.name === 'boundary-proxy'),
  );
});

test('the request service reads a ring, a definitive miss and a failure apart', async () => {
  const replies = [
    { status: 200, body: { ring: square(-99, 31, 4), name: 'Texas' } },
    { status: 200, body: { ring: null } },
    { status: 503, body: { error: 'down' } },
  ];
  const urls = [];
  const services = createApplicationRequestServices({
    fetchImpl: async (url) => {
      urls.push(url);
      const reply = replies.shift();
      return {
        ok: reply.status === 200,
        status: reply.status,
        headers: new Headers(),
        json: async () => reply.body,
      };
    },
  });
  const found = await services.adminBoundaries.lookup('Texas', {
    lat: 31.1,
    lon: -99.2,
    scope: 'state',
  });
  assert.equal(found.name, 'Texas');
  assert.equal(
    urls[0],
    '/api/boundary?q=Texas&lat=31.1000&lon=-99.2000&scope=state',
  );
  assert.equal(await services.adminBoundaries.lookup('Atlantis'), null);
  assert.equal(await services.adminBoundaries.lookup('Texas'), undefined);
});

const features = (overrides = {}) =>
  Object.assign(
    Object.fromEntries(
      FEATURE_SOURCE_METHODS.map((method) => [method, async () => []]),
    ),
    overrides,
  );
const placeSearch = (types, lat = 31.1, lng = -99.2) => ({
  async geocode() {
    return {
      place: {
        lat,
        lng,
        name: 'Freedonia City',
        label: 'Freedonia City',
        types,
      },
    };
  },
});

test('"flights over" a city gets its outline from the named lookup when Overpass cannot answer', async () => {
  const overpassCalls = [];
  const lookups = [];
  const resolver = createAnnotationResolver({
    featureSource: features({
      getAdministrativeAreas: async () => {
        overpassCalls.push('is_in');
        return null; // every mirror refused
      },
    }),
    boundaryLookup: {
      lookup: async (name, options) => {
        lookups.push({ name, scope: options.scope });
        return { ring: square(-99, 31, 0.2), name: 'Freedonia City' };
      },
    },
  });
  const region = await resolver.resolveRegionRingForQuery(
    'Freedonia City',
    undefined,
    placeSearch(['locality', 'political']),
  );
  assert.equal(region.name, 'Freedonia City');
  assert.ok(region.ring.length >= 4);
  assert.deepEqual(lookups, [{ name: 'Freedonia City', scope: 'city' }]);
  assert.equal(overpassCalls.length, 0, 'a named city is asked by name first');
});

test('a named miss still tries Overpass, and without the lookup nothing changes', async () => {
  const order = [];
  const resolver = createAnnotationResolver({
    featureSource: features({
      getAdministrativeAreas: async () => {
        order.push('overpass');
        return null;
      },
    }),
    boundaryLookup: {
      lookup: async (name, { scope }) => {
        order.push(`named:${scope}`);
        return scope === 'city' ? null : { ring: square(-122.4, 37.76, 0.01) };
      },
    },
  });
  assert.equal(
    await resolver.resolveRegionRingForQuery(
      'Freedonia City',
      undefined,
      placeSearch(['locality']),
    ),
    null,
  );
  assert.deepEqual(order, ['named:city', 'overpass']);

  const withoutLookup = createAnnotationResolver({
    featureSource: features({ getAdministrativeAreas: async () => null }),
  });
  assert.equal(
    await withoutLookup.resolveRegionRingForQuery(
      'Freedonia City',
      undefined,
      placeSearch(['locality']),
    ),
    null,
    'without the lookup nothing changes',
  );
});

test('a named feature is the one at the geocoded point, of any kind, never a namesake far away', () => {
  const pentagon = {
    ...row('The Pentagon', square(-77.0563, 38.8719, 0.002)),
    category: 'building',
    place_rank: 30,
  };
  const namesake = {
    ...row('The Pentagon', square(-80, 40, 0.002)),
    category: 'building',
    osm_id: 9,
  };
  const chosen = selectNominatimBoundary([namesake, pentagon], {
    name: 'the Pentagon',
    lat: 38.8719,
    lon: -77.0563,
    scope: 'feature',
  });
  assert.equal(chosen.category, 'building');
  assert.ok(Math.abs(chosen.ring[0][0] - -77.0583) < 1e-9);
  assert.equal(
    selectNominatimBoundary([namesake], {
      name: 'the Pentagon',
      lat: 38.8719,
      lon: -77.0563,
      scope: 'feature',
    }),
    null,
    '300 km away is another Pentagon',
  );
  assert.equal(
    selectNominatimBoundary([pentagon], {
      name: 'the Pentagon',
      scope: 'state',
    }),
    null,
    'a building is never a state',
  );
});

test('a building outline comes from the named-feature lookup when the Overpass footprint lookup fails', async () => {
  const asked = [];
  const resolver = createAnnotationResolver({
    featureSource: features({ getFootprints: async () => null }),
    boundaryLookup: {
      lookup: async (name, options) => {
        asked.push(options.scope);
        return {
          ring: square(-77.0563, 38.8719, 0.002),
          name: 'The Pentagon',
          category: 'building',
        };
      },
    },
  });
  const target = await resolver.resolveAnnotationTarget({
    latitude: 38.8719,
    longitude: -77.0563,
    target: 'the Pentagon',
    entityKind: 'building',
    footprint: true,
  });
  assert.ok(target.ring?.length >= 4, 'drawn as an outline, not a point');
  assert.equal(target.footprintKind, 'building');
  assert.deepEqual(asked, ['feature']);

  const without = createAnnotationResolver({
    featureSource: features({ getFootprints: async () => null }),
  });
  const point = await without.resolveAnnotationTarget({
    latitude: 38.8719,
    longitude: -77.0563,
    target: 'the Pentagon',
    entityKind: 'building',
    footprint: true,
  });
  assert.equal(point.ring, null, 'without the lookup it stays an honest point');
});

test('a name is asked without its article first, and as given only when that finds nothing', async () => {
  const asked = [];
  const lookup = createNominatimBoundaryProvider({
    requestJson: async (url) => {
      const q = new URL(url).searchParams.get('q');
      asked.push(q);
      return q === 'the Pentagon'
        ? [
            {
              ...row('The Pentagon', square(-77.0563, 38.8719, 0.002)),
              category: 'military',
            },
          ]
        : [];
    },
  });
  const found = await lookup({
    name: 'the Pentagon',
    lat: 38.8719,
    lon: -77.0563,
    scope: 'feature',
  });
  assert.equal(found.name, 'The Pentagon');
  assert.deepEqual(asked, ['Pentagon', 'the Pentagon']);
});
