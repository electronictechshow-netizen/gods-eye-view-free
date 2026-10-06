#!/usr/bin/env node
/**
 * voice-check.mjs — prove the free Gemini voice agent works, no microphone needed.
 *
 * With `npm run dev` running in another window, this opens the same session the
 * GEV MIC button opens (same server-side setup frame, same 28 actions, same
 * relay that keeps GEMINI_API_KEY inside the local server), sends one TYPED
 * request, and prints the actions the agent decides to call plus its spoken
 * reply as text. Nothing is changed in the running app: the actions are
 * acknowledged here, not executed.
 *
 *   npm run voice:check
 *   npm run voice:check -- "Show me the International Space Station"
 */
import WebSocket from 'ws';

const PORT = process.env.PORT || 4173;
const BASE = process.env.QA_BASE_URL || `http://localhost:${PORT}`;
const request =
  process.argv.slice(2).join(' ').trim() ||
  'Take me to Tokyo and turn on flights.';

function fail(message) {
  console.error(`voice check failed: ${message}`);
  process.exit(1);
}

let session;
try {
  const response = await fetch(`${BASE}/api/realtime/gemini-session`);
  session = await response.json();
  if (!response.ok) fail(session.error || `HTTP ${response.status}`);
} catch (error) {
  fail(`could not reach ${BASE} (is npm run dev running?) ${error.message}`);
}

const tools = session.setup?.tools?.[0]?.functionDeclarations?.length ?? 0;
console.log(
  `provider: ${session.provider}   model: ${session.model}   actions: ${tools}`,
);
console.log(`you: "${request}"`);

const socketUrl = BASE.replace(/^http/, 'ws') + session.socketPath;
const socket = new WebSocket(socketUrl);
const started = Date.now();
let reply = '';
let turns = 0;
const timer = setTimeout(() => fail('no answer within 45 s'), 45_000);

socket.on('open', () => socket.send(JSON.stringify({ setup: session.setup })));
socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.setupComplete) {
    console.log(`session open in ${Date.now() - started} ms`);
    socket.send(JSON.stringify({ realtimeInput: { text: request } }));
  }
  if (message.toolCall) {
    const calls = message.toolCall.functionCalls || [];
    for (const call of calls)
      console.log(
        `agent action: ${call.name} ${JSON.stringify(call.args || {})}`,
      );
    socket.send(
      JSON.stringify({
        toolResponse: {
          functionResponses: calls.map((call) => ({
            id: call.id,
            name: call.name,
            response: { ok: true },
          })),
        },
      }),
    );
  }
  const content = message.serverContent;
  if (content?.outputTranscription?.text)
    reply += content.outputTranscription.text;
  if (content?.turnComplete && (reply || ++turns >= 2)) {
    if (reply) console.log(`agent says: "${reply.trim()}"`);
    console.log(`voice check passed in ${Date.now() - started} ms`);
    clearTimeout(timer);
    socket.close();
  }
  if (message.error) fail(JSON.stringify(message.error));
});
socket.on('close', () => process.exit(0));
socket.on('error', (error) => fail(error.message));
