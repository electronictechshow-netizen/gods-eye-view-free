import { keySetupRequirement } from '../keySetupCore.mjs';
/**
 * Why Google 3D is unavailable, phrased so the tooltip and toast recommend the
 * RIGHT fix. With no credentials the fix is a key (or the ion route); with a
 * key or ion token configured, the tileset failed for another reason —
 * restrictions, quota, an EEA-billed key, or the network — and telling the
 * user to add a key they already added is the wrong advice.
 * @param {boolean} hasCredentials
 * @returns {string}
 */
export function photorealUnavailableReason(hasCredentials) {
  // The free route is a Cesium ion token, and the commonest reason it "does
  // nothing" is a new account that never added the tiles to My Assets: ion only
  // streams an Asset Depot asset after the account has added it.
  if (hasCredentials)
    return 'Google 3D tiles unavailable — with a Cesium ion token, add “Google Photorealistic 3D Tiles” to My Assets (ion.cesium.com/assetdepot); otherwise check the key’s API restrictions, quota, or network';
  return `${keySetupRequirement('cesium-ion')} (free) — or a Google Maps key for the direct route`;
}
