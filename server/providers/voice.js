import { defaultSourceRoot } from './common/source-root.js';
import { handleHudSummary } from './voice/hud-summary.js';
import { createDebugLogHandler } from './voice/debug-log.js';

/**
 * Vite plugin: the small routes that sit beside the voice session.
 *
 * `/api/hud-summary` writes the five-word AI HUD readout (Groq, free tier) and
 * `/api/realtime/debug-log` stores the local voice debug log. The voice session
 * itself is served by the Gemini Live proxy (`./gemini.js`).
 */
function voiceSupportProxy({ sourceRoot = defaultSourceRoot } = {}) {
  function install(middlewares) {
    middlewares.use('/api/hud-summary', handleHudSummary);

    middlewares.use(
      '/api/realtime/debug-log',
      createDebugLogHandler({ sourceRoot }),
    );
  }

  return {
    name: 'voice-support-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { voiceSupportProxy };
