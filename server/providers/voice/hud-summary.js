import {
  HUD_SUMMARY_INSTRUCTIONS as SHARED_HUD_SUMMARY_INSTRUCTIONS,
  keylessHudSummaryResponse,
} from '../../../src/hudSummaryResponse.js';
import { enforceRateLimit, voiceRateLimiter } from './rate-limit.js';
import { readRequestBody } from '../common/request.js';
import {
  GROQ_CHAT_COMPLETIONS_URL,
  GROQ_HUD_SUMMARY_MODEL_DEFAULT,
} from './constants.js';

/**
 * The shared HUD_SUMMARY_INSTRUCTIONS (feed provenance included), plus one rule
 * for the small open models on Groq's free tier, which loop on a thin context.
 */
const HUD_SUMMARY_INSTRUCTIONS = `${SHARED_HUD_SUMMARY_INSTRUCTIONS} Never repeat a word. With no named place, describe the view scale and the enabled layers.`;

function extractChatCompletionText(data) {
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  return String(choices[0]?.message?.content ?? '').trim();
}

/**
 * The configured HUD summary provider: Groq, on its free tier. With no
 * GROQ_API_KEY there is no provider and the HUD shows its plain built-in
 * summary instead.
 */
function resolveHudSummaryProvider(env = process.env) {
  const groqKey = String(env.GROQ_API_KEY ?? '').trim();
  if (groqKey) {
    return {
      name: 'groq',
      apiKey: groqKey,
      url: GROQ_CHAT_COMPLETIONS_URL,
      model: env.GROQ_HUD_SUMMARY_MODEL || GROQ_HUD_SUMMARY_MODEL_DEFAULT,
      extract: extractChatCompletionText,
      body: (model, context) => ({
        model,
        messages: [
          { role: 'system', content: HUD_SUMMARY_INSTRUCTIONS },
          { role: 'user', content: JSON.stringify(context) },
        ],
        // Groq's free tier serves reasoning models (gpt-oss, Qwen). Reasoning
        // tokens are drawn from max_tokens BEFORE any content, so a tight
        // budget returns finish_reason:"length" with an empty message. Cap the
        // thinking and leave real headroom; five words cost almost nothing.
        reasoning_effort: 'low',
        max_tokens: 512,
        temperature: 0.2,
      }),
    };
  }

  return null;
}

function toFiveWordHudSummary(value) {
  const words = String(value || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Small open models loop on a thin context ("SATELLITES SATELLITES
  // SATELLITES"). Keep each word once; a layer-only answer reads "IN VIEW".
  const seen = new Set();
  const unique = words.filter((word) => {
    const key = word.toLowerCase().replace(/s$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length && unique.length < 3) unique.push('IN', 'VIEW');
  return unique.slice(0, 5).join(' ');
}

export { toFiveWordHudSummary };

async function handleHudSummary(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const provider = resolveHudSummaryProvider();
  const keyless = keylessHudSummaryResponse(provider?.apiKey);
  if (keyless) {
    res.statusCode = keyless.statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(keyless.payload));
    return;
  }

  // Per-IP throttle (GEV_RATELIMIT_VOICE_PER_MIN). On by default; 0 disables.
  // The keyless HUD fallback calls no provider and resolves above without
  // using a quota slot.
  if (!enforceRateLimit(voiceRateLimiter(), req, res)) return;

  try {
    const body = await readRequestBody(req, 64 * 1024);
    const context = JSON.parse(body || '{}');
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(provider.body(provider.model, context)),
    });
    const data = await response.json().catch(() => ({}));
    const summary = toFiveWordHudSummary(provider.extract(data));
    res.statusCode = response.ok && summary ? 200 : response.status || 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (!response.ok)
      console.warn(`[hud-summary] upstream HTTP ${response.status}`);
    res.end(
      JSON.stringify({
        summary: summary || null,
        // Never relay the provider's own error wording: it can carry request
        // ids, account hints and quota phrasing.
        error: response.ok
          ? null
          : `${provider.name} HUD summary request failed`,
      }),
    );
  } catch {
    console.warn('[hud-summary] request failed');
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: `${provider.name} HUD summary request failed`,
      }),
    );
  }
}

export { handleHudSummary };
