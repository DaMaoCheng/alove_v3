import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const entryPath = "src/features/call-modal/call-realtime-client.js";
const statePath = "src/features/call-modal/call-state-machine.js";
const audioPath = "src/features/call-modal/call-audio-capture.js";
const websocketPath = "src/features/call-modal/call-websocket-client.js";
const playbackPath = "src/features/call-modal/call-playback-guard.js";
const diagnosticsPath = "src/features/call-modal/call-client-diagnostics.js";

for (const path of [entryPath, statePath, audioPath, websocketPath, playbackPath, diagnosticsPath]) {
  assert.ok(existsSync(path), `call frontend split file should exist: ${path}`);
}

const entry = readFileSync(entryPath, "utf8");
assert.match(entry, /export class RealtimeCallClient/, "entry should keep public RealtimeCallClient");
assert.match(entry, /beginListeningTurn/, "entry should keep listening turn orchestration");
assert.match(entry, /handleSocketMessage/, "entry should keep backend event dispatch");
assert.doesNotMatch(entry, /function resampleFloat32/, "entry should not own resampling implementation");
assert.doesNotMatch(entry, /function convertFloat32ToPcm16/, "entry should not own PCM encoding implementation");
assert.doesNotMatch(entry, /function arrayBufferToBase64/, "entry should not own base64 implementation");
assert.doesNotMatch(entry, /function calculateRms/, "entry should not own RMS implementation");
assert.doesNotMatch(entry, /new WebSocket\(/, "entry should not own websocket construction");
assert.ok(entry.split(/\r?\n/).length <= 280, "call realtime client should be substantially smaller after split");

const state = readFileSync(statePath, "utf8");
assert.match(state, /export const CALL_STATES/, "state module should export CALL_STATES");
assert.match(state, /LISTENING/, "state module should keep listening state");
assert.match(state, /SPEAKING/, "state module should keep speaking state");

const audio = readFileSync(audioPath, "utf8");
assert.match(audio, /export (async )?function createCallAudioCapture/, "audio module should create microphone capture");
assert.match(audio, /echoCancellation:\s*true/, "audio module should keep echo cancellation");
assert.match(audio, /noiseSuppression:\s*true/, "audio module should keep noise suppression");
assert.match(audio, /TARGET_SAMPLE_RATE\s*=\s*16000/, "audio module should keep target sample rate");
assert.match(audio, /resampleFloat32/, "audio module should own resampling");
assert.match(audio, /convertFloat32ToPcm16/, "audio module should own PCM conversion");
assert.match(audio, /calculateRms/, "audio module should own RMS calculation");

const websocket = readFileSync(websocketPath, "utf8");
assert.match(websocket, /export function openCallSocket/, "websocket module should open call sockets");
assert.match(websocket, /new WebSocket\([^)]*\/ws\/call/, "websocket module should connect to /ws/call");
assert.match(websocket, /type:\s*"start_call"/, "websocket module should send start_call");
assert.match(websocket, /export function sendSocketEvent/, "websocket module should send socket events");

const playback = readFileSync(playbackPath, "utf8");
assert.match(playback, /POST_SPEAK_DELAY_MS\s*=\s*200/, "playback module should keep post-speak delay");
assert.match(playback, /ASSISTANT_RESUME_GUARD_MS/, "playback module should keep resume guard");
assert.match(playback, /export function getAssistantResumeGuardDelay/, "playback module should calculate resume guard delay");

const diagnostics = readFileSync(diagnosticsPath, "utf8");
assert.match(diagnostics, /export function emitCallDiagnostics/, "diagnostics module should own client timing projection");

console.log("call realtime frontend split self-check passed");
