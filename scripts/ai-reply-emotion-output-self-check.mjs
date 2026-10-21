import assert from "node:assert/strict";

import { generateChatReplyWithRequest } from "../server/ai-reply-service.js";
import { parseStructuredChatReply } from "../server/chat-reply-structure-service.js";
import { sanitizeTtsSpeechText } from "../server/tts-speech-text-sanitizer.js";
import { normalizeVisibleText, stripTtsControlTags } from "../server/tts-emotion-tag-service.js";
import { applyContextualEmotionTags } from "../server/tts-emotion-routing-service.js";

for (const [userText, displayText] of [
  ["I don't want to buy anything.", "We can just chat."],
  ["I was tired yesterday, but I'm feeling better now.", "Good to hear things are looking up."],
  ["¿Qué precio tiene?", "Todavía no tengo un precio confirmado."],
  ["我不想聊球衣了。", "好，换个话题。"],
]) {
  const result = applyContextualEmotionTags({ userText, displayText, speechText: displayText, sourceType: "ai" });
  assert.deepEqual(result.emotionTags, [], "untagged AI replies must not acquire a keyword-based mood");
  assert.equal(result.speechText, normalizeVisibleText(displayText));
}
assert.equal(applyContextualEmotionTags({ speechText: "Welcome!", sourceType: "promotion_campaign" }).speechText, "[happy] Welcome!", "explicit campaign fallback stays unchanged");

const structured = parseStructuredChatReply(JSON.stringify({
  displayText: "That one feels clean, bro. Proper matchday energy.",
  speechText: "[happy] That one feels clean, bro. [short pause] Proper matchday energy.",
}));

assert.equal(structured.displayText, "That one feels clean, bro. Proper matchday energy.");
assert.equal(structured.speechText, "[happy] That one feels clean, bro. [short pause] Proper matchday energy.");
assert.equal(stripTtsControlTags(structured.speechText), structured.displayText);

const sanitizedSpeech = sanitizeTtsSpeechText("[excited] Clean pick. [short pause] Go with the home shirt.");
assert.equal(sanitizedSpeech, "[excited] Clean pick. [short pause] Go with the home shirt.");

const reply = await generateChatReplyWithRequest({
  promptContext: {
    systemPrompt: "You are Dani.",
    messages: [{ role: "user", content: "Need one short reply." }],
  },
  userText: "Need one short reply.",
  logContext: {
    languageCode: "en",
    languageLabel: "English",
    voiceProvider: "elevenlabs",
    voiceModel: "eleven_v3",
    voiceId: "voice_test",
  },
  requestReplyText: async () => JSON.stringify({
    displayText: "That one feels clean, bro.",
    speechText: "[happy] That one feels clean, bro.",
    voiceMeta: {
      languageCode: "en",
      languageLabel: "English",
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "voice_test",
    },
  }),
  recordReplyLogFn: async () => {},
});

assert.equal(reply.text, "That one feels clean, bro.");
assert.equal(reply.displayText, "That one feels clean, bro.");
assert.equal(reply.speechText, "[happy] That one feels clean, bro.");

const injected = await generateChatReplyWithRequest({
  promptContext: {
    systemPrompt: "You are Millie.",
    messages: [{ role: "user", content: "Been a rough day, just want a calm football chat." }],
  },
  userText: "Been a rough day, just want a calm football chat.",
  logContext: {
    languageCode: "en",
    languageLabel: "English",
    voiceProvider: "elevenlabs",
    voiceModel: "eleven_v3",
    voiceId: "voice_test",
  },
  requestReplyText: async () => JSON.stringify({
    displayText: "Yeah, fair enough — sorry it's been a rough one. We can keep it easy.",
    speechText: "Yeah, fair enough — sorry it's been a rough one. We can keep it easy.",
    voiceMeta: {
      languageCode: "en",
      languageLabel: "English",
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "voice_test",
    },
  }),
  recordReplyLogFn: async () => {},
});

assert.equal(injected.displayText, "Yeah, fair enough — sorry it's been a rough one. We can keep it easy.", "TTS punctuation cleanup must not rewrite the explicit display channel");
assert.equal(injected.speechText, "Yeah, fair enough - sorry it's been a rough one. We can keep it easy.", "neutral model delivery retains the existing TTS punctuation equivalent without keyword mood injection");
assert.equal(stripTtsControlTags(injected.speechText), injected.displayText.replace("—", "-"));

console.log("ok");
