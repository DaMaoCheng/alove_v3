import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const entryPath = "server/call-realtime-service.js";
const sessionPath = "server/call-session-service.js";
const providerPath = "server/call-provider-socket-service.js";
const turnPath = "server/call-turn-service.js";
const diagnosticsPath = "server/call-diagnostics-service.js";
const inputGuardPath = "server/call-input-guard-service.js";

for (const path of [entryPath, sessionPath, providerPath, turnPath, diagnosticsPath, inputGuardPath]) {
  assert.ok(existsSync(path), `call backend split file should exist: ${path}`);
}

const entry = readFileSync(entryPath, "utf8");
assert.match(entry, /createRealtimeCallService/, "entry should keep createRealtimeCallService");
assert.match(entry, /handleFinalTranscript/, "entry should dispatch final transcripts through turn module");
assert.doesNotMatch(entry, /function handleFinalTranscript/, "entry should not own final transcript implementation");
assert.doesNotMatch(entry, /function connectProviderSocket/, "entry should not own provider socket implementation");
assert.doesNotMatch(entry, /function logCallTurnTiming/, "entry should not own diagnostics implementation");
assert.ok(entry.split(/\r?\n/).length <= 240, "call realtime entry should remain bounded after split");

const session = readFileSync(sessionPath, "utf8");
for (const name of ["createCallSession", "closeCallSession", "sendEvent", "sendErrorEvent", "throwUserError", "safeString"]) {
  assert.match(session, new RegExp(`export function ${name}`), `session module should export ${name}`);
}

const provider = readFileSync(providerPath, "utf8");
for (const name of ["connectProviderSocket", "sendAudioChunkToProvider", "resetProviderSocketForNextTurn"]) {
  assert.match(provider, new RegExp(`export (async )?function ${name}`), `provider module should export ${name}`);
}
assert.match(provider, /buildElevenLabsRealtimeSttUrl/, "provider module should own ElevenLabs realtime connection");
assert.match(provider, /audio_chunk_forwarded/, "provider module should keep audio forwarded diagnostics");

const turn = readFileSync(turnPath, "utf8");
assert.match(turn, /export async function handleFinalTranscript/, "turn module should export final transcript handler");
assert.match(turn, /createUserMessage\(/, "turn module should create user messages");
assert.match(turn, /createUserReply\(/, "turn module should create AI replies");
assert.match(turn, /VOICE_MODEL_MODE_REALTIME_CALL_FAST/, "turn module should keep fast voice mode");
assert.match(turn, /completedTurnIds/, "turn module should preserve completed turn guard");
assert.match(turn, /stale_turn_ignored/, "turn module should preserve stale turn diagnostics");

const diagnostics = readFileSync(diagnosticsPath, "utf8");
assert.match(diagnostics, /export function logCallTurnTiming/, "diagnostics module should export timing log");
assert.match(diagnostics, /export function logCallAudioEvent/, "diagnostics module should export audio log");
assert.match(diagnostics, /\[aiove\]\[call-timing\]/, "diagnostics module should keep timing log tag");
assert.match(diagnostics, /\[aiove\]\[call-audio\]/, "diagnostics module should keep audio log tag");

const inputGuard = readFileSync(inputGuardPath, "utf8");
assert.match(inputGuard, /parseAndValidateCallClientMessage/, "input guard should validate websocket events");
assert.match(inputGuard, /consumeCallAudioInput/, "input guard should enforce audio payload and rate limits");
assert.match(inputGuard, /assertGuestCallProviderGuard/, "input guard should bound idle guest Provider connections without limiting normal call duration");

console.log("call realtime backend split self-check passed");
