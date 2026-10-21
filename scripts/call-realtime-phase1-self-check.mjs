import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("server/server.js", "utf8");
const callSource = readFileSync("server/call-realtime-service.js", "utf8");
const callBackendSource = [
  "server/call-realtime-service.js",
  "server/call-session-service.js",
  "server/call-provider-socket-service.js",
  "server/call-turn-service.js",
  "server/call-diagnostics-service.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const clientSource = [
  "src/features/call-modal/call-realtime-client.js",
  "src/features/call-modal/call-state-machine.js",
  "src/features/call-modal/call-audio-capture.js",
  "src/features/call-modal/call-websocket-client.js",
  "src/features/call-modal/call-playback-guard.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const modalSource = readFileSync("src/features/call-modal/call-modal.js", "utf8");

assert.match(serverSource, /createRealtimeCallService\(\{\s*server\s*\}\)/, "server should attach realtime call websocket service");
assert.match(callSource, /pathname\s*!==\s*["']\/ws\/call["']/, "call websocket should use /ws/call");
for (const eventName of ["call_ready", "transcript_final", "assistant_thinking", "assistant_audio", "listening", "error", "call_ended"]) {
  assert.match(callBackendSource, new RegExp(eventName), `backend should emit ${eventName}`);
}
assert.match(callBackendSource, /createUserMessage\(/, "final transcript should enter the normal user message chain");
assert.match(callBackendSource, /createUserReply\(/, "call replies should reuse the existing reply chain");
assert.match(callBackendSource, /VOICE_MODEL_MODE_REALTIME_CALL_FAST/, "call replies should request realtime fast TTS mode explicitly");
assert.match(callBackendSource, /ttsModel/, "call timing logs should expose selected TTS model");
assert.doesNotMatch(callBackendSource, /writeFile|createWriteStream|uploads\/voice\/user/, "call service must not persist raw user audio");

assert.match(clientSource, /new WebSocket\([^)]*\/ws\/call/, "frontend call client should connect to /ws/call");
assert.match(clientSource, /echoCancellation:\s*true/, "microphone capture should request echo cancellation");
assert.match(clientSource, /noiseSuppression:\s*true/, "microphone capture should request noise suppression");
assert.match(clientSource, /type:\s*["']audio_chunk["']/, "frontend should stream realtime audio chunks");
assert.match(clientSource, /POST_SPEAK_DELAY_MS\s*=\s*200/, "assistant playback should wait 200ms before listening resumes");
assert.match(clientSource, /type:\s*["']resume_listening["']/, "frontend should tell backend to resume listening after playback");
assert.doesNotMatch(clientSource, /barge/i, "phase 1 should not implement barge-in interruption yet");

assert.match(modalSource, /callStatusText/, "call modal should render realtime call status text");
assert.match(modalSource, /onStartCall/, "call modal should start realtime call after mount");

console.log("realtime call phase 1 self-check passed");
