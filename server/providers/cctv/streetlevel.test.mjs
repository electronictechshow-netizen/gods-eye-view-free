import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedImageUrl,
  kartaViewFallback,
  pickBestPhoto,
  rankPhotos,
} from './streetlevel.js';

const photo = (over = {}) => ({
  distance: 10,
  heading: 90,
  fileurlProc: 'https://storage9.openstreetcam.org/files/photo/a.jpg',
  ...over,
});

function listResponse(photos) {
  return new Response(JSON.stringify({ result: { data: photos } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function imageResponse({ status = 200, type = 'image/jpeg', bytes = 32 } = {}) {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { 'content-type': type },
  });
}

/* ---------------- candidate ranking ---------------- */

test('a facing frame beats a nearer one pointing the wrong way', () => {
  const best = pickBestPhoto(
    [
      photo({ distance: 10, heading: 270 }),
      photo({ distance: 40, heading: 92 }),
    ],
    90,
  );
  assert.equal(best.heading, 92);
});

test('with no camera bearing, ranking falls back to pure proximity', () => {
  const ranked = rankPhotos(
    [
      photo({ distance: 50, heading: 90 }),
      photo({ distance: 5, heading: 270 }),
    ],
    NaN,
  );
  assert.equal(ranked[0].distance, 5);
});

test('bearing wrap-around is measured the short way', () => {
  // 350 deg is 20 deg from 10 deg, not 340.
  const best = pickBestPhoto(
    [
      photo({ distance: 10, heading: 350 }),
      photo({ distance: 12, heading: 180 }),
    ],
    10,
  );
  assert.equal(best.heading, 350);
});

test('photos without a usable distance are dropped', () => {
  assert.deepEqual(rankPhotos([{ heading: 90 }, photo()], 90).length, 1);
  assert.equal(pickBestPhoto([], 90), null);
});

/* ---------------- URL allowlist (SSRF guard) ---------------- */

test('only KartaView image hosts over https are fetched', () => {
  assert.ok(allowedImageUrl('https://storage9.openstreetcam.org/a.jpg'));
  assert.ok(allowedImageUrl('https://storage.kartaview.org/a.jpg'));
  assert.ok(allowedImageUrl('https://storage12.kartaview.org/a.jpg'));

  assert.equal(
    allowedImageUrl('http://storage9.openstreetcam.org/a.jpg'),
    null,
  );
  assert.equal(allowedImageUrl('https://evil.example/a.jpg'), null);
  assert.equal(
    allowedImageUrl('https://storage9.openstreetcam.org.evil.example/a.jpg'),
    null,
  );
  assert.equal(
    allowedImageUrl('https://u:p@storage.kartaview.org/a.jpg'),
    null,
  );
  assert.equal(allowedImageUrl('not a url'), null);
  assert.equal(allowedImageUrl(undefined), null);
});

/* ---------------- fetch flow ---------------- */

test('a usable frame is returned with its attribution', async () => {
  const result = await kartaViewFallback({
    lat: 30.2672,
    lon: -97.7431,
    heading: 90,
    fetchImpl: async (url) =>
      String(url).includes('api.kartaview.org/2.0/photo')
        ? listResponse([photo()])
        : imageResponse(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/jpeg');
  assert.match(result.attribution, /KartaView/);
  assert.match(result.attribution, /CC BY-SA/);
  assert.ok(Buffer.isBuffer(result.body));
});

test('a retired storage node is skipped for the next candidate', async () => {
  // Legacy frames answer 409 from decommissioned nodes; giving up on the
  // closest photo would lose coverage that is actually available.
  const attempted = [];
  const result = await kartaViewFallback({
    lat: 30.2672,
    lon: -97.7431,
    heading: 90,
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes('api.kartaview.org/2.0/photo'))
        return listResponse([
          photo({
            distance: 1,
            fileurlProc: 'https://storage9.openstreetcam.org/dead.jpg',
          }),
          photo({
            distance: 2,
            fileurlProc: 'https://storage.kartaview.org/live.jpg',
          }),
        ]);
      attempted.push(href);
      return href.includes('dead.jpg')
        ? new Response('<Error/>', {
            status: 409,
            headers: { 'content-type': 'application/xml' },
          })
        : imageResponse();
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(attempted, [
    'https://storage9.openstreetcam.org/dead.jpg',
    'https://storage.kartaview.org/live.jpg',
  ]);
});

test('no coverage returns null rather than throwing', async () => {
  const empty = await kartaViewFallback({
    lat: 0,
    lon: 0,
    fetchImpl: async () => listResponse([]),
  });
  assert.equal(empty, null);
});

test('an upstream failure returns null', async () => {
  for (const fetchImpl of [
    async () => new Response('nope', { status: 500 }),
    async () => {
      throw new Error('socket hang up');
    },
    async () => new Response('not json', { status: 200 }),
  ]) {
    assert.equal(await kartaViewFallback({ lat: 1, lon: 1, fetchImpl }), null);
  }
});

test('invalid coordinates never reach the network', async () => {
  let called = false;
  const guard = async () => {
    called = true;
    throw new Error('must not fetch');
  };
  assert.equal(
    await kartaViewFallback({ lat: NaN, lon: 1, fetchImpl: guard }),
    null,
  );
  assert.equal(await kartaViewFallback({ fetchImpl: guard }), null);
  assert.equal(called, false);
});

test('a non-image response is refused even with HTTP 200', async () => {
  const result = await kartaViewFallback({
    lat: 1,
    lon: 1,
    fetchImpl: async (url) =>
      String(url).includes('api.kartaview.org')
        ? listResponse([photo()])
        : imageResponse({ type: 'text/html' }),
  });
  assert.equal(result, null);
});

test('the search radius is clamped to a sane range', async () => {
  const seen = [];
  const capture = async (url) => {
    seen.push(new URL(url).searchParams.get('radius'));
    return listResponse([]);
  };
  await kartaViewFallback({ lat: 1, lon: 1, radiusM: 5, fetchImpl: capture });
  await kartaViewFallback({
    lat: 1,
    lon: 1,
    radiusM: 99999,
    fetchImpl: capture,
  });
  assert.deepEqual(seen, ['10', '500']);
});
