import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_INPUT_MIME,
  GUIDANCE_KEY,
  TOOL_BATCH_IMAGE_WAIT_MS,
  TOOL_BATCH_MAX_WAIT_MS,
  createGeminiInboundTranslator,
  createGeminiOutbound,
  geminiFromRealtimeEvent,
} from './geminiProtocol.js';
import {
  RADIO_START_FAILED_INSTRUCTION,
  extractFunctionCalls,
  parseArguments,
  responseInstructionForToolResult,
  wantsViewportImage,
} from './realtimeProtocol.js';

/* ---------------- outbound: GEV event -> Gemini message ---------------- */

test('microphone audio becomes a realtimeInput chunk at 16 kHz', () => {
  const [message] = geminiFromRealtimeEvent({
    type: 'input_audio_buffer.append',
    audio: 'QUJD',
  });
  assert.deepEqual(message, {
    realtimeInput: { audio: { data: 'QUJD', mimeType: GEMINI_INPUT_MIME } },
  });
  assert.match(GEMINI_INPUT_MIME, /rate=16000/);
});

test('an empty audio append sends nothing', () => {
  assert.deepEqual(
    geminiFromRealtimeEvent({ type: 'input_audio_buffer.append', audio: '' }),
    [],
  );
});

test('a tool result becomes a toolResponse keyed by call id', () => {
  const [message] = geminiFromRealtimeEvent({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: 'call_7',
      name: 'fly_to_location',
      output: JSON.stringify({ ok: true, action: 'fly_to_location' }),
    },
  });
  assert.deepEqual(message.toolResponse.functionResponses, [
    {
      id: 'call_7',
      name: 'fly_to_location',
      response: { ok: true, action: 'fly_to_location' },
    },
  ]);
});

test('a non-JSON tool result is still delivered, wrapped', () => {
  const [message] = geminiFromRealtimeEvent({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: 'c1', output: 'plain text' },
  });
  assert.deepEqual(message.toolResponse.functionResponses[0].response, {
    result: 'plain text',
  });
});

test('typed user text becomes a client turn', () => {
  const [message] = geminiFromRealtimeEvent({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      content: [{ type: 'input_text', text: 'fly to LAX' }],
    },
  });
  assert.deepEqual(message.clientContent.turns, [
    { role: 'user', parts: [{ text: 'fly to LAX' }] },
  ]);
});

test('a viewport screenshot data URL becomes inlineData', () => {
  const [message] = geminiFromRealtimeEvent({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      content: [
        { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAB' },
      ],
    },
  });
  assert.deepEqual(message.clientContent.turns[0].parts, [
    { inlineData: { mimeType: 'image/jpeg', data: 'AAAB' } },
  ]);
});

test('response.create closes the client turn so Gemini generates', () => {
  assert.deepEqual(geminiFromRealtimeEvent({ type: 'response.create' }), [
    { clientContent: { turnComplete: true } },
  ]);
});

test('events Gemini handles natively are dropped, not mistranslated', () => {
  for (const type of [
    'session.update',
    'response.cancel',
    'conversation.item.delete',
  ])
    assert.deepEqual(geminiFromRealtimeEvent({ type }), [], type);
  assert.deepEqual(geminiFromRealtimeEvent(null), []);
  assert.deepEqual(geminiFromRealtimeEvent({ type: 'unknown.thing' }), []);
});

/* ---------------- inbound: Gemini message -> GEV event ---------------- */

test('setupComplete opens the session', () => {
  const { events } = createGeminiInboundTranslator().translate({
    setupComplete: {},
  });
  assert.equal(events[0].type, 'session.created');
});

test('a Gemini tool call parses through the real extractFunctionCalls', () => {
  const { events } = createGeminiInboundTranslator().translate({
    toolCall: {
      functionCalls: [
        { id: 'fc_1', name: 'fly_to_location', args: { query: 'Tokyo' } },
        { id: 'fc_2', name: 'set_visual_style', args: { style: 'nvg' } },
      ],
    },
  });

  // The whole point of the bridge: GEV's own parser must accept what we emit.
  const calls = events.flatMap((event) => extractFunctionCalls(event));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'fly_to_location');
  assert.deepEqual(parseArguments(calls[0].arguments), { query: 'Tokyo' });
  assert.equal(calls[1].call_id, 'fc_2');
  assert.deepEqual(parseArguments(calls[1].arguments), { style: 'nvg' });
});

test('a tool call with no args yields parseable empty arguments', () => {
  const { events } = createGeminiInboundTranslator().translate({
    toolCall: { functionCalls: [{ id: 'fc', name: 'reset_globe' }] },
  });
  const [call] = events.flatMap((event) => extractFunctionCalls(event));
  assert.deepEqual(parseArguments(call.arguments), {});
});

test('model audio is separated from the event stream', () => {
  const { events, audio } = createGeminiInboundTranslator().translate({
    serverContent: {
      modelTurn: {
        parts: [
          { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QUJD' } },
        ],
      },
    },
  });
  assert.deepEqual(
    audio,
    ['QUJD'],
    'audio is handed to the player, not the bus',
  );
  assert.equal(events[0].type, 'response.created', 'turn opens on first audio');
});

test('a turn emits created once and done at the end', () => {
  const translator = createGeminiInboundTranslator();
  const first = translator.translate({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AA' } }],
      },
    },
  });
  const second = translator.translate({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'BB' } }],
      },
    },
  });
  const last = translator.translate({ serverContent: { turnComplete: true } });

  assert.equal(
    first.events.filter((e) => e.type === 'response.created').length,
    1,
  );
  assert.equal(
    second.events.filter((e) => e.type === 'response.created').length,
    0,
    'the turn does not reopen mid-stream',
  );
  const done = last.events.find((e) => e.type === 'response.done');
  assert.ok(done, 'turn completion closes the response');
  assert.equal(done.response.status, 'completed');
  assert.equal(
    first.events[0].response.id,
    done.response.id,
    'same response id',
  );
});

test('output transcription accumulates and is reported on completion', () => {
  const translator = createGeminiInboundTranslator();
  translator.translate({
    serverContent: { outputTranscription: { text: 'Flying ' } },
  });
  translator.translate({
    serverContent: { outputTranscription: { text: 'to Tokyo' } },
  });
  const { events } = translator.translate({
    serverContent: { turnComplete: true },
  });
  const done = events.find(
    (e) => e.type === 'response.output_audio_transcript.done',
  );
  assert.equal(done.transcript, 'Flying to Tokyo');
});

test('barge-in clears queued audio and cancels the turn', () => {
  const translator = createGeminiInboundTranslator();
  translator.translate({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AA' } }],
      },
    },
  });
  const { events } = translator.translate({
    serverContent: { interrupted: true },
  });
  assert.ok(events.some((e) => e.type === 'output_audio_buffer.cleared'));
  const done = events.find((e) => e.type === 'response.done');
  assert.equal(done.response.status, 'cancelled');
});

test('user speech transcription surfaces as the completed-transcription event', () => {
  const { events } = createGeminiInboundTranslator().translate({
    serverContent: { inputTranscription: { text: 'take me to Paris' } },
  });
  const transcription = events.find(
    (e) => e.type === 'conversation.item.input_audio_transcription.completed',
  );
  assert.equal(transcription.transcript, 'take me to Paris');
});

test('usage metadata is carried onto response.done', () => {
  const translator = createGeminiInboundTranslator();
  translator.translate({
    serverContent: { outputTranscription: { text: 'hi' } },
  });
  const { events } = translator.translate({
    serverContent: { turnComplete: true },
    usageMetadata: {
      totalTokenCount: 42,
      promptTokenCount: 30,
      responseTokenCount: 12,
    },
  });
  const done = events.find((e) => e.type === 'response.done');
  assert.equal(done.response.usage.total_tokens, 42);
  assert.equal(done.response.usage.input_tokens, 30);
  assert.equal(done.response.usage.output_tokens, 12);
});

test('goAway surfaces as an error the session owner can act on', () => {
  const { events } = createGeminiInboundTranslator().translate({ goAway: {} });
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].error.code, 'server_going_away');
});

test('garbage frames are ignored rather than thrown on', () => {
  const translator = createGeminiInboundTranslator();
  for (const input of [null, '', 'not json', '{"broken":', 7, []])
    assert.deepEqual(translator.translate(input), { events: [], audio: [] });
});

test('a raw JSON string frame is parsed like an object', () => {
  const { events } = createGeminiInboundTranslator().translate(
    JSON.stringify({ setupComplete: {} }),
  );
  assert.equal(events[0].type, 'session.created');
});

test('reset drops a half-open turn so the next session starts clean', () => {
  const translator = createGeminiInboundTranslator();
  translator.translate({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AA' } }],
      },
    },
  });
  translator.reset();
  const { events } = translator.translate({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'BB' } }],
      },
    },
  });
  assert.equal(
    events.filter((e) => e.type === 'response.created').length,
    1,
    'a fresh turn opens after reset',
  );
});

/* ---------------- push-to-talk turn boundaries ---------------- */

test('push-to-talk activity markers map to Gemini activity signals', () => {
  // With automaticActivityDetection disabled these are the ONLY thing that
  // tells Gemini a turn happened. Verified against the live API: without them
  // streamed audio is accepted and silently never transcribed.
  assert.deepEqual(
    geminiFromRealtimeEvent({ type: 'input_audio_activity.start' }),
    [{ realtimeInput: { activityStart: {} } }],
  );
  assert.deepEqual(
    geminiFromRealtimeEvent({ type: 'input_audio_activity.end' }),
    [{ realtimeInput: { activityEnd: {} } }],
  );
});

test('open-mic commit still ends the stream rather than the activity', () => {
  // Open-mic relies on Gemini's own VAD, so a commit marks the stream end and
  // must NOT be confused with an explicit turn boundary.
  assert.deepEqual(
    geminiFromRealtimeEvent({ type: 'input_audio_buffer.commit' }),
    [{ realtimeInput: { audioStreamEnd: true } }],
  );
});

/* ---------------- tool results: one toolResponse per toolCall ---------------- */

/** A deterministic clock so the max-wait and image timers can be stepped. */
function fakeClock() {
  let now = 0;
  const timers = new Map();
  let next = 1;
  return {
    setTimer(callback, delay) {
      const id = next++;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.due <= end)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].due;
        due[1].callback();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

function outbound() {
  const clock = fakeClock();
  const sent = [];
  const bridge = createGeminiOutbound({
    send: (message) => sent.push(message),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { bridge, sent, clock };
}

const output = (id, result) => ({
  type: 'conversation.item.create',
  item: {
    type: 'function_call_output',
    call_id: id,
    output: JSON.stringify(result),
  },
});
const create = (instructions) => ({
  type: 'response.create',
  ...(instructions ? { response: { instructions } } : {}),
});
const zoomResult = { ok: true, action: 'adjust_camera_zoom', direction: 'in' };
const radioResult = {
  ok: true,
  action: 'control_radio',
  radioAction: 'play',
  radioPlaybackRequested: true,
};

test("one tool call: the result leaves at once, with the app's own guidance for it", () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'adjust_camera_zoom' }]);
  bridge.forward(output('a', zoomResult));
  assert.equal(sent.length, 1, 'no waiting on a follow-up that may never come');
  assert.deepEqual(sent[0].toolResponse.functionResponses, [
    {
      id: 'a',
      name: 'adjust_camera_zoom',
      response: {
        ...zoomResult,
        [GUIDANCE_KEY]: responseInstructionForToolResult(zoomResult),
      },
    },
  ]);
});

test('the follow-up response.create for an answered tool is absorbed, not answered again', () => {
  // GEV asks for a reply after each result; Gemini already replies to the
  // toolResponse, and the empty turnComplete it used to become made it say
  // everything twice.
  const { bridge, sent } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'adjust_camera_zoom' }]);
  bridge.forward(output('a', zoomResult));
  bridge.forward(create(responseInstructionForToolResult(zoomResult)));
  assert.equal(sent.length, 1);
  assert.equal(sent.filter((m) => m.clientContent).length, 0);
});

test('a follow-up deferred until after the reply does not trigger a second reply', () => {
  // The app holds a follow-up while it believes a response is pending; with a
  // batch answered in one go it surfaces only after the model has spoken.
  const { bridge, sent } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'adjust_camera_zoom' },
    { id: 'b', name: 'adjust_camera_zoom' },
  ]);
  bridge.forward(output('a', zoomResult));
  bridge.forward(create('first follow-up'));
  bridge.forward(output('b', zoomResult));
  assert.equal(sent.length, 1, 'answered when the last tool finished');
  bridge.forward(create(responseInstructionForToolResult(zoomResult))); // late
  assert.equal(sent.length, 1, 'the late follow-up adds nothing');
});

test('two tool calls are answered together the moment the last one finishes', () => {
  // Gemini speaks after EVERY toolResponse: answering call by call made it
  // confirm twice, talk over itself, and sometimes re-issue the calls.
  const { bridge, sent } = outbound();
  const style = { ok: true, action: 'set_visual_style' };
  const layer = {
    ok: true,
    action: 'set_layer_visibility',
    layerId: 'flights',
  };
  bridge.openToolBatch([
    { id: 'a', name: 'set_visual_style' },
    { id: 'b', name: 'set_layer_visibility' },
  ]);
  bridge.forward(output('a', style));
  assert.deepEqual(sent, [], 'one call is not the batch');
  bridge.forward(output('b', layer));

  assert.equal(sent.length, 1);
  const responses = sent[0].toolResponse.functionResponses;
  assert.deepEqual(
    responses.map((r) => r.id),
    ['a', 'b'],
    'in the order the model asked',
  );
  assert.equal(
    responses[0].response[GUIDANCE_KEY],
    responseInstructionForToolResult(layer),
    'the last result to finish leads, as it did for the follow-up',
  );
  assert.equal(
    responses[1].response[GUIDANCE_KEY],
    undefined,
    'guidance appears once',
  );
});

test('the Radio handoff wording stays authoritative when another tool finishes after it', () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'control_radio' },
    { id: 'b', name: 'adjust_camera_zoom' },
  ]);
  bridge.forward(output('a', radioResult));
  bridge.forward(output('b', zoomResult));
  const guidance =
    sent[0].toolResponse.functionResponses[0].response[GUIDANCE_KEY];
  assert.equal(guidance, responseInstructionForToolResult(radioResult));
  assert.match(guidance, /Turning on the radio/);
});

test('a slow second tool delays the whole answer rather than splitting it', () => {
  const { bridge, sent, clock } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'zoom_to_globe' },
    { id: 'b', name: 'control_radio' },
  ]);
  bridge.forward(output('a', { ok: true }));
  bridge.forward(create('about a'));
  clock.advance(10_000);
  assert.deepEqual(sent, [], 'an incomplete batch is not answered early');
  bridge.forward(output('b', radioResult));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].toolResponse.functionResponses.length, 2);
});

test('a tool that never reports is answered with an honest failure after the max wait', () => {
  const { bridge, sent, clock } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'fly_to_location' },
    { id: 'b', name: 'control_radio' },
  ]);
  bridge.forward(output('a', { ok: true }));
  clock.advance(TOOL_BATCH_MAX_WAIT_MS + 1);
  assert.equal(sent.length, 1);
  const [first, second] = sent[0].toolResponse.functionResponses;
  assert.equal(first.response.ok, true);
  assert.equal(second.id, 'b');
  assert.equal(second.response.ok, false);
  assert.match(second.response.error, /did not report/);
  assert.equal(
    first.response[GUIDANCE_KEY],
    undefined,
    'guidance for a partial picture is not offered',
  );
});

test('a result that arrives after its batch was answered is dropped', () => {
  const { bridge, sent, clock } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'x' },
    { id: 'b', name: 'y' },
  ]);
  clock.advance(TOOL_BATCH_MAX_WAIT_MS + 1);
  const answered = sent.length;
  assert.equal(answered, 1);
  bridge.forward(output('a', { ok: true, late: true }));
  assert.equal(sent.length, answered, 'Gemini no longer expects it');
});

test('a result for a call no batch knows is answered on its own', () => {
  const { bridge, sent } = outbound();
  bridge.forward(output('stray', { ok: true }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].toolResponse.functionResponses[0].id, 'stray');
});

test('calls the model withdrew are not waited on or answered', () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'x' },
    { id: 'b', name: 'y' },
  ]);
  bridge.forward(output('a', { ok: true }));
  assert.deepEqual(sent, [], 'b is still outstanding');
  bridge.cancelToolCalls(['b']);
  assert.equal(sent.length, 1, 'with b withdrawn, a is the whole batch');
  assert.deepEqual(
    sent[0].toolResponse.functionResponses.map((r) => r.id),
    ['a'],
  );
  bridge.forward(output('b', { ok: true }));
  assert.equal(sent.length, 1, 'the cancelled call stays unanswered');
});

test('cancelling every call discards the batch and its timers', () => {
  const { bridge, sent, clock } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'x' }]);
  bridge.cancelToolCalls(['a']);
  assert.equal(clock.pending(), 0);
  clock.advance(TOOL_BATCH_MAX_WAIT_MS * 2);
  assert.deepEqual(sent, []);
});

test('a second toolCall joins an unanswered batch instead of replacing it', () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'x' }]);
  bridge.openToolBatch([{ id: 'b', name: 'y' }]);
  bridge.forward(output('a', { ok: true }));
  assert.deepEqual(sent, [], 'the batch is not complete without b');
  bridge.forward(output('b', { ok: true }));
  assert.equal(sent[0].toolResponse.functionResponses.length, 2);
});

test('attaching guidance leaves the delivered result data intact', () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'adjust_camera_zoom' }]);
  bridge.forward(output('a', zoomResult));
  const delivered = sent[0].toolResponse.functionResponses[0].response;
  assert.equal(delivered.ok, true);
  assert.equal(delivered.direction, 'in');
});

/* ---- the screenshot that belongs with a result ---- */

const streetLevel = {
  ok: true,
  action: 'get_entity_context',
  scene: { basemap: { viewScale: 'local' } },
};
const screenshotItem = {
  type: 'conversation.item.create',
  item: {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'Current viewport screenshot.' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAB' },
    ],
  },
};

test('a street-level answer waits for its screenshot, which reaches the model first', () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'get_entity_context' }]);
  bridge.forward(output('a', streetLevel));
  assert.deepEqual(sent, [], 'held for the image');
  bridge.forward(screenshotItem);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].clientContent, 'the image goes out first');
  bridge.forward(create('guidance'));
  assert.equal(sent.length, 2);
  assert.ok(sent[1].toolResponse, 'then the answer that triggers the reply');
});

test('a screenshot that never comes does not hold the answer forever', () => {
  const { bridge, sent, clock } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'get_entity_context' }]);
  bridge.forward(output('a', streetLevel));
  clock.advance(TOOL_BATCH_IMAGE_WAIT_MS - 1);
  assert.deepEqual(sent, []);
  clock.advance(2);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].toolResponse);
});

test('a result that already names what is in view does not wait for an image', () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'get_entity_context' }]);
  bridge.forward(
    output('a', {
      ...streetLevel,
      scene: {
        basemap: { viewScale: 'local', nearbyPlaces: [{ name: 'Cafe' }] },
      },
    }),
  );
  assert.equal(sent.length, 1);
});

test('wantsViewportImage mirrors the conditions the screenshot sender uses', () => {
  assert.equal(wantsViewportImage(streetLevel), true);
  assert.equal(
    wantsViewportImage({ ...streetLevel, action: 'fly_to_location' }),
    false,
  );
  assert.equal(
    wantsViewportImage({
      ...streetLevel,
      scene: { basemap: { viewScale: 'regional' } },
    }),
    false,
    'only at street level',
  );
  assert.equal(
    wantsViewportImage({ ...streetLevel, selected: { id: 'x' } }),
    false,
  );
  assert.equal(wantsViewportImage(null), false);
  assert.equal(wantsViewportImage(undefined), false);
});

/* ---- typed commands and the one non-tool instruction ---- */

test('a typed command still closes its turn so Gemini generates', () => {
  const { bridge, sent } = outbound();
  bridge.forward({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'fly to LAX' }],
    },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].clientContent.turnComplete, false);
  bridge.forward(create());
  assert.deepEqual(sent[1], { clientContent: { turnComplete: true } });
});

test('a typed command and a finished tool in the same moment are both honoured', () => {
  const { bridge, sent } = outbound();
  bridge.openToolBatch([{ id: 'a', name: 'adjust_camera_zoom' }]);
  bridge.forward(output('a', zoomResult));
  bridge.forward({
    type: 'conversation.item.create',
    item: { type: 'message', content: [{ type: 'input_text', text: 'stop' }] },
  });
  bridge.forward(create());
  assert.ok(
    sent.some((m) => m.toolResponse),
    'the pending call is answered',
  );
  assert.ok(
    sent.some((m) => m.clientContent?.turnComplete === true),
    'and the typed turn is closed',
  );
});

test('the Radio failing to start becomes a labelled console turn', () => {
  const { bridge, sent } = outbound();
  bridge.forward(create(RADIO_START_FAILED_INSTRUCTION));
  assert.equal(sent.length, 1);
  const turn = sent[0].clientContent;
  assert.equal(turn.turnComplete, true);
  assert.equal(turn.turns[0].role, 'user');
  assert.match(turn.turns[0].parts[0].text, /^\[GEV console instruction/);
  assert.match(turn.turns[0].parts[0].text, /Radio station could not start/);
});

test('any other instruction with nothing to answer is dropped, not spoken', () => {
  const { bridge, sent } = outbound();
  bridge.forward(create(responseInstructionForToolResult(zoomResult)));
  bridge.forward(
    create('Some instruction nobody asked the transport to relay.'),
  );
  assert.deepEqual(sent, []);
});

test('a bare response.create with nothing to answer sends nothing', () => {
  const { bridge, sent } = outbound();
  bridge.forward(create());
  assert.deepEqual(sent, []);
});

/* ---- telling the caller whether a response.create asked for anything ---- */

test('a redundant tool follow-up says it asked for nothing, so nobody waits for its reply', () => {
  // The Radio handoff waits for the response that follows each response.create
  // it sent. A follow-up the bridge swallows has no response of its own coming.
  const { bridge } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'control_radio' },
    { id: 'b', name: 'adjust_camera_zoom' },
  ]);
  bridge.forward(output('a', radioResult));
  assert.equal(
    bridge.forward(create(responseInstructionForToolResult(radioResult))),
    false,
    'absorbed while a sibling tool is still running',
  );
  bridge.forward(output('b', zoomResult));
  assert.equal(
    bridge.forward(create(responseInstructionForToolResult(radioResult))),
    false,
    'absorbed after the batch has been answered',
  );
});

test('a response.create that does make Gemini generate says so', () => {
  const typed = outbound();
  typed.bridge.forward({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'fly to LAX' }],
    },
  });
  assert.equal(typed.bridge.forward(create()), true, 'a typed command');

  const radio = outbound();
  assert.equal(
    radio.bridge.forward(create(RADIO_START_FAILED_INSTRUCTION)),
    true,
    'the Radio failing to start',
  );

  const waiting = outbound();
  waiting.bridge.openToolBatch([{ id: 'a', name: 'get_entity_context' }]);
  waiting.bridge.forward(output('a', streetLevel));
  assert.equal(
    waiting.bridge.forward(create('after the screenshot')),
    true,
    'a follow-up that releases a batch held for its screenshot',
  );
});

test('every other outbound event reports that it was handled', () => {
  const { bridge } = outbound();
  assert.equal(bridge.forward(screenshotItem), true);
  assert.equal(bridge.forward({ type: 'input_audio_buffer.commit' }), true);
  assert.equal(bridge.forward(null), true);
});

test('a viewport screenshot is not mistaken for a typed command', () => {
  const { bridge, sent } = outbound();
  bridge.forward(screenshotItem);
  assert.equal(sent.length, 1, 'the image still reaches Gemini');
  bridge.forward(create());
  assert.equal(sent.length, 1, 'but it does not arm a turnComplete');
});

test('a system map event is not mistaken for a typed command', () => {
  const { bridge, sent } = outbound();
  bridge.forward({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'system',
      content: [
        { type: 'input_text', text: '{"type":"map_annotation_outline"}' },
      ],
    },
  });
  bridge.forward(create());
  assert.equal(
    sent.filter((m) => m.clientContent?.turnComplete === true).length,
    0,
  );
});

test('reset drops a half-collected batch and its timers', () => {
  const { bridge, sent, clock } = outbound();
  bridge.openToolBatch([
    { id: 'a', name: 'x' },
    { id: 'b', name: 'y' },
  ]);
  bridge.forward(output('a', { ok: true }));
  bridge.reset();
  assert.equal(clock.pending(), 0);
  clock.advance(TOOL_BATCH_MAX_WAIT_MS * 2);
  assert.deepEqual(sent, []);
});

test('non-object tool output is wrapped so Gemini always gets an object', () => {
  for (const value of ['5', '[1,2]', 'null']) {
    const [message] = geminiFromRealtimeEvent({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'c', output: value },
    });
    const { response } = message.toolResponse.functionResponses[0];
    assert.equal(typeof response, 'object', value);
    assert.equal(Array.isArray(response), false, value);
  }
});

/* ---------------- the inbound side reports tool batches ---------------- */

test('a toolCall message reports its calls as a batch', () => {
  const { toolCalls } = createGeminiInboundTranslator().translate({
    toolCall: {
      functionCalls: [
        { id: 'fc_1', name: 'zoom_to_globe', args: {} },
        { id: 'fc_2', name: 'control_radio', args: { action: 'play' } },
        { name: '' },
      ],
    },
  });
  assert.deepEqual(toolCalls, [
    { id: 'fc_1', name: 'zoom_to_globe' },
    { id: 'fc_2', name: 'control_radio' },
  ]);
});

test('a call without an id gets a stable local id, used for the batch too', () => {
  const { events, toolCalls } = createGeminiInboundTranslator().translate({
    toolCall: { functionCalls: [{ name: 'reset_globe' }] },
  });
  const [call] = events.flatMap((event) => extractFunctionCalls(event));
  assert.equal(toolCalls[0].id, call.call_id);
});

test('a toolCallCancellation reports the withdrawn ids', () => {
  const { cancelledCalls } = createGeminiInboundTranslator().translate({
    toolCallCancellation: { ids: ['fc_1', 'fc_2'] },
  });
  assert.deepEqual(cancelledCalls, ['fc_1', 'fc_2']);
});

test('messages with no tool activity carry no tool fields', () => {
  const result = createGeminiInboundTranslator().translate({
    serverContent: { turnComplete: true },
  });
  assert.equal('toolCalls' in result, false);
  assert.equal('cancelledCalls' in result, false);
});
