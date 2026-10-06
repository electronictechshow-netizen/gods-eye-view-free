import assert from 'node:assert/strict';
import test from 'node:test';
import {
  googlePlacesContextProxy,
  keylessGooglePlacesResponse,
} from '../vite.config.js';

const KEYLESS_PAYLOAD = { configured: false, error: null, places: [] };

/** One OSM-shaped result, so no test reaches Photon. */
const OSM_PLACE = {
  id: 'node/1',
  name: 'Texas State Capitol',
  address: 'Congress Avenue, Austin',
  latitude: 30.2747,
  longitude: -97.7404,
  distanceM: 120,
  primaryType: 'attraction',
  types: ['tourist_attraction', 'point_of_interest'],
};

function installGooglePlacesRoutes(options = {}) {
  const routes = new Map();
  googlePlacesContextProxy({
    nearbyProvider: async () => [OSM_PLACE],
    textSearchProvider: async () => [OSM_PLACE],
    // A keyless request must never reach Google; this makes that observable.
    fetchImpl: async () => {
      throw new Error('Google must not be called without a key');
    },
    ...options,
  }).configureServer({
    middlewares: {
      use(path, handler) {
        routes.set(path, handler);
      },
    },
  });
  return routes;
}

function invokeRoute(
  handler,
  { method = 'GET', url = '/', remoteAddress = '127.0.0.1' } = {},
) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const req = { method, url, headers: {}, socket: { remoteAddress } };
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
      },
      end(body = '') {
        resolve({
          statusCode: this.statusCode,
          headers: Object.fromEntries(headers),
          body: body ? JSON.parse(String(body)) : null,
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function withoutGoogleKeys(run) {
  const previous = {
    server: process.env.GOOGLE_MAPS_SERVER_API_KEY,
    browser: process.env.GOOGLE_MAPS_API_KEY,
    limit: process.env.GEV_RATELIMIT_GOOGLE_PER_MIN,
  };
  process.env.GOOGLE_MAPS_SERVER_API_KEY = '';
  process.env.GOOGLE_MAPS_API_KEY = '';
  return (async () => {
    try {
      return await run();
    } finally {
      for (const [name, value] of [
        ['GOOGLE_MAPS_SERVER_API_KEY', previous.server],
        ['GOOGLE_MAPS_API_KEY', previous.browser],
        ['GEV_RATELIMIT_GOOGLE_PER_MIN', previous.limit],
      ]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  })();
}

test('builds the keyless capability response only for a blank key', () => {
  // The helper itself is unchanged: it still reports "no Google key". What
  // changed is what the ROUTES do with that answer — they now fall back to
  // OpenStreetMap instead of returning the empty payload verbatim.
  assert.deepEqual(keylessGooglePlacesResponse(undefined), {
    statusCode: 200,
    payload: KEYLESS_PAYLOAD,
  });
  assert.deepEqual(keylessGooglePlacesResponse('  '), {
    statusCode: 200,
    payload: KEYLESS_PAYLOAD,
  });
  assert.equal(keylessGooglePlacesResponse('configured-key'), null);
});

test('keyless Places routes answer from OpenStreetMap instead of empty', async () => {
  await withoutGoogleKeys(async () => {
    const routes = installGooglePlacesRoutes();

    const nearby = await invokeRoute(routes.get('/api/google/nearby-places'), {
      url: '/?lat=30.27&lon=-97.74',
    });
    assert.equal(nearby.statusCode, 200);
    assert.equal(nearby.body.source, 'osm');
    assert.equal(nearby.body.error, null);
    assert.deepEqual(nearby.body.places, [OSM_PLACE]);

    const text = await invokeRoute(routes.get('/api/google/text-search'), {
      url: '/?q=capitol&lat=30.27&lon=-97.74',
    });
    assert.equal(text.statusCode, 200);
    assert.equal(text.body.source, 'osm');
    assert.deepEqual(text.body.places, [OSM_PLACE]);
  });
});

test('keyless Places routes stay successful after the Google quota is exhausted', async () => {
  await withoutGoogleKeys(async () => {
    process.env.GEV_RATELIMIT_GOOGLE_PER_MIN = '1';
    const routes = installGooglePlacesRoutes();
    const nearby = routes.get('/api/google/nearby-places');
    const textSearch = routes.get('/api/google/text-search');
    assert.equal(typeof nearby, 'function');
    assert.equal(typeof textSearch, 'function');

    // The limiter allows one request per minute; a keyless answer costs the
    // provider nothing, so it must resolve before the limiter and keep
    // succeeding well past that ceiling.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nearbyResponse = await invokeRoute(nearby, {
        url: '/?lat=30.27&lon=-97.74',
      });
      assert.equal(nearbyResponse.statusCode, 200, `nearby attempt ${attempt}`);
      assert.equal(nearbyResponse.body.source, 'osm');

      const textResponse = await invokeRoute(textSearch, {
        url: '/?q=capitol&lat=30.27&lon=-97.74',
      });
      assert.equal(textResponse.statusCode, 200, `text attempt ${attempt}`);
      assert.equal(textResponse.body.source, 'osm');
    }
  });
});

test('a keyless lookup failure degrades to an empty list, not an error', async () => {
  await withoutGoogleKeys(async () => {
    const routes = installGooglePlacesRoutes({
      nearbyProvider: async () => {
        throw new Error('Photon unreachable');
      },
    });
    const response = await invokeRoute(
      routes.get('/api/google/nearby-places'),
      {
        url: '/?lat=30.27&lon=-97.74',
      },
    );
    // Callers treat `error` as a configuration problem worth surfacing; an
    // upstream blip is neither, so it stays a successful empty answer.
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.places, []);
    assert.equal(response.body.error, null);
    assert.match(response.body.unavailable, /Photon unreachable/);
  });
});

test('keyless routes still validate coordinates before answering', async () => {
  await withoutGoogleKeys(async () => {
    const routes = installGooglePlacesRoutes();
    const response = await invokeRoute(
      routes.get('/api/google/nearby-places'),
      {
        url: '/?lat=999&lon=-97.74',
      },
    );
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body.places, []);
  });
});
