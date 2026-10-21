import assert from "node:assert/strict";
import { normalizeReplyVoiceMeta } from "../server/ai-reply-service.js";

const normalized = normalizeReplyVoiceMeta(
  {
    languageCode: "en",
    languageLabel: "English",
    provider: "unknown",
    model: "unknown",
    voiceId: "unknown",
  },
  {
    fallbackLanguageCode: "en",
    fallbackLanguageLabel: "English",
    fallbackProvider: "elevenlabs",
    fallbackModel: "eleven_v3",
    fallbackVoiceId: "IKne3meq5aSn9XLyUdCD",
  }
);

assert.deepEqual(normalized, {
  languageCode: "en",
  languageLabel: "English",
  provider: "elevenlabs",
  model: "eleven_v3",
  voiceId: "IKne3meq5aSn9XLyUdCD",
});

const fallbackOnly = normalizeReplyVoiceMeta(
  {},
  {
    fallbackProvider: "elevenlabs",
    fallbackModel: "eleven_v3",
    fallbackVoiceId: "voice_backend",
  }
);

assert.equal(fallbackOnly.provider, "elevenlabs");
assert.equal(fallbackOnly.model, "eleven_v3");
assert.equal(fallbackOnly.voiceId, "voice_backend");
assert.equal(fallbackOnly.languageCode, "en");
assert.equal(fallbackOnly.languageLabel, "English");

console.log("chat reply voice meta self-check passed");
