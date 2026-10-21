import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildElevenLabsRealtimeSttUrl, resolveElevenLabsRealtimeSttConfig } from "../server/elevenlabs-realtime-stt-service.js";

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
const modalSource = readFileSync("src/features/call-modal/call-modal.js", "utf8");
const mainSource = readFileSync("src/app/main.js", "utf8");
const appSource = [
  "src/app/main.js",
  "src/app/app-call-actions.js",
  "src/app/app-create-actions.js",
  "src/features/call-modal/call-dom-renderer.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const stylesSource = readFileSync("src/features/app-shell/styles/call-modal.css", "utf8");

assert.match(serverSource, /buildElevenLabsRealtimeSttUrl/, "call backend should use ElevenLabs realtime STT");
assert.match(serverSource, /message_type:\s*"input_audio_chunk"/, "call backend should forward realtime audio chunks");
assert.doesNotMatch(serverSource, /transcribeChatVoice|audio_blob/, "call backend should not use recorded voice model mode");

assert.match(clientSource, /type:\s*"audio_chunk"/, "call client should stream realtime audio chunks");
assert.doesNotMatch(clientSource, /new MediaRecorder|type:\s*"audio_blob"/, "call client should not record fixed voice blobs");
assert.match(clientSource, /this\.stopped/, "call client should guard against late playback after call end");

const url = buildElevenLabsRealtimeSttUrl({
  config: resolveElevenLabsRealtimeSttConfig({ apiKey: "test", baseUrl: "https://api.elevenlabs.io/v1" }),
  sampleRate: 16000,
});
assert.match(url, /commit_strategy=vad/, "realtime STT should use VAD commit");
assert.match(url, /vad_silence_threshold_secs=0\.3/, "VAD silence threshold should be tuned faster");
assert.match(url, /vad_threshold=0\.35/, "VAD sensitivity threshold should be explicit");
assert.match(url, /min_speech_duration_ms=50/, "minimum speech duration should be low");
assert.match(url, /min_silence_duration_ms=50/, "minimum silence duration should be low");

assert.match(modalSource, /call-live-dot/, "call modal should render dot marker");
assert.match(appSource, /call-live-dot/, "call live DOM updates should render dot marker");
assert.doesNotMatch(modalSource, />You<|>AI</, "call modal should not render text labels for speakers");
assert.match(stylesSource, /\.call-live-row\.user/, "user live text should have separate style");
assert.match(stylesSource, /\.call-live-row\.user \.call-live-dot\{\s*order:2/, "user dot should be on the right");
assert.match(stylesSource, /\.call-live-row\.assistant \.call-live-dot/, "assistant dot should be on the left");

assert.doesNotMatch(appSource, /markVoiceMessagesForAutoplay\(appState, appState\.agent, items\)/, "call-created messages should not autoplay in chat");
assert.match(appSource, /unreadByCharacterId\[appState\.agent\]\s*=\s*false/, "call-created messages should be treated as read in current chat");

console.log("call realtime fast VAD self-check passed");
