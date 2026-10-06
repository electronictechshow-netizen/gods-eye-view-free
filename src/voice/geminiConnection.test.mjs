import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiRealtimeConnection } from './geminiConnection.js';
import { RealtimeInput } from './realtimeInput.js';

const OPEN = 1;

/** A socket double that records the JSON frames the connection writes. */
function openSocket() {
  return {
    readyState: OPEN,
    sent: [],
    send(data) {
      this.sent.push(JSON.parse(data));
    },
  };
}

function connection({ input = {} } = {}) {
  const connection = new GeminiRealtimeConnection({
    readLifetimeSignal: () => null,
    readStatus: () => 'listening',
    input,
    cost: {},
    operations: { setMicrophoneEnabled() {}, debugLog() {} },
  });
  connection.ws = openSocket();
  return connection;
}

const audio = (data) => ({ type: 'input_audio_buffer.append', audio: data });

/** Compact view of what reached the socket, in order. */
function summary(sent) {
  return sent.map((message) => {
    if (message.realtimeInput?.audio)
      return `audio:${message.realtimeInput.audio.data}`;
    if (message.realtimeInput?.activityStart) return 'activityStart';
    if (message.realtimeInput?.activityEnd) return 'activityEnd';
    if (message.realtimeInput?.audioStreamEnd) return 'audioStreamEnd';
    return Object.keys(message)[0];
  });
}

test('audio and turn markers are held until the session reports ready', () => {
  const c = connection();
  c.forwardToGemini({ type: 'input_audio_activity.start' });
  c.forwardToGemini(audio('AAAA'));
  c.forwardToGemini(audio('BBBB'));
  assert.deepEqual(c.ws.sent, [], 'nothing leaves before setupComplete');

  c.markReady();
  assert.deepEqual(
    summary(c.ws.sent),
    ['activityStart', 'audio:AAAA', 'audio:BBBB'],
    'released together, in the order they were captured',
  );

  c.forwardToGemini(audio('CCCC'));
  assert.equal(c.ws.sent.length, 4, 'after ready, audio goes straight out');
});

test('a whole held turn survives a release before the session is ready', () => {
  // Quick tap of Space while the first session is still connecting.
  const c = connection();
  c.forwardToGemini({ type: 'input_audio_activity.start' });
  c.forwardToGemini(audio('AAAA'));
  c.forwardToGemini({ type: 'input_audio_activity.end' });
  c.markReady();
  assert.deepEqual(summary(c.ws.sent), [
    'activityStart',
    'audio:AAAA',
    'activityEnd',
  ]);
});

test('typed commands and tool results are never held back', () => {
  const c = connection();
  c.forwardToGemini({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    },
  });
  assert.equal(c.ws.sent.length, 1);
  assert.ok(c.ws.sent[0].clientContent);
});

test('sendRealtimeEvent tells the turn owner when a response.create asked for nothing', () => {
  const c = connection();
  c.markReady();
  const toolOutput = {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: 'a',
      output: JSON.stringify({ ok: true, action: 'adjust_camera_zoom' }),
    },
  };
  c.outbound.openToolBatch([{ id: 'a', name: 'adjust_camera_zoom' }]);
  assert.equal(c.sendRealtimeEvent(toolOutput), true);
  const sentBefore = c.ws.sent.length;
  assert.equal(
    c.sendRealtimeEvent({
      type: 'response.create',
      response: { instructions: 'Briefly confirm the completed GEV action.' },
    }),
    false,
    'Gemini already answers the toolResponse, so this follow-up asked for nothing',
  );
  assert.equal(c.ws.sent.length, sentBefore, 'and nothing was written');

  c.sendRealtimeEvent({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'stop' }],
    },
  });
  assert.equal(
    c.sendRealtimeEvent({ type: 'response.create' }),
    true,
    'a typed command is a real request',
  );
});

test('sendRealtimeEvent still reports a closed socket as not sent', () => {
  const c = connection();
  c.ws.readyState = 3;
  assert.equal(c.sendRealtimeEvent({ type: 'response.create' }), false);
  assert.equal(
    c.sendRealtimeEvent({ type: 'input_audio_buffer.commit' }),
    false,
  );
});

test('markReady is idempotent and does not replay', () => {
  const c = connection();
  c.forwardToGemini(audio('AAAA'));
  c.markReady();
  c.markReady();
  assert.equal(c.ws.sent.length, 1);
});

test('held events are dropped, not leaked, when the transport closes first', () => {
  const c = connection();
  c.forwardToGemini(audio('AAAA'));
  c.closeTransport();
  c.ws = openSocket();
  c.markReady();
  assert.deepEqual(c.ws.sent, [], 'a new session never inherits the old audio');
});

test('held events are bounded so a stalled setup cannot grow without limit', () => {
  const c = connection();
  for (let i = 0; i < 7000; i += 1) c.forwardToGemini(audio('AAAA'));
  c.markReady();
  assert.equal(c.ws.sent.length, 6000);
});

/* ---- the push-to-talk gesture: Space goes through RealtimeInput ---- */

function inputOwner() {
  const track = { enabled: false };
  const ui = { root: { dataset: {} } };
  const input = new RealtimeInput({
    readUi: () => ui,
    readStream: () => ({ getAudioTracks: () => [track] }),
    readStatus: () => 'listening',
    operations: {},
  });
  return { input, track, ui };
}

test('releasing Space ends the turn and stops the stream (the Gemini push-to-talk bug)', () => {
  const { input, track } = inputOwner();
  const c = connection({ input });
  const gated = [];
  c.capture = { setEnabled: (on) => gated.push(on), stop() {} };
  c.manualActivity = true;
  c.ready = true;
  input.microphoneGate = (enabled) => c.gateCapture(enabled);

  // Space held: RealtimeInput unmutes, which must open the turn.
  input.setMicrophoneEnabled(true);
  assert.equal(track.enabled, true);
  assert.deepEqual(summary(c.ws.sent), ['activityStart']);

  // Space released: RealtimeInput mutes, which must close the turn.
  input.setMicrophoneEnabled(false);
  assert.equal(track.enabled, false);
  assert.deepEqual(summary(c.ws.sent), ['activityStart', 'activityEnd']);
  assert.deepEqual(gated, [true, false], 'the capture is gated with the key');
});

test('a second hold in the same session opens a second turn', () => {
  const { input } = inputOwner();
  const c = connection({ input });
  c.capture = { setEnabled() {}, stop() {} };
  c.manualActivity = true;
  c.ready = true;
  input.microphoneGate = (enabled) => c.gateCapture(enabled);

  input.setMicrophoneEnabled(true);
  input.setMicrophoneEnabled(false);
  input.setMicrophoneEnabled(true);
  input.setMicrophoneEnabled(false);
  assert.deepEqual(summary(c.ws.sent), [
    'activityStart',
    'activityEnd',
    'activityStart',
    'activityEnd',
  ]);
});

test('open-mic sessions never emit manual turn markers', () => {
  const { input } = inputOwner();
  const c = connection({ input });
  c.capture = { setEnabled() {}, stop() {} };
  c.manualActivity = false;
  c.ready = true;
  input.microphoneGate = (enabled) => c.gateCapture(enabled);
  input.setMicrophoneEnabled(true);
  input.setMicrophoneEnabled(false);
  assert.deepEqual(c.ws.sent, []);
});

test('RealtimeInput without a transport gate behaves as before', () => {
  const { input, track } = inputOwner();
  input.setMicrophoneEnabled(true);
  assert.equal(track.enabled, true);
  input.setMicrophoneEnabled(false);
  assert.equal(track.enabled, false);
});

test('a session reset drops the gate so a stale transport cannot be driven', () => {
  const { input } = inputOwner();
  input.microphoneGate = () => {
    throw new Error('stale gate must not run');
  };
  input.resetSession();
  assert.doesNotThrow(() => input.setMicrophoneEnabled(false));
});
