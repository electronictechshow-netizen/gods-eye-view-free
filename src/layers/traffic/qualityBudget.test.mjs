import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOTS, maxDots, qualityDotShare, roadDotBudget } from './policy.js';

test('traffic keeps the full car budget at the standard level and without a level', () => {
  assert.equal(qualityDotShare('standard'), 1);
  assert.equal(qualityDotShare(undefined), 1);
  assert.equal(qualityDotShare('unknown'), 1);
  assert.equal(maxDots(1), MAX_DOTS);
  // Node has no document: the original's budget, unchanged.
  assert.equal(maxDots(), MAX_DOTS);
  assert.equal(roadDotBudget(500), MAX_DOTS);
  assert.equal(roadDotBudget(1000), MAX_DOTS);
  assert.equal(roadDotBudget(4000), 400);
});

test('lighter quality levels draw proportionally fewer traffic cars', () => {
  assert.equal(qualityDotShare('low'), 0.6);
  assert.equal(qualityDotShare('minimal'), 0.25);
  assert.equal(maxDots(qualityDotShare('minimal')), 1500);
  assert.equal(roadDotBudget(1000, 0.25), 1500);
  assert.equal(roadDotBudget(8000, 0.25), 100);
  assert.ok(roadDotBudget(2000, 0.6) < roadDotBudget(2000, 1));
});

test('the level named on the page is the one traffic follows', (t) => {
  const original = globalThis.document;
  t.after(() => {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  globalThis.document = {
    documentElement: { dataset: { gevQuality: 'minimal' } },
  };
  assert.equal(qualityDotShare(), 0.25);
  assert.equal(maxDots(), 1500);
  assert.equal(roadDotBudget(1000), 1500);
});
