import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { isCrossSiteRequest } from '../server/providers/common/cross-site.js';
import { crossSiteGuardPlugin } from '../server/providers/common/cross-site-guard.js';
import { attachGeminiSocketProxy } from '../server/providers/gemini/socket-proxy.js';

/* ---------------- the decision ---------------- */

test('requests from the app itself are allowed', () => {
  assert.equal(
    isCrossSiteRequest({
      'sec-fetch-site': 'same-origin',
      host: 'localhost:4173',
    }),
    false,
  );
  // A user opening the address directly.
  assert.equal(isCrossSiteRequest({ 'sec-fetch-site': 'none' }), false);
});

test('another website, or even another local port, is refused', () => {
  for (const site of ['cross-site', 'same-site'])
    assert.equal(isCrossSiteRequest({ 'sec-fetch-site': site }), true, site);
});

test('Sec-Fetch-Site wins over a spoofable Origin when the browser sends it', () => {
  assert.equal(
    isCrossSiteRequest({
      'sec-fetch-site': 'cross-site',
      origin: 'http://localhost:4173',
      host: 'localhost:4173',
    }),
    true,
  );
});

test('older browsers are judged by Origin against the Host they asked for', () => {
  const host = 'localhost:4173';
  assert.equal(
    isCrossSiteRequest({ origin: 'http://localhost:4173', host }),
    false,
  );
  assert.equal(
    isCrossSiteRequest({ origin: 'http://LOCALHOST:4173', host }),
    false,
  );
  assert.equal(
    isCrossSiteRequest({ origin: 'https://evil.example', host }),
    true,
  );
  assert.equal(
    isCrossSiteRequest({ origin: 'http://localhost:9999', host }),
    true,
    'another port',
  );
  assert.equal(
    isCrossSiteRequest({ origin: 'http://127.0.0.1:4173', host }),
    true,
    'another hostname',
  );
});

test('an opaque or malformed Origin is never the app', () => {
  assert.equal(
    isCrossSiteRequest({ origin: 'null', host: 'localhost:4173' }),
    true,
  );
  assert.equal(
    isCrossSiteRequest({ origin: 'not a url', host: 'localhost:4173' }),
    true,
  );
});

test('a request with neither header is not a web page, and is left alone', () => {
  // curl, this repository's own QA scripts, the test suite.
  assert.equal(isCrossSiteRequest({ host: 'localhost:4173' }), false);
  assert.equal(isCrossSiteRequest({}), false);
  assert.equal(isCrossSiteRequest(), false);
});

/* ---------------- the middleware ---------------- */

function installedGuard() {
  let mounted = null;
  const server = {
    middlewares: {
      use(path, handler) {
        mounted = { path, handler };
      },
    },
  };
  const plugin = crossSiteGuardPlugin();
  plugin.configureServer(server);
  return { plugin, mounted };
}

function run(handler, headers) {
  const out = { status: null, headers: null, body: '', nexted: false };
  handler(
    { headers },
    {
      writeHead(status, responseHeaders) {
        out.status = status;
        out.headers = responseHeaders;
      },
      end(body) {
        out.body = body ?? '';
      },
    },
    () => {
      out.nexted = true;
    },
  );
  return out;
}

test('the guard is mounted on /api for both dev and preview servers', () => {
  const { plugin, mounted } = installedGuard();
  assert.equal(mounted.path, '/api');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});

test('a cross-site API request is answered 403 and never reaches a provider', () => {
  const { mounted } = installedGuard();
  const result = run(mounted.handler, { 'sec-fetch-site': 'cross-site' });
  assert.equal(result.status, 403);
  assert.equal(result.nexted, false);
  assert.match(JSON.parse(result.body).error, /Cross-site/);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test("the app's own and non-browser API requests pass through", () => {
  const { mounted } = installedGuard();
  assert.equal(
    run(mounted.handler, { 'sec-fetch-site': 'same-origin' }).nexted,
    true,
  );
  assert.equal(run(mounted.handler, { host: 'localhost:4173' }).nexted, true);
});

/* ---------------- the Gemini relay (real WebSocket handshake) ---------------- */

async function withRelay(run) {
  const server = http.createServer();
  const detach = attachGeminiSocketProxy(server, { resolveApiKey: () => '' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(port);
  } finally {
    detach();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Resolve how a handshake ended: refused, or opened (and then closed with a reason). */
function handshake(port, headers) {
  return new Promise((resolve) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/realtime/gemini-ws`,
      {
        headers,
      },
    );
    let opened = false;
    socket.on('unexpected-response', (_request, response) =>
      resolve({ opened, refused: response.statusCode }),
    );
    socket.on('open', () => {
      opened = true;
    });
    socket.on('close', (code, reason) =>
      resolve({ opened, code, reason: reason.toString() }),
    );
    socket.on('error', (error) => resolve({ opened, error: error.message }));
    setTimeout(() => resolve({ opened, timeout: true }), 5000).unref();
  });
}

test('a web page on another site cannot open the Gemini relay', async () => {
  await withRelay(async (port) => {
    const outcome = await handshake(port, { Origin: 'https://evil.example' });
    assert.equal(outcome.opened, false, 'the handshake never completes');
    assert.equal(outcome.refused, 403);
  });
});

test('another local port is refused too', async () => {
  await withRelay(async (port) => {
    const outcome = await handshake(port, {
      Origin: 'http://127.0.0.1:9',
      'Sec-Fetch-Site': 'same-site',
    });
    assert.equal(outcome.opened, false);
    assert.equal(outcome.refused, 403);
  });
});

test("the app's own page still reaches the relay (and gets the missing-key reason)", async () => {
  await withRelay(async (port) => {
    const outcome = await handshake(port, {
      Origin: `http://127.0.0.1:${port}`,
      'Sec-Fetch-Site': 'same-origin',
    });
    assert.equal(outcome.opened, true, 'accepted');
    assert.equal(outcome.code, 1011);
    assert.match(outcome.reason, /GEMINI_API_KEY is not set/);
  });
});

test('a non-browser client with no Origin still reaches the relay', async () => {
  await withRelay(async (port) => {
    const outcome = await handshake(port, {});
    assert.equal(outcome.opened, true);
    assert.equal(outcome.code, 1011);
  });
});
