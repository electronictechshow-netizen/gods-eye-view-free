/**
 * Keyless stand-ins for the two Google Places surfaces.
 *
 * Named-place lookup is Photon (OpenStreetMap). Nearby context merges two
 * sources that are each strong where the other is weak: Photon `/reverse` for
 * streets, shops and addresses, and Wikipedia geosearch for which building in
 * view is actually notable. Both emit the exact shape
 * `placeProviderPayloads.js` produces for Google, so the voice scene context,
 * Global Context classification and annotation resolver need no changes.
 *
 * Overpass would give richer POI detail but is not dependable here: its public
 * mirrors refuse a meaningful share of residential traffic outright (HTTP 406
 * at their Apache layer, before the query is parsed).
 *
 * Still not a like-for-like replacement for Google's corpus — long-tail retail
 * is covered unevenly — but the landmark case, which is what the voice agent
 * is actually asked about, is answered in every city tested.
 */

const PHOTON_ENDPOINT = 'https://photon.komoot.io/api';
const PHOTON_REVERSE_ENDPOINT = 'https://photon.komoot.io/reverse';
const WIKIPEDIA_GEOSEARCH_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'gods-eye-view (local dev)';

/**
 * Titles that are not a place you can look at.
 *
 * Wikipedia geosearch returns anything with coordinates, which includes events
 * ("2017 Times Square car attack"), works of art and disambiguation pages. A
 * voice answer naming those instead of the building in view is worse than
 * naming nothing, so they are dropped.
 */
const NON_PLACE_TITLE =
  /\b(19|20)\d{2}\b|\b(attack|bombing|shooting|panic|disaster|crash|riot|protest|election|massacre|incident)\b|\(disambiguation\)/i;

/**
 * Wikipedia coordinate types that describe a REGION rather than something in
 * view. The reverse geocode already names the city, so repeating it as a
 * "nearby place" is noise that crowds out the building actually in front of
 * the camera.
 */
const AREA_COORDINATE_TYPES = new Set([
  'country',
  'satellite',
  'state',
  'adm1st',
  'adm2nd',
  'adm3rd',
  'city',
  'isle',
  'waterbody',
  'mountain',
  'forest',
  'glacier',
  'event',
]);

/** Largest coordinate extent (metres) still treated as a discrete place. */
const MAX_LANDMARK_DIM = 5000;

/**
 * Nearby notable landmarks from Wikipedia geosearch.
 *
 * Complements Photon: OSM is strong on streets, shops and addresses and weak
 * on which building is famous. Wikipedia is the reverse. Keyless, and the one
 * source that answered in every city tested.
 *
 * @returns {Promise<Array<object>>} Places in the shared projected shape.
 */
export async function keylessLandmarks({
  latitude,
  longitude,
  radiusM = 500,
  fetchImpl = (...args) => fetch(...args),
  endpoint = WIKIPEDIA_GEOSEARCH_ENDPOINT,
  signal,
} = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'geosearch');
  url.searchParams.set('gscoord', `${latitude}|${longitude}`);
  // Wikipedia caps gsradius at 10 km and rejects anything larger outright.
  url.searchParams.set(
    'gsradius',
    String(Math.max(10, Math.min(10000, Math.round(radiusM)))),
  );
  url.searchParams.set('gslimit', '20');
  // `type` and `dim` are what make region entries separable from buildings.
  url.searchParams.set('gsprop', 'type|dim');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok)
    throw new Error(`Wikipedia geosearch HTTP ${response.status}`);
  const data = await response.json();

  return (Array.isArray(data?.query?.geosearch) ? data.query.geosearch : [])
    .filter((entry) => {
      if (!entry?.title || NON_PLACE_TITLE.test(entry.title)) return false;
      if (AREA_COORDINATE_TYPES.has(String(entry.type || '').toLowerCase()))
        return false;
      // `dim` is the article's own estimate of how large the thing is.
      const dim = Number(entry.dim);
      return !Number.isFinite(dim) || dim <= MAX_LANDMARK_DIM;
    })
    .map((entry) => ({
      id: entry.pageid ? `wikipedia/${entry.pageid}` : null,
      name: entry.title,
      address: null,
      latitude: entry.lat ?? null,
      longitude: entry.lon ?? null,
      distanceM: Number.isFinite(entry.dist)
        ? Math.round(entry.dist)
        : distanceM(latitude, longitude, entry.lat, entry.lon),
      primaryType: 'tourist_attraction',
      // Ranked as a landmark so `placeContextPriority` floats it above a shop
      // when the voice agent is asked what it is looking at.
      types: ['tourist_attraction', 'point_of_interest'],
    }))
    .filter((place) => Number.isFinite(place.latitude));
}

/**
 * Map OSM tags onto the Google place-type vocabulary the projections rank by.
 *
 * `placeContextPriority` scores on these names, so an unmapped feature would
 * sort as generic even when it is the landmark the user is looking at.
 */
function osmTypes(tags = {}) {
  const types = [];
  const add = (...names) => {
    for (const name of names) if (!types.includes(name)) types.push(name);
  };

  if (tags.historic === 'monument' || tags.historic === 'memorial')
    add('monument', 'historical_landmark');
  else if (tags.historic) add('historical_landmark');

  if (tags.tourism === 'museum') add('museum');
  if (tags.tourism === 'attraction' || tags.tourism === 'viewpoint')
    add('tourist_attraction');
  if (tags.tourism === 'hotel') add('lodging');

  if (tags.aeroway === 'terminal' || tags.aeroway === 'aerodrome')
    add('airport');
  if (tags.railway === 'station') add('train_station', 'transit_station');
  if (tags.military || tags.landuse === 'military') add('military');
  if (tags.amenity === 'university' || tags.amenity === 'college')
    add('university');
  if (tags.amenity === 'school') add('school');
  if (tags.amenity === 'hospital') add('hospital');
  if (tags.amenity) add(String(tags.amenity));
  if (tags.shop) add('store');
  if (tags.office) add('office');
  if (tags.leisure === 'park') add('park');
  if (tags.leisure) add(String(tags.leisure));
  if (tags.building && tags.building !== 'yes') add('premise');
  if (tags['addr:housenumber']) add('street_address');

  add('point_of_interest');
  return types.slice(0, 8);
}

/** Best human label OSM offers for a feature. */
function osmAddress(tags = {}) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'] || tags['addr:suburb'],
    tags['addr:postcode'],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function distanceM(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(Number.isFinite))
    return Number.MAX_SAFE_INTEGER;
  const latScale = 111320;
  const lonScale = latScale * Math.cos((latA * Math.PI) / 180);
  return Math.round(
    Math.hypot((latB - latA) * latScale, (lonB - lonA) * lonScale),
  );
}

/**
 * Nearby named features from OpenStreetMap.
 *
 * @returns {Promise<Array<object>>} Places in Google's projected shape.
 */
async function photonNearby({
  latitude,
  longitude,
  radiusM = 250,
  fetchImpl = (...args) => fetch(...args),
  endpoint = PHOTON_REVERSE_ENDPOINT,
  signal,
} = {}) {
  // Photon's reverse endpoint rather than Overpass: it answers in one bounded
  // request, and the public Overpass mirrors refuse a meaningful share of
  // residential/dev traffic outright (HTTP 406 at their Apache layer), which
  // would make nearby context fail exactly where it is most wanted.
  const url = new URL(endpoint);
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('limit', '30');

  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(20_000),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Photon reverse HTTP ${response.status}`);
  const data = await response.json();

  const radius = Math.max(25, Math.min(5000, Math.round(radiusM)));
  const seen = new Set();
  return (Array.isArray(data?.features) ? data.features : [])
    .map((feature) => {
      const props = feature?.properties || {};
      const [lon, lat] = Array.isArray(feature?.geometry?.coordinates)
        ? feature.geometry.coordinates
        : [null, null];
      const types = osmTypes({
        [props.osm_key]: props.osm_value,
        ...(props.housenumber ? { 'addr:housenumber': props.housenumber } : {}),
      });
      return {
        id:
          props.osm_type && props.osm_id
            ? `${props.osm_type}/${props.osm_id}`
            : null,
        name: props.name || null,
        address:
          [props.street, props.district, props.city]
            .filter(Boolean)
            .join(', ') || null,
        latitude: lat,
        longitude: lon,
        distanceM: distanceM(latitude, longitude, lat, lon),
        primaryType: props.osm_value || types[0] || null,
        types,
      };
    })
    .filter((place) => {
      // Unnamed nodes are noise in a spoken answer, and Photon returns matches
      // well outside the asked-for radius — filter to what was requested.
      if (!place.name || !Number.isFinite(place.latitude)) return false;
      if (place.distanceM > radius * 4) return false;
      const key = place.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 20);
}

/**
 * Nearby place context, merged from both keyless sources.
 *
 * Photon supplies streets, shops and addresses; Wikipedia supplies which of
 * the buildings in view is actually notable. Neither alone matches Google's
 * corpus; together they cover the two things the voice agent is asked for.
 *
 * Either source failing is survivable — a thinner answer beats no answer — so
 * both are settled independently rather than awaited as a pair.
 *
 * @returns {Promise<Array<object>>} Places in Google's projected shape.
 */
export async function keylessNearbyPlaces(options = {}) {
  const { latitude, longitude, radiusM = 250 } = options;
  const [streets, landmarks] = await Promise.allSettled([
    photonNearby(options),
    keylessLandmarks({ latitude, longitude, radiusM: Math.max(radiusM, 500) }),
  ]);

  const both = [
    ...(landmarks.status === 'fulfilled' ? landmarks.value : []),
    ...(streets.status === 'fulfilled' ? streets.value : []),
  ];
  // Both sources failing is a real outage; the caller turns that into an
  // honest "unavailable" rather than an empty list that reads as "nothing here".
  if (streets.status === 'rejected' && landmarks.status === 'rejected') {
    throw streets.reason ?? landmarks.reason;
  }

  const seen = new Set();
  return both
    .filter((place) => {
      const key = String(place.name || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 20);
}

/**
 * View-biased named-place lookup via Photon.
 *
 * @returns {Promise<Array<object>>} Places in Google's text-search shape.
 */
export async function keylessTextSearch({
  query,
  latitude,
  longitude,
  fetchImpl = (...args) => fetch(...args),
  endpoint = PHOTON_ENDPOINT,
  signal,
} = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
  }

  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(20_000),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
  const data = await response.json();

  return (Array.isArray(data?.features) ? data.features : [])
    .map((feature) => {
      const props = feature?.properties || {};
      const [lon, lat] = Array.isArray(feature?.geometry?.coordinates)
        ? feature.geometry.coordinates
        : [null, null];
      // Photon's extent is [minLon, maxLat, maxLon, minLat]; Google's viewport
      // is low/high corners. Sizing an annotation disc depends on this.
      const extent = Array.isArray(props.extent) ? props.extent : null;
      const viewport =
        extent && extent.length === 4 && extent.every(Number.isFinite)
          ? {
              low: {
                latitude: Math.min(extent[1], extent[3]),
                longitude: Math.min(extent[0], extent[2]),
              },
              high: {
                latitude: Math.max(extent[1], extent[3]),
                longitude: Math.max(extent[0], extent[2]),
              },
            }
          : null;
      const types = osmTypes({
        [props.osm_key]: props.osm_value,
        ...(props.housenumber ? { 'addr:housenumber': props.housenumber } : {}),
      });
      const address =
        [props.street, props.city, props.state, props.country]
          .filter(Boolean)
          .join(', ') || null;
      return {
        id:
          props.osm_type && props.osm_id
            ? `${props.osm_type}/${props.osm_id}`
            : null,
        name: props.name || null,
        address,
        latitude: lat,
        longitude: lon,
        distanceM: distanceM(latitude, longitude, lat, lon),
        primaryType: props.osm_value || types[0] || null,
        types,
        viewport,
      };
    })
    .filter((place) => place.name && Number.isFinite(place.latitude));
}
