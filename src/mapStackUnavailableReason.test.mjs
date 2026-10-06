import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MapStackController,
  photorealUnavailableReason,
} from './mapStackController.js';

test('missing photoreal credentials lead with the free Cesium ion route and mention the direct one', () => {
  const reason = photorealUnavailableReason(false);
  assert.match(reason, /Needs CESIUM_ION_TOKEN.*Provider Settings/);
  assert.match(reason, /free/);
  assert.match(reason, /Google Maps key/);
});

test('a configured but failed photoreal route does not ask for another key', () => {
  const reason = photorealUnavailableReason(true);
  assert.match(reason, /unavailable.*restrictions, quota, or network/);
  assert.doesNotMatch(reason, /Needs|add it/);
});

test('a failed ion route names the step new accounts miss: adding the tiles to My Assets', () => {
  // ion only streams an Asset Depot asset once the account has added it, so a
  // valid token alone silently falls back to flat imagery.
  const reason = photorealUnavailableReason(true);
  assert.match(reason, /Google Photorealistic 3D Tiles/);
  assert.match(reason, /My Assets/);
  assert.match(reason, /ion\.cesium\.com\/assetdepot/);
});

test('controller credential detection accepts ion without a browser global', () => {
  const hasCredentials = MapStackController.prototype._hasPhotorealCredentials;
  assert.equal(hasCredentials.call({ cesiumToken: 'configured' }), true);
  assert.equal(hasCredentials.call({ cesiumToken: '   ' }), false);
});
