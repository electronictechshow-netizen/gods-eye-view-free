import test from 'node:test';
import assert from 'node:assert/strict';
import { toFiveWordHudSummary } from '../server/providers/voice/hud-summary.js';

test('free edition: a looping model answer collapses to distinct words', () => {
  assert.equal(
    toFiveWordHudSummary(
      'SATELLITES SATELLITES SATELLITES SATELLITES SATELLITE',
    ),
    'SATELLITES IN VIEW',
  );
  assert.equal(
    toFiveWordHudSummary('LIVE FLIGHTS LIVE FLIGHTS LIVE'),
    'LIVE FLIGHTS IN VIEW',
  );
  assert.equal(
    toFiveWordHudSummary('Trafalgar Square Charing Cross CCTV'),
    'Trafalgar Square Charing Cross CCTV',
  );
  assert.equal(toFiveWordHudSummary(''), '');
});
