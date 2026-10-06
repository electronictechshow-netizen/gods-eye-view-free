import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { overpassProxy } from 'gods-eye-view/server/providers/overpass';
import { militaryInstallationsProxy } from 'gods-eye-view/server/providers/military-installations';
import {
  regionalBriefProxy,
  weatherEffectsProxy,
} from 'gods-eye-view/server/providers/regional';
import { voiceSupportProxy } from 'gods-eye-view/server/providers/voice';
import { geminiRealtimeProxy } from 'gods-eye-view/server/providers/gemini';
import { keySetupEndpoint } from 'gods-eye-view/server/standalone/key-setup';
import { realtimeInstructions } from '../../server/providers/voice/instructions.js';
import { GEV_REALTIME_TOOLS } from '../../server/providers/voice/tools.js';
import { standaloneVoiceTools } from '../../server/standalone/voiceTools.js';
import { toGeminiTools } from '../../src/voice/geminiTools.js';

function install(plugin, preview = false) {
  const routes = new Map();
  plugin[preview ? 'configurePreviewServer' : 'configureServer']({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
    restart: async () => {},
  });
  return routes;
}
function request(
  handler,
  {
    method = 'GET',
    url = '/',
    body = '',
    origin = 'http://localhost:4173',
  } = {},
) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, {
      method,
      url,
      headers: {
        host: 'localhost:4173',
        origin,
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      writeHead(status, values) {
        this.statusCode = status;
        for (const [k, v] of Object.entries(values)) this.setHeader(k, v);
      },
      end(body = '') {
        resolve({
          status: this.statusCode,
          headers,
          body: String(body),
          json: () => JSON.parse(String(body)),
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
function env(t, name, value) {
  const old = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  });
}
function root(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-services-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('standalone service guards run in development and preview without upstream acquisition', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw Error('invalid requests must not fetch');
  });
  for (const preview of [false, true]) {
    for (const [factory, route] of [
      [overpassProxy, '/api/overpass'],
      [militaryInstallationsProxy, '/api/military-installations'],
      [regionalBriefProxy, '/api/regional-brief'],
      [weatherEffectsProxy, '/api/weather-effects'],
    ]) {
      const routes = install(factory(), preview);
      assert.equal(
        (await request(routes.get(route), { method: 'DELETE' })).status,
        405,
      );
      assert.equal(
        (
          await request(routes.get(route), {
            method: route === '/api/overpass' ? 'POST' : 'GET',
          })
        ).status,
        400,
      );
    }
  }
});

test('weather-only requests share upstream work and retain fresh and stale responses', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    assert.equal(new URL(url).hostname, 'api.open-meteo.com');
    if (calls > 1) throw Error('offline');
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({
      current: {
        time: '2026-09-12T12:00',
        temperature_2m: 20,
        weather_code: 0,
        wind_speed_10m: 10,
      },
    });
  });
  const handler = install(weatherEffectsProxy()).get('/api/weather-effects');
  const query = { url: '/?latitude=34.61&longitude=-112.43' };
  const pair = await Promise.all([
    request(handler, query),
    request(handler, query),
  ]);
  assert.deepEqual(pair.map((r) => r.headers['x-weather-effects']).sort(), [
    'INFLIGHT',
    'MISS',
  ]);
  assert.equal(calls, 1);
  assert.equal(
    (await request(handler, query)).headers['x-weather-effects'],
    'HIT',
  );
  now += 6 * 60_000;
  assert.equal(
    (await request(handler, query)).headers['x-weather-effects'],
    'STALE',
  );
});

test('Gemini session handler preserves tools and default instructions, isolates supplied annotation guidance, and keeps the key server-side', async (t) => {
  env(t, 'GEMINI_API_KEY', 'fixture-upstream-secret');
  env(t, 'GEV_RATELIMIT_VOICE_PER_MIN', undefined);
  const instructions = [];
  for (const [options, guidance] of [
    [{}, undefined],
    [
      { annotationGuidance: 'Fixture annotation instruction.' },
      'Fixture annotation instruction.',
    ],
    [{}, undefined],
  ]) {
    const response = await request(
      install(geminiRealtimeProxy(options)).get('/api/realtime/gemini-session'),
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.includes('fixture-upstream-secret'), false);
    const { setup } = response.json();
    instructions.push(setup.systemInstruction.parts[0].text);
    assert.equal(instructions.at(-1), realtimeInstructions(guidance));
    assert.equal(
      setup.tools[0].functionDeclarations.length,
      GEV_REALTIME_TOOLS.length,
    );
  }
  assert.notEqual(instructions[0], instructions[1]);
  assert.equal(instructions[0], instructions[2]);
});

test('the Gemini session carries the supplied tools, and the standalone voice adds the catalog queries', async (t) => {
  env(t, 'GEMINI_API_KEY', 'fixture-only-not-a-real-key');
  env(t, 'GEV_RATELIMIT_VOICE_PER_MIN', undefined);
  const tools = standaloneVoiceTools();
  const response = await request(
    install(geminiRealtimeProxy({ realtime: { tools } })).get(
      '/api/realtime/gemini-session',
    ),
  );
  assert.equal(response.status, 200);
  const declared = response
    .json()
    .setup.tools[0].functionDeclarations.map((declaration) => declaration.name);
  assert.deepEqual(
    declared,
    toGeminiTools(tools)[0].functionDeclarations.map((d) => d.name),
  );
  const names = tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    tools.slice(0, GEV_REALTIME_TOOLS.length),
    GEV_REALTIME_TOOLS,
  );
  assert.ok(names.includes('get_weather'));
  assert.ok(names.includes('military_awareness'));
  assert.ok(!names.includes('show_in_gods_eye_view'));
  assert.ok(!names.includes('aircraft_in_area'));
  assert.ok(!names.includes('get_weather_map'));
  // The action of the same name answers satellite passes.
  assert.equal(
    tools.findLast((tool) => tool.name === 'next_satellite_pass'),
    GEV_REALTIME_TOOLS.find((tool) => tool.name === 'next_satellite_pass'),
  );
  // Without supplied tools the session keeps the app's actions alone.
  const plain = await request(
    install(geminiRealtimeProxy()).get('/api/realtime/gemini-session'),
  );
  assert.equal(
    plain.json().setup.tools[0].functionDeclarations.length,
    GEV_REALTIME_TOOLS.length,
  );
});
test('debug logging resolves each supplied application directory independently', async (t) => {
  const first = root(t),
    second = root(t);
  for (const [sourceRoot, marker] of [
    [first, 'first'],
    [second, 'second'],
  ]) {
    const handler = install(voiceSupportProxy({ sourceRoot })).get(
      '/api/realtime/debug-log',
    );
    assert.equal(
      (
        await request(handler, {
          method: 'POST',
          body: JSON.stringify({ marker }),
        })
      ).status,
      204,
    );
    const file = path.join(
      sourceRoot,
      '.gev-logs/realtime-conversations.jsonl',
    );
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).marker, marker);
  }
});

test('key setup writes only the supplied application root, retains request guards and stays absent from preview', async (t) => {
  const first = root(t),
    untouched = root(t);
  env(t, 'GEMINI_API_KEY', undefined);
  const plugin = keySetupEndpoint({ sourceRoot: first });
  assert.equal(plugin.apply({}, { command: 'serve', isPreview: true }), false);
  assert.equal(plugin.configurePreviewServer, undefined);
  const routes = install(plugin);
  const handler = routes.get('/api/setup/keys');
  const body = JSON.stringify({
    GEMINI_API_KEY: 'fixture-only-not-a-real-key',
  });
  assert.equal(
    (
      await request(handler, {
        method: 'POST',
        body,
        origin: 'https://example.com',
      })
    ).status,
    403,
  );
  assert.equal(existsSync(path.join(first, '.env')), false);
  const saved = await request(handler, { method: 'POST', body });
  assert.equal(saved.status, 200);
  assert.match(
    readFileSync(path.join(first, '.env'), 'utf8'),
    /GEMINI_API_KEY=fixture-only-not-a-real-key/,
  );
  if (process.platform !== 'win32')
    assert.equal(statSync(path.join(first, '.env')).mode & 0o777, 0o600);
  assert.equal(saved.body.includes('fixture-only-not-a-real-key'), false);
  assert.equal(existsSync(path.join(untouched, '.env')), false);
});

test('the HUD summary answers generically when the provider or the request fails', async (t) => {
  env(t, 'GROQ_API_KEY', 'fixture-upstream-secret');
  env(t, 'GEV_RATELIMIT_VOICE_PER_MIN', undefined);
  const leak =
    'fixture-upstream-secret req_fixture_1234 org-fixture quota exhausted';

  // The provider's own error wording — request ids, account hints, quota
  // phrasing — must never be relayed to the page.
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { message: leak } }, { status: 429 }),
  );
  const summary = await request(
    install(voiceSupportProxy()).get('/api/hud-summary'),
    { method: 'POST', body: JSON.stringify({ context: {} }) },
  );
  assert.equal(summary.json().error, 'groq HUD summary request failed');
  assert.equal(summary.body.includes('req_fixture_1234'), false);
  assert.equal(summary.body.includes('fixture-upstream-secret'), false);

  // A network fault surfaced a resolver message naming the upstream host.
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => {
    throw Error(`getaddrinfo ENOTFOUND api.groq.com ${leak}`);
  });
  const failed = await request(
    install(voiceSupportProxy()).get('/api/hud-summary'),
    { method: 'POST', body: '{}' },
  );
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json(), { error: 'groq HUD summary request failed' });
  assert.equal(failed.body.includes('api.groq.com'), false);
  assert.equal(failed.body.includes('fixture-upstream-secret'), false);
});
