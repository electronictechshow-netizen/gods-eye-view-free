// WIKIPEDIA GEOCODER — famous place names ("the Colosseum", "the Kremlin") answered
// from Wikipedia ahead of the OpenStreetMap geocoders.
//
// What matters here: it answers only when the article IS the thing asked for
// (right title, an Earth coordinate, not a disambiguation page, not a country /
// state / city), it never replaces the geocoders for anything it is unsure of,
// and a service failure is "did not answer", never a verdict.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikipediaGeocoder } from './wikipediaGeocoder.js';
import { createDefaultPlaceSearch } from './defaults.js';
import { findNaturalRegion } from '../data/naturalEarthRegions.js';
import * as search from './index.js';

const page = (title, extra = {}) => ({
  pageid: Math.abs([...title].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)),
  ns: 0,
  title,
  ...extra,
});
const at = (lat, lon, extra = {}) => [
  { lat, lon, primary: true, type: 'landmark', globe: 'earth', ...extra },
];

/**
 * A fake network: Wikipedia's search answers from `articles`, its title lookup
 * from `titled` (title → page) through `redirects` (title → title), Wikidata
 * from `wikidata`, Photon from `photon`.
 */
function network({
  articles = {},
  photon = [],
  wikidata = {},
  titled = {},
  redirects = {},
  status = 200,
} = {}) {
  const requests = [];
  const photonUrls = [];
  // Wikipedia's search ignores case and a leading article, so the fixtures do too.
  const key = (query) => String(query).toLowerCase().replace(/^the /, '');
  const byKey = Object.fromEntries(
    Object.entries(articles).map(([query, pages]) => [key(query), pages]),
  );
  const fetchImpl = async (url) => {
    const asked = new URL(String(url));
    requests.push(`${asked.hostname}${asked.pathname}`);
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    if (
      asked.hostname.includes('wikipedia') &&
      asked.searchParams.has('titles')
    ) {
      const normalized = [];
      const followed = [];
      const pages = [];
      for (const title of asked.searchParams.get('titles').split('|')) {
        const upper = title.charAt(0).toUpperCase() + title.slice(1);
        if (upper !== title) normalized.push({ from: title, to: upper });
        const target = redirects[upper];
        if (target) followed.push({ from: upper, to: target });
        const final = target ?? upper;
        if (!pages.some((entry) => entry.title === final))
          pages.push(titled[final] ?? { title: final, missing: true });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: { normalized, redirects: followed, pages },
        }),
      };
    }
    if (asked.hostname.includes('wikipedia')) {
      const pages = byKey[key(asked.searchParams.get('gsrsearch'))] ?? [];
      return {
        ok: true,
        status: 200,
        json: async () => (pages.length ? { query: { pages } } : {}),
      };
    }
    if (asked.hostname.includes('wikidata')) {
      const item = asked.searchParams.get('ids');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entities: wikidata[item] ? { [item]: wikidata[item] } : {},
        }),
      };
    }
    photonUrls.push(asked);
    return {
      ok: true,
      status: 200,
      json: async () => ({ features: photon }),
    };
  };
  return { fetchImpl, requests, photonUrls };
}

const feature = (name, lon, lat, extra = {}) => ({
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    name,
    osm_key: 'tourism',
    osm_value: 'attraction',
    type: 'house',
    ...extra,
  },
});

const COLOSSEUM = {
  Colosseum: [
    page('Colosseum', {
      index: 1,
      coordinates: at(41.8902, 12.4922),
      description: 'Ancient Roman amphitheater in Rome',
    }),
    page('Pokémon Colosseum', { index: 2, description: '2003 video game' }),
  ],
};

test("a famous name answers with the article's coordinate, ahead of any geocoder", async () => {
  const { fetchImpl, requests } = network({ articles: COLOSSEUM });
  const geocoder = createWikipediaGeocoder({ fetchImpl });
  for (const query of ['Colosseum', 'the Colosseum', 'THE COLOSSEUM']) {
    const { place, answered } = await geocoder.geocode(query);
    assert.equal(answered, true, query);
    assert.equal(place.name, 'Colosseum', query);
    assert.equal(place.lat, 41.8902);
    assert.equal(place.lng, 12.4922);
    assert.deepEqual(place.types, ['point_of_interest']);
    assert.equal(place.viewport, null, 'a point has no box');
  }
  assert.equal(
    requests.filter((url) => url.includes('wikipedia')).length,
    1,
    'the same name is one request',
  );
});

test('the title must be the name asked for, ignoring an article, accents and parentheses', async () => {
  const articles = {
    'the Hollywood sign': [
      page('Hollywood Sign', { index: 1, coordinates: at(34.1341, -118.3216) }),
    ],
    Mercury: [
      page('Mercury (planet)', {
        index: 1,
        coordinates: at(0, 0, { globe: 'mercury' }),
      }),
    ],
    'Sixth Street': [
      page('Sixth Street Partners', {
        index: 1,
        description: 'Investment firm',
      }),
      page('Sixth Street Viaduct', {
        index: 2,
        coordinates: at(34.03, -118.23),
      }),
    ],
    Starbucks: [
      page('Starbucks', { index: 1, description: 'Coffeehouse chain' }),
    ],
    Pentagon: [
      page('Pentagon', { index: 1, description: 'Shape with five sides' }),
      page('The Pentagon', { index: 2, coordinates: at(38.8719, -77.0563) }),
    ],
  };
  const { fetchImpl } = network({ articles });
  const geocoder = createWikipediaGeocoder({ fetchImpl });

  assert.equal(
    (await geocoder.geocode('the Hollywood sign')).place.name,
    'Hollywood Sign',
  );
  // A hit further down the list still counts when it is the one named.
  assert.equal((await geocoder.geocode('Pentagon')).place.lat, 38.8719);

  for (const query of [
    'Sixth Street',
    'Starbucks',
    'Mercury',
    'Nowhere Land',
  ]) {
    const outcome = await geocoder.geocode(query);
    assert.equal(outcome.place, null, `${query} must be left to the geocoders`);
    assert.equal(
      outcome.answered,
      true,
      'having nothing to say is not a verdict',
    );
  }
});

test('a disambiguation page of that name ends the search: which one depends on the view', async () => {
  const { fetchImpl, requests } = network({
    articles: {
      Springfield: [
        page('Springfield', { index: 1, pageprops: { disambiguation: '' } }),
        page('Springfield, Massachusetts', {
          index: 2,
          coordinates: at(42.1, -72.6, { type: 'city' }),
        }),
      ],
    },
  });
  const outcome = await createWikipediaGeocoder({ fetchImpl }).geocode(
    'Springfield',
  );
  assert.equal(outcome.place, null);
  assert.equal(outcome.answered, true);
  assert.equal(
    requests.filter((url) => url.includes('photon')).length,
    0,
    'nothing to look up in OpenStreetMap',
  );
});

test('countries, states, counties, cities and islands stay with the geocoders that frame them', async () => {
  for (const type of [
    'country',
    'adm1st',
    'adm2nd',
    'adm3rd',
    'city',
    'isle',
    'event',
  ]) {
    const { fetchImpl } = network({
      articles: {
        Somewhere: [
          page('Somewhere', { index: 1, coordinates: at(10, 10, { type }) }),
        ],
      },
    });
    const outcome = await createWikipediaGeocoder({ fetchImpl }).geocode(
      'Somewhere',
    );
    assert.equal(outcome.place, null, type);
    assert.equal(outcome.answered, true, type);
  }
});

test('an event is handed on without a second request', async () => {
  const { fetchImpl, requests } = network({
    articles: {
      Somewhere: [
        page('Somewhere', {
          index: 1,
          coordinates: at(10, 10, { type: 'event' }),
        }),
      ],
    },
  });
  await createWikipediaGeocoder({ fetchImpl }).geocode('Somewhere');
  assert.deepEqual(
    requests,
    ['en.wikipedia.org/w/api.php'],
    'a battle is not a place to fly to, so nothing more is asked',
  );
});

test('a country is answered with the box of the same-named OpenStreetMap country, asked for in English', async () => {
  const articles = {
    Japan: [
      page('Japan', {
        index: 1,
        coordinates: at(36, 138, { type: 'country' }),
        description: 'Island country in East Asia',
      }),
    ],
  };
  const country = feature('Japan', 139.2394, 36.5748, {
    osm_key: 'place',
    osm_value: 'country',
    type: 'country',
    extent: [122.7, 45.7, 154.2, 20.2],
  });
  const missouri = feature('Japan', -91.0, 38.0, {
    osm_key: 'place',
    osm_value: 'village',
    type: 'city',
  });
  const { fetchImpl, photonUrls } = network({
    articles,
    photon: [missouri, country],
  });
  const { place } = await createWikipediaGeocoder({ fetchImpl }).geocode(
    'Japan',
  );
  assert.equal(place.lat, 36.5748, 'the country, not the village in Missouri');
  assert.deepEqual(place.types, ['country']);
  assert.equal(place.viewport.southwest.lng, 122.7);
  assert.equal(photonUrls[0].searchParams.get('lang'), 'en');

  const unconfirmed = await createWikipediaGeocoder({
    fetchImpl: network({ articles, photon: [missouri] }).fetchImpl,
  }).geocode('Japan');
  assert.equal(
    unconfirmed.place,
    null,
    'without the country near its point the name goes on to the geocoders',
  );
});

test('a name that redirects to the article is answered from the article it names', async () => {
  const giza = page('Giza pyramid complex', {
    coordinates: at(29.9792, 31.1342, { type: 'landmark' }),
    description: 'Archaeological site in Giza, Egypt',
  });
  const { fetchImpl, requests } = network({
    // The search lists the article under its own title, which is not the name asked.
    articles: { 'Pyramids of Giza': [{ ...giza, index: 1 }] },
    titled: { 'Giza pyramid complex': giza },
    redirects: { 'Pyramids of Giza': 'Giza pyramid complex' },
  });
  const geocoder = createWikipediaGeocoder({ fetchImpl });
  for (const query of ['Pyramids of Giza', 'the pyramids of giza']) {
    const { place, answered } = await geocoder.geocode(query);
    assert.equal(answered, true, query);
    assert.equal(place.lat, 29.9792, query);
    assert.equal(place.lng, 31.1342, query);
  }
  assert.deepEqual(
    requests.slice(0, 2),
    ['en.wikipedia.org/w/api.php', 'en.wikipedia.org/w/api.php'],
    'the search, then the name looked up as a title',
  );
});

test('a redirect is held to the same rules as an article: a disambiguation page or a missing title is no answer', async () => {
  const { fetchImpl } = network({
    articles: { Mercury: [page('Mercury Records', { index: 1 })] },
    titled: {
      'Mercury (disambiguation)': page('Mercury (disambiguation)', {
        pageprops: { disambiguation: '' },
      }),
    },
    redirects: { Mercury: 'Mercury (disambiguation)' },
  });
  const outcome = await createWikipediaGeocoder({ fetchImpl }).geocode(
    'Mercury',
  );
  assert.equal(outcome.place, null);
  assert.equal(outcome.answered, true);

  const missing = await createWikipediaGeocoder({
    fetchImpl: network({ articles: {} }).fetchImpl,
  }).geocode('Nowhere In Particular');
  assert.equal(missing.place, null);
  assert.equal(missing.answered, true, 'no such title is a verdict');
});

test('a coordinate on another world, or a malformed one, is not a place here', async () => {
  for (const coordinates of [
    at(10, 10, { globe: 'moon' }),
    at(95, 10),
    at(10, 200),
    [{ lat: 'x', lon: 5, primary: true }],
    [],
    undefined,
  ]) {
    const { fetchImpl } = network({
      articles: { Crater: [page('Crater', { index: 1, coordinates })] },
    });
    const outcome = await createWikipediaGeocoder({ fetchImpl }).geocode(
      'Crater',
    );
    assert.equal(outcome.place, null, JSON.stringify(coordinates));
  }
});

test('the OpenStreetMap feature of the same name near the point supplies the framing', async () => {
  const articles = {
    'Lady Bird Lake': [
      page('Lady Bird Lake', {
        index: 1,
        coordinates: at(30.2616, -97.7385, { type: 'waterbody' }),
        description: 'Reservoir on the Colorado River in Austin',
      }),
    ],
  };
  const lake = feature('Lady Bird Lake', -97.7385, 30.2616, {
    osm_key: 'natural',
    osm_value: 'water',
    type: 'other',
    extent: [-97.8, 30.28, -97.7, 30.25],
  });
  const { fetchImpl, requests } = network({ articles, photon: [lake] });
  const { place } = await createWikipediaGeocoder({ fetchImpl }).geocode(
    'Lady Bird Lake',
  );
  assert.deepEqual(place.types, ['natural_feature']);
  assert.ok(place.viewport, 'the OpenStreetMap extent frames a lake');
  assert.equal(place.viewport.southwest.lng, -97.8);
  assert.deepEqual(
    requests.map((url) => url.split('/')[0]),
    ['en.wikipedia.org', 'photon.komoot.io'],
    'Wikipedia names it, Photon frames it',
  );
});

test('an OpenStreetMap feature that is far away, or not notable, is not used', async () => {
  const articles = { Colosseum: COLOSSEUM.Colosseum };
  for (const hit of [
    feature('Colosseum', 151.2, -33.9), // same name, other side of the world
    feature('Colosseo Pizza', 12.4923, 41.8902, {
      osm_key: 'amenity',
      osm_value: 'restaurant',
    }), // beside it, but not the thing
    feature('Colosseo', 12.55, 41.9, {
      osm_key: 'historic',
      osm_value: 'ruins',
    }), // notable, but 5 km off
  ]) {
    const { fetchImpl } = network({ articles, photon: [hit] });
    const { place } = await createWikipediaGeocoder({ fetchImpl }).geocode(
      'Colosseum',
    );
    assert.equal(place.lat, 41.8902, 'the Wikipedia point stands');
    assert.equal(place.name, 'Colosseum');
  }
});

test('a notable feature right there under another name is the same place', async () => {
  // OpenStreetMap holds the monument as "Colosseo"; Photon found it for the query
  // through another language's name.
  const hit = feature('Colosseo', 12.4923, 41.8902, {
    osm_key: 'historic',
    osm_value: 'amphitheatre',
    type: 'house',
    extent: [12.49, 41.892, 12.495, 41.889],
  });
  const { fetchImpl } = network({ articles: COLOSSEUM, photon: [hit] });
  const { place } = await createWikipediaGeocoder({ fetchImpl }).geocode(
    'the Colosseum',
  );
  assert.equal(place.name, 'Colosseo');
  assert.ok(place.viewport, 'its own bounding box frames it');
});

test("a city is answered only when OpenStreetMap confirms it near the article's point", async () => {
  const articles = {
    Chernobyl: [
      page('Chernobyl', {
        index: 1,
        coordinates: at(51.2763, 30.2219, { type: 'city' }),
        description: 'Abandoned city in Ukraine',
      }),
    ],
  };
  const extent = [30.2, 51.3, 30.25, 51.25];
  const confirmed = [
    // the same name
    feature('Chernobyl', 30.2219, 51.2763, {
      osm_key: 'place',
      osm_value: 'city',
      type: 'city',
      extent,
    }),
    // another language's name, held by a place of the right kind a few km away
    feature('Чорнобиль', 30.25, 51.29, {
      osm_key: 'place',
      osm_value: 'city',
      type: 'city',
      extent,
    }),
  ];
  for (const hit of confirmed) {
    const { fetchImpl } = network({ articles, photon: [hit] });
    const { place } = await createWikipediaGeocoder({ fetchImpl }).geocode(
      'Chernobyl',
    );
    assert.deepEqual(place.types, ['locality']);
    assert.ok(place.viewport, 'the city is framed by its OpenStreetMap box');
  }

  // The same name in South Africa, or nothing at all: hand the search on.
  for (const photon of [
    [
      feature('Chernobyl', 22.4, -33.9, {
        osm_key: 'place',
        osm_value: 'suburb',
        type: 'district',
      }),
    ],
    [],
  ]) {
    const { fetchImpl } = network({ articles, photon });
    const outcome = await createWikipediaGeocoder({ fetchImpl }).geocode(
      'Chernobyl',
    );
    assert.equal(outcome.place, null);
    assert.equal(outcome.answered, true);
  }
});

test('a street of the same name does not stand in for a monument, but does for a street', async () => {
  const lane = feature('Colosseum', 12.4922, 41.8902, {
    osm_key: 'highway',
    osm_value: 'pedestrian',
    type: 'street',
  });
  const monument = await createWikipediaGeocoder({
    fetchImpl: network({ articles: COLOSSEUM, photon: [lane] }).fetchImpl,
  }).geocode('Colosseum');
  assert.deepEqual(
    monument.place.types,
    ['point_of_interest'],
    'the Wikipedia point, not a street corridor',
  );

  const avenue = {
    'Champs-Élysées': [
      page('Champs-Élysées', {
        index: 1,
        coordinates: at(48.8698, 2.3078),
        description: 'Avenue in Paris, France',
      }),
    ],
  };
  const road = feature('Champs-Élysées', 2.3078, 48.8698, {
    osm_key: 'highway',
    osm_value: 'primary',
    type: 'street',
    extent: [2.29, 48.875, 2.322, 48.865],
  });
  const street = await createWikipediaGeocoder({
    fetchImpl: network({ articles: avenue, photon: [road] }).fetchImpl,
  }).geocode('Champs-Élysées');
  assert.deepEqual(street.place.types, ['route']);
  assert.ok(street.place.viewport, 'a street is framed by its own extent');
});

test("a large natural feature may sit far from the article's point; a building may not", async () => {
  const reef = {
    'Great Barrier Reef': [
      page('Great Barrier Reef', {
        index: 1,
        coordinates: at(-16.4, 145.8, { type: '' }),
        description: 'Coral reef system in Queensland, Australia',
      }),
    ],
  };
  const osm = feature('Great Barrier Reef', 147.7, -18.3, {
    osm_key: 'natural',
    osm_value: 'reef',
    type: 'other',
    extent: [142, -10, 154, -24],
  });
  const { fetchImpl } = network({ articles: reef, photon: [osm] });
  const { place } = await createWikipediaGeocoder({ fetchImpl }).geocode(
    'Great Barrier Reef',
  );
  assert.ok(
    place.viewport,
    "about 280 km from the article's point is the same reef",
  );
  assert.deepEqual(place.types, ['natural_feature']);
});

test('without an OpenStreetMap match the description and extent decide the framing', async () => {
  const articles = {
    'Mount Everest': [
      page('Mount Everest', {
        index: 1,
        coordinates: at(27.9881, 86.925, { type: 'mountain', dim: 20000 }),
        description: 'Highest mountain on Earth',
      }),
    ],
    Nile: [
      page('Nile', {
        index: 1,
        coordinates: at(30.2, 31.1, { type: 'river' }),
        description: 'Major river in northeast Africa',
      }),
    ],
    'Central Park': [
      page('Central Park', {
        index: 1,
        coordinates: at(40.7829, -73.9654, { type: '' }),
        description: 'Public park in Manhattan, New York',
      }),
    ],
    'Small Rock': [
      page('Small Rock', {
        index: 1,
        coordinates: at(1, 2, { type: '', dim: 800 }),
      }),
    ],
  };
  const { fetchImpl } = network({ articles });
  const geocoder = createWikipediaGeocoder({ fetchImpl });

  const everest = (await geocoder.geocode('Mount Everest')).place;
  assert.deepEqual(everest.types, ['natural_feature']);
  const { southwest, northeast } = everest.viewport;
  assert.ok(southwest.lat < 27.9881 && northeast.lat > 27.9881);
  assert.ok(Math.abs(northeast.lat - southwest.lat - 20000 / 111320) < 1e-6);

  assert.deepEqual((await geocoder.geocode('Nile')).place.types, [
    'natural_feature',
  ]);
  assert.equal((await geocoder.geocode('Nile')).place.viewport, null);
  assert.deepEqual(
    (await geocoder.geocode('Central Park')).place.types,
    ['natural_feature'],
    'a park is an area, not a doorstep',
  );
  assert.equal(
    (await geocoder.geocode('Small Rock')).place.viewport,
    null,
    'a stated extent under five kilometres is not worth a box',
  );
});

test('a failing, refusing or malformed service is "did not answer", not a miss', async () => {
  for (const status of [429, 500, 503]) {
    const { fetchImpl } = network({ articles: COLOSSEUM, status });
    assert.deepEqual(
      await createWikipediaGeocoder({ fetchImpl }).geocode('Colosseum'),
      {
        place: null,
        answered: false,
      },
    );
  }
  for (const fetchImpl of [
    async () => {
      throw new TypeError('network down');
    },
    async () => ({ ok: true, json: async () => null }),
    async () => ({ ok: true, json: async () => 'not an object' }),
    async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }),
  ]) {
    const outcome = await createWikipediaGeocoder({ fetchImpl }).geocode(
      'Colosseum',
    );
    assert.deepEqual(outcome, { place: null, answered: false });
  }
});

test('a request that outlasts its budget is "did not answer"', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  const started = Date.now();
  const outcome = await createWikipediaGeocoder({
    fetchImpl,
    timeoutMs: 30,
  }).geocode('Colosseum');
  assert.deepEqual(outcome, { place: null, answered: false });
  assert.ok(Date.now() - started < 2000);
});

test('addresses, numbers, lists and sentences are never sent out', async () => {
  const { fetchImpl, requests } = network({ articles: COLOSSEUM });
  const geocoder = createWikipediaGeocoder({ fetchImpl });
  for (const query of [
    '1600 Pennsylvania Avenue',
    'Paris, Texas',
    'one two three four five six seven',
    '',
    '   ',
    'Москва',
  ]) {
    const outcome = await geocoder.geocode(query);
    assert.equal(outcome.place, null, query);
    assert.equal(outcome.answered, true, query);
  }
  assert.deepEqual(requests, []);
});

test('answers and misses are remembered; an unanswered request is retried', async () => {
  const { fetchImpl, requests } = network({ articles: COLOSSEUM });
  const geocoder = createWikipediaGeocoder({ fetchImpl });
  await geocoder.geocode('Colosseum');
  const afterFirst = requests.length;
  await geocoder.geocode('the colosseum');
  assert.equal(requests.length, afterFirst, 'a hit is served from memory');

  await geocoder.geocode('Nothing Here');
  const afterMiss = requests.length;
  await geocoder.geocode('Nothing Here');
  assert.equal(
    requests.length,
    afterMiss,
    'a definitive miss is served from memory',
  );

  let calls = 0;
  const flaky = createWikipediaGeocoder({
    fetchImpl: async (url) => {
      calls += 1;
      if (calls === 1) throw new TypeError('blip');
      return network({ articles: COLOSSEUM }).fetchImpl(url);
    },
  });
  assert.equal((await flaky.geocode('Colosseum')).answered, false);
  assert.equal((await flaky.geocode('Colosseum')).place.name, 'Colosseum');
});

test('two unanswered searches in a row pause the lookup for a minute', async () => {
  let clock = 1_000_000;
  let down = true;
  const live = network({ articles: COLOSSEUM });
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return down
      ? { ok: false, status: 429, json: async () => ({}) }
      : live.fetchImpl(url);
  };
  const geocoder = createWikipediaGeocoder({ fetchImpl, now: () => clock });

  await geocoder.geocode('Colosseum');
  assert.equal(requests.length, 1);
  await geocoder.geocode('Louvre');
  assert.equal(requests.length, 2);

  // Paused: the search is not held up, and it is not a verdict either.
  assert.deepEqual(await geocoder.geocode('Kremlin'), {
    place: null,
    answered: false,
  });
  assert.equal(requests.length, 2, 'nothing is asked while paused');

  clock += 61_000;
  down = false;
  assert.equal((await geocoder.geocode('Colosseum')).place.name, 'Colosseum');
  assert.ok(requests.length > 2, 'after the pause it asks again');
});

test('one unanswered search in between answers does not start a pause', async () => {
  let calls = 0;
  const live = network({ articles: COLOSSEUM });
  const geocoder = createWikipediaGeocoder({
    fetchImpl: async (url) => {
      calls += 1;
      return calls === 2
        ? { ok: false, status: 500, json: async () => ({}) }
        : live.fetchImpl(url);
    },
  });
  await geocoder.geocode('Louvre');
  await geocoder.geocode('Kremlin'); // the unanswered one
  const before = calls;
  await geocoder.geocode('Colosseum');
  assert.ok(calls > before, 'still asking');
});

test('a cancelled search throws', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createWikipediaGeocoder({ fetchImpl: async () => ({ ok: true }) }).geocode(
      'Colosseum',
      { signal: controller.signal },
    ),
    (error) => error.name === 'AbortError',
  );
});

test('the default chain asks Wikipedia after the offline providers and before Photon', async () => {
  const articles = {
    ...COLOSSEUM,
    'Sixth Street': [],
  };
  const photonHit = feature('Sixth Street', -97.74, 30.267, {
    osm_key: 'highway',
    osm_value: 'residential',
    type: 'street',
  });
  const { fetchImpl, requests } = network({ articles, photon: [photonHit] });
  const chain = (options = {}) =>
    createDefaultPlaceSearch({
      fetchImpl,
      naturalRegions: findNaturalRegion,
      ...options,
    });

  const withLandmarks = chain({ landmarks: true });
  const alps = await withLandmarks.geocode('the Alps');
  assert.deepEqual(alps.place.types, ['natural_feature']);
  assert.deepEqual(requests, [], 'a natural region never reaches the network');

  const colosseum = await withLandmarks.geocode('the Colosseum');
  assert.equal(colosseum.place.name, 'Colosseum');
  assert.equal(requests[0], 'en.wikipedia.org/w/api.php');

  requests.length = 0;
  const street = await withLandmarks.geocode('Sixth Street');
  assert.deepEqual(
    requests.map((url) => url.split('/')[0]),
    ['en.wikipedia.org', 'en.wikipedia.org', 'photon.komoot.io'],
    'what Wikipedia has no article or redirect for goes on to Photon',
  );
  assert.equal(street.place.name, 'Sixth Street');

  requests.length = 0;
  await chain().geocode('the Colosseum');
  assert.ok(
    requests.every((url) => !url.includes('wikipedia')),
    'without the option the search is exactly what it was',
  );
});

const claim = (
  latitude,
  longitude,
  globe = 'http://www.wikidata.org/entity/Q2',
) => ({
  claims: {
    P625: [
      { mainsnak: { datavalue: { value: { latitude, longitude, globe } } } },
    ],
  },
});
const PETRA = {
  Petra: [
    page('Petra', {
      index: 1,
      description: 'Ancient rock-cut historical city in Jordan',
      pageprops: { wikibase_item: 'Q101' },
    }),
    page('Petra (disambiguation)', {
      index: 2,
      pageprops: { disambiguation: '' },
    }),
  ],
};

test("an article with no coordinate borrows its Wikidata item's, and OpenStreetMap must confirm it", async () => {
  const site = feature('Petra', 35.4444, 30.3285, {
    osm_key: 'historic',
    osm_value: 'archaeological_site',
  });
  const found = network({
    articles: PETRA,
    wikidata: { Q101: claim(30.3285, 35.4444) },
    photon: [site],
  });
  const { place } = await createWikipediaGeocoder({
    fetchImpl: found.fetchImpl,
  }).geocode('Petra');
  assert.equal(place.name, 'Petra');
  assert.ok(Math.abs(place.lat - 30.3285) < 1e-6);
  assert.deepEqual(
    found.requests.map((url) => url.split('/')[0]),
    ['en.wikipedia.org', 'www.wikidata.org', 'photon.komoot.io'],
  );

  // A same-named place on another continent does not confirm it: hand the search on.
  for (const photon of [[feature('Petra', 37.59, 55.76)], []]) {
    const far = network({
      articles: PETRA,
      wikidata: { Q101: claim(30.3285, 35.4444) },
      photon,
    });
    const outcome = await createWikipediaGeocoder({
      fetchImpl: far.fetchImpl,
    }).geocode('Petra');
    assert.equal(outcome.place, null);
    assert.equal(outcome.answered, true);
  }
});

test('Wikidata is asked only for something that reads like a place, and answers must be sound', async () => {
  const company = {
    Starbucks: [
      page('Starbucks', {
        index: 1,
        description: 'American multinational coffeehouse chain',
        pageprops: { wikibase_item: 'Q37158' },
      }),
    ],
  };
  const firm = network({
    articles: company,
    wikidata: { Q37158: claim(47.58, -122.33) },
  });
  assert.equal(
    (
      await createWikipediaGeocoder({ fetchImpl: firm.fetchImpl }).geocode(
        'Starbucks',
      )
    ).place,
    null,
  );
  assert.deepEqual(firm.requests, ['en.wikipedia.org/w/api.php']);

  // No coordinate claim, another world, an impossible one, or no answer at all.
  for (const wikidata of [
    {},
    { Q101: { claims: {} } },
    { Q101: claim(30.3285, 35.4444, 'http://www.wikidata.org/entity/Q405') },
    { Q101: claim(95, 10) },
  ]) {
    const none = network({
      articles: PETRA,
      wikidata,
      photon: [feature('Petra', 35.4444, 30.3285)],
    });
    const outcome = await createWikipediaGeocoder({
      fetchImpl: none.fetchImpl,
    }).geocode('Petra');
    assert.equal(outcome.place, null, JSON.stringify(wikidata));
  }
});

test('the "(disambiguation)" page is no page named X: the article X wins even when it ranks second', async () => {
  const articles = {
    Louvre: [
      page('Louvre (disambiguation)', {
        index: 1,
        pageprops: { disambiguation: '' },
      }),
      page('Louvre', { index: 2, coordinates: at(48.8606, 2.3376) }),
    ],
    Elsewhere: [
      page('Elsewhere (disambiguation)', {
        index: 1,
        pageprops: { disambiguation: '' },
      }),
    ],
  };
  const { fetchImpl } = network({ articles });
  const geocoder = createWikipediaGeocoder({ fetchImpl });
  assert.equal((await geocoder.geocode('Louvre')).place.name, 'Louvre');
  assert.equal((await geocoder.geocode('Elsewhere')).place, null);
});

test('for a river or a reef only a natural feature may stand in for it, never a building with its name', async () => {
  const articles = {
    Nile: [
      page('Nile', {
        index: 1,
        coordinates: at(30.1725, 31.14, { type: 'river', dim: 10000 }),
        description: 'Major river in northeast Africa',
      }),
    ],
  };
  const tower = feature('Nile Towers', 31.2275, 30.0722, {
    osm_key: 'building',
    osm_value: 'yes',
  });
  const { place } = await createWikipediaGeocoder({
    fetchImpl: network({ articles, photon: [tower] }).fetchImpl,
  }).geocode('the Nile');
  assert.equal(
    place.name,
    'Nile',
    'the Wikipedia point, framed by its stated extent',
  );
  assert.deepEqual(place.types, ['natural_feature']);
  assert.ok(place.viewport);

  const river = feature('Nile', 31.14, 30.17, {
    osm_key: 'waterway',
    osm_value: 'river',
    type: 'other',
    extent: [29, 31, 33, 22],
  });
  const refined = await createWikipediaGeocoder({
    fetchImpl: network({ articles, photon: [tower, river] }).fetchImpl,
  }).geocode('the Nile');
  assert.equal(refined.place.name, 'Nile');
  assert.equal(refined.place.viewport.southwest.lng, 29);
});

test('a river is not framed by a differently named notable feature beside its point', async () => {
  const articles = {
    Nile: [
      page('Nile', {
        index: 1,
        coordinates: at(30.1725, 31.14, { type: 'river' }),
        description: 'Major river in northeast Africa',
      }),
    ],
  };
  const island = feature('Gezira', 31.2243, 30.0566, {
    osm_key: 'place',
    osm_value: 'island',
    type: 'other',
    extent: [31.21, 30.07, 31.23, 30.04],
  });
  const { place } = await createWikipediaGeocoder({
    fetchImpl: network({ articles, photon: [island] }).fetchImpl,
  }).geocode('the Nile');
  assert.equal(place.name, 'Nile', 'the article point, not the island');
  assert.equal(place.lat, 30.1725);
});

test('the search package exports the provider', () => {
  assert.equal(search.createWikipediaGeocoder, createWikipediaGeocoder);
});

test('an acronym is asked for as its exact title first: LAX is the airport, Lax is a disambiguation page', async () => {
  const airport = page('Los Angeles International Airport', {
    coordinates: at(33.9425, -118.4081, { type: 'airport' }),
    description: 'Primary airport serving Los Angeles, California',
  });
  const lax = page('Lax', { index: 1, pageprops: { disambiguation: '' } });
  const { fetchImpl, requests } = network({
    articles: { LAX: [lax] },
    titled: { 'Los Angeles International Airport': airport },
    redirects: { LAX: 'Los Angeles International Airport' },
  });
  const geocoder = createWikipediaGeocoder({ fetchImpl });
  const { place } = await geocoder.geocode('LAX');
  assert.equal(place.lat, 33.9425);
  assert.deepEqual(place.types, ['airport']);
  assert.deepEqual(
    requests,
    ['en.wikipedia.org/w/api.php', 'photon.komoot.io/api/'],
    'the exact title answered: no search was needed',
  );

  const word = await geocoder.geocode('Lax');
  assert.equal(word.place, null, 'the word is the disambiguation page');
  assert.equal(word.answered, true);
});

test('a lake mapped as water=lake confirms and frames its article; a road of its name does not', async () => {
  const articles = {
    'Dead Sea': [
      page('Dead Sea', {
        index: 1,
        description: 'Salt lake bordering Israel, the West Bank and Jordan',
        pageprops: { wikibase_item: 'Q23883' },
      }),
    ],
  };
  const lake = feature('Dead Sea', 35.481, 31.542, {
    osm_key: 'water',
    osm_value: 'lake',
    type: 'other',
    extent: [35.39, 31.76, 35.59, 31.32],
  });
  const road = feature('Dead Sea', 35.401, 31.557, {
    osm_key: 'highway',
    osm_value: 'trunk',
    type: 'street',
  });
  const found = network({
    articles,
    wikidata: { Q23883: claim(31.5207, 35.4845) },
    photon: [road, lake],
  });
  const { place } = await createWikipediaGeocoder({
    fetchImpl: found.fetchImpl,
  }).geocode('the Dead Sea');
  assert.equal(place.name, 'Dead Sea');
  assert.equal(place.viewport.southwest.lng, 35.39);

  const onlyRoad = network({
    articles,
    wikidata: { Q23883: claim(31.5207, 35.4845) },
    photon: [road],
  });
  const outcome = await createWikipediaGeocoder({
    fetchImpl: onlyRoad.fetchImpl,
  }).geocode('the Dead Sea');
  assert.equal(outcome.place, null, 'unconfirmed: handed on, not the road');
});
