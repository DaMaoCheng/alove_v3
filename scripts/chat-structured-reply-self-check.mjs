import assert from "node:assert/strict";
import {
  parseStructuredChatReply,
  buildPlainTextStructuredReply,
} from "../server/chat-reply-structure-service.js";

const structured = parseStructuredChatReply(
  JSON.stringify({
    displayText: "That kit suits your derby mood.",
    speechText: "That kit suits your derby mood. Clean choice.",
    voiceMeta: {
      languageCode: "en",
      languageLabel: "English",
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "voice_123",
    },
  }),
  {
    fallbackLanguageCode: "en",
    fallbackLanguageLabel: "English",
    fallbackVoiceId: "voice_fallback",
  }
);

assert.equal(structured.displayText, "That kit suits your derby mood.", "the explicit display channel must not be overwritten by extra speech content");
assert.equal(structured.text, "That kit suits your derby mood.", "visible reply should remain compatible with reply.text");
assert.equal(structured.speechText, "That kit suits your derby mood. Clean choice.");
assert.equal(structured.voiceMeta.languageCode, "en");
assert.equal(structured.voiceMeta.languageLabel, "English");
assert.equal(structured.voiceMeta.provider, "elevenlabs");
assert.equal(structured.voiceMeta.model, "eleven_v3");
assert.equal(structured.voiceMeta.voiceId, "voice_123");
assert.equal(structured.structured, true);

const fenced = parseStructuredChatReply(
  "```json\n{\"displayText\":\"Visible only\",\"speechText\":\"Voice only\",\"voiceMeta\":{\"languageCode\":\"ja\"}}\n```",
  {
    fallbackLanguageCode: "en",
    fallbackLanguageLabel: "English",
    fallbackVoiceId: "voice_fallback",
  }
);
assert.equal(fenced.displayText, "Visible only", "different channel meanings remain visible to the complete independent review");
assert.equal(fenced.speechText, "Voice only");
assert.equal(fenced.voiceMeta.languageCode, "ja");
assert.doesNotMatch(fenced.displayText, /speechText|voiceMeta|displayText/);

const leaky = parseStructuredChatReply(
  `displayText: "Clean visible text", speechText: "Do not show this", voiceMeta: {"languageCode":"es"}`,
  {
    fallbackLanguageCode: "en",
    fallbackLanguageLabel: "English",
    fallbackVoiceId: "voice_fallback",
  }
);
assert.equal(leaky.displayText, "Clean visible text");
assert.equal(leaky.speechText, "Clean visible text", "malformed structured output should not trust leaked speechText");
assert.doesNotMatch(leaky.displayText, /speechText|voiceMeta|displayText/);
assert.equal(leaky.voiceMeta.languageCode, "en", "malformed voiceMeta should use fallback");

const plain = buildPlainTextStructuredReply("Plain reply", {
  fallbackLanguageCode: "pt",
  fallbackLanguageLabel: "Portuguese",
  fallbackVoiceId: "voice_pt",
});
assert.equal(plain.displayText, "Plain reply");
assert.equal(plain.speechText, "Plain reply");
assert.equal(plain.voiceMeta.languageCode, "pt");
assert.equal(plain.voiceMeta.voiceId, "voice_pt");
assert.equal(plain.structured, false);

console.log("chat structured reply self-check passed");
