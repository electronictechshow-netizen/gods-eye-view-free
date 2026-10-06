import assert from 'node:assert/strict';
import test from 'node:test';
import { GevRealtimeController } from './realtimeController.js';
import { GeminiRealtimeConnection } from './geminiConnection.js';
import { RealtimeInput } from './realtimeInput.js';
import { RealtimeViewport } from './realtimeViewport.js';

function installGlobals(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
}

const sessionResponse = {
  ok: true,
  async json() {
    return {
      provider: 'gemini',
      model: 'gemini-test-live',
      socketPath: '/api/realtime/gemini-ws',
      pushToTalk: false,
      setup: {},
    };
  },
};

// A browser just real enough for the Gemini transport to start a session:
// a session request, a microphone, a Web Audio graph and a WebSocket.
function browser(t, { sessionFetch = async () => sessionResponse } = {}) {
  const sockets = [];
  const streams = [];
  class Socket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      this.handlers = new Map();
      sockets.push(this);
    }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; }
  }
  class Context {
    constructor() {
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = {};
      this.audioWorklet = { async addModule() {} };
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    close() { return Promise.resolve(); }
  }
  class Worklet {
    constructor() { this.port = {}; }
    connect() {}
    disconnect() {}
  }
  installGlobals(t, {
    WebSocket: Socket,
    AudioContext: Context,
    AudioWorkletNode: Worklet,
    window: { AudioContext: Context, location: { protocol: 'http:', host: 'localhost:4173' } },
    fetch: sessionFetch,
    document: { querySelectorAll: () => [], body: { appendChild() {} }, createElement: () => ({ dataset: {}, style: {}, remove() {} }) },
    navigator: { mediaDevices: { async getUserMedia() {
      const track = { stops: 0, stop() { this.stops++; } };
      const stream = { getTracks: () => [track], getAudioTracks: () => [track], track };
      streams.push(stream); return stream;
    } } },
  });
  return { sockets, streams };
}

function geminiController(runner) {
  const controller = new GevRealtimeController({
    runner,
    connectionClass: GeminiRealtimeConnection,
    debugSink: null,
    ui: { root: { dataset: {}, classList: { remove() {} }, querySelectorAll: () => [] }, status: {}, detail: {} },
  });
  controller.startVoiceVisualizer = () => {};
  return controller;
}

const toolCall = (id) => ({
  data: JSON.stringify({ toolCall: { functionCalls: [{ id, name: 'get_entity_context', args: {} }] } }),
});

test('retained socket callbacks cannot act after stop or enter a replacement session', async (t) => {
  const { sockets, streams } = browser(t);
  const actions = [];
  const controller = geminiController(async (name) => { actions.push(name); return { ok: true }; });
  await controller.start();
  const old = sockets[0];
  assert.equal(controller.status, 'listening');
  controller.stop();
  old.handlers.get('message')(toolCall('stale'));
  await new Promise((resolve) => setImmediate(resolve));
  await controller.start();
  const current = sockets[1];
  const channel = controller.dc;
  old.handlers.get('message')(toolCall('stale-again'));
  old.handlers.get('error')();
  old.handlers.get('close')({ code: 1006 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.status, 'listening', 'a stale socket cannot end the new session');
  assert.equal(controller.dc, channel, 'the replacement still owns the channel');
  assert.equal(current.readyState, 1, 'and its socket is untouched');
  assert.deepEqual(actions, []);
  controller.stop();
  assert.deepEqual(streams.map((s) => s.track.stops), [1, 1]);
});

test('a session request resolved after restart cannot replace the new session', async (t) => {
  let release;
  let calls = 0;
  const { sockets } = browser(t, {
    sessionFetch: () => (++calls === 1
      ? new Promise((resolve) => { release = () => resolve(sessionResponse); })
      : Promise.resolve(sessionResponse)),
  });
  const controller = geminiController(async () => ({ ok: true }));
  const firstStart = controller.start();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  controller.stop();
  await controller.start();
  assert.equal(sockets.length, 1, 'the replacement opened the only socket');
  const channel = controller.dc;
  release();
  await firstStart;
  assert.equal(sockets.length, 1, 'the superseded start opened nothing');
  assert.equal(controller.dc, channel);
  assert.equal(controller.status, 'listening');
  controller.stop();
});
const localContext = { action: 'get_entity_context', scene: { basemap: { viewScale: 'local' } } };

test('a late viewport capture cannot publish into a replacement or reset conversation', async () => {
  for (const reset of [false, true]) {
    let channel = { readyState: 'open' };
    let finish;
    const sent = [];
    const owner = new RealtimeViewport({
      readChannel: () => channel,
      capture: () => new Promise(resolve => { finish = resolve; }),
      operations: { sendRealtimeEvent(message) { sent.push(message); return true; } },
    });
    const pending = owner.sendVisualContextIfUseful(localContext);
    if (reset) owner.reset();
    else channel = { readyState: 'open' };
    finish('data:image/jpeg;base64,abc');
    assert.equal(await pending, false);
    assert.deepEqual(sent, []);
    assert.equal(owner.lastViewportItemId, null);
  }
});

test('a current viewport capture retains one image and replaces it through the protocol', async () => {
  const channel = { readyState: 'open' };
  const sent = [];
  const owner = new RealtimeViewport({
    readChannel: () => channel, capture: async () => 'data:image/jpeg;base64,abc',
    operations: { sendRealtimeEvent(message) { sent.push(message); return true; } },
  });
  assert.equal(await owner.sendVisualContextIfUseful(localContext), true);
  const first = owner.lastViewportItemId;
  assert.equal(await owner.sendVisualContextIfUseful(localContext), true);
  assert.equal(sent[1].type, 'conversation.item.delete');
  assert.equal(sent[1].item_id, first);
  assert.equal(sent[2].item.id, owner.lastViewportItemId);
  owner.reset();
  assert.equal(owner.lastViewportItemId, null);
  assert.equal(owner.pendingViewportDeletes.size, 0);
});

test('audio meter initialization failure releases its newly acquired AudioContext', (t) => {
  let closes = 0;
  class AudioContext {
    resume() { return Promise.resolve(); }
    createAnalyser() { return {}; }
    createMediaStreamSource() { throw new Error('analysis unavailable'); }
    close() { closes++; return Promise.resolve(); }
  }
  installGlobals(t, { window: { AudioContext } });
  const owner = new RealtimeInput({
    readUi: () => ({ root: { querySelectorAll: () => [{ style: { setProperty() {}, removeProperty() {} } }] } }),
    readStatus: () => 'listening', readStream: () => null, operations: {},
  });
  owner.startVoiceVisualizer({});
  assert.equal(closes, 1);
  assert.equal(owner.visualizerAudioContext, null);
  owner.stopVoiceVisualizer();
  assert.equal(closes, 1);
});

test('stopping one audio meter revokes retained frames without stopping another meter', (t) => {
  const frames = [];
  const contexts = [];
  class AudioContext {
    constructor() { this.reads = 0; this.closes = 0; contexts.push(this); }
    resume() { return Promise.resolve(); }
    createAnalyser() { return {
      frequencyBinCount: 32,
      getByteFrequencyData: data => { this.reads++; data.fill(30); },
    }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    close() { this.closes++; return Promise.resolve(); }
  }
  installGlobals(t, {
    window: { AudioContext },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
  });
  const create = () => new RealtimeInput({
    readUi: () => ({ root: { querySelectorAll: () => [{ style: { setProperty() {}, removeProperty() {} } }] } }),
    readStatus: () => 'listening', readStream: () => null, operations: {},
  });
  const first = create();
  const second = create();
  first.startVoiceVisualizer({}); second.startVoiceVisualizer({});
  first.stopVoiceVisualizer();
  const reads = contexts[0].reads;
  frames[0]();
  assert.equal(contexts[0].reads, reads);
  assert.equal(frames.length, 2, 'a revoked frame cannot rearm itself');
  frames[1]();
  assert.equal(contexts[1].reads, 2);
  assert.equal(frames.length, 3, 'the other meter retains its own render lifetime');
  second.stopVoiceVisualizer();
  assert.deepEqual(contexts.map(c => c.closes), [1, 1]);
});

test('late action or viewport completion cannot resume a stopped or replacement conversation', async (t) => {
  const { sockets } = browser(t);
  for (const phase of ['tool', 'tool-error', 'viewport']) {
    for (const restart of [false, true]) {
      let finish;
      const controller = geminiController(phase === 'viewport'
        ? async () => ({ ok: true, ...localContext })
        : () => new Promise((resolve, reject) => {
            finish = phase === 'tool-error'
              ? () => reject(new Error('superseded action failed'))
              : () => resolve({ ok: true, action: 'get_entity_context' });
          }));
      if (phase === 'viewport') controller._viewport.capture = () => new Promise((resolve) => {
        finish = () => resolve('data:image/jpeg;base64,abc');
      });
      await controller.start();
      const pending = controller.handleRealtimeEvent({ data: JSON.stringify({
        type: 'response.function_call_arguments.done', name: 'get_entity_context',
        call_id: 'delayed', arguments: '{}',
      }) });
      while (!finish) await new Promise((resolve) => setImmediate(resolve));
      controller.stop();
      if (restart) await controller.start();
      const status = controller.status;
      const written = sockets.at(-1).sent.length;
      finish();
      await pending;
      assert.equal(controller.status, status, `${phase}: stopped status stays owned by the new lifetime`);
      assert.equal(sockets.at(-1).sent.length, written, `${phase}: no old result or response reaches the replacement`);
      assert.equal(controller.pendingResponseInstructions, null);
      controller.stop();
    }
  }
});