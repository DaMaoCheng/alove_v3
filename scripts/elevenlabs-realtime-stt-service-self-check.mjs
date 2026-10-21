import assert from "node:assert/strict";
import {
  buildElevenLabsRealtimeSttUrl,
  normalizeElevenLabsRealtimeEvent,
  resolveElevenLabsRealtimeSttConfig,
} from "../server/elevenlabs-realtime-stt-service.js";

const config = resolveElevenLabsRealtimeSttConfig({
  apiKey: "test-key",
  baseUrl: "https://api.elevenlabs.io/v1/",
  model: "scribe_v2_realtime",
});

assert.equal(config.enabled, true);
assert.equal(config.model, "scribe_v2_realtime");
assert.equal(config.baseUrl, "https://api.elevenlabs.io/v1");

const url = buildElevenLabsRealtimeSttUrl({ config, sampleRate: 16000 });
assert.match(url, /^wss:\/\/api\.elevenlabs\.io\/v1\/speech-to-text\/realtime\?/);
assert.match(url, /model_id=scribe_v2_realtime/);
assert.match(url, /sample_rate=16000/);

assert.deepEqual(
  normalizeElevenLabsRealtimeEvent({ type: "partial_transcript", transcript: "hel" }),
  { type: "partial", text: "hel", rawType: "partial_transcript" }
);
assert.deepEqual(
  normalizeElevenLabsRealtimeEvent({ type: "committed_transcript", transcript: "hello" }),
  { type: "final", text: "hello", rawType: "committed_transcript" }
);
assert.equal(normalizeElevenLabsRealtimeEvent({ type: "unknown" }), null);

console.log("ElevenLabs realtime STT service self-check passed");
