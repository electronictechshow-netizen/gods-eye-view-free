/**
 * Keyless street-level fallback frame, from KartaView (OpenStreetMap's
 * crowd-sourced street imagery).
 *
 * The Google Street View fallback needs a billing-enabled Maps key. KartaView's
 * read API needs no credential at all, so a camera whose upstream has no frame
 * can still show real ground-level imagery instead of a placeholder card.
 *
 * Coverage is crowd-sourced and uneven — dense in mapped cities, absent on many
 * rural roads — and frames are historical, not live. Callers must label it as
 * such; it is a fallback, never presented as the camera's own view.
 */

const KARTAVIEW_API = 'https://api.kartaview.org/2.0/photo/';

/** Image hosts KartaView serves frames from. Nothing else is fetched. */
const ALLOWED_IMAGE_HOSTS = new Set([
  'storage.kartaview.org',
  'api.kartaview.org',
  'kartaview.org',
]);

function allowedImageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  // Frames are served from numbered storage nodes (storage9.openstreetcam.org).
  const allowed =
    ALLOWED_IMAGE_HOSTS.has(host) ||
    /^storage\d*\.openstreetcam\.org$/.test(host) ||
    /^storage\d*\.kartaview\.org$/.test(host);
  return allowed ? url : null;
}

/** Smallest absolute difference between two bearings, in degrees. */
function headingDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

/**
 * Score candidates so the chosen frame looks the way the camera looks.
 *
 * A nearer photo pointing the wrong way is worse than a slightly further one
 * facing the camera's bearing, so heading dominates when a bearing is known.
 */
function rankPhotos(photos, heading) {
  return photos
    .map((photo) => {
      const distance = Number(photo?.distance);
      if (!Number.isFinite(distance)) return null;
      const delta = headingDelta(Number(photo?.heading), heading);
      // Distance in metres plus a heading penalty; an unknown bearing on
      // either side falls back to pure proximity.
      return { photo, score: delta == null ? distance : distance + delta * 2 };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.photo);
}

/** Best single candidate. Retained for callers that only need the ranking. */
function pickBestPhoto(photos, heading) {
  return rankPhotos(photos, heading)[0] ?? null;
}

/**
 * Fetch a nearby street-level frame, or null when there is no usable coverage.
 *
 * @param {object} options
 * @param {number} options.lat - Camera latitude.
 * @param {number} options.lon - Camera longitude.
 * @param {number} [options.heading] - Camera bearing in degrees.
 * @param {number} [options.radiusM] - Search radius in metres.
 * @param {number} [options.timeoutMs] - Per-request timeout.
 * @returns {Promise<{ok: true, body: Buffer, contentType: string, attribution: string}|null>}
 */
export async function kartaViewFallback({
  lat,
  lon,
  heading,
  radiusM = 80,
  timeoutMs = 8000,
  maxCandidates = 6,
  fetchImpl = (...args) => fetch(...args),
  endpoint = KARTAVIEW_API,
} = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    const url = new URL(endpoint);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lng', String(lon));
    url.searchParams.set(
      'radius',
      String(Math.max(10, Math.min(500, radiusM))),
    );
    url.searchParams.set('itemsPerPage', '20');

    const listResponse = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!listResponse.ok) return null;
    const payload = await listResponse.json().catch(() => null);
    const photos = payload?.result?.data;
    if (!Array.isArray(photos) || !photos.length) return null;

    // Older frames still point at retired storage nodes that answer 409, so
    // walk the ranked candidates rather than giving up on the closest one.
    for (const photo of rankPhotos(photos, Number(heading)).slice(
      0,
      maxCandidates,
    )) {
      // Prefer the processed render; fall back to the large thumbnail.
      const imageUrl =
        allowedImageUrl(photo?.fileurlProc) ||
        allowedImageUrl(photo?.fileurlLTh);
      if (!imageUrl) continue;

      let imageResponse;
      try {
        imageResponse = await fetchImpl(imageUrl, {
          headers: { 'User-Agent': 'gods-eye-view-cctv-proxy/1.0' },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        continue;
      }
      const contentType = imageResponse.headers.get('content-type') || '';
      if (!imageResponse.ok || !contentType.startsWith('image/')) continue;

      return {
        ok: true,
        body: Buffer.from(await imageResponse.arrayBuffer()),
        contentType,
        // CC BY-SA 4.0 requires naming the source wherever the frame is shown.
        attribution: 'KartaView (CC BY-SA)',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export { pickBestPhoto, rankPhotos, allowedImageUrl };
