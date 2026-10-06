// RENDERING QUALITY GOVERNOR — the globe stays smooth on a weak machine and
// keeps the original's full quality wherever the hardware carries it.
//
// What matters here: the standard level changes nothing, the lighter levels
// trade only per-frame cost (multisampling, canvas resolution, tile detail,
// tile cache, frame-rate target), the level steps down only on frame rates
// actually measured and never back up, and `?quality=` wins over detection.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_LEVELS,
  detectQualityLevel,
  installPerformanceGovernor,
  requestedQuality,
} from './performance.js';

const MB = 1024 * 1024;

test('the starting level follows what the browser reports', () => {
  const cases = [
    [{ renderer: 'Google SwiftShader' }, 'minimal'],
    [{ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }, 'minimal'],
    [{ renderer: 'Microsoft Basic Render Driver' }, 'minimal'],
    [{ hardwareConcurrency: 2, deviceMemory: 8 }, 'minimal'],
    [{ hardwareConcurrency: 8, deviceMemory: 2 }, 'minimal'],
    [{ hardwareConcurrency: 4, deviceMemory: 8 }, 'low'],
    [{ hardwareConcurrency: 8, deviceMemory: 4 }, 'low'],
    [{ hardwareConcurrency: 8, renderer: 'Intel(R) HD Graphics 4000' }, 'low'],
    [{ hardwareConcurrency: 8, saveData: true }, 'low'],
    [
      {
        hardwareConcurrency: 8,
        deviceMemory: 8,
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)',
      },
      'standard',
    ],
    [
      {
        hardwareConcurrency: 16,
        deviceMemory: 8,
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)',
      },
      'standard',
    ],
    [{ hardwareConcurrency: 12 }, 'standard'],
  ];
  for (const [hints, level] of cases)
    assert.equal(detectQualityLevel(hints), level, JSON.stringify(hints));
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('?quality= overrides detection, is remembered, and auto forgets it', () => {
  const storage = memoryStorage();
  assert.equal(requestedQuality({ search: '?quality=low', storage }), 'low');
  assert.equal(requestedQuality({ search: '', storage }), 'low');
  assert.equal(requestedQuality({ search: '?quality=auto', storage }), null);
  assert.equal(storage.data.size, 0);
  assert.equal(requestedQuality({ search: '?quality=ultra', storage }), null);
  const refusing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {},
  };
  assert.equal(
    requestedQuality({ search: '?quality=minimal', storage: refusing }),
    'minimal',
  );
  assert.equal(requestedQuality({ search: '', storage: refusing }), null);
  assert.equal(requestedQuality({}), null);
});

function fakeViewer(tilesets = []) {
  const listeners = new Set();
  const scene = {
    msaaSamples: 4,
    globe: { maximumScreenSpaceError: 2 },
    primitives: {
      get length() {
        return tilesets.length;
      },
      get: (index) => tilesets[index],
    },
    postRender: {
      addEventListener: (listener) => listeners.add(listener),
      removeEventListener: (listener) => listeners.delete(listener),
    },
    renders: 0,
    requestRender() {
      this.renders += 1;
    },
  };
  return {
    viewer: { scene, resolutionScale: 1, targetFrameRate: 60 },
    listeners,
    frame: () => {
      for (const listener of listeners) listener();
    },
  };
}
const tileset = (error = 16, cacheBytes = 1536 * MB) => ({
  maximumScreenSpaceError: error,
  cacheBytes,
});

test("the standard level is exactly the original's configuration", () => {
  const google = tileset(16, 1536 * MB);
  const custom = tileset(8, 256 * MB);
  const { viewer } = fakeViewer([google, custom]);
  const governor = installPerformanceGovernor(viewer, {
    forced: 'standard',
    eventTarget: null,
  });
  assert.equal(governor.level(), 'standard');
  assert.equal(viewer.scene.msaaSamples, 4);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.targetFrameRate, 60);
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2);
  assert.deepEqual(google, tileset(16, 1536 * MB));
  assert.deepEqual(
    custom,
    tileset(8, 256 * MB),
    "a tileset's own detail stays",
  );
});

test('a lighter level trades only per-frame cost, and re-applying never compounds', () => {
  const google = tileset();
  const tilesets = [google];
  const { viewer } = fakeViewer(tilesets);
  const governor = installPerformanceGovernor(viewer, {
    forced: 'low',
    eventTarget: null,
  });
  const low = QUALITY_LEVELS.low;
  assert.equal(viewer.scene.msaaSamples, low.msaaSamples);
  assert.equal(viewer.resolutionScale, low.resolutionScale);
  assert.equal(viewer.targetFrameRate, low.targetFrameRate);
  assert.equal(google.maximumScreenSpaceError, 24);
  assert.equal(google.cacheBytes, 512 * MB);
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 3);
  governor.refresh();
  governor.refresh();
  assert.equal(google.maximumScreenSpaceError, 24, 'not 36, not 54');

  const late = tileset(16, 128 * MB);
  tilesets.push(late);
  governor.refresh();
  assert.equal(late.maximumScreenSpaceError, 24, 'a tileset added later');
  assert.equal(late.cacheBytes, 128 * MB, 'a smaller cache is not raised');
});

test('slow frames measured after warm-up step the level down, one at a time, never back up', () => {
  let clock = 0;
  const google = tileset();
  const { viewer, frame } = fakeViewer([google]);
  const governor = installPerformanceGovernor(viewer, {
    hints: { hardwareConcurrency: 16, deviceMemory: 8 },
    now: () => clock,
    eventTarget: null,
  });
  assert.equal(governor.level(), 'standard');
  const run = (frames, intervalMs) => {
    for (let i = 0; i < frames; i += 1) {
      clock += intervalMs;
      frame();
    }
  };
  run(200, 50); // 20 fps during the first ten seconds: startup streaming
  assert.equal(governor.level(), 'standard', 'warm-up is not judged');
  run(400, 16); // smooth, past the warm-up
  assert.equal(governor.level(), 'standard');
  run(120, 50);
  assert.equal(governor.level(), 'low');
  assert.equal(google.maximumScreenSpaceError, 24);
  run(40, 50);
  assert.equal(governor.level(), 'low', 'a cooldown follows a change');
  run(400, 50);
  assert.equal(governor.level(), 'minimal');
  assert.equal(google.maximumScreenSpaceError, 32);
  run(400, 80);
  assert.equal(governor.level(), 'minimal', 'there is nothing below minimal');
  run(400, 10);
  assert.equal(governor.level(), 'minimal', 'it never steps back up by itself');
});

test('a hidden tab or an idle scene is not a slow frame, and a forced level is never changed', () => {
  let clock = 0;
  const { viewer, frame, listeners } = fakeViewer([tileset()]);
  const governor = installPerformanceGovernor(viewer, {
    hints: { hardwareConcurrency: 16 },
    now: () => clock,
    eventTarget: null,
  });
  for (let i = 0; i < 400; i += 1) {
    clock += 1000;
    frame();
  }
  assert.equal(governor.level(), 'standard');
  governor.dispose();
  assert.equal(listeners.size, 0);

  clock = 0;
  const forced = fakeViewer([tileset()]);
  const pinned = installPerformanceGovernor(forced.viewer, {
    forced: 'standard',
    now: () => clock,
    eventTarget: null,
  });
  for (let i = 0; i < 1000; i += 1) {
    clock += 60;
    forced.frame();
  }
  assert.equal(pinned.level(), 'standard');
});

test('a map-stack switch re-applies the level to the new tilesets', () => {
  const target = new EventTarget();
  const tilesets = [];
  const { viewer } = fakeViewer(tilesets);
  const governor = installPerformanceGovernor(viewer, {
    forced: 'minimal',
    eventTarget: target,
  });
  const next = tileset();
  tilesets.push(next);
  target.dispatchEvent(new Event('gev:map-stack-changed'));
  assert.equal(next.maximumScreenSpaceError, 32);
  governor.dispose();
  const after = tileset();
  tilesets.push(after);
  target.dispatchEvent(new Event('gev:map-stack-changed'));
  assert.equal(
    after.maximumScreenSpaceError,
    16,
    'disposed: no longer listening',
  );
});

test('the level in force is named on the page for layers that scale their own work', (t) => {
  const original = globalThis.document;
  t.after(() => {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  globalThis.document = { documentElement: { dataset: {} } };
  const { viewer } = fakeViewer([tileset(16, 1536 * MB)]);
  const governor = installPerformanceGovernor(viewer, {
    forced: 'minimal',
    eventTarget: null,
  });
  assert.equal(
    globalThis.document.documentElement.dataset.gevQuality,
    'minimal',
  );
  governor.dispose();
});

test('nested tilesets are found, and marker collections are never walked into', () => {
  // A marker collection (billboards, labels, points) has get() and length but
  // holds markers; one of them may carry an isDestroyed field that is not a
  // function. Walking into it once stopped rendering in a busy London scene.
  const nested = tileset(16, 1536 * MB);
  const markers = {
    length: 1,
    get: () => ({ isDestroyed: false, maximumScreenSpaceError: 1 }),
  };
  const group = {
    length: 2,
    get: (index) => [markers, nested][index],
    raiseToTop() {},
    isDestroyed: () => false,
  };
  const { viewer } = fakeViewer([group, markers]);
  installPerformanceGovernor(viewer, { forced: 'minimal', eventTarget: null });
  assert.equal(
    nested.maximumScreenSpaceError,
    32,
    'the nested tileset is lightened',
  );
});
