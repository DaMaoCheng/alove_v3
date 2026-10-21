import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
globalThis.fetch = async () => { throw new Error("No network in language quality checks"); };
const original = { text: "Jó újra beszélni veled!", displayText: "Jó újra beszélni veled!", speechText: "[happy] Jó újra beszélni veled!", sourceType: "ai", sourceRef: "venice-chat-completions", answerRequired: false,
  discountOfferReply: true, verifiedDiscountOffers: [{ code: "FIXTURE" }], voiceMeta: { languageCode: "hu" } };
let calls = 0;
const verdict = { allowed: true, confidence: .99, languageQualitySupported: true };
const accepted = await enforceReplyBoundary({ replyResult: original, language: "hu", languageQualityRequired: true, assess: async (input) => {
  calls++; assert.equal(input.boundaryReviewRequired, false); assert.equal(input.languageQualityRequired, true);
  assert.equal(input.speechText, original.text); return verdict;
} });
assert.equal(calls, 1, "ordinary model replies must receive one quality assessment");
assert.equal(accepted, original, "accepted quality-only replies retain all original metadata and TTS tags");
for (const result of [{ ...verdict, languageQualitySupported: false }, { allowed: true, confidence: .99 }, { ...verdict, languageQualitySupported: "true" }, { ...verdict, confidence: .1 }, { ...verdict, confidence: NaN }, { ...verdict, confidence: 1.1 }]) {
  const output = await enforceReplyBoundary({ replyResult: { ...original, text: "írokmappingsz" }, language: "hu", languageQualityRequired: true, assess: async () => result });
  assert.notEqual(output.text, "írokmappingsz"); assert.equal(output.text, output.speechText); assert.equal(output.degradationReason, "language_quality_unverified");
  assert.equal(output.sourceType, "system"); assert.equal(output.discountOfferReply, false);
}
const timedOut = await enforceReplyBoundary({ replyResult: original, language: "es", languageQualityRequired: true, assess: async () => { throw new Error("timeout"); } });
assert.equal(timedOut.degradationReason, "language_quality_unverified"); assert.notEqual(timedOut.text, original.text);
let body;
const config = { apiKey: "fixture", model: "fixture", baseUrl: "https://invalid.test" };
const assessed = await assessReplyBoundary({ text: original.text, speechText: original.text, userText: "Szia", language: "hu", languageQualityRequired: true, boundaryReviewRequired: false, config,
  fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(verdict) } }] }) }; }, recordLog: async () => {} });
assert.equal(assessed.languageQualitySupported, true);
const instructions = body.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
assert.match(instructions, /malformed words/); assert.match(instructions, /translation|bilingual/); assert.match(instructions, /names/);
assert.doesNotMatch(instructions, /This is a storefront|this specific product request|no confirmed matching catalogue|checkoutProblem/);
assert.equal(JSON.parse(body.messages.at(-1).content).activeLanguage, "hu");
assert.equal(JSON.parse(body.messages.at(-1).content).proposedSpeech, original.text);
const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
const { buildLanguageQualityFallbackReply, languageQualityPassed } = await import("../server/chat-reply-language-quality.js");
const { inspectAiReplyQuality } = await import("../server/ai-reply-quality-service.js");
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const fallback = buildLanguageQualityFallbackReply(language.code);
  assert(fallback && (language.code === "en" || fallback !== buildLanguageQualityFallbackReply("en")), `${language.code} has its own fallback`);
  assert.equal(inspectAiReplyQuality({ text: "", language: language.code }).finalText, fallback);
}
assert.equal(languageQualityPassed({ ...verdict, languageQualitySupported: false, retainedLanguageQualitySupported: true }), false);
const { resolveChatImageStatusContext } = await import("../server/chat-image-status-context-service.js");
const session = { id: "fixture-session", internal_uid: "fixture-user", character_id: "fixture-character" };
const character = { id: "fixture-character", category_id: "mascot" };
const image = await resolveChatImageStatusContext({ execute: async () => [[{ id: "image-message", message_id: "image-message", asset_id: "asset", session_id: session.id, character_id: character.id, internal_uid: session.internal_uid,
  content_type: "image_generation", status: "ready", image_status: "ready", asset_status: "ready", display_order: 5, sender_type: "character", delivery_status: "ready" }]] }, { session, character, userDisplayOrder: 10 });
assert(image);
const safeParagraph = "Card payment is supported.";
const mixed = `${safeParagraph}\n\nI am still generating the image.`;
const imageVerdict = { allowed: false, confidence: .99, evidenceSupported: true, guidanceSupported: true, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true, retainedBoundarySupported: true, retainedImageStatusSupported: true, retainedText: safeParagraph, retainedTextAllowed: true };
for (const quality of [{ languageQualitySupported: true }, { languageQualitySupported: true, retainedLanguageQualitySupported: false }]) {
  const rejected = await enforceReplyBoundary({ replyResult: { text: mixed }, chatImageContext: image, character, languageQualityRequired: true, assess: async () => ({ ...imageVerdict, ...quality }) });
  assert(!rejected.text.includes(safeParagraph), "whole-text quality never approves an unchecked retained paragraph");
}
let combinedCalls = 0;
const retained = await enforceReplyBoundary({ replyResult: { text: mixed }, chatImageContext: image, character, languageQualityRequired: true, assess: async () => {
  combinedCalls++; return { ...imageVerdict, languageQualitySupported: false, retainedLanguageQualitySupported: true };
} });
assert.equal(combinedCalls, 1); assert(retained.text.includes(safeParagraph)); assert(!retained.text.includes("still generating"));
for (const part of ["Invented response.", "payment is supported."]) {
  const rejected = await enforceReplyBoundary({ replyResult: { text: mixed }, chatImageContext: image, character, languageQualityRequired: true, assess: async () => ({ ...imageVerdict, retainedText: part, retainedLanguageQualitySupported: true }) });
  assert(!rejected.text.includes(part), "quality approval cannot authorize rewritten or partial paragraphs");
}
const { buildGuestBenefitContext, isGuestBenefitReplyReviewed } = await import("../server/guest-benefit-guidance-service.js");
const userText = "Give me a coupon";
const searchIntent = { commerceConfidence: .99, promotionInquiry: { kind: "benefit_request", evidence: userText } };
const benefit = buildGuestBenefitContext({ isGuest: true, userText, searchIntent, languageCode: "en" });
const bodyText = "I cannot issue a coupon here.";
const rights = await enforceReplyBoundary({ replyResult: { text: bodyText }, userText, searchIntent, guestBenefitContext: benefit, character, languageQualityRequired: true,
  assess: async () => ({ allowed: true, confidence: .99, guidanceSupported: true, guestBenefitSupported: true, languageQualitySupported: false }) });
assert(!isGuestBenefitReplyReviewed(benefit, bodyText), "a language failure cannot grant exact-body cleaning permission");
assert(!rights.text.includes("SAVE"));
let capturedSpeech;
const wrongSpeech = await enforceReplyBoundary({ replyResult: { ...original, speechText: "írokmappingsz" }, language: "hu", languageQualityRequired: true,
  assess: async (input) => { capturedSpeech = input.speechText; return { ...verdict, languageQualitySupported: false }; } });
assert.equal(capturedSpeech, "írokmappingsz"); assert.notEqual(wrongSpeech.speechText, capturedSpeech);
for (const score of [1.1, -1, "0.99", null]) {
  const invalidConfidence = await enforceReplyBoundary({ replyResult: original, language: "hu", languageQualityRequired: true,
    assess: (options) => assessReplyBoundary({ ...options, config, recordLog: async () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...verdict, confidence: score }) } }] }) }) }) });
  assert.equal(invalidConfidence.degradationReason, "language_quality_unverified", "parser must not clamp invalid quality confidence into acceptance");
}
let unclearBody;
const unclear = await enforceReplyBoundary({ replyResult: original, character: { category_id: "mascot" }, searchIntent: { commerceRoute: "unclear" }, language: "hu", languageQualityRequired: true,
  assess: (options) => assessReplyBoundary({ ...options, config, recordLog: async () => {}, fetchImpl: async (_url, request) => {
    unclearBody = JSON.parse(request.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(verdict) } }] }) };
  } }) });
assert.equal(unclear, original, "unclear commerce alone must not add checkout review to a quality-only turn");
assert(!unclearBody.messages.some((m) => m.role === "system" && /checkoutProblem|checkout rules/.test(m.content)));
console.log("chat reply language quality self-check passed");
