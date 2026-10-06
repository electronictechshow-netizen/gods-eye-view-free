import { WebSocketServer, WebSocket } from 'ws';
import { GEMINI_LIVE_WS_URL } from './constants.js';
import { isCrossSiteRequest } from '../common/cross-site.js';

/** Path the browser opens. Anything else is left for Vite's own HMR socket. */
const GEMINI_SOCKET_PATH = '/api/realtime/gemini-ws';

/** Hostnames a voice socket may arrive under. Mirrors the key-setup guard. */
const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
]);

function isLocalRequest(req) {
  const host = String(req.headers?.host || '');
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTNAMES.has(hostname);
}

/**
 * Relay one browser socket to Gemini Live.
 *
 * Ephemeral tokens mint cleanly but are refused at the Live socket on
 * AI-Studio free-tier keys ("API key not valid"), so the key is used here,
 * server-side, and never reaches the browser — a stronger position than an
 * ephemeral token in a URL the page can read.
 */
function relay(
  client,
  { apiKey, upstreamUrl = GEMINI_LIVE_WS_URL, createSocket },
) {
  const connect =
    createSocket || ((url) => new WebSocket(url, { handshakeTimeout: 20_000 }));
  const upstream = connect(`${upstreamUrl}?key=${encodeURIComponent(apiKey)}`);

  // Frames the browser sends before the upstream handshake finishes — the
  // setup frame is sent immediately on open, so dropping it would hang the
  // session waiting for a setupComplete that never comes.
  const pending = [];
  let upstreamReady = false;

  const send = (socket, data) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      // Gemini speaks JSON text both ways; forwarding Buffers as binary makes
      // the far side reject them.
      socket.send(typeof data === 'string' ? data : data.toString('utf8'), {
        binary: false,
      });
    } catch {
      /* the close handlers below own teardown */
    }
  };

  upstream.on('open', () => {
    upstreamReady = true;
    for (const frame of pending.splice(0)) send(upstream, frame);
  });

  client.on('message', (data) => {
    if (upstreamReady) send(upstream, data);
    else if (pending.length < 64) pending.push(data);
  });

  upstream.on('message', (data) => send(client, data));

  // Propagate closure both ways so neither side is left half-open. Codes
  // outside 1000-4999 are not forwardable, so they collapse to 1011.
  const forwardableCode = (code) =>
    Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : 1011;

  upstream.on('close', (code, reason) => {
    try {
      client.close(forwardableCode(code), reason?.toString().slice(0, 120));
    } catch {
      /* already gone */
    }
  });
  upstream.on('error', () => {
    try {
      client.close(1011, 'Gemini Live upstream error');
    } catch {
      /* already gone */
    }
  });
  client.on('close', () => {
    try {
      upstream.close();
    } catch {
      /* already gone */
    }
  });
  client.on('error', () => {
    try {
      upstream.close();
    } catch {
      /* already gone */
    }
  });
}

/**
 * Attach the Gemini Live relay to a dev/preview HTTP server.
 *
 * Only upgrades on GEMINI_SOCKET_PATH are claimed; every other upgrade is
 * ignored untouched so Vite's HMR socket keeps working.
 *
 * @param {import('node:http').Server} httpServer - Server to attach to.
 * @param {object} [options]
 * @returns {() => void} Detach function, for tests.
 */
function attachGeminiSocketProxy(httpServer, options = {}) {
  if (!httpServer) return () => {};
  const {
    path = GEMINI_SOCKET_PATH,
    resolveApiKey = () => process.env.GEMINI_API_KEY,
    ...relayOptions
  } = options;
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || '', 'http://localhost').pathname;
    } catch {
      return;
    }
    // Not ours — leave the socket entirely alone (Vite HMR lives here too).
    if (pathname !== path) return;

    if (!isLocalRequest(req)) {
      socket.destroy();
      return;
    }
    // A WebSocket handshake is not bound by the same-origin policy, so any web
    // page the user visits could otherwise open this relay and spend their key.
    if (isCrossSiteRequest(req.headers)) {
      socket.end(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      socket.destroy();
      return;
    }
    const apiKey = String(resolveApiKey() ?? '').trim();
    if (!apiKey) {
      // Accept then close with a reason, so the browser surfaces something
      // better than an opaque handshake failure.
      wss.handleUpgrade(req, socket, head, (client) =>
        client.close(1011, 'GEMINI_API_KEY is not set'),
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) =>
      relay(client, { apiKey, ...relayOptions }),
    );
  };

  httpServer.on('upgrade', onUpgrade);
  return () => {
    httpServer.off('upgrade', onUpgrade);
    wss.close();
  };
}

export { GEMINI_SOCKET_PATH, attachGeminiSocketProxy, relay };
