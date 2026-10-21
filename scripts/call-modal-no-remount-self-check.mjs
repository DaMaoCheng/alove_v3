import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mainSource = readFileSync("src/app/main.js", "utf8");
const appSource = [
  "src/app/main.js",
  "src/app/app-call-actions.js",
  "src/app/app-create-actions.js",
  "src/features/call-modal/call-client-event-state.js",
  "src/features/call-modal/call-dom-renderer.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const modalSource = readFileSync("src/features/call-modal/call-modal.js", "utf8");
const stylesSource = readFileSync("src/features/app-shell/styles/call-modal.css", "utf8");
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

const handlerMatch = appSource.match(/function handleCallClientEvent\(event = \{\}\) \{[\s\S]*?\n\}/);
assert.ok(handlerMatch, "app call module should define handleCallClientEvent");
assert.doesNotMatch(handlerMatch[0], /mountApp\(\)/, "call status events should not remount the whole app");
assert.match(appSource, /domRenderer\.updateModal\(\)/, "call state should update the existing modal DOM");
assert.match(appSource, /function updateModal\(\)/, "call DOM renderer should own in-place modal updates");
assert.match(appSource, /mergeChatMessages\(appState\.chat\.messages/, "call results should merge into chat messages");
assert.match(serverSource, /user_message/, "call backend should emit user message before assistant reply completes");
assert.match(clientSource, /payload\.type === "user_message"/, "call client should handle user_message events");

assert.match(modalSource, /speaker === "user"/, "call modal should branch user transcript style");
assert.match(modalSource, /"assistant"/, "call modal should branch assistant transcript style");
assert.match(stylesSource, /\.call-live-row\.user/, "user call transcript style should exist");
assert.match(stylesSource, /\.call-live-row\.assistant/, "assistant call transcript style should exist");

console.log("call modal no-remount self-check passed");
