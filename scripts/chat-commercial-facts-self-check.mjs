import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
globalThis.fetch = async () => { throw new Error("Unexpected external request"); };
const character = { id: "mascot_fixture", category_id: "mascot" };
const searchIntent = { answerRequired: true, knowledgeScope: "business", commerceRoute: "store_policy", commerceTopic: "authenticity" };
const original = { text: "Our shirts are officially licensed.", speechText: "[happy] Our shirts are officially licensed.", discountOfferReply: true, verifiedDiscountOffers: [{ code: "fixture" }] };
const verdict = { allowed: true, confidence: .99, businessFactsSupported: true, evidenceSupported: true, guidanceSupported: true, languageQualitySupported: true };
let calls = 0;
const rejected = await enforceReplyBoundary({ replyResult: original, character, searchIntent, language: "hu", assess: async (input) => {
  calls++; assert.equal(input.businessFactsRequired, true); assert.equal(input.evidenceRequired, false);
  assert.equal(input.guidanceRequired, false); return { ...verdict, allowed: false, businessFactsSupported: false };
} });
assert.equal(calls, 1, "ordinary store-policy assertions must receive a facts check");
assert.notEqual(rejected.text, original.text); assert.equal(rejected.degradationReason, "business_facts_unverified");
assert.equal(rejected.discountOfferReply, false); assert.deepEqual(rejected.verifiedDiscountOffers, []);
assert(!/Product search|matching|Understood/.test(rejected.text), "a policy failure must not become a product-no-match reply");
for (const commerceRoute of ["store_policy", "product_question", "product_search"]) {
  const result = await enforceReplyBoundary({ replyResult: original, character, searchIntent: { ...searchIntent, commerceRoute }, productContext: { products: [{ name: "Fixture jersey" }] },
    languageQualityRequired: true, assess: async (input) => { assert.equal(input.businessFactsRequired, true); return verdict; } });
  assert.equal(result, original, "accepted fact-only answers retain existing TTS and commerce metadata");
}
for (const patch of [{ answerRequired: false }, { knowledgeScope: "none" }, { commerceRoute: "chat" }]) {
  const result = await enforceReplyBoundary({ replyResult: original, character, searchIntent: { ...searchIntent, ...patch }, assess: async () => { throw new Error("should not review"); } });
  assert.equal(result, original);
}
assert.equal(await enforceReplyBoundary({ replyResult: original, character: { category_id: "companion" }, searchIntent, assess: async () => { throw new Error("other persona"); } }), original);
for (const patch of [{ businessFactsSupported: undefined }, { businessFactsSupported: "true" }, { confidence: "0.99" }, { confidence: 1.1 }, { confidence: .7 }, { confidence: NaN }]) {
  const result = await enforceReplyBoundary({ replyResult: original, character, searchIntent, assess: async () => ({ ...verdict, ...patch }) });
  assert.equal(result.degradationReason, "business_facts_unverified");
}
const timeout = await enforceReplyBoundary({ replyResult: original, character, searchIntent, assess: async () => { throw new Error("timeout"); } });
assert.equal(timeout.degradationReason, "business_facts_unverified");
const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
for (const { code } of SUPPORTED_CHARACTER_LANGUAGES) {
  const result = await enforceReplyBoundary({ replyResult: original, character, searchIntent, language: code, assess: async () => ({ ...verdict, allowed: false, businessFactsSupported: false }) });
  assert(result.text && (code === "en" || result.text !== timeout.text), `${code} keeps localized uncertainty`);
}
const { buildGuestBenefitContext, isGuestBenefitReplyReviewed } = await import("../server/guest-benefit-guidance-service.js");
const couponRequest = { ...searchIntent, commerceConfidence: .99, promotionInquiry: { kind: "benefit_request", evidence: "coupon" } };
const guest = buildGuestBenefitContext({ isGuest: true, searchIntent: couponRequest, userText: "coupon", languageCode: "en" });
const unsafeOffer = await enforceReplyBoundary({ replyResult: { ...original, text: "Use SAVE20 for 20% off." }, character, searchIntent: couponRequest,
  userText: "coupon", guestBenefitContext: guest, assess: async () => ({ ...verdict, guestBenefitSupported: false }) });
assert(!unsafeOffer.text.includes("SAVE20")); assert(!isGuestBenefitReplyReviewed(guest, "Use SAVE20 for 20% off."));
const supported = "The listed price is $25 USD.";
const mixed = { ...original, text: `${supported}\n\nOur shirts are officially licensed.` };
const partialVerdict = { ...verdict, allowed: false, businessFactsSupported: false, retainedText: supported, retainedTextAllowed: true,
  retainedBusinessFactsSupported: true, retainedBoundarySupported: true, retainedLanguageQualitySupported: true };
const partial = await enforceReplyBoundary({ replyResult: mixed, character, searchIntent, languageQualityRequired: true, assess: async () => partialVerdict });
assert(partial.text.startsWith(supported)); assert(!partial.text.includes("officially licensed")); assert.equal(partial.partialAnswerRetained, true);
assert.equal(partial.discountOfferReply, false);
for (const patch of [{ retainedBusinessFactsSupported: false }, { retainedBoundarySupported: false }, { retainedLanguageQualitySupported: false }, { retainedText: "price is $25 USD." }, { retainedText: "Invented paragraph." }, { evidenceSupported: false }]) {
  const result = await enforceReplyBoundary({ replyResult: mixed, character, searchIntent: { ...searchIntent, needsLiveProductData: true }, languageQualityRequired: true, assess: async () => ({ ...partialVerdict, ...patch }) });
  assert(!result.text.includes(supported), "all retained paragraphs require independent complete review");
}
const config = { apiKey: "fixture", model: "fixture", baseUrl: "https://invalid.test" };
let payload, instructions;
async function parseVerdict(value, options = {}) {
  return assessReplyBoundary({ text: original.text, userText: "Are these official?", businessFactsRequired: true, config, recordLog: async () => {}, ...options,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body); payload = JSON.parse(body.messages.at(-1).content);
      instructions = body.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...value, ...(payload.businessClaimContext ? { businessClaimAudit: payload.businessClaimContext.units.map(unit => ({
        unitId: unit.id, factual: true, referenceIds: [payload.businessClaimContext.references[0].id], supported: value.businessFactsSupported !== false,
        sourceAllowsException: false, replyPreservesException: true,
      })) } : {}) }) } }] }) };
    } });
}
const parsed = await parseVerdict(verdict, { productContext: { products: [{ name: "Fixture jersey", price: "$25", currency: "USD", available: true, customizationOptions: [{ id: "name", name: "Name", type: "text" }], paymentMethods: ["card"], sourceItem: { secret: "must-not-pass" } }] },
  verifiedDiscountOffers: [{ code: "VALID", offerDescription: "10% off", privateField: "must-not-pass" }], speechText: "The offer is VALID.",
  knowledgeContext: { items: [{ id: "terms", siteId: "fixture", content: "Our own shirts are officially licensed.", evidenceQuote: "Our own shirts are officially licensed." }] } });
assert.equal(parsed.businessFactsSupported, true); assert.equal(payload.businessFactsRequired, true);
assert.equal(payload.evidence.catalogueProducts[0].price, "$25"); assert.equal(payload.evidence.catalogueProducts[0].currency, "USD");
assert.equal(payload.evidence.catalogueProducts[0].customizationOptions[0].name, "Name"); assert(!JSON.stringify(payload).includes("must-not-pass"));
assert.deepEqual(payload.evidence.verifiedDiscountOffers, [{ code: "VALID", offerDescription: "10% off" }]);
assert.equal(payload.proposedSpeech, "The offer is VALID.");
assert.match(instructions, /templates/); assert.match(instructions, /name.*licens/i); assert.match(instructions, /general explanation/i);
assert.match(instructions, /cannot override.*guest.*discountPolicyExplanation/);
for (const patch of [{ confidence: "0.99" }, { confidence: 1.1 }, { businessFactsSupported: "true" }, { businessFactsSupported: undefined }]) {
  const value = await parseVerdict({ ...verdict, ...patch });
  assert(!(value.businessFactsSupported && value.confidence >= .8));
}
for (const knowledge of [[], [{ id: "script", title: "Generic sales script", content: "Example: Our products are officially licensed by [rights holder]. Replace this placeholder after verification." }]]) {
  const result = await enforceReplyBoundary({ replyResult: original, character, searchIntent: { ...searchIntent, commerceRoute: "product_question", needsLiveProductData: true }, productContext: { products: [{ name: "Brand Home Jersey" }] }, knowledgeContext: { items: knowledge },
    assess: (options) => parseVerdict({ ...verdict, allowed: false, businessFactsSupported: false }, options) });
  assert.equal(result.degradationReason, "business_facts_unverified"); assert(!result.text.includes("officially licensed"));
  assert.equal(payload.evidence.catalogueProducts[0].name, "Brand Home Jersey");
  assert.deepEqual(payload.evidence.knowledge.map((item) => item.content), knowledge.map((item) => item.content));
}
const verifiedReply = { ...original, text: "Card payment is supported only for online orders." };
const siteTerms = { items: [{ id: "current-site-policy", scope: "site", siteId: "fixture", content: "Card payment is supported only for online orders. Offline payment is not confirmed." }] };
assert.equal(await enforceReplyBoundary({ replyResult: verifiedReply, character, searchIntent, knowledgeContext: siteTerms,
  assess: (options) => parseVerdict(verdict, options) }), verifiedReply);
assert.equal(payload.evidence.knowledge[0].content, siteTerms.items[0].content, "material limitations stay in the review evidence");
// Positive cases explicitly include uncertainty or real terms; the stub verifies
// transport/contracts, not the semantic judgment of a real external model.
for (const text of ["Licensing generally means permission from the rights holder; I cannot confirm this store's status.", "Card payment is supported. I cannot verify this store's licensing."]) {
  const reply = { ...original, text };
  assert.equal(await enforceReplyBoundary({ replyResult: reply, character, searchIntent, assess: async () => verdict }), reply);
}
console.log("chat commercial facts self-check passed (isolated review fixtures, no external model)");
