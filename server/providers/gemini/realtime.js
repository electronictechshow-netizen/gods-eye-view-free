import { toGeminiTools } from '../../../src/voice/geminiTools.js';
import { realtimeInstructions } from '../voice/instructions.js';
import { GEV_REALTIME_TOOLS } from '../voice/tools.js';
import { enforceRateLimit, voiceRateLimiter } from '../voice/rate-limit.js';
import { GEMINI_SOCKET_PATH } from './socket-proxy.js';
import {
  GEMINI_LIVE_MODEL_DEFAULT,
  GEMINI_LIVE_VOICE_DEFAULT,
  VOICE_KEY_MISSING_MESSAGE,
} from './constants.js';

/**
 * A rule the shared instructions already state, repeated where Gemini loses it.
 *
 * "Turn on the radio" means start playing (action "play"). Said alone Gemini
 * follows that; inside a sentence that also asks for something else ("go to the
 * globe view and turn on the radio") it sometimes picks "enable", which only
 * reveals the Radio markers and leaves the user in silence. Sent as a second
 * part so the shared instructions stay byte-for-byte what every transport sees.
 */
const GEMINI_RADIO_REMINDER =
  'Reminder: "turn on", "start", "put on" or "play" the radio, including inside a sentence that also asks for something else, is control_radio with action "play" so audio starts. Use action "enable" only when the user asks to show the Radio layer or its markers.';

/**
 * Compose the Live API ``setup`` frame.
 *
 * Built server-side so the system instructions and the action declarations
 * (the app's actions, plus the catalog tools voice offers when the caller
 * supplies `tools`) are composed in one place; the browser forwards it
 * verbatim through the relay rather than assembling its own tool list.
 */
function geminiSetup({
  model,
  voice,
  annotationGuidance,
  pushToTalk = false,
  tools = GEV_REALTIME_TOOLS,
}) {
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
    // Push-to-talk already knows exactly when the user is speaking, so the
    // client marks the turn with activityStart/activityEnd instead. Verified
    // against the live API: with automatic detection left on, streamed audio
    // was accepted but never transcribed — the turn simply never closed.
    // Open-mic keeps automatic detection, which is what provides turn-taking
    // when nothing else signals the boundaries.
    ...(pushToTalk
      ? {
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true },
          },
        }
      : {}),
    systemInstruction: {
      parts: [
        { text: realtimeInstructions(annotationGuidance) },
        { text: GEMINI_RADIO_REMINDER },
      ],
    },
    tools: toGeminiTools(tools),
    // Both transcriptions are required: GEV shows what the user said and what
    // the assistant replied, and Gemini only emits them when asked.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

/**
 * Hand the browser everything it needs to open a Gemini Live session.
 *
 * No credential is returned. Ephemeral tokens mint successfully but are
 * refused at the Live socket on AI-Studio free-tier keys ("API key not
 * valid"), so the browser instead opens a same-origin socket that this server
 * relays upstream with GEMINI_API_KEY attached — the key stays in this
 * process and never reaches the page.
 */
function createGeminiSessionHandler({
  annotationGuidance,
  tools = GEV_REALTIME_TOOLS,
} = {}) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (!enforceRateLimit(voiceRateLimiter(), req, res)) return;

    const apiKey = String(process.env.GEMINI_API_KEY ?? '').trim();
    if (!apiKey) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: VOICE_KEY_MISSING_MESSAGE }));
      return;
    }

    const model = process.env.GEMINI_LIVE_MODEL || GEMINI_LIVE_MODEL_DEFAULT;
    const voice = process.env.GEMINI_LIVE_VOICE || GEMINI_LIVE_VOICE_DEFAULT;
    // The turn-detection mode has to be fixed in the setup frame, so the
    // client states which one it is opening.
    const pushToTalk = (() => {
      try {
        return (
          new URL(req.url || '', 'http://localhost').searchParams.get(
            'mode',
          ) === 'push-to-talk'
        );
      } catch {
        return false;
      }
    })();

    res.statusCode = 200;
    res.setHeader('X-GEV-Voice-Model', model);
    res.setHeader('X-GEV-Voice-Provider', 'gemini');
    res.end(
      JSON.stringify({
        provider: 'gemini',
        model,
        // Same-origin and relative: the client resolves the ws:// or wss://
        // scheme from the page it is served on.
        socketPath: GEMINI_SOCKET_PATH,
        pushToTalk,
        setup: geminiSetup({
          model,
          voice,
          annotationGuidance,
          pushToTalk,
          tools,
        }),
      }),
    );
  };
}

export { createGeminiSessionHandler, geminiSetup };
