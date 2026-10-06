// NATURAL-REGION GEOCODER — "the Alps", "the Sahara", "Gulf of Mexico" answered
// from the bundled Natural Earth pack ahead of the network geocoders.
//
// What matters here: the answer must land INSIDE the real polygon (the outline
// code accepts a ring only when it contains the geocoded anchor), the place must
// read as a natural feature with a framing box (the camera swath is built for
// that shape), and nothing a city, state or country search should reach may be
// shadowed by a polygon of the same name.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNaturalRegionGeocoder } from './naturalRegionGeocoder.js';
import { createDefaultPlaceSearch } from './defaults.js';
import * as search from './index.js';
import {
  findNaturalRegion,
  listRegions,
  lookupNaturalRegionOutline,
} from '../data/naturalEarthRegions.js';

const geocoder = createNaturalRegionGeocoder({ lookup: findNaturalRegion });

/** Even-odd ray cast, ring = [[lon, lat], …]. Independent of the module under test. */
function contains(ring, lat, lon) {
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

const regionLookup = (region) => async () => region;

test('the real ranges, deserts and seas answer with an anchor inside the real polygon', async () => {
  for (const query of [
    'the Alps',
    'Alps',
    'the Andes',
    'the Sahara',
    'Sahara Desert',
    'the Rocky Mountains',
    'the Rockies',
    'the Himalayas',
    'the Gobi Desert',
    'the Appalachians',
    'the Pyrenees',
    'the Great Plains',
    'Gulf of Mexico',
    'the Persian Gulf',
    'the Mediterranean',
  ]) {
    const { place, answered } = await geocoder.geocode(query);
    assert.equal(answered, true, query);
    assert.ok(place, `${query} must resolve`);
    assert.deepEqual(place.types, ['natural_feature'], query);
    assert.equal(place.exact, true, `${query}: nothing nearby may replace it`);
    // The contract the annotation resolver depends on: the same pack, asked for
    // the outline at the geocoded anchor, must hand back a ring.
    const outline = await lookupNaturalRegionOutline(
      query,
      place.lat,
      place.lng,
    );
    assert.ok(
      outline,
      `${query}: the anchor must sit inside a polygon of the region`,
    );
    assert.ok(contains(outline.ring, place.lat, place.lng), query);
    // The camera swath reads southwest/northeast with lat/lng, and it looks at
    // the CENTRE of that box: the centre has to be in the range, not beside it.
    const { southwest, northeast } = place.viewport;
    assert.ok(southwest.lat < place.lat && place.lat < northeast.lat, query);
    assert.ok(southwest.lng < place.lng && place.lng < northeast.lng, query);
    assert.equal(
      contains(
        outline.ring,
        (southwest.lat + northeast.lat) / 2,
        (southwest.lng + northeast.lng) / 2,
      ),
      true,
      `${query}: the framing centre must be inside the region`,
    );
  }
});

test('the Alps land in Europe and the Andes in South America', async () => {
  const alps = (await geocoder.geocode('the Alps')).place;
  assert.ok(alps.lat > 43 && alps.lat < 49 && alps.lng > 4 && alps.lng < 17);
  const andes = (await geocoder.geocode('the Andes')).place;
  assert.ok(
    andes.lat < 12 && andes.lat > -56 && andes.lng < -60 && andes.lng > -82,
  );
  const sahara = (await geocoder.geocode('the Sahara')).place;
  assert.ok(
    sahara.lat > 10 && sahara.lat < 36 && sahara.lng > -18 && sahara.lng < 40,
  );
});

test('a spoken abbreviation in the pack reads in full', async () => {
  assert.equal(
    (await geocoder.geocode('the Appalachians')).place.label,
    'Appalachian Mountains',
  );
  assert.equal(
    (await geocoder.geocode('Caucasus Mountains')).place.label,
    'Caucasus Mountains',
  );
});

test('places people search for as a city, state or country are handed on', async () => {
  for (const query of [
    'Alaska',
    'Cuba',
    'Florida',
    'India',
    'Korea',
    'Java',
    'Hawaii',
    'Punjab',
    'Scandinavia',
    'Paris',
    'Texas',
    'Mount Fuji',
    'Narnia',
    'the Eiffel Tower',
    '1600 Pennsylvania Avenue',
    'the quick brown fox jumps over',
    '',
    '   ',
  ]) {
    const outcome = await geocoder.geocode(query);
    assert.equal(
      outcome.place,
      null,
      `${query} must be left to the other geocoders`,
    );
    assert.equal(
      outcome.answered,
      true,
      'having nothing to say is not a verdict on the query',
    );
  }
});

test('no natural region answers to a country or a US state name', async () => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const taken = new Set();
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const name = names.of(String.fromCharCode(a, b));
      if (name) taken.add(name.toLowerCase().replace(/^the /, ''));
    }
  }
  for (const state of [
    'alabama',
    'alaska',
    'arizona',
    'arkansas',
    'california',
    'colorado',
    'connecticut',
    'delaware',
    'florida',
    'georgia',
    'hawaii',
    'idaho',
    'illinois',
    'indiana',
    'iowa',
    'kansas',
    'kentucky',
    'louisiana',
    'maine',
    'maryland',
    'massachusetts',
    'michigan',
    'minnesota',
    'mississippi',
    'missouri',
    'montana',
    'nebraska',
    'nevada',
    'new hampshire',
    'new jersey',
    'new mexico',
    'new york',
    'north carolina',
    'north dakota',
    'ohio',
    'oklahoma',
    'oregon',
    'pennsylvania',
    'rhode island',
    'south carolina',
    'south dakota',
    'tennessee',
    'texas',
    'utah',
    'vermont',
    'virginia',
    'washington',
    'west virginia',
    'wisconsin',
    'wyoming',
  ])
    taken.add(state);

  const answered = [];
  for (const region of await listRegions()) {
    const { place } = await geocoder.geocode(region.name);
    if (place) answered.push(region.name);
  }
  assert.ok(
    answered.length > 400,
    'the pack should answer its natural features',
  );
  const shadowed = answered.filter((name) =>
    taken.has(name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')),
  );
  assert.deepEqual(
    shadowed,
    [],
    'these would shadow a country or state search',
  );
});

test('a ring-shaped range is anchored inside itself, not at its centroid', async () => {
  // A "C": its centroid lies in the opening, outside the polygon.
  const ring = [
    [0, 0],
    [10, 0],
    [10, 2],
    [2, 2],
    [2, 8],
    [10, 8],
    [10, 10],
    [0, 10],
  ];
  const { place } = await createNaturalRegionGeocoder({
    lookup: regionLookup({
      name: 'Crescent Range',
      featurecla: 'Range/mtn',
      polygons: [ring],
    }),
  }).geocode('crescent range');
  assert.ok(place, 'the C must still resolve');
  assert.equal(contains(ring, place.lat, place.lng), true);

  // The box centre (5, 5) is in the opening of the C. The framing box keeps its
  // size but is re-centred on the anchor, so the swath looks at the range.
  const { southwest, northeast } = place.viewport;
  assert.ok(Math.abs(northeast.lat - southwest.lat - 10) < 1e-9);
  assert.ok(Math.abs(northeast.lng - southwest.lng - 10) < 1e-9);
  assert.equal(
    contains(
      ring,
      (southwest.lat + northeast.lat) / 2,
      (southwest.lng + northeast.lng) / 2,
    ),
    true,
  );
});

test("a box that re-centring would push past the dateline keeps the ring's own box", async () => {
  // A reversed C whose spine is pressed against longitude 180: the anchor is in
  // the spine, so shifting the box onto it would leave the globe, and the ring's
  // own bounding box stands.
  const ring = [
    [170, 0],
    [180, 0],
    [180, 10],
    [170, 10],
    [170, 8],
    [178, 8],
    [178, 2],
    [170, 2],
  ];
  const { place } = await createNaturalRegionGeocoder({
    lookup: regionLookup({
      name: 'Edge Range',
      featurecla: 'Range/mtn',
      polygons: [ring],
    }),
  }).geocode('edge range');
  assert.equal(contains(ring, place.lat, place.lng), true);
  assert.deepEqual(place.viewport, {
    southwest: { lat: 0, lng: 170 },
    northeast: { lat: 10, lng: 180 },
  });
});

test('the largest ring carries the name and the framing box', async () => {
  const small = [
    [100, 40],
    [101, 40],
    [101, 41],
    [100, 41],
  ];
  const large = [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
  ];
  const { place } = await createNaturalRegionGeocoder({
    lookup: regionLookup({
      name: 'Twin Range',
      featurecla: 'Range/mtn',
      polygons: [small, large],
    }),
  }).geocode('twin range');
  assert.equal(contains(large, place.lat, place.lng), true);
  assert.equal(place.viewport.northeast.lng, 20);
});

test('a ring across the dateline gets no framing box rather than a wrong one', async () => {
  const { place } = await createNaturalRegionGeocoder({
    lookup: regionLookup({
      name: 'Dateline Sea',
      featurecla: 'sea',
      polygons: [
        [
          [-179, 0],
          [179, 0],
          [179, 5],
          [-179, 5],
        ],
      ],
    }),
  }).geocode('dateline sea');
  assert.ok(place, 'the place itself still resolves');
  assert.equal(place.viewport, null);
});

test('only natural feature classes answer; islands, peninsulas and geoareas pass', async () => {
  const square = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  const ask = (featurecla) =>
    createNaturalRegionGeocoder({
      lookup: regionLookup({
        name: 'Somewhere',
        featurecla,
        polygons: [square],
      }),
    }).geocode('somewhere');
  for (const featurecla of [
    'Range/mtn',
    'range/mtn',
    'Desert',
    'sea',
    'Plateau',
  ])
    assert.ok((await ask(featurecla)).place, featurecla);
  for (const featurecla of [
    'Island',
    'Island group',
    'Geoarea',
    'Coast',
    'Pen/cape',
    'Isthmus',
    'Gorge',
    'Continent',
    '',
    undefined,
  ])
    assert.equal((await ask(featurecla)).place, null, String(featurecla));
});

test('a sliver, a missing polygon list and an unusable ring are handed on', async () => {
  for (const polygons of [
    undefined,
    [],
    [[]],
    [[[0, 0]]],
    [
      [
        [0, 0],
        [1, 1],
      ],
    ],
  ]) {
    const outcome = await createNaturalRegionGeocoder({
      lookup: regionLookup({ name: 'Nothing', featurecla: 'Desert', polygons }),
    }).geocode('nothing');
    assert.equal(outcome.place, null);
    assert.equal(outcome.answered, true);
  }
});

test('a pack that fails to load is "did not answer", and a cancelled search throws', async () => {
  const failing = createNaturalRegionGeocoder({
    lookup: async () => {
      throw new Error('pack failed to load');
    },
  });
  assert.deepEqual(await failing.geocode('the Alps'), {
    place: null,
    answered: false,
  });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    geocoder.geocode('the Alps', { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
  assert.deepEqual(await createNaturalRegionGeocoder().geocode('the Alps'), {
    place: null,
    answered: true,
  });
});

test('a pack that is still loading does not hold the search: it passes, and is not a verdict', async () => {
  const square = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  const region = {
    name: 'Slow Range',
    featurecla: 'Range/mtn',
    polygons: [square],
  };
  let finish;
  const loading = new Promise((resolve) => {
    finish = () => resolve(region);
  });
  const slow = createNaturalRegionGeocoder({
    lookup: () => loading,
    budgetMs: 20,
  });
  const started = Date.now();
  assert.deepEqual(await slow.geocode('slow range'), {
    place: null,
    answered: false,
  });
  assert.ok(
    Date.now() - started < 1000,
    'the search must not wait for the pack',
  );

  // The pack finishes loading in the background; the next search finds it ready.
  finish();
  const next = await slow.geocode('slow range');
  assert.equal(next.answered, true);
  assert.equal(next.place.label, 'Slow Range');
});

test('the default chain answers a region offline, ahead of every network geocoder', async () => {
  const requested = [];
  const photon = {
    features: [
      {
        geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
        properties: {
          name: 'Paris',
          osm_key: 'place',
          osm_value: 'city',
          type: 'city',
        },
      },
    ],
  };
  const fetchImpl = async (url) => {
    requested.push(String(url));
    return { ok: true, status: 200, json: async () => photon };
  };
  const place = (naturalRegions) =>
    createDefaultPlaceSearch({
      fetchImpl,
      naturalRegions,
      presets: {
        austin: {
          name: 'Austin',
          pois: [{ name: 'Texas State Capitol', lat: 30.2747, lon: -97.7403 }],
        },
      },
    });

  const withPack = place(findNaturalRegion);
  const alps = await withPack.geocode('the Alps');
  assert.deepEqual(requested, [], 'a region reaches no network provider');
  assert.deepEqual(alps.place.types, ['natural_feature']);

  assert.equal((await withPack.geocode('Austin')).place.label, 'Austin');
  assert.deepEqual(requested, [], 'a bundled city still answers first');

  const paris = await withPack.geocode('Paris');
  assert.equal(paris.place.name, 'Paris');
  assert.ok(requested.length > 0, 'anything else still walks the network');

  requested.length = 0;
  await place(null).geocode('the Alps');
  assert.ok(
    requested.some((url) => url.includes('photon')),
    'without the pack the search is exactly what it was',
  );
});

test('the search package exports the provider', () => {
  assert.equal(search.createNaturalRegionGeocoder, createNaturalRegionGeocoder);
});
