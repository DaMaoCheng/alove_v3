import assert from "node:assert/strict";
import { SUPPORTED_CHARACTER_LANGUAGES } from "../shared/language-library.js";
import { createSiteCopy } from "../src/i18n/site-copy.js";
import { CHAT_IMAGE_CHARACTER_STATUS_COPY, getChatImageStatusCopy } from "../server/chat-image-copy-service.js";
import { normalizeGuestReplyText } from "../server/guest-chat-output-policy.js";

let checks = 0;
function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  checks += 1;
}
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const code = language.code;
  assert.ok(CHAT_IMAGE_CHARACTER_STATUS_COPY[code], `${code}: supported character language needs explicit image copy`);
  checks += 1;
  for (const status of ["queued", "ready"]) {
    const copy = CHAT_IMAGE_CHARACTER_STATUS_COPY[code][status];
    assert.ok(typeof copy === "string" && copy.trim(), `${code}/${status}: nonempty translation`);
    checks += 1;
    equal(getChatImageStatusCopy({ language: language.label, status }), copy, `${code}/${status}: character labels resolve`);
    equal(getChatImageStatusCopy({ language: `${code}-XX`, status }), copy, `${code}/${status}: locale resolves`);
    equal(getChatImageStatusCopy({ language: { code }, status }), copy, `${code}/${status}: language objects resolve`);
    if (code !== "en") {
      assert.notEqual(copy, CHAT_IMAGE_CHARACTER_STATUS_COPY.en[status], `${code}/${status}: must not silently fall back to English`);
      checks += 1;
    }
    for (const aiTransportFallback of [false, true]) {
      equal(normalizeGuestReplyText({
        text: aiTransportFallback ? "English model transport fallback." : "",
        imageTaskCreated: true,
        imageDeliveryType: status === "ready" ? "mascot_library_image" : "image_generation",
        aiTransportFallback,
        languageCode: language.label,
        userText: "OK",
      }), copy, `${code}/${status}: actual guest final normalizer uses local acknowledgement`);
    }
  }
  for (const [status, key] of [["generating", "chat.imageGenerating"], ["failed", "chat.imageFailed"], ["cancelled", "chat.imageCancelled"], ["invalid", "chat.imageQueued"]]) {
    equal(getChatImageStatusCopy({ language: code, status }), createSiteCopy(code).t(key), `${code}/${status}: other states retain original UI copy behavior`);
  }
  const text = "A verified parallel answer in the character's language.";
  equal(normalizeGuestReplyText({ text, imageTaskCreated: true, languageCode: code }), text, `${code}: existing parallel model answer is retained`);
}
for (const code of ["en", "zh", "es", "fr", "hu", "tr", "ar"]) {
  for (const status of ["queued", "ready"]) {
    equal(getChatImageStatusCopy({ language: code, status }), createSiteCopy(code).t(status === "ready" ? "chat.imageReady" : "chat.imageQueued"), `${code}: existing translation stays identical`);
  }
}
equal(getChatImageStatusCopy({ language: "unknown-language", status: "ready" }), createSiteCopy("unknown-language").t("chat.imageReady"), "unknown language preserves existing fallback");
equal(getChatImageStatusCopy({ language: "de", status: "ready" }), "Das Foto ist fertig.", "German reply regression");
equal(getChatImageStatusCopy({ language: "ja", status: "ready" }), "写真ができました。", "Japanese reply regression");
console.log(`chat image status language self-check passed: ${SUPPORTED_CHARACTER_LANGUAGES.length} languages, ${checks} assertions; no provider or DB calls`);
