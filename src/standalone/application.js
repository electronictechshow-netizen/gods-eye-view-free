import * as Cesium from 'cesium';
import { createStandaloneCatalog } from './catalog.js';
import { createStandalonePlaceSearch } from './placeSearch.js';
import { CITY_POIS } from '../locations.js';
import { findNaturalRegion } from '../data/naturalEarthRegions.js';
import { createIonGeocodeSearch } from '../maps/ionGeocoding.js';
import { createApplication } from '../app/application.js';
import { createStandaloneScene } from './scene.js';
import { createStandaloneControls } from './controls.js';
import { createStandaloneData } from './data.js';
import { createStandaloneTools } from './tools.js';
import { createGoogleTokenSource } from '../maps/googleTokens.js';

// The existing controls and layer catalog contain page-scoped state.
let constructed = false;

/** Compose the standalone application once per page. Reload to start again. */
export function createStandaloneApplication({
  googleApiKey,
  cesiumToken,
  geospatial = {},
  voice = {},
  allowQaRegistration = false,
}) {
  if (constructed)
    throw new Error('The standalone application already owns this page');
  constructed = true;
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');
  let placeSearch;
  let catalog;
  let globeScene = null;
  return createApplication({
    createScene: async (context) => {
      placeSearch = createStandalonePlaceSearch({
        // The bundled city and landmark data the offline name provider reads,
        // and the Natural Earth lookup that answers "the Alps" or "the Sahara"
        // with the real range instead of a same-named hamlet. The search package
        // takes both as plain inputs rather than importing them, so it stays
        // free of application state.
        presets: CITY_POIS,
        naturalRegions: findNaturalRegion,
        // Famous places ("the Colosseum", "the Kremlin") are looked up on
        // Wikipedia ahead of Photon, which ranks by text and finds a same-named
        // locality on the wrong continent.
        landmarks: true,
        // Google (then Bing) place search through the Cesium ion token the 3D
        // tiles already use: the same knowledge the original's Google key gave
        // it, and the geocoder Google's tiles are meant to be searched with. It
        // answers once the globe exists to show the geocoder's credit on.
        ionGeocoding: createIonGeocodeSearch(Cesium, {
          accessToken: cesiumToken,
          getScene: () => globeScene,
        }),
        ...geospatial,
        resolveApiKey: () => googleApiKey,
        signal: context.signal,
      });
      const scene = await createStandaloneScene({
        ...context,
        googleApiKey,
        // Without a key, Google 3D can still load with tokens from the
        // app's server when it offers them.
        googleTokens: googleApiKey ? null : createGoogleTokenSource(),
        cesiumToken,
        loaderStatus,
      });
      globeScene = scene.viewer.scene;
      catalog = createStandaloneCatalog({
        nepalBoundaryResolver: (signal) =>
          scene.operations.annotationResolver.resolveRegionRingForQuery(
            'Nepal',
            signal,
            placeSearch,
            // The locator draws the border whenever it arrives.
            { budgetMs: Infinity },
          ),
        signal: context.signal,
        surface: scene.operations.surface,
      });
      return scene;
    },
    createControls: (context) =>
      createStandaloneControls({
        ...context,
        loaderStatus,
        placeSearch,
        catalog,
      }),
    createData: (context) =>
      createStandaloneData({ ...context, allowQaRegistration, catalog }),
    createTools: (context) =>
      createStandaloneTools({ ...context, loadingScreen, placeSearch, voice }),
  });
}
