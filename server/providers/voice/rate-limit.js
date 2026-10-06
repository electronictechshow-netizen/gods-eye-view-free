import { makeCostRateLimiter, clientKey } from '../common/rate-limit.js';

/**
 * Requests/min/IP applied when GEV_RATELIMIT_VOICE_PER_MIN is unset. The HUD
 * asks for a summary every 15s (HUD_SUMMARY_INTERVAL_MS), so an open tab
 * spends 4/min and a voice session adds one session request; the cap clears
 * ordinary use several times over and bites only a caller working the
 * endpoints far harder than the app does.
 */
const VOICE_DEFAULT_PER_MIN = 30;

// Built LAZILY on first request, NOT at module load: `.env` values are applied to process.env later
// (the plugin config hook calls loadEnv → process.env, AFTER this module is imported), so reading
// process.env here at import time would always see them unset and fall back to the default even when
// configured via .env. Building on first request (like the API-key reads) sees the loaded env;
// the result is cached so the limiter's per-IP window state persists. `null` = the explicit 0 opt-out.
let _voiceRateLimiter;

/** Voice session + AI HUD summary endpoints (GEV_RATELIMIT_VOICE_PER_MIN). Null only when set to 0. */
function voiceRateLimiter() {
  if (_voiceRateLimiter === undefined)
    _voiceRateLimiter = makeCostRateLimiter(
      process.env.GEV_RATELIMIT_VOICE_PER_MIN,
      VOICE_DEFAULT_PER_MIN,
    );
  return _voiceRateLimiter;
}

/**
 * Apply the limiter to a request, writing a 429 when over the cap.
 * When `limiter` is null — the explicit `0` opt-out — this is a no-op
 * returning `true`, so the handler proceeds unthrottled.
 *
 * @param {((key:string)=>boolean)|null} limiter
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean} True if the request may proceed; false if a 429 was sent.
 */
function enforceRateLimit(limiter, req, res) {
  if (!limiter) return true; // explicit 0 opt-out — unthrottled
  if (limiter(clientKey(req))) return true;
  res.statusCode = 429;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Retry-After', '5');
  res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
  return false;
}

export { enforceRateLimit, voiceRateLimiter, VOICE_DEFAULT_PER_MIN };
