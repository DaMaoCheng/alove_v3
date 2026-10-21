import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildElevenLabsSttForm,
  buildElevenLabsSttRequest,
  resolveElevenLabsSttConfig,
} from "../server/elevenlabs-stt-service.js";

const config = resolveElevenLabsSttConfig({
  apiKey: "test-key",
  baseUrl: "https://api.elevenlabs.io/v1/",
  model: "scribe_v2",
  timeoutMs: 12000,
});

assert.equal(config.enabled, true);
assert.equal(config.baseUrl, "https://api.elevenlabs.io/v1");
assert.equal(config.model, "scribe_v2");
assert.equal(config.timeoutMs, 12000);

const audioBuffer = Buffer.from("fake-audio");
const form = buildElevenLabsSttForm({
  config,
  buffer: audioBuffer,
  filename: "voice.webm",
  mimeType: "audio/webm",
});

assert.equal(form.get("model_id"), "scribe_v2");
assert.equal(form.get("tag_audio_events"), "false");
assert.equal(form.get("diarize"), "false");
assert.equal(form.get("file_format"), "other");
assert.equal(form.get("file").name, "voice.webm");
assert.equal(form.get("file").type, "audio/webm");

const request = buildElevenLabsSttRequest({ config, form });
assert.equal(request.url, "https://api.elevenlabs.io/v1/speech-to-text");
assert.equal(request.headers["xi-api-key"], "test-key");
assert.equal(request.options.method, "POST");
assert.equal(request.options.body, form);

const routesSource = readFileSync("server/chat-routes.js", "utf8");
assert.match(routesSource, /from\s+["']\.\/elevenlabs-stt-service\.js["']/, "chat voice route should use ElevenLabs STT");
assert.equal(
  (routesSource.match(/transcribeChatVoice/g) || []).length,
  2,
  "chat voice route should only import and call the active STT service"
);

const envExample = readFileSync(".env.example", "utf8");
assert.match(envExample, /ELEVENLABS_STT_MODEL=scribe_v2/, "env example should document ElevenLabs STT model");

const disabled = resolveElevenLabsSttConfig({ apiKey: "" });
assert.equal(disabled.enabled, false);

console.log("ElevenLabs STT service self-check passed");
