/**
 * Bidirectional bridge between GEV's Realtime-style event vocabulary and the
 * Gemini Live `BidiGenerateContent` wire format.
 *
 * GEV's turn, tool, radio and viewport owners all speak one Realtime-style
 * vocabulary (conversation items, responses, function calls) over a
 * data-channel-shaped facade. Gemini Live speaks its own protocol over a
 * WebSocket. Translating at this boundary keeps every one of those owners —
 * and the 28-action tool layer — working unchanged.
 *
 * Nothing here touches the network or the DOM: a message goes in, messages come
 * out, which is what makes the mapping unit-testable.
 */

import {
  RADIO_START_FAILED_INSTRUCTION,
  responseInstructionForToolResult,
  wantsViewportImage,
} from './realtimeProtocol.js';

/** Gemini Live consumes 16 kHz mono PCM16 and emits 24 kHz mono PCM16. */
export const GEMINI_INPUT_SAMPLE_RATE = 16000;
export const GEMINI_OUTPUT_SAMPLE_RATE = 24000;
export const GEMINI_INPUT_MIME = `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}`;

let counter = 0;
/** Monotonic local id. Gemini does not supply event ids of its own. */
function nextId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/** Gemini wants a function response to be an object; wrap anything else. */
function toResponseObject(output) {
  const parsed = parseJson(output);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    return parsed;
  return { result: parsed ?? output };
}

/**
 * Translate one outbound GEV event into Gemini messages.
 *
 * @param {object} event - A Realtime-style client event.
 * @returns {Array<object>} Zero or more Gemini messages to send.
 */
export function geminiFromRealtimeEvent(event) {
  if (!event || typeof event !== 'object') return [];

  switch (event.type) {
    case 'input_audio_buffer.append': {
      if (typeof event.audio !== 'string' || !event.audio) return [];
      return [
        {
          realtimeInput: {
            audio: { data: event.audio, mimeType: GEMINI_INPUT_MIME },
          },
        },
      ];
    }

    // Push-to-talk turn boundaries. With automatic activity detection off,
    // these are the ONLY thing that tells Gemini a turn happened: without
    // them streamed audio is accepted and silently never transcribed.
    case 'input_audio_activity.start':
      return [{ realtimeInput: { activityStart: {} } }];

    case 'input_audio_activity.end':
      return [{ realtimeInput: { activityEnd: {} } }];

    case 'input_audio_buffer.commit':
      // Open-mic: Gemini closes the turn from its own VAD, so this only marks
      // the end of the stream. Push-to-talk sends activityEnd instead.
      return [{ realtimeInput: { audioStreamEnd: true } }];

    case 'conversation.item.create': {
      const item = event.item;
      if (!item || typeof item !== 'object') return [];

      if (item.type === 'function_call_output') {
        const response = toResponseObject(item.output);
        return [
          {
            toolResponse: {
              functionResponses: [
                {
                  id: item.call_id,
                  name: item.name || undefined,
                  response,
                },
              ],
            },
          },
        ];
      }

      // Text and image turns GEV injects (typed commands, viewport captures).
      const parts = [];
      for (const entry of Array.isArray(item.content) ? item.content : []) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.type === 'input_text' && typeof entry.text === 'string') {
          parts.push({ text: entry.text });
          continue;
        }
        if (
          entry.type === 'input_image' &&
          typeof entry.image_url === 'string'
        ) {
          // GEV sends a data: URL; Gemini wants the raw base64 plus mime type.
          const match = /^data:([^;,]+);base64,(.*)$/s.exec(entry.image_url);
          if (match)
            parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
      if (!parts.length) return [];
      return [
        {
          clientContent: {
            turns: [{ role: 'user', parts }],
            turnComplete: false,
          },
        },
      ];
    }

    case 'response.create':
      // Gemini generates as soon as a turn completes, so an explicit
      // response.create only needs to close the pending client turn.
      return [{ clientContent: { turnComplete: true } }];

    case 'session.update':
    case 'response.cancel':
    case 'conversation.item.delete':
      // setup is sent once at connect; interruption and item pruning are
      // handled by Gemini's own barge-in and context window.
      return [];

    default:
      return [];
  }
}

/**
 * Longest a finished batch waits for the viewport screenshot that has to be
 * seen with its result. Only used when a result asks for one.
 */
export const TOOL_BATCH_IMAGE_WAIT_MS = 6000;

/** Longest a tool batch waits for a slow tool before it answers without it. */
export const TOOL_BATCH_MAX_WAIT_MS = 30_000;

/** Key carrying GEV's per-result guidance next to the data in a tool response. */
export const GUIDANCE_KEY = 'assistant_guidance';

/** Frames an app-authored instruction so it is not mistaken for something the user said. */
const CONSOLE_INSTRUCTION_PREFIX =
  '[GEV console instruction, not spoken by the user] ';

/** Recently answered or cancelled call ids, so a late result is dropped rather than re-sent. */
const FINISHED_CALL_MEMORY = 64;

/** A typed command: user text with no image, which the next response.create must close. */
function isUserTextTurn(item) {
  if (!item || item.type !== 'message') return false;
  if (item.role !== undefined && item.role !== 'user') return false;
  const content = Array.isArray(item.content) ? item.content : [];
  return (
    content.some((entry) => entry?.type === 'input_text') &&
    !content.some((entry) => entry?.type === 'input_image')
  );
}

/** What GEV tells the assistant to say about a set of results (the last to finish leads). */
function guidanceForResults(results) {
  if (!results.length) return null;
  // The Radio handoff wording stays authoritative even when another tool's
  // result follows it in the same multi-intent turn.
  const radio = results.find(
    (result) =>
      result?.action === 'control_radio' && result.radioPlaybackRequested,
  );
  return responseInstructionForToolResult(radio ?? results[results.length - 1]);
}

/**
 * Build the stateful outbound side of the bridge.
 *
 * `geminiFromRealtimeEvent` is a one-event-in, messages-out mapping. That is
 * not enough for three things the Realtime-style vocabulary does implicitly
 * and Gemini Live does not:
 *
 *  - Gemini speaks a reply after EVERY toolResponse message. GEV finishes the
 *    tools of one model turn one at a time, so answering them one at a time
 *    made the assistant confirm twice, get cut off by its own second answer,
 *    and sometimes re-issue the calls. The results of one toolCall are
 *    collected and sent as a single toolResponse, the moment the last one is in.
 *  - GEV follows each result with a `response.create` carrying instructions
 *    ("confirm once", "say the route is a straight line", ...). Their timing is
 *    tied to a request/response lifecycle Gemini does not have, so it arrives late or not at all here,
 *    so the same guidance is derived from the results themselves and rides in
 *    the toolResponse. The `response.create` for a tool result is then
 *    redundant: sent as a bare turnComplete it made Gemini answer a second time.
 *  - `response.create` is still honoured where it is the only trigger: it
 *    closes a typed command's turn, and the one instruction that is not a tool
 *    follow-up (the Radio failing to start) is sent as a labelled console turn.
 *
 * A result that has to be seen with the viewport screenshot waits briefly for
 * it, so the image reaches the model before the toolResponse that triggers its
 * reply.
 *
 * @param {object} options
 * @param {(message: object) => void} options.send - Writes one Gemini message.
 * @returns {{forward: (event: unknown) => boolean, openToolBatch: (calls: Array<{id: string, name: string}>) => void, cancelToolCalls: (ids: string[]) => void, reset: () => void}}
 */
export function createGeminiOutbound({
  send,
  imageWaitMs = TOOL_BATCH_IMAGE_WAIT_MS,
  maxWaitMs = TOOL_BATCH_MAX_WAIT_MS,
  setTimer = (...args) => setTimeout(...args),
  clearTimer = (...args) => clearTimeout(...args),
} = {}) {
  let batch = null;
  let userTurnOpen = false;
  const finished = new Set();

  const remember = (id) => {
    finished.add(id);
    while (finished.size > FINISHED_CALL_MEMORY)
      finished.delete(finished.values().next().value);
  };

  const stopTimers = (target) => {
    if (target?.imageTimer) clearTimer(target.imageTimer);
    if (target?.maxTimer) clearTimer(target.maxTimer);
  };

  const isComplete = (target) =>
    target.calls.size > 0 &&
    [...target.calls.keys()].every((id) => target.outputs.has(id));

  function flush({ forced = false } = {}) {
    if (!batch) return;
    const current = batch;
    batch = null;
    stopTimers(current);
    let functionResponses = [];
    for (const [id, name] of current.calls) {
      remember(id);
      if (current.outputs.has(id)) {
        functionResponses.push({ id, name, response: current.outputs.get(id) });
      } else if (forced) {
        // Every call must be answered or the model waits on it forever.
        functionResponses.push({
          id,
          name,
          response: {
            ok: false,
            error: 'This action did not report a result in time.',
          },
        });
      }
    }
    if (!functionResponses.length) return;
    // After a forced flush the late result may still matter, but the guidance
    // would describe an incomplete picture, so only a clean batch carries it.
    const guidance = forced
      ? null
      : guidanceForResults(
          current.order
            .filter((id) => current.outputs.has(id))
            .map((id) => current.outputs.get(id)),
        );
    if (guidance) {
      const [first, ...rest] = functionResponses;
      functionResponses = [
        {
          ...first,
          response: { ...first.response, [GUIDANCE_KEY]: guidance },
        },
        ...rest,
      ];
    }
    send({ toolResponse: { functionResponses } });
  }

  /** Answer now, unless a result is waiting to be seen with a screenshot. */
  function settle() {
    if (!batch || !isComplete(batch)) return;
    const needsImage = [...batch.outputs.values()].some(wantsViewportImage);
    if (!needsImage) {
      flush();
      return;
    }
    if (batch.imageTimer) return;
    const current = batch;
    current.imageTimer = setTimer(() => {
      current.imageTimer = null;
      if (batch === current && isComplete(current)) flush();
    }, imageWaitMs);
  }

  function forwardToolOutput(event) {
    const id = event.item.call_id;
    if (batch?.calls.has(id)) {
      batch.outputs.set(id, toResponseObject(event.item.output));
      batch.order = batch.order.filter((known) => known !== id).concat(id);
      settle();
      return;
    }
    // Already answered or cancelled: Gemini no longer expects it.
    if (finished.has(id)) return;
    // Not part of any batch seen here: answer it on its own.
    for (const message of geminiFromRealtimeEvent(event)) send(message);
  }

  function closeUserTurn() {
    if (!userTurnOpen) return false;
    userTurnOpen = false;
    send({ clientContent: { turnComplete: true } });
    return true;
  }

  /** @returns {boolean} False when the request was redundant and nothing was asked of Gemini. */
  function forwardResponseCreate(event) {
    const raw = event.response?.instructions;
    const instructions = typeof raw === 'string' ? raw.trim() : '';

    // The follow-up that comes after a screenshot attempt: the image is in, so
    // the batch that was waiting for it can go.
    if (batch && isComplete(batch)) {
      flush();
      closeUserTurn();
      return true;
    }
    // A typed command: close its turn so Gemini generates.
    if (closeUserTurn()) return true;
    // The one instruction that is not a tool follow-up has nothing to ride on,
    // so the nearest Gemini equivalent is a labelled console turn.
    if (instructions === RADIO_START_FAILED_INSTRUCTION) {
      send({
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: `${CONSOLE_INSTRUCTION_PREFIX}${instructions}` }],
            },
          ],
          turnComplete: true,
        },
      });
      return true;
    }
    // Every other follow-up is already covered by the toolResponse that
    // answered its call. Saying so matters: the caller waits for a response to
    // each request it sent, and nothing will arrive for this one.
    return false;
  }

  return {
    /** A toolCall arrived: expect one result per call, answered together. */
    openToolBatch(calls) {
      const usable = (Array.isArray(calls) ? calls : []).filter(
        (call) => call?.id && call?.name,
      );
      if (!usable.length) return;
      batch ??= {
        calls: new Map(),
        outputs: new Map(),
        order: [],
        imageTimer: null,
        maxTimer: null,
      };
      for (const { id, name } of usable) {
        batch.calls.set(id, name);
        finished.delete(id);
      }
      if (batch.maxTimer) clearTimer(batch.maxTimer);
      const current = batch;
      current.maxTimer = setTimer(() => {
        if (batch === current) flush({ forced: true });
      }, maxWaitMs);
    },

    /** Gemini withdrew calls (the user spoke over them): stop waiting on them. */
    cancelToolCalls(ids) {
      if (!batch) return;
      for (const id of Array.isArray(ids) ? ids : []) {
        batch.calls.delete(id);
        batch.outputs.delete(id);
        batch.order = batch.order.filter((known) => known !== id);
        remember(id);
      }
      if (!batch.calls.size) {
        stopTimers(batch);
        batch = null;
        return;
      }
      settle();
    },

    /**
     * Translate one outbound GEV event and write the result through `send`.
     *
     * @returns {boolean} False only for a `response.create` that asked Gemini
     *   for nothing, because the reply it wanted is already on its way.
     */
    forward(event) {
      if (!event || typeof event !== 'object') return true;
      if (
        event.type === 'conversation.item.create' &&
        event.item?.type === 'function_call_output'
      ) {
        forwardToolOutput(event);
        return true;
      }
      if (event.type === 'response.create') return forwardResponseCreate(event);
      const messages = geminiFromRealtimeEvent(event);
      if (
        event.type === 'conversation.item.create' &&
        messages.length &&
        isUserTextTurn(event.item)
      )
        userTurnOpen = true;
      for (const message of messages) send(message);
      return true;
    },

    /** A session ended: drop everything still waiting. */
    reset() {
      stopTimers(batch);
      batch = null;
      userTurnOpen = false;
      finished.clear();
    },
  };
}

/**
 * Build a stateful inbound translator.
 *
 * Gemini has no explicit response lifecycle, so the translator synthesizes
 * `response.created` / `response.done` around each model turn — GEV's turn
 * owner depends on that pairing to track whether a response is active.
 *
 * `translate` also returns `toolCalls` ({id, name} per call) for a toolCall
 * message and `cancelledCalls` (ids) for a toolCallCancellation — only when
 * there is something to report.
 *
 * @returns {{translate: (message: unknown) => {events: object[], audio: string[], toolCalls?: Array<{id: string, name: string}>, cancelledCalls?: string[]}, reset: () => void}}
 */
export function createGeminiInboundTranslator() {
  let responseId = null;
  let transcript = '';

  function openResponse(events) {
    if (responseId) return;
    responseId = nextId('resp');
    transcript = '';
    events.push({
      type: 'response.created',
      event_id: nextId('evt'),
      response: { id: responseId, status: 'in_progress' },
    });
  }

  function closeResponse(events, { status = 'completed', usage = null } = {}) {
    if (!responseId) return;
    if (transcript) {
      events.push({
        type: 'response.output_audio_transcript.done',
        event_id: nextId('evt'),
        response_id: responseId,
        transcript,
      });
    }
    events.push({
      type: 'response.done',
      event_id: nextId('evt'),
      response: {
        id: responseId,
        status,
        // GEV's cost tracker reads this shape. Gemini Live's free tier has no
        // per-token price here, so reported usage is informational only.
        usage: usage || {
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    });
    responseId = null;
    transcript = '';
  }

  return {
    reset() {
      responseId = null;
      transcript = '';
    },

    translate(raw) {
      const message = parseJson(raw);
      const events = [];
      const audio = [];
      if (!message || typeof message !== 'object') return { events, audio };

      if (message.setupComplete) {
        events.push({
          type: 'session.created',
          event_id: nextId('evt'),
          session: { id: nextId('sess') },
        });
        return { events, audio };
      }

      if (message.toolCall) {
        const calls = Array.isArray(message.toolCall.functionCalls)
          ? message.toolCall.functionCalls
          : [];
        // A tool call implies the model is mid-turn even if no audio preceded
        // it, so the response must be open before the call is dispatched.
        if (calls.length) openResponse(events);
        const toolCalls = [];
        for (const call of calls) {
          if (!call?.name) continue;
          const callId = call.id || nextId('call');
          toolCalls.push({ id: callId, name: call.name });
          events.push({
            type: 'response.function_call_arguments.done',
            event_id: nextId('evt'),
            response_id: responseId,
            item_id: callId,
            call_id: callId,
            name: call.name,
            arguments: JSON.stringify(call.args ?? {}),
          });
        }
        // Gemini answers a whole toolCall at once, so the batch is reported
        // alongside the events (see createGeminiOutbound).
        return toolCalls.length
          ? { events, audio, toolCalls }
          : { events, audio };
      }

      if (message.toolCallCancellation) {
        // GEV aborts in-flight tools on interruption already; the ids are
        // reported so a half-collected batch is not answered for dead calls.
        const cancelledCalls = Array.isArray(message.toolCallCancellation.ids)
          ? message.toolCallCancellation.ids.filter(
              (id) => typeof id === 'string' && id,
            )
          : [];
        return cancelledCalls.length
          ? { events, audio, cancelledCalls }
          : { events, audio };
      }

      if (message.goAway) {
        events.push({
          type: 'error',
          event_id: nextId('evt'),
          error: {
            type: 'server_going_away',
            code: 'server_going_away',
            message: 'Gemini Live is closing this session',
          },
        });
        return { events, audio };
      }

      const content = message.serverContent;
      if (!content) return { events, audio };

      if (content.interrupted) {
        // Barge-in: drop queued audio and end the turn as cancelled.
        events.push({
          type: 'output_audio_buffer.cleared',
          event_id: nextId('evt'),
        });
        closeResponse(events, { status: 'cancelled' });
        return { events, audio };
      }

      const inputText = content.inputTranscription?.text;
      if (typeof inputText === 'string' && inputText) {
        events.push({
          type: 'conversation.item.input_audio_transcription.completed',
          event_id: nextId('evt'),
          transcript: inputText,
        });
      }

      const parts = Array.isArray(content.modelTurn?.parts)
        ? content.modelTurn.parts
        : [];
      for (const part of parts) {
        if (!part || typeof part !== 'object') continue;
        const inline = part.inlineData;
        if (
          inline?.data &&
          String(inline.mimeType || '').startsWith('audio/')
        ) {
          openResponse(events);
          audio.push(inline.data);
          continue;
        }
        if (typeof part.text === 'string' && part.text) {
          openResponse(events);
          transcript += part.text;
          events.push({
            type: 'response.output_text.delta',
            event_id: nextId('evt'),
            response_id: responseId,
            delta: part.text,
          });
        }
      }

      const outputText = content.outputTranscription?.text;
      if (typeof outputText === 'string' && outputText) {
        openResponse(events);
        transcript += outputText;
        events.push({
          type: 'response.output_audio_transcript.delta',
          event_id: nextId('evt'),
          response_id: responseId,
          delta: outputText,
        });
      }

      if (content.turnComplete) {
        closeResponse(events, {
          usage: message.usageMetadata
            ? {
                total_tokens: message.usageMetadata.totalTokenCount ?? 0,
                input_tokens: message.usageMetadata.promptTokenCount ?? 0,
                output_tokens: message.usageMetadata.responseTokenCount ?? 0,
              }
            : null,
        });
      }

      return { events, audio };
    },
  };
}
