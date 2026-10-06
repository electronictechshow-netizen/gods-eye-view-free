import { createGeminiSessionHandler } from './gemini/realtime.js';
import { attachGeminiSocketProxy } from './gemini/socket-proxy.js';

/**
 * Vite plugin: Gemini Live voice.
 *
 * Serves the session config over HTTP and relays the Live API WebSocket, so
 * GEMINI_API_KEY stays server-side.
 */
function geminiRealtimeProxy({ annotationGuidance, realtime = {} } = {}) {
  function install(server) {
    server.middlewares.use(
      '/api/realtime/gemini-session',
      createGeminiSessionHandler({ annotationGuidance, tools: realtime.tools }),
    );
    // Claims only its own upgrade path; Vite's HMR socket is untouched.
    attachGeminiSocketProxy(server.httpServer);
  }

  return {
    name: 'gemini-realtime-proxy',
    configureServer(server) {
      install(server);
    },
    configurePreviewServer(server) {
      install(server);
    },
  };
}

export { geminiRealtimeProxy };
