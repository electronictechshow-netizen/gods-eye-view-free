import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiSessionHandler, geminiSetup } from './realtime.js';
import { GEMINI_LIVE_MODEL_DEFAULT } from './constants.js';
import { GEMINI_SOCKET_PATH } from './socket-proxy.js';

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload ?? '';
    },
  };
}

const req = {
  method: 'POST',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
};

function withKey(value, run) {
  const previous = process.env.GEMINI_API_KEY;
  if (value === null) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
}

test('a missing key says where to get the free one', () => {
  withKey(null, () => {
    const res = fakeRes();
    createGeminiSessionHandler()(req, res);
    assert.equal(res.statusCode, 503);
    const { error } = JSON.parse(res.body);
    assert.match(error, /GEMINI_API_KEY/);
    assert.match(error, /POWER UP/);
  });
});

test('a non-GET/POST method is rejected', () => {
  withKey('k', () => {
    const res = fakeRes();
    createGeminiSessionHandler()({ ...req, method: 'DELETE' }, res);
    assert.equal(res.statusCode, 405);
  });
});

test('the session response carries the relay path and never the API key', () => {
  withKey('SECRET_KEY', () => {
    const res = fakeRes();
    createGeminiSessionHandler()(req, res);

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.provider, 'gemini');
    assert.equal(body.model, GEMINI_LIVE_MODEL_DEFAULT);
    assert.equal(body.socketPath, GEMINI_SOCKET_PATH);
    assert.ok(body.setup, 'the setup frame is composed server-side');

    // The whole point of the relay: no credential crosses to the browser.
    assert.ok(
      !res.body.includes('SECRET_KEY'),
      'the API key is not echoed to the client',
    );
    assert.ok(!('token' in body), 'no ephemeral token is issued');
    assert.ok(!('apiKey' in body));
    // A same-origin relative path, never a direct googleapis URL.
    assert.ok(body.socketPath.startsWith('/'), 'relay path is same-origin');
    assert.ok(!JSON.stringify(body).includes('generativelanguage.googleapis'));
  });
});

test('a model override is honoured and echoed', () => {
  const previous = process.env.GEMINI_LIVE_MODEL;
  process.env.GEMINI_LIVE_MODEL = 'gemini-experimental-live';
  try {
    withKey('k', () => {
      const res = fakeRes();
      createGeminiSessionHandler()(req, res);
      const body = JSON.parse(res.body);
      assert.equal(body.model, 'gemini-experimental-live');
      assert.equal(body.setup.model, 'models/gemini-experimental-live');
      assert.equal(
        res.headers['X-GEV-Voice-Model'],
        'gemini-experimental-live',
      );
    });
  } finally {
    if (previous === undefined) delete process.env.GEMINI_LIVE_MODEL;
    else process.env.GEMINI_LIVE_MODEL = previous;
  }
});

test('the setup frame carries audio modality, tools and both transcriptions', () => {
  const setup = geminiSetup({
    model: 'gemini-3.8-live',
    voice: 'Puck',
    annotationGuidance: null,
  });
  assert.equal(setup.model, 'models/gemini-3.8-live');
  assert.deepEqual(setup.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(
    setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
      .voiceName,
    'Puck',
  );
  assert.ok(
    setup.systemInstruction.parts[0].text.length > 100,
    'instructions present',
  );
  assert.match(
    setup.systemInstruction.parts[1].text,
    /control_radio with action "play"/,
    'the radio rule is repeated where Gemini loses it',
  );
  assert.ok(setup.inputAudioTranscription, 'user speech is transcribed');
  assert.ok(setup.outputAudioTranscription, 'assistant speech is transcribed');

  const declarations = setup.tools[0].functionDeclarations;
  assert.ok(declarations.length >= 20, 'the action suite is declared');
  assert.ok(
    declarations.some((entry) => entry.name === 'fly_to_location'),
    'a known GEV action is present',
  );
  assert.ok(
    !JSON.stringify(setup.tools).includes('additionalProperties'),
    'schemas are Gemini-safe',
  );
});

/* ---------------- turn-detection mode ---------------- */

test('open-mic leaves Gemini automatic activity detection alone', () => {
  const setup = geminiSetup({ model: 'm', voice: 'Puck', pushToTalk: false });
  assert.ok(
    !('realtimeInputConfig' in setup),
    'automatic turn detection is what provides open-mic turn-taking',
  );
});

test('push-to-talk disables automatic detection so the client owns the turn', () => {
  // Live-verified: with automatic detection left on, push-to-talk audio was
  // accepted by Gemini and never transcribed — the turn never closed.
  const setup = geminiSetup({ model: 'm', voice: 'Puck', pushToTalk: true });
  assert.equal(
    setup.realtimeInputConfig.automaticActivityDetection.disabled,
    true,
  );
});

test('the session reports which mode it opened so the client can match it', () => {
  withKey('k', () => {
    const open = fakeRes();
    createGeminiSessionHandler()({ ...req, url: '/' }, open);
    assert.equal(JSON.parse(open.body).pushToTalk, false);

    const ptt = fakeRes();
    createGeminiSessionHandler()({ ...req, url: '/?mode=push-to-talk' }, ptt);
    const body = JSON.parse(ptt.body);
    assert.equal(body.pushToTalk, true);
    assert.equal(
      body.setup.realtimeInputConfig.automaticActivityDetection.disabled,
      true,
    );
  });
});
