/**
 * Cesium ion geocoding (Google or Bing) for the place search, through
 * CesiumJS's own `IonGeocoderService` — the way Cesium asks its geocoder to be
 * used — with each answer's attribution put on the globe's credit line, as
 * Cesium's geocoder widget does.
 *
 * `Cesium` is passed in, like the 3D tile loader's, so the transport can be
 * exercised without a WebGL context. The search package receives only the
 * returned function and plain degrees; it never imports Cesium.
 */

/** Rectangle (radians) or Cartesian3 destination → plain degrees, or null. */
function resultToDegrees(Cesium, result) {
  const label = String(result?.displayName ?? '');
  const destination = result?.destination;
  if (!destination) return null;
  if (['west', 'south', 'east', 'north'].every((key) => key in destination)) {
    const toDegrees = Cesium.Math.toDegrees;
    return {
      label,
      west: toDegrees(destination.west),
      south: toDegrees(destination.south),
      east: toDegrees(destination.east),
      north: toDegrees(destination.north),
    };
  }
  const cartographic = Cesium.Cartographic.fromCartesian(destination);
  if (!cartographic) return null;
  return {
    label,
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lng: Cesium.Math.toDegrees(cartographic.longitude),
  };
}

/**
 * The ion transport `createIonGeocoder` expects, or null without a token.
 *
 * `getScene()` supplies the globe's scene once it exists; until then a search
 * resolves to null ("not ready"), which the place search reads as no answer and
 * passes on. A failed request rejects with the HTTP `status` Cesium reported,
 * so a token without the geocode scope can be told apart from a network blip.
 *
 * @param {object} Cesium
 * @param {{accessToken?: string, getScene?: () => object|null}} options
 * @returns {null | ((query: string, options?: {provider?: 'google'|'bing'})
 *   => Promise<object[]|null>)}
 */
export function createIonGeocodeSearch(
  Cesium,
  { accessToken = '', getScene = () => null } = {},
) {
  const token = String(accessToken ?? '').trim();
  if (!token) return null;
  const services = new Map();
  let shown = [];
  let shownOn = null;

  function serviceFor(provider, scene) {
    const existing = services.get(provider);
    if (existing?.scene === scene) return existing.service;
    const service = new Cesium.IonGeocoderService({
      scene,
      accessToken: token,
      geocodeProviderType:
        provider === 'bing'
          ? Cesium.IonGeocodeProviderType.BING
          : Cesium.IonGeocodeProviderType.GOOGLE,
    });
    services.set(provider, { scene, service });
    return service;
  }

  /** Replace the previous answer's credits with this one's, like the geocoder widget. */
  function credit(scene, result) {
    const display = scene?.frameState?.creditDisplay;
    if (!display || display.isDestroyed?.()) return;
    if (shownOn === scene)
      for (const previous of shown) display.removeStaticCredit(previous);
    shown = Cesium.GeocoderService.getCreditsFromResult(result) ?? [];
    shownOn = scene;
    for (const next of shown) display.addStaticCredit(next);
  }

  return async function searchIon(query, { provider = 'google' } = {}) {
    const scene = getScene();
    if (!scene || scene.isDestroyed?.()) return null;
    let results;
    try {
      results = await serviceFor(provider, scene).geocode(
        String(query),
        Cesium.GeocodeType.SEARCH,
      );
    } catch (error) {
      throw Object.assign(new Error('Cesium ion geocoder request failed'), {
        status: error?.statusCode ?? error?.status ?? null,
      });
    }
    if (!Array.isArray(results)) return [];
    if (results.length) credit(scene, results[0]);
    return results
      .map((result) => resultToDegrees(Cesium, result))
      .filter(Boolean);
  };
}
