// CESIUM ION GEOCODER — Google- and Bing-grade place search through the ion
// token the 3D tiles already use.
//
// What matters here: an answer is used only when its label names what was
// asked (ion's Google route can answer a name it does not know with an
// unrelated street), the framing types are read sensibly from the label and
// the box, a box across the 180th meridian is centred correctly, and a token
// that may not geocode rests the lookup instead of failing every search.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIonGeocoder,
  ionResultTypes,
  isNamesake,
  labelNamesQuery,
  normalizeIonResult,
} from './ionGeocoder.js';
import { createDefaultPlaceSearch } from './defaults.js';
import * as search from './index.js';

const box = (label, west, south, east, north) => ({
  label,
  west,
  south,
  east,
  north,
});

test('an answer must name what was asked', () => {
  for (const [query, label] of [
    ['Pyramids of Giza', 'Al Haram, Giza Governorate 3512201, Egypt'],
    ['the Eiffel Tower', 'Eiffel Tower, Av. Gustave Eiffel, 75007 Paris'],
    ['Chernobyl', 'Chornobyl, Kyiv Oblast, Ukraine'],
    ['MIT', 'Massachusetts Institute of Technology, Cambridge, MA, USA'],
    ['the Pyramid', 'Pyramids Rd, Giza'],
    ['Area 51', 'Area 51, NV 89001, USA'],
    ['LA', 'Los Angeles, CA, USA'],
    ['東京', 'Tokyo, Japan'],
  ])
    assert.equal(labelNamesQuery(query, label), true, `${query} ← ${label}`);
  for (const [query, label] of [
    ['the Suez Canal', 'Weimarstraat 259, 2562 HH Den Haag, Netherlands'],
    ['the Amazon rainforest', 'China, Guang Zhou Shi, Pan Yu Qu'],
    ['MIT', 'Mittelbergheim, Grand Est, France'],
    ['Petra', 'Peter Street, Dublin'],
  ])
    assert.equal(labelNamesQuery(query, label), false, `${query} ← ${label}`);
});

test('a town named after a lake, or a village spelled like an airport code, is a namesake', () => {
  for (const [query, label] of [
    ['Lake Geneva', 'Lake Geneva, WI 53147, USA'],
    ['Lake Victoria', 'Lake Victoria, MI 48848, USA'],
    ['LAX', 'Lax, Switzerland'],
  ])
    assert.equal(isNamesake(query, label), true, `${query} ← ${label}`);
  for (const [query, label] of [
    ['Lake Tahoe', 'Lake Tahoe, United States'],
    [
      'Mount Fuji',
      'Mount Fuji, Kitayama, Fujinomiya, Shizuoka 418-0112, Japan',
    ],
    [
      'LAX',
      'Los Angeles International Airport (LAX), 1 World Way, Los Angeles, CA 90045, USA',
    ],
    ['Lax', 'Lax, Switzerland'],
    ['Paris', 'Paris, TX 75460, USA'],
  ])
    assert.equal(isNamesake(query, label), false, `${query} ← ${label}`);
});

test('framing types come from the label and the size of the box', () => {
  const cases = [
    ['Japan', 2500, ['country', 'political']],
    ['Iceland', 450, ['country', 'political']],
    ['Texas, USA', 1200, ['administrative_area_level_1', 'political']],
    ['Alaska, USA', 3000, ['administrative_area_level_1', 'political']],
    ['Paris, France', 18, ['locality', 'political']],
    ['Salt Lake City, UT, USA', 30, ['locality', 'political']],
    ['Lake Baikal, Russia', 640, ['natural_feature']],
    ['Mount Everest', 8, ['natural_feature']],
    ['Central Park, New York, NY, USA', 4, ['park']],
    ['Heathrow Airport (LHR), Longford, UK', 5, ['airport']],
    ['Massachusetts Institute of Technology, Cambridge', 1, ['university']],
    ['Wembley Stadium, London', 0.4, ['stadium']],
    ['E 6th St, Austin, TX, USA', 2, ['route']],
    ['350 5th Ave, New York, NY 10118, USA', 0.1, ['street_address']],
    [
      'Mission District, San Francisco, CA, USA',
      3,
      ['sublocality', 'political'],
    ],
    ['District of Columbia, USA', 25, ['locality', 'political']],
    ['Eiffel Tower, Paris, France', 0.3, ['point_of_interest']],
    ['Golden Gate Bridge, San Francisco, CA, USA', 2.7, ['park']],
  ];
  for (const [label, spanKm, types] of cases)
    assert.deepEqual(ionResultTypes(label, spanKm), types, label);
});

test('a box across the 180th meridian is centred across it and framed without a viewport', () => {
  const alaska = normalizeIonResult(
    box('Alaska, USA', 172.4, 51.2, -129.9, 71.4),
  );
  assert.ok(Math.abs(alaska.lat - 61.3) < 1e-9);
  assert.ok(alaska.lng < -150 && alaska.lng > -165, String(alaska.lng));
  assert.equal(alaska.viewport, null);
  assert.deepEqual(alaska.types, ['administrative_area_level_1', 'political']);

  const paris = normalizeIonResult(
    box('Paris, France', 2.2241, 48.8156, 2.4699, 48.9022),
  );
  assert.deepEqual(paris.viewport, {
    southwest: { lat: 48.8156, lng: 2.2241 },
    northeast: { lat: 48.9022, lng: 2.4699 },
  });
  assert.equal(paris.name, 'Paris');

  const point = normalizeIonResult({ label: 'Somewhere', lat: 10, lng: 20 });
  assert.equal(point.viewport, null);
  assert.deepEqual(point.types, ['point_of_interest']);

  for (const bad of [
    box('x', 0, 10, 1, 5),
    box('x', 0, 95, 1, 96),
    { label: 'x', lat: 'a', lng: 1 },
    null,
  ])
    assert.equal(normalizeIonResult(bad), null, JSON.stringify(bad));
});

function transport(answers, calls = []) {
  return async (query, options) => {
    calls.push({ query, ...options });
    const answer = answers[query];
    if (answer instanceof Error) throw answer;
    return answer === undefined ? [] : answer;
  };
}

test('the first result that names the query is used, with the name asked for when the label leads with a district', async () => {
  const geocoder = createIonGeocoder({
    search: transport({
      'Pyramids of Giza': [
        box('Peter Street, Dublin', -6.27, 53.33, -6.26, 53.34),
        box(
          'Al Haram, Giza Governorate 3512201, Egypt',
          31.1325,
          29.9766,
          31.1359,
          29.9824,
        ),
      ],
    }),
  });
  const { place, answered } = await geocoder.geocode('Pyramids of Giza');
  assert.equal(answered, true);
  assert.ok(Math.abs(place.lat - 29.9795) < 1e-9);
  assert.equal(place.name, 'Pyramids of Giza');
  assert.equal(place.label, 'Al Haram, Giza Governorate 3512201, Egypt');
});

test('an answer that does not name the query is no answer, and the miss is a verdict', async () => {
  const calls = [];
  const geocoder = createIonGeocoder({
    search: transport(
      {
        'the Suez Canal': [
          box('Weimarstraat 259, 2562 HH Den Haag', 4.28, 52.07, 4.29, 52.08),
        ],
      },
      calls,
    ),
  });
  assert.deepEqual(await geocoder.geocode('the Suez Canal'), {
    place: null,
    answered: true,
  });
  await geocoder.geocode('the Suez Canal');
  assert.equal(calls.length, 1, 'the miss is remembered');
});

test('Google or Bing is asked as configured, and an unknown provider is refused', async () => {
  const calls = [];
  await createIonGeocoder({
    search: transport({}, calls),
    provider: 'bing',
  }).geocode('Somewhere');
  assert.equal(calls[0].provider, 'bing');
  assert.throws(
    () => createIonGeocoder({ search: transport({}), provider: 'osm' }),
    TypeError,
  );
  assert.throws(() => createIonGeocoder({}), TypeError);
});

test('a transport that cannot search yet is "did not answer", and nothing is remembered', async () => {
  let ready = false;
  const geocoder = createIonGeocoder({
    search: async () =>
      ready ? [box('Paris, France', 2.2, 48.8, 2.5, 48.9)] : null,
  });
  assert.deepEqual(await geocoder.geocode('Paris'), {
    place: null,
    answered: false,
  });
  ready = true;
  assert.equal((await geocoder.geocode('Paris')).place.name, 'Paris');
});

test('a token that may not geocode, or a spent quota, rests the lookup for a quarter of an hour', async () => {
  for (const status of [401, 403, 429]) {
    let clock = 0;
    const calls = [];
    const geocoder = createIonGeocoder({
      search: async (query, options) => {
        calls.push(query);
        throw Object.assign(new Error('refused'), { status });
      },
      now: () => clock,
    });
    assert.equal((await geocoder.geocode('Paris')).answered, false);
    clock = 14 * 60_000;
    assert.equal((await geocoder.geocode('Rome')).answered, false);
    assert.equal(calls.length, 1, `${status}: resting, nothing sent`);
    clock = 16 * 60_000;
    await geocoder.geocode('Rome');
    assert.equal(calls.length, 2, `${status}: asked again after the rest`);
  }
});

test('two unanswered searches in a row pause the lookup for a minute', async () => {
  let clock = 0;
  const calls = [];
  const geocoder = createIonGeocoder({
    search: async (query) => {
      calls.push(query);
      throw new Error('offline');
    },
    now: () => clock,
  });
  await geocoder.geocode('A');
  await geocoder.geocode('B');
  await geocoder.geocode('C');
  assert.deepEqual(calls, ['A', 'B'], 'the third waits out the pause');
  clock = 61_000;
  await geocoder.geocode('C');
  assert.deepEqual(calls, ['A', 'B', 'C']);
});

test('a request that outlasts its budget is "did not answer"; a cancelled search throws', async () => {
  const slow = createIonGeocoder({
    search: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  assert.deepEqual(await slow.geocode('Paris'), {
    place: null,
    answered: false,
  });
  const controller = new AbortController();
  const pending = slow.geocode('Rome', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

function fakeNetwork() {
  const requests = [];
  const fetchImpl = async (url) => {
    const asked = new URL(String(url), 'http://localhost');
    requests.push(asked.hostname);
    if (asked.hostname.includes('wikipedia'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: {
            pages: [
              {
                title: 'Suez Canal',
                index: 1,
                coordinates: [
                  {
                    lat: 30.705,
                    lon: 32.344,
                    type: 'landmark',
                    globe: 'earth',
                  },
                ],
                description: 'Artificial sea-level waterway in Egypt',
              },
            ],
          },
        }),
      };
    return { ok: true, status: 200, json: async () => ({ features: [] }) };
  };
  return { fetchImpl, requests };
}

test('the default chain asks Google through ion before Wikipedia, and Bing only after it', async () => {
  const { fetchImpl, requests } = fakeNetwork();
  const calls = [];
  const ionGeocoding = transport(
    {
      Tokyo: [box('Tokyo, Japan', 138.9, 35.5, 139.9, 35.9)],
      'the Suez Canal': [
        box('Weimarstraat 259, 2562 HH Den Haag', 4.28, 52.07, 4.29, 52.08),
      ],
    },
    calls,
  );
  const chain = createDefaultPlaceSearch({
    fetchImpl,
    landmarks: true,
    ionGeocoding,
  });

  const tokyo = await chain.geocode('Tokyo');
  assert.equal(tokyo.place.name, 'Tokyo');
  assert.deepEqual(requests, [], 'Google answered: nothing else was asked');
  assert.deepEqual(
    calls.map((call) => call.provider),
    ['google'],
  );

  const suez = await chain.geocode('the Suez Canal');
  assert.equal(
    suez.place.name,
    'Suez Canal',
    "Google's unrelated street is handed on, and Wikipedia knows the canal",
  );
  assert.deepEqual(
    calls.map((call) => call.provider),
    ['google', 'google'],
    'Bing is not asked once Wikipedia has answered',
  );

  calls.length = 0;
  await chain.geocode('Nowhere Known');
  assert.deepEqual(
    calls.map((call) => call.provider),
    ['google', 'bing'],
  );
});

test('without an ion transport the chain is exactly what it was', async () => {
  const { fetchImpl, requests } = fakeNetwork();
  const chain = createDefaultPlaceSearch({ fetchImpl, landmarks: true });
  await chain.geocode('the Suez Canal');
  assert.equal(requests[0], 'en.wikipedia.org');
});

test('the search package exports the provider', () => {
  assert.equal(search.createIonGeocoder, createIonGeocoder);
});
