import { createNominatimProvider } from './nominatim.js';
import { createGeospatialServices } from './geospatial.js';
import { createHttpGeospatialProvider } from './http.js';
import { createPlaceSearch } from './placeSearch.js';
import { createGoogleGeocoder } from './google.js';
import { createPhotonGeocoder } from '../keylessGeocoder.js';
import { createCoordinateGeocoder } from './coordinateGeocoder.js';
import { createPresetGeocoder } from './presetGeocoder.js';
import { createNaturalRegionGeocoder } from './naturalRegionGeocoder.js';
import { createWikipediaGeocoder } from './wikipediaGeocoder.js';
import { createIonGeocoder } from './ionGeocoder.js';

/**
 * Coordinates, bundled names and bundled natural regions first — all answer
 * offline and with no key — then Google when configured, then Google through
 * Cesium ion (when `ionGeocoding` is supplied), then Wikipedia for famous
 * places (when `landmarks` is set), then Bing through Cesium ion, then keyless
 * Photon, then the local Nominatim route as a last resort. Transport stays
 * local to setup.
 *
 * `presets` is the caller's bundled place data and `naturalRegions` its
 * natural-region lookup (name → region polygons, or null). Both are passed in
 * rather than imported so this package keeps reading no application state; with
 * none supplied there is simply no provider for them. `landmarks` opts in to the
 * Wikipedia lookup (true, or its options), which the other callers do not want
 * adding requests to their searches.
 *
 * `ionGeocoding` is the caller's Cesium ion transport (`createIonGeocodeSearch`
 * in the maps package): it runs CesiumJS's geocoder with the ion token the 3D
 * tiles already use, so this package still imports no Cesium. Bing is asked
 * only after Wikipedia, because where Google has no answer Bing's usual miss is
 * a same-named town, which Wikipedia does not make.
 */
export function createDefaultPlaceSearch({
  resolveApiKey,
  fetchImpl = (...args) => fetch(...args),
  signal,
  endpoints = {},
  providers = {},
  presets = null,
  naturalRegions = null,
  landmarks = false,
  ionGeocoding = null,
  geocoding = null,
} = {}) {
  if (geocoding && geocoding.provider !== 'nominatim')
    throw new TypeError('Unsupported geocoding provider');
  const selected = geocoding
    ? createNominatimProvider({ ...geocoding, fetchImpl })
    : null;
  if (selected && !selected.geocode)
    throw new TypeError('Nominatim searchEndpoint is required');
  const forward = createPlaceSearch({
    signal,
    providers: providers.geocode || [
      createCoordinateGeocoder(),
      ...(presets ? [createPresetGeocoder({ presets })] : []),
      ...(naturalRegions
        ? [createNaturalRegionGeocoder({ lookup: naturalRegions })]
        : []),
      ...(selected
        ? [selected]
        : [
            createGoogleGeocoder({
              request(query, { bias, signal }) {
                const key = resolveApiKey?.();
                if (!key) return null;
                const url = new URL(
                  endpoints.geocode ||
                    'https://maps.googleapis.com/maps/api/geocode/json',
                );
                url.searchParams.set('address', query);
                url.searchParams.set('key', key);
                if (bias) url.searchParams.set('bounds', bias);
                return fetchImpl(url.toString(), { signal });
              },
            }),
            ...(ionGeocoding
              ? [
                  createIonGeocoder({
                    search: ionGeocoding,
                    provider: 'google',
                  }),
                ]
              : []),
            ...(landmarks
              ? [
                  createWikipediaGeocoder({
                    fetchImpl,
                    photonEndpoint: endpoints.photon,
                    ...(typeof landmarks === 'object' ? landmarks : {}),
                  }),
                ]
              : []),
            ...(ionGeocoding
              ? [createIonGeocoder({ search: ionGeocoding, provider: 'bing' })]
              : []),
            createPhotonGeocoder({ fetchImpl, endpoint: endpoints.photon }),
            // Last resort: the local Nominatim route, which answers with no key when
            // neither of the two above did. It speaks the same result shape, so it
            // rides the existing Google adapter rather than needing its own.
            createGoogleGeocoder({
              request(query, { bias, signal }) {
                const params = new URLSearchParams({ q: query });
                if (bias) params.set('bounds', bias);
                return fetchImpl(
                  `${endpoints.nominatim || '/api/geocode'}?${params}`,
                  {
                    signal,
                  },
                );
              },
            }),
          ]),
    ],
  });
  const operations = createHttpGeospatialProvider({
    fetchImpl,
    resolveApiKey,
    endpoints,
  });
  return {
    ...forward,
    ...createGeospatialServices({
      signal,
      providers: {
        ...operations,
        ...(selected
          ? {
              reverseGeocode: selected.reverseGeocode,
              attribution: {
                ...operations.attribution,
                ...selected.attribution,
              },
            }
          : {}),
        ...providers,
      },
    }),
  };
}

// Compatibility for direct module callers. Application composition supplies its own instance.
export const defaultGeospatial = createDefaultPlaceSearch({
  resolveApiKey: () => globalThis.window?.__GOOGLE_MAPS_API_KEY__,
});
