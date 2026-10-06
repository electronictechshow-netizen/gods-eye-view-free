import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeSession } from './realtimeSession.js';
import { GeminiRealtimeConnection } from './geminiConnection.js';
import { GevRealtimeController } from './realtimeController.js';

function stubController() {
  return {
    ui: {},
    started: [],
    stopped: [],
    sent: [],
    shortcutBound: 0,
    spaceKeyHeld: false,
    start(settings) {
      this.started.push(settings);
    },
    stop(settings) {
      this.stopped.push(settings);
    },
    sendTextCommand(text) {
      this.sent.push(['text', text]);
    },
    notifyMapEvent(event) {
      this.sent.push(['map', event]);
    },
    bindPushToTalkShortcut() {
      this.shortcutBound += 1;
    },
  };
}

function session(extra = {}) {
  const controller = stubController();
  const seen = [];
  const adapter = createRealtimeSession({
    emit() {},
    runAction() {},
    createController: (options) => {
      seen.push(options);
      return controller;
    },
    ...extra,
  });
  return { controller, adapter, seen };
}

test('the voice session is built on the Gemini Live transport', () => {
  const { seen } = session();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].connectionClass, GeminiRealtimeConnection);
});

test('the session hands its action runner and event sink to the controller', () => {
  const emit = () => {};
  const runAction = () => {};
  const { seen } = session({ emit, runAction });
  assert.equal(seen[0].actionExecutor, runAction);
  assert.equal(seen[0].onSessionEvent, emit);
});

test('start, stop and the two senders go straight to the controller', () => {
  const { controller, adapter } = session();
  adapter.start({ pushToTalk: true });
  adapter.stop({ removeUi: true });
  adapter.sendText('fly to LAX');
  adapter.sendMapEvent({ type: 'map_annotation_outline' });
  assert.deepEqual(controller.started, [{ pushToTalk: true }]);
  assert.deepEqual(controller.stopped, [{ removeUi: true }]);
  assert.deepEqual(controller.sent, [
    ['text', 'fly to LAX'],
    ['map', { type: 'map_annotation_outline' }],
  ]);
});

test('the session offers push-to-talk and nothing metered', () => {
  const { adapter } = session();
  assert.deepEqual(adapter.capabilities, { pushToTalk: true });
});

test('binding the controls binds the hold-Space shortcut', () => {
  const { controller, adapter } = session();
  adapter.bindControls();
  assert.equal(controller.shortcutBound, 1);
});

test('a click that ends a hold-Space gesture is ignored', () => {
  const { controller, adapter } = session();
  assert.equal(adapter.ignoreButtonClick(), false);
  controller.spaceKeyHeld = true;
  assert.equal(adapter.ignoreButtonClick(), true);
});

/* ---------------- a real controller on the Gemini transport ---------------- */

function realController() {
  const ui = {
    root: { dataset: {}, querySelectorAll: () => [], remove() {} },
    status: {},
    detail: {},
  };
  const controller = new GevRealtimeController({
    ui,
    runner: async () => ({}),
    debugSink: () => {},
    connectionClass: GeminiRealtimeConnection,
  });
  const starts = [];
  controller._connection.start = (...args) => {
    starts.push(args);
  };
  return { controller, ui, starts };
}

test('the controller runs on the Gemini transport', () => {
  const { controller } = realController();
  assert.ok(controller._connection instanceof GeminiRealtimeConnection);
});

test('a hold-Space start reaches the transport inside the call', () => {
  // The hold gesture restores a DOM marker the moment start() returns, which
  // relies on the transport's own setup having already run by then.
  const { controller, starts } = realController();
  controller.start({ pushToTalk: true });
  assert.equal(starts.length, 1, 'the connection start ran inside the call');
  assert.deepEqual(starts[0], [{ pushToTalk: true }]);
});

test('the controller carries no spend meter or model-tier state', () => {
  const { controller } = realController();
  for (const name of [
    'costTracker',
    'voiceTier',
    'toggleVoiceTier',
    'syncCostUi',
    'recordUsage',
  ])
    assert.equal(name in controller, false, `${name} is gone`);
});
