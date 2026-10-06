// Free-tier provider for the AI HUD summary. Groq serves a chat-completions
// API, so the request needs only an endpoint, a model and a response shape.
//
// Groq rotates which models the free tier may call — the Llama models were
// moved to enterprise-only on 2026-08-16 and now 404 for free keys. Verify
// against https://api.groq.com/openai/v1/models before changing this, and
// override with GROQ_HUD_SUMMARY_MODEL rather than editing code.
//
// (The `openai/` in the model id and in the URL path below is Groq's own
// naming: an open-weight model hosted by Groq, and Groq's API path.)
const GROQ_HUD_SUMMARY_MODEL_DEFAULT = 'openai/gpt-oss-20b';

const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions';

export { GROQ_CHAT_COMPLETIONS_URL, GROQ_HUD_SUMMARY_MODEL_DEFAULT };
