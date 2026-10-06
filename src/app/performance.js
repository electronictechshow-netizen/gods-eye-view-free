/**
 * Rendering quality calibrated to the machine — so the globe stays smooth on a
 * weak laptop, a software renderer or a small GPU, and keeps full quality
 * wherever the hardware can carry it.
 *
 * The idle render governor already stops drawing when nothing moves; what is
 * left on a weak machine is the cost of each frame while something does move:
 * 4× multisampling, a full-resolution canvas, the photorealistic tiles at
 * their finest screen-space error, a 1.5 GB tile cache and a 60 fps target.
 * Each quality level trades exactly those, nothing else — no layer, data
 * source or feature is switched off.
 *
 * The starting level comes from what the browser reports (a software
 * renderer, the core count, the device memory), and it steps down one level
 * at a time while the frame rate actually measured during continuous
 * rendering stays below the floor. It never steps back up by itself, so it
 * cannot oscillate. `?quality=standard|low|minimal|auto` (remembered in
 * localStorage) overrides the automatic choice.
 */

const MB = 1024 * 1024;

/**
 * What each level sets. `standard` is exactly the original's configuration;
 * the others scale each tileset's and the globe's own detail setting
 * (`detailFactor` × its screen-space error) and cap the tile cache.
 */
export const QUALITY_LEVELS = Object.freeze({
  standard: Object.freeze({
    msaaSamples: 4,
    resolutionScale: 1,
    detailFactor: 1,
    tileCacheBytes: null,
    targetFrameRate: 60,
  }),
  low: Object.freeze({
    msaaSamples: 1,
    resolutionScale: 0.8,
    detailFactor: 1.5,
    tileCacheBytes: 512 * MB,
    targetFrameRate: 30,
  }),
  minimal: Object.freeze({
    msaaSamples: 1,
    resolutionScale: 0.6,
    detailFactor: 2,
    tileCacheBytes: 320 * MB,
    targetFrameRate: 30,
  }),
});

const ORDER = ['standard', 'low', 'minimal'];

/** Frames per second below which continuous rendering counts as struggling. */
const FPS_FLOOR = 24;

/** Startup tile streaming makes the first frames slow on any machine. */
const WARMUP_MS = 15_000;

/** Frames measured before a verdict, and the pause after a change. */
const SAMPLE_FRAMES = 90;
const COOLDOWN_MS = 10_000;

/** A gap this long is a hidden tab or an idle scene, not a slow frame. */
const MAX_FRAME_GAP_MS = 250;

const STORAGE_KEY = 'gev.quality';

/** A renderer string that means no GPU is drawing at all. */
const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;

/** Integrated or mobile GPUs that struggle with photorealistic tiles. */
const WEAK_GPU =
  /intel\(r\) hd graphics(?! [6-9]\d\d)|intel\(r\) (gma|graphics media)|mali-[4t]|adreno \(tm\) [3-5]\d\d|powervr/i;

/**
 * The level to start at, from what the browser reports.
 * @param {{hardwareConcurrency?: number, deviceMemory?: number,
 *   renderer?: string, saveData?: boolean}} hints
 * @returns {'standard'|'low'|'minimal'}
 */
export function detectQualityLevel({
  hardwareConcurrency,
  deviceMemory,
  renderer = '',
  saveData = false,
} = {}) {
  if (SOFTWARE_RENDERER.test(renderer)) return 'minimal';
  const cores = Number(hardwareConcurrency) || 4;
  // deviceMemory is capped at 8 and missing outside Chromium: absent is not small.
  const memory = Number(deviceMemory) || 8;
  if (memory <= 2 || cores <= 2) return 'minimal';
  if (memory <= 4 || cores <= 4 || WEAK_GPU.test(renderer) || saveData)
    return 'low';
  return 'standard';
}

/** The WebGL renderer string, when the browser shares it. */
function rendererName(scene) {
  try {
    const gl = scene?.context?._gl;
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return String(
      gl?.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '',
    );
  } catch {
    return '';
  }
}

/** `?quality=` first, then the remembered choice; `auto` (or nothing) means detect. */
export function requestedQuality({ search = '', storage = null } = {}) {
  let asked = null;
  try {
    asked = new URLSearchParams(search).get('quality');
  } catch {
    asked = null;
  }
  try {
    if (asked) {
      if (asked === 'auto') storage?.removeItem(STORAGE_KEY);
      else if (QUALITY_LEVELS[asked]) storage?.setItem(STORAGE_KEY, asked);
    } else asked = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // Storage may be unavailable (private window, blocked site data).
  }
  return QUALITY_LEVELS[asked] ? asked : null;
}

/** Every 3D tileset in the scene, including ones nested in collections. */
function tilesets(scene) {
  const found = [];
  const visit = (collection) => {
    const length = collection?.length ?? 0;
    for (let i = 0; i < length; i += 1) {
      const primitive = collection.get(i);
      if (!primitive) continue;
      if (
        typeof primitive.isDestroyed === 'function' &&
        primitive.isDestroyed()
      )
        continue;
      if ('maximumScreenSpaceError' in primitive && 'cacheBytes' in primitive)
        found.push(primitive);
      // Only primitive collections nest tilesets. Billboard, label and point
      // collections also have get(), but hold markers, not primitives.
      else if (typeof primitive.raiseToTop === 'function') visit(primitive);
    }
  };
  visit(scene?.primitives);
  return found;
}

/**
 * Install the governor on a viewer. Returns `{level(), refresh(), dispose()}`:
 * `refresh()` re-applies the level to tilesets added since (a map-stack
 * switch), and `level()` reports the level in force.
 */
export function installPerformanceGovernor(
  viewer,
  {
    hints = {},
    forced = null,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    eventTarget = globalThis.window ?? null,
  } = {},
) {
  const scene = viewer?.scene;
  if (!scene) throw new TypeError('A Cesium viewer is required');
  const startedAt = now();
  let current = QUALITY_LEVELS[forced]
    ? forced
    : detectQualityLevel({ renderer: rendererName(scene), ...hints });
  let lastFrameAt = null;
  let changedAt = startedAt;
  const intervals = [];
  // Each tileset's and the globe's own settings, as the app configured them.
  const original = new WeakMap();
  const globeError = scene.globe?.maximumScreenSpaceError;

  function applyToTilesets(settings) {
    for (const tileset of tilesets(scene)) {
      if (!original.has(tileset))
        original.set(tileset, {
          error: tileset.maximumScreenSpaceError,
          cacheBytes: tileset.cacheBytes,
        });
      const own = original.get(tileset);
      tileset.maximumScreenSpaceError = own.error * settings.detailFactor;
      tileset.cacheBytes =
        settings.tileCacheBytes === null
          ? own.cacheBytes
          : Math.min(own.cacheBytes, settings.tileCacheBytes);
    }
  }

  function apply(name) {
    const settings = QUALITY_LEVELS[name];
    current = name;
    try {
      if (scene.msaaSamples !== settings.msaaSamples)
        scene.msaaSamples = settings.msaaSamples;
    } catch {
      // WebGL 1 has no multisampling to change.
    }
    viewer.resolutionScale = settings.resolutionScale;
    viewer.targetFrameRate = settings.targetFrameRate;
    if (scene.globe && Number.isFinite(globeError))
      scene.globe.maximumScreenSpaceError = globeError * settings.detailFactor;
    applyToTilesets(settings);
    // Layers that scale their own work by level read it here (traffic cars).
    const root = globalThis.document?.documentElement;
    if (root?.dataset) root.dataset.gevQuality = name;
    scene.requestRender?.();
  }

  function onFrame() {
    if (forced) return;
    const at = now();
    const gap = lastFrameAt === null ? null : at - lastFrameAt;
    lastFrameAt = at;
    if (gap === null || gap > MAX_FRAME_GAP_MS) return;
    if (at - startedAt < WARMUP_MS || at - changedAt < COOLDOWN_MS) return;
    intervals.push(gap);
    if (intervals.length < SAMPLE_FRAMES) return;
    const sorted = [...intervals].sort((a, b) => a - b);
    intervals.length = 0;
    const median = sorted[Math.floor(sorted.length / 2)];
    const next = ORDER[ORDER.indexOf(current) + 1];
    if (median > 1000 / FPS_FLOOR && next) {
      changedAt = at;
      // This runs inside Cesium's render loop: a throw here would stop rendering.
      try {
        apply(next);
      } catch (error) {
        console.warn(`[Quality] Could not switch to ${next}:`, error);
      }
    }
  }

  const refresh = () => applyToTilesets(QUALITY_LEVELS[current]);
  apply(current);
  scene.postRender?.addEventListener(onFrame);
  eventTarget?.addEventListener?.('gev:map-stack-changed', refresh);
  return {
    level: () => current,
    refresh,
    dispose() {
      scene.postRender?.removeEventListener(onFrame);
      eventTarget?.removeEventListener?.('gev:map-stack-changed', refresh);
    },
  };
}
