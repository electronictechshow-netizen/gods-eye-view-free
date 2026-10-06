// Gemini Live model ids move (2.5 native-audio -> 3.1 -> 3.8 within a year).
// Treat this as a default, not a fact: override with GEMINI_LIVE_MODEL rather
// than editing code when Google renames or retires the id.
const GEMINI_LIVE_MODEL_DEFAULT = 'gemini-3.8-live';

/** Prebuilt Gemini speech voice. Overridable with GEMINI_LIVE_VOICE. */
const GEMINI_LIVE_VOICE_DEFAULT = 'Puck';

/**
 * What someone is told when they press the mic and no Gemini key is set. The
 * fix is free, so the message says where to get it.
 */
const VOICE_KEY_MISSING_MESSAGE =
  'Voice needs a free Gemini key: add GEMINI_API_KEY with the POWER UP button (bottom-right), then restart.';

/** Ephemeral-token mint endpoint. Tokens are Live-API-only and v1beta-only. */
const GEMINI_AUTH_TOKENS_URL =
  'https://generativelanguage.googleapis.com/v1beta/auth_tokens';

/** Live API bidirectional socket. The ephemeral token rides as access_token. */
const GEMINI_LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** How long a minted token may start a new session. */
const GEMINI_NEW_SESSION_WINDOW_MS = 60_000;

/** How long an established session may keep transmitting. */
const GEMINI_TOKEN_LIFETIME_MS = 30 * 60_000;

export {
  GEMINI_AUTH_TOKENS_URL,
  GEMINI_LIVE_MODEL_DEFAULT,
  GEMINI_LIVE_VOICE_DEFAULT,
  GEMINI_LIVE_WS_URL,
  GEMINI_NEW_SESSION_WINDOW_MS,
  GEMINI_TOKEN_LIFETIME_MS,
  VOICE_KEY_MISSING_MESSAGE,
};
