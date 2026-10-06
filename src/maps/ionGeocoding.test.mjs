// CESIUM ION GEOCODING TRANSPORT — the place search's Google/Bing lookups run
// through CesiumJS's own IonGeocoderService, and each answer is credited on
// the globe the way Cesium's geocoder widget credits it.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIonGeocodeSearch } from './ionGeocoding.js';

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** A stand-in for the parts of Cesium the transport touches. */
function fakeCesium({ answers = {}, failure = null } = {}) {
  const constructed = [];
  class IonGeocoderService {
    constructor(options) {
      this.options = options;
      constructed.push(options);
    }
    async geocode(query, type) {
      assert.equal(type, 'SEARCH');
      if (failure) throw failure;
      return answers[query] ?? [];
    }
  }
  return {
    constructed,
    IonGeocoderService,
    IonGeocodeProviderType: { GOOGLE: 'GOOGLE', BING: 'BING' },
    GeocodeType: { SEARCH: 'SEARCH' },
    GeocoderService: {
      getCreditsFromResult: (result) =>
        result.attributions?.map((attribution) => ({ html: attribution.html })),
    },
    Math: { toDegrees: (radians) => (radians * 180) / Math.PI },
    Cartographic: {
      fromCartesian: (cartesian) => ({
        latitude: cartesian.lat,
        longitude: cartesian.lon,
      }),
    },
  };
}

function fakeScene() {
  const credits = [];
  return {
    credits,
    isDestroyed: () => false,
    frameState: {
      creditDisplay: {
        isDestroyed: () => false,
        addStaticCredit: (credit) => credits.push(credit),
        removeStaticCredit: (credit) =>
          credits.splice(credits.indexOf(credit), 1),
      },
    },
  };
}

test('no token, no transport', () => {
  assert.equal(createIonGeocodeSearch(fakeCesium(), {}), null);
  assert.equal(
    createIonGeocodeSearch(fakeCesium(), { accessToken: '  ' }),
    null,
  );
});

test('a search before the globe exists is "not ready"', async () => {
  const Cesium = fakeCesium();
  const search = createIonGeocodeSearch(Cesium, { accessToken: 'token' });
  assert.equal(await search('Paris'), null);
  assert.equal(Cesium.constructed.length, 0);
});

test('results come back in degrees, through the provider asked for, with the token passed explicitly', async () => {
  const Cesium = fakeCesium({
    answers: {
      Paris: [
        {
          displayName: 'Paris, France',
          destination: {
            west: toRadians(2.2),
            south: toRadians(48.8),
            east: toRadians(2.5),
            north: toRadians(48.9),
          },
          attributions: [{ html: 'Google' }],
        },
      ],
      Pin: [
        {
          displayName: 'Pin',
          destination: { lat: toRadians(10), lon: toRadians(20) },
        },
      ],
    },
  });
  const scene = fakeScene();
  const search = createIonGeocodeSearch(Cesium, {
    accessToken: 'token',
    getScene: () => scene,
  });
  const [paris] = await search('Paris', { provider: 'bing' });
  assert.equal(paris.label, 'Paris, France');
  assert.ok(Math.abs(paris.west - 2.2) < 1e-9);
  assert.ok(Math.abs(paris.north - 48.9) < 1e-9);
  assert.equal(Cesium.constructed[0].geocodeProviderType, 'BING');
  assert.equal(Cesium.constructed[0].accessToken, 'token');
  assert.equal(Cesium.constructed[0].scene, scene);

  const [pin] = await search('Pin');
  assert.ok(Math.abs(pin.lat - 10) < 1e-9 && Math.abs(pin.lng - 20) < 1e-9);
  assert.equal(Cesium.constructed[1].geocodeProviderType, 'GOOGLE');

  await search('Paris', { provider: 'bing' });
  assert.equal(Cesium.constructed.length, 2, 'one service per provider');
});

test("each answer's attribution replaces the previous one on the credit line", async () => {
  const answer = (html) => [
    {
      displayName: 'Somewhere',
      destination: { lat: 0, lon: 0 },
      attributions: [{ html }],
    },
  ];
  const Cesium = fakeCesium({
    answers: { A: answer('Google'), B: answer('Microsoft Bing') },
  });
  const scene = fakeScene();
  const search = createIonGeocodeSearch(Cesium, {
    accessToken: 'token',
    getScene: () => scene,
  });
  await search('A');
  assert.deepEqual(
    scene.credits.map((credit) => credit.html),
    ['Google'],
  );
  await search('B', { provider: 'bing' });
  assert.deepEqual(
    scene.credits.map((credit) => credit.html),
    ['Microsoft Bing'],
  );
  await search('Nothing');
  assert.deepEqual(
    scene.credits.map((credit) => credit.html),
    ['Microsoft Bing'],
    'an empty answer leaves the last credit standing',
  );
});

test('a refused request carries its HTTP status', async () => {
  const search = createIonGeocodeSearch(
    fakeCesium({ failure: { statusCode: 401 } }),
    { accessToken: 'token', getScene: fakeScene },
  );
  await assert.rejects(search('Paris'), { status: 401 });
});
