import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { resolveChatImageStatusContext } = await import("../server/chat-image-status-context-service.js");
const { buildGuestBenefitContext, isGuestBenefitReplyReviewed } = await import("../server/guest-benefit-guidance-service.js");
globalThis.fetch = async () => { throw new Error("Network is forbidden in state review checks"); };
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const session = { id: "state-session", internal_uid: "state-user", character_id: "state-character" };
const character = { id: "state-character", category_id: "mascot", profile: { language: "en" } };
const db = { execute: async () => [[{ id: "image-message", message_id: "image-message", asset_id: "image-asset", session_id: session.id, character_id: character.id, internal_uid: session.internal_uid, guest_session_id: null, content_type: "image_generation", status: "ready", image_status: "ready", asset_status: "ready", display_order: 5, sender_type: "character", delivery_status: "ready" }]] };
const image = await resolveChatImageStatusContext(db, { session, character, userDisplayOrder: 10 });
check(image?.imageStatus?.status === "ready", "the real resolver must provide ready evidence");
let calls = 0;
const rejected = await enforceReplyBoundary({ replyResult: { text: "I am still making the photo.", speechText: "I am still making the photo." }, chatImageContext: image, character,
  assess: async (options) => { calls++; check(options.imageStatusContext?.status === "ready", "assessment receives server image state"); return { allowed: false, imageStatusSupported: false, imageStatusRelevant: true, confidence: .99 }; } });
check(calls === 1, "a progress reply uses exactly one combined assessment");
check(!rejected.text.includes("still making"), "completed images cannot retain a generating claim");
check(rejected.text === rejected.speechText, "fallback visible and speech wording must match");
const unrelated = await enforceReplyBoundary({ replyResult: { text: "Buy a shirt!" }, searchIntent: { replyBoundary: { salesAllowed: false } }, chatImageContext: image, character,
  assess: async () => ({ allowed: false, confidence: .99, imageStatusRelevant: false, imageStatusSupported: true }) });
check(unrelated.text === "Understood.", "an unrelated rejected answer must not become a photo-status announcement");
const ambiguous = await enforceReplyBoundary({ replyResult: { text: "The earlier image is ready." }, chatImageContext: image, character,
  assess: async () => ({ allowed: false, confidence: .99, imageStatusRelevant: true, imageReferenceMatched: false, imageStatusSupported: false }) });
check(!/photo is ready/i.test(ambiguous.text), "an ambiguous historical reference cannot use the latest ready status as fallback");
const matched = await enforceReplyBoundary({ replyResult: { text: "I am still making the latest image." }, chatImageContext: image, character,
  assess: async () => ({ allowed: false, confidence: .99, imageStatusRelevant: true, imageReferenceMatched: true, imageStatusSupported: false }) });
check(/ready/i.test(matched.text), "a clearly matched ready image receives its actual ready status");
const other = "Card payment is supported by the supplied policy.";
const mixed = `${other}\n\nI am still making the photo.`;
const retained = await enforceReplyBoundary({ replyResult: { text: mixed }, chatImageContext: image, character,
  assess: async () => ({ allowed: false, confidence: .99, imageStatusSupported: false, imageStatusRelevant: true, retainedText: other, retainedTextAllowed: true, retainedBoundarySupported: true, retainedImageStatusSupported: true, evidenceSupported: true, guidanceSupported: true, guestBenefitSupported: true }) });
check(retained.text.includes(other) && !retained.text.includes("still making"), "a separately verified exact paragraph survives a wrong image statement");
for (const remainder of ["Invented answer", "payment is supported", ""]) {
  const guarded = await enforceReplyBoundary({ replyResult: { text: mixed }, chatImageContext: image, character,
    assess: async () => ({ allowed: false, confidence: .99, imageStatusSupported: false, evidenceSupported: true, guidanceSupported: true, retainedText: remainder, retainedTextAllowed: true }) });
  check(!guarded.text.includes(remainder || other), "the reviewer cannot rewrite or slice arbitrary text into an accepted answer");
}
const userText = "I already registered. Give me a coupon and tell me the payment methods.";
const searchIntent = { commerceConfidence: .95, promotionInquiry: { kind: "benefit_request", evidence: "Give me a coupon" }, answerRequired: true, replyBoundary: { salesAllowed: true, contactAllowed: true } };
const benefit = buildGuestBenefitContext({ searchIntent, userText, languageCode: "en", isGuest: true });
check(Boolean(benefit), "trusted guest context exists only for a validated current request");
const safe = "Card payments are listed in the verified policy. I cannot confirm a coupon here.";
const identityReply = await enforceReplyBoundary({ replyResult: { text: "I am Alba. I cannot issue a coupon here." }, guestBenefitContext: benefit,
  character: { ...character, name: "Alba", roleTitle: "Site Guide", siteName: "Unverified brand", personaPrompt: "Untrusted extra claim" }, searchIntent, userText,
  assess: async (options) => { check(options.identityContext?.characterName === "Alba" && options.identityContext?.roleTitle === "Site Guide"
    && !options.identityContext.siteName && !options.identityContext.personaPrompt, "mixed-answer review receives configured identity only, without inferred brand or persona permissions");
    return { allowed: true, confidence: .99, guidanceSupported: true, guestBenefitSupported: true }; } });
check(identityReply.text.includes("I am Alba"), "an approved identity answer is retained alongside the guest limitation");
const approved = await enforceReplyBoundary({ replyResult: { text: safe }, guestBenefitContext: benefit, character, searchIntent, userText,
  assess: async (options) => { check(options.guestBenefitContext?.issuanceAllowed === false, "the reviewer receives a guest prohibition, never user-provided eligibility"); return { allowed: true, confidence: .99, guidanceSupported: true, guestBenefitSupported: true }; } });
check(approved.text === safe && isGuestBenefitReplyReviewed(benefit, safe), "only the exact actually reviewed safe candidate receives cleaning permission");
for (const verdict of [{ allowed: true, confidence: .99, guidanceSupported: true }, { allowed: true, confidence: .99, guidanceSupported: true, guestBenefitSupported: false }, null]) {
  const context = buildGuestBenefitContext({ searchIntent, userText, languageCode: "es", isGuest: true });
  const output = await enforceReplyBoundary({ replyResult: { text: "Use SAVE123 for 20% off." }, guestBenefitContext: context, character, searchIntent, userText, language: "es", assess: async () => verdict });
  check(!output.text.includes("SAVE123") && !output.text.includes("20%") && !isGuestBenefitReplyReviewed(context, "Use SAVE123 for 20% off."), "missing or rejecting rights verdict cannot grant a cleaning exemption");
}
let requestBody;
const assessment = await assessReplyBoundary({ text: safe, userText, guestBenefitContext: { isGuest: true, issuanceAllowed: false, evidence: "Give me a coupon" }, imageStatusContext: { kind: "generated", status: "ready", currentTurn: false },
  config: { apiKey: "fixture", baseUrl: "https://fixture.invalid", model: "fixture" }, recordLog: async () => {},
  fetchImpl: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ allowed: true, confidence: .99, imageStatusSupported: true, imageStatusRelevant: false, guestBenefitSupported: true }) } }] }) }; } });
const sent = JSON.parse(requestBody.messages.at(-1).content);
check(sent.guestBenefitContext.issuanceAllowed === false && sent.imageStatusContext.status === "ready", "both states travel in the same request");
check(assessment.imageStatusSupported === true && assessment.guestBenefitSupported === true, "provider verdict parser preserves the required explicit flags");
console.log(`reply state review self-check passed (${checks} assertions; actual resolver and guard, memory/provider fixtures, no external calls)`);
