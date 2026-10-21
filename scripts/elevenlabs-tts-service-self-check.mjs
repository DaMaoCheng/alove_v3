import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";

const {
  buildElevenLabsTtsRequest,
  generateElevenLabsSpeech,
  resolveElevenLabsTtsConfig,
} = await import("../server/elevenlabs-tts-service.js");

const config = resolveElevenLabsTtsConfig({
  apiKey: "test-key",
  baseUrl: "https://api.elevenlabs.io/v1/",
  qualityModel: "eleven_v3",
  fastModel: "eleven_flash_v2_5",
  outputFormat: "mp3_44100_128",
  timeoutMs: 8000,
  maxRetries: 2,
});

assert.equal(config.enabled, true);
assert.equal(config.baseUrl, "https://api.elevenlabs.io/v1");
assert.equal(config.qualityModel, "eleven_v3");
assert.equal(config.fastModel, "eleven_flash_v2_5");
assert.equal(config.outputFormat, "mp3_44100_128");
assert.equal(config.maxRetries, 2);

const outputDir = await mkdtemp(join(tmpdir(), "alove-elevenlabs-tts-self-check-"));
try {
  let attempts = 0;
  const retried = await generateElevenLabsSpeech({
    config: resolveElevenLabsTtsConfig({
      ...config,
      outputDir,
      publicPath: "/self-check-voice",
      maxRetries: 2,
    }),
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    text: "Retry twice before succeeding.",
    outputFileName: "retry-success.mp3",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts <= 2) throw Object.assign(new Error("synthetic timeout"), { name: "AbortError" });
      return new Response(Buffer.from("synthetic-audio"), { status: 200, headers: { "content-type": "audio/mpeg" } });
    },
  });
  assert.equal(attempts, 3, "TTS should make the initial request plus two timeout retries");
  assert.equal(retried.status, "ready");

  let exhaustedAttempts = 0;
  await assert.rejects(
    () => generateElevenLabsSpeech({
      config: resolveElevenLabsTtsConfig({ ...config, outputDir, maxRetries: 2 }),
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      text: "Stop after the retry budget.",
      outputFileName: "retry-failed.mp3",
      fetchImpl: async () => {
        exhaustedAttempts += 1;
        throw Object.assign(new Error("synthetic timeout"), { name: "AbortError" });
      },
    }),
    (error) => {
      assert.equal(error.retryCount, 2, "final TTS error should expose two completed retries");
      return true;
    }
  );
  assert.equal(exhaustedAttempts, 3, "TTS should stop after two retries");

  let nonRetryableAttempts = 0;
  await assert.rejects(
    () => generateElevenLabsSpeech({
      config: resolveElevenLabsTtsConfig({ ...config, outputDir, maxRetries: 2 }),
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      text: "Do not retry a client error.",
      outputFileName: "non-retryable.mp3",
      fetchImpl: async () => {
        nonRetryableAttempts += 1;
        return new Response(JSON.stringify({ detail: "invalid voice" }), { status: 400 });
      },
    }),
    /ElevenLabs TTS failed: HTTP 400/
  );
  assert.equal(nonRetryableAttempts, 1, "TTS should not retry a non-retryable client error");
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

const request = buildElevenLabsTtsRequest({
  config,
  voiceId: "EXAVITQu4vr4xnSDxMaL",
  text: "The first move sets everything in motion.",
  model: "eleven_v3",
});

assert.equal(
  request.url,
  "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128"
);
assert.equal(request.headers["xi-api-key"], "test-key");
assert.equal(request.headers["Content-Type"], "application/json");
assert.deepEqual(JSON.parse(request.body), {
  text: "The first move sets everything in motion.",
  model_id: "eleven_v3",
});

const flashRequest = buildElevenLabsTtsRequest({
  config,
  voiceId: "EXAVITQu4vr4xnSDxMaL",
  text: "Fast call audio.",
  model: "eleven_flash_v2_5",
});

assert.deepEqual(JSON.parse(flashRequest.body), {
  text: "Fast call audio.",
  model_id: "eleven_flash_v2_5",
});

const turboConfig = resolveElevenLabsTtsConfig({ ...config, qualityModel: "eleven_v4_turbo", fastModel: "eleven_v4_turbo" });
const turboRequest = buildElevenLabsTtsRequest({ config: turboConfig, voiceId: "EXAVITQu4vr4xnSDxMaL", text: "[thoughtful] Let's talk." });
assert.equal(turboRequest.url, request.url, "Turbo should preserve the voice and output format");
assert.deepEqual(JSON.parse(turboRequest.body), { text: "[thoughtful] Let's talk.", model_id: "eleven_v4_turbo" });

const disabled = resolveElevenLabsTtsConfig({ apiKey: "" });
assert.equal(disabled.enabled, false);

console.log("ElevenLabs TTS service self-check passed");
