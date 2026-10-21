import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = [
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
const appSource = [
  "src/app/main.js",
  "src/app/app-call-actions.js",
  "src/app/app-create-actions.js",
  "src/features/call-modal/call-client-event-state.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const modalSource = readFileSync("src/features/call-modal/call-modal.js", "utf8");
const stylesSource = readFileSync("src/features/app-shell/styles/call-modal.css", "utf8");
const viewFactorySource = readFileSync("src/app/app-view-factory.js", "utf8");

assert.match(serverSource, /stageStartedAt/, "server should capture per-turn stage start time");
assert.match(serverSource, /userMessageMs/, "server should report user-message write timing");
assert.match(serverSource, /replyTotalMs/, "server should report reply generation timing");
assert.match(serverSource, /timing/, "server call events should include timing payloads");
assert.match(serverSource, /logCallTurnTiming/, "server should log call turn timings for local diagnostics");
assert.match(serverSource, /\[aiove\]\[call-timing\]/, "server call timing log should be easy to grep");

assert.match(clientSource, /turnStartedAt/, "client should track turn start time");
assert.match(clientSource, /transcriptFinalAt/, "client should track final transcript time");
assert.match(clientSource, /assistantAudioAt/, "client should track assistant audio arrival time");
assert.match(clientSource, /diagnostics/, "client should emit diagnostics to app state");

assert.match(appSource, /latencyText/, "app call state should store latency text");
assert.match(appSource, /formatCallLatencyText/, "app should format call latency diagnostics");
assert.match(viewFactorySource, /latencyText: appState\.call\.latencyText/, "view factory should pass latency text");
assert.match(modalSource, /callLatency/, "call modal should render latency text");
assert.match(stylesSource, /\.call-latency/, "call modal should style latency text");

console.log("call latency diagnostics self-check passed");
