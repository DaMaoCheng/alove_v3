import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSource = [
  "src/features/call-modal/call-realtime-client.js",
  "src/features/call-modal/call-state-machine.js",
  "src/features/call-modal/call-audio-capture.js",
  "src/features/call-modal/call-websocket-client.js",
  "src/features/call-modal/call-playback-guard.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const serverSource = [
  "server/call-realtime-service.js",
  "server/call-session-service.js",
  "server/call-provider-socket-service.js",
  "server/call-turn-service.js",
  "server/call-diagnostics-service.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const deploymentSource = readFileSync("scripts/deployment-check.mjs", "utf8");

assert.match(clientSource, /CALL_STATES/, "frontend should define explicit call states");
assert.match(clientSource, /beginListeningTurn/, "frontend should begin isolated listening turns");
assert.match(clientSource, /finishListeningTurn/, "frontend should finish one listening turn before assistant reply");
assert.match(clientSource, /shouldSendAudioFrame/, "frontend should centralize realtime audio send conditions");
assert.match(clientSource, /maybeSendAudioProbe/, "frontend should emit audio boundary diagnostics while debugging call capture");
assert.match(clientSource, /audio_probe/, "frontend should report whether audio processing is running");
assert.doesNotMatch(clientSource, /LOCAL_GATE_/, "frontend should not use local RMS gate until realtime capture is stable again");
assert.match(clientSource, /turnId/, "frontend should send turnId with audio chunks");

assert.match(serverSource, /activeTurnId/, "backend should track one active turn");
assert.match(serverSource, /completedTurnIds/, "backend should reject repeated final transcripts per turn");
assert.match(serverSource, /resetProviderSocketForNextTurn/, "backend should reset STT socket between turns");
assert.match(serverSource, /payload\.turnId/, "backend should read turnId from client audio chunks");
assert.match(serverSource, /stale_turn_ignored/, "backend should expose stale turn ignore diagnostics");
assert.match(serverSource, /\[aiove\]\[call-audio\]/, "backend should expose realtime audio boundary diagnostics");
assert.match(serverSource, /audio_chunk_forwarded/, "backend should log when audio reaches provider");

assert.match(deploymentSource, /call-turn-isolation-self-check\.mjs/, "deployment check should include turn isolation self-check");

console.log("call turn isolation self-check passed");
