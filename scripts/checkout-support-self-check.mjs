// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from "node:assert/strict";
import { normalizeCheckoutIssue, shouldSkipOrderLookupForCheckout, buildCheckoutSupportPrompt, buildCheckoutReviewContext, hasCheckoutIssue, CHECKOUT_CLASSIFICATION_CONTRACT } from "../server/checkout-support-guidance.js";
import { buildCheckoutNextStepCopy } from "../server/checkout-support-copy.js";

// Pure functions only. Never load provider configuration or access a database.
globalThis.fetch = async () => { throw new Error("Network is forbidden in this self-check"); };
assert.match(CHECKOUT_CLASSIFICATION_CONTRACT, /not inferred from orderPlaced/);
assert.match(CHECKOUT_CLASSIFICATION_CONTRACT, /displayed error wording or code/);
assert.match(CHECKOUT_CLASSIFICATION_CONTRACT, /Ordinary data entry or pressing Continue is not a repair attempt/);
assert.match(CHECKOUT_CLASSIFICATION_CONTRACT, /lookupEvidence must quote the CURRENT/);
assert.ok(CHECKOUT_CLASSIFICATION_CONTRACT.split(/\s+/).length <= 260, "Keep added classifier instructions bounded");
const userText = "No me deja continuar después de meter mi dirección. No he hecho el pedido.";
const raw = { active: true, evidence: "No me deja continuar", stage: "address", stageEvidence: "después de meter mi dirección", orderPlaced: false, orderEvidence: "No he hecho el pedido", lookupRequested: false, lookupEvidence: "No he hecho el pedido" };
const normalize = (value = raw, options = {}) => normalizeCheckoutIssue(value, { userText, confidence: .96, ...options });
const issue = normalize();
assert.equal(issue.stage, "address");
assert.equal(issue.orderPlaced, false);
assert.equal(shouldSkipOrderLookupForCheckout({ checkoutIssue: issue }), true);
assert.equal(normalize(raw, { confidence: .4 }).stage, 'address', 'selected checkout intent does not depend on the confidence score');
assert.equal(normalize({ ...raw, evidence: "invented" }), null);
assert.equal(normalize({ ...raw, active: false }), null);
assert.equal(normalize(raw, { userText: "Thanks, how was the match?" }), null);
assert.equal(normalize({ ...raw, stage: "fake" }).stage, "unknown");
assert.equal(normalize({ ...raw, stageEvidence: "invented" }).stage, "unknown");
assert.equal(normalize({ ...raw, orderEvidence: "invented" }).orderPlaced, null);
assert.equal(normalize({ ...raw, lookupEvidence: "" }).lookupRequested, null);
assert.equal(shouldSkipOrderLookupForCheckout({ checkoutIssue: normalize({ ...raw, lookupEvidence: "" }) }), false);
assert.equal(shouldSkipOrderLookupForCheckout({ checkoutIssue: normalize({ ...raw, lookupRequested: true }) }), false);
assert.equal(shouldSkipOrderLookupForCheckout({ checkoutIssue: normalize({ ...raw, orderPlaced: true }) }), false);
assert.deepEqual(normalize(issue), issue, "Routing revalidation preserves validated evidence references");
assert.equal(normalize(JSON.parse(JSON.stringify(issue))), null, "Serialized model references are not trusted evidence");
assert.equal(hasCheckoutIssue({ checkoutIssue: { ...issue } }), false, "Copied/forged state cannot authorize skipping lookup");
assert.equal(normalize(issue, { userText: "Different checkout question" }), null, "Evidence cannot leak into another turn");
assert.equal(normalize({ ...raw, evidence: "x".repeat(161) }), null);
assert.equal(normalize(raw, { confidence: 0 }).stage, "address");
for (const confidence of [null, "", "0.2", false, undefined, NaN, Infinity, -1, 2]) {
  assert.equal(normalize(raw, { confidence }), null, `invalid confidence ${String(confidence)} must not authorize checkout routing`);
}
assert.equal(normalize(raw, { confidence: Infinity }), null);
assert.equal(normalize(raw, { confidence: 2 }), null);
assert.equal(normalize(raw, { recentMessages: [null] }).stage, "address");
assert.deepEqual(normalize(issue, { userText: `  ${userText}  ` }), issue, "Classifier trimming and routing preserve the same turn");
const recentMessages = [{ senderType: "assistant", text: "Try removing spaces." }, { senderType: "user", text: "I tried removing spaces and it still failed. It says invalid postal code." }];
const followupText = "Still unable to continue.";
const followup = normalizeCheckoutIssue({ active: true, evidence: followupText, stage: "address", stageEvidence: "invalid postal code", errorEvidence: "invalid postal code", failedAttempts: ["Try removing spaces.", "I tried removing spaces and it still failed."] }, { userText: followupText, recentMessages, confidence: .9 });
assert.equal(followup.failedAttempts.length, 1, "Assistant advice is not proof that the user tried it");
assert.ok(followup.errorEvidence);
assert.equal(followup.orderPlaced, null, "A stage never implies order creation state");
assert.equal(followup.lookupRequested, null);
assert.ok(!JSON.stringify(followup).includes("postal"), "No raw address/error/payment text is duplicated into metadata");
const review = buildCheckoutReviewContext({ checkoutIssue: followup }, { userText: followupText, recentMessages });
assert.equal(review.errorEvidence, "invalid postal code");
assert.deepEqual(review.failedAttempts, ["I tried removing spaces and it still failed."]);
assert.equal(buildCheckoutReviewContext({ checkoutIssue: followup }, { userText: "Unrelated", recentMessages }), null);
const expired = normalizeCheckoutIssue({ active: true, evidence: followupText, failedAttempts: ["old failure"] }, { userText: followupText, confidence: .9, recentMessages: [{ senderType: "user", text: "old failure" }, ...Array.from({ length: 6 }, () => ({ senderType: "assistant", text: "later" }))] });
assert.equal(expired.failedAttempts.length, 0, "Expired history does not become current state");
const privateText = "Checkout failed. Contact buyer@example.invalid, reference 1234567890123456.";
const privateIssue = normalizeCheckoutIssue({ active: true, evidence: "Checkout failed", errorEvidence: "buyer@example.invalid, reference 1234567890123456" }, { userText: privateText, confidence: .9 });
assert.ok(!JSON.stringify(privateIssue).includes("buyer@"));
const privateReview = buildCheckoutReviewContext({ checkoutIssue: privateIssue }, { userText: privateText });
assert.ok(!JSON.stringify(privateReview).includes("buyer@"));
assert.ok(!JSON.stringify(privateReview).includes("1234567890123456"));
assert.equal(normalizeCheckoutIssue(privateIssue, { userText: privateText.replace("failed", "worked"), confidence: .9 }), null);
assert.match(buildCheckoutSupportPrompt({ checkoutIssue: followup }), /Do not repeat/);
assert.equal(buildCheckoutSupportPrompt({}), "");
assert.notEqual(buildCheckoutNextStepCopy({ stage: "unknown" }, "en"), buildCheckoutNextStepCopy({ stage: "address" }, "en"));
assert.notEqual(buildCheckoutNextStepCopy({ stage: "address" }, "en"), buildCheckoutNextStepCopy(followup, "en"));
const languages = "en zh es fr de pt it hu tr ar ja ko hi id nl pl sv no da fi ru uk cs sk ro bg el he th vi ms ta bn ur fa sw tl ca hr sr lt lv et".split(" ");
for (const code of languages) {
  for (const state of [{ stage: "unknown" }, { stage: "address" }, followup]) assert.ok(buildCheckoutNextStepCopy(state, code));
  if (code !== "en") assert.notEqual(buildCheckoutNextStepCopy(issue, code), buildCheckoutNextStepCopy(issue, "en"));
}
console.log("checkout support pure self-check passed: evidence, state, no-contact-neutral fallback and 43 languages");

// Production classification and routing with an injected in-memory provider.
// Configuration is imported only after logs are disabled and fetch is blocked.
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { classifyCommerceIntentFallback: classifyCommerceIntent } = await import("../server/product-intent-classifier-service.js");
const { resolveCommerceSearchIntent } = await import("../server/commerce-routing-service.js");
const history = [
  { senderType: "user", text: "old unrelated line" },
  { senderType: "character", product: { id: "old-card", name: "Earlier product" } },
  { senderType: "user", text: "No he hecho el pedido" },
  { senderType: "assistant", text: "assistant advice" },
  { senderType: "user", text: "después de meter mi dirección" },
  { senderType: "assistant", text: "another suggestion" },
  { senderType: "user", text: "previous context" },
  { senderType: "assistant", text: "last reply" },
];
let calls = 0;
const current = "No me deja continuar";
const decision = await classifyCommerceIntent(current, {
  recentMessages: history,
  config: { apiKey: "mock", model: "mock", baseUrl: "https://mock.invalid" },
  fetchImpl: async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /checkoutIssue/);
    assert.equal(body.messages[1].role, "user");
    assert.equal(JSON.parse(body.messages[1].content).recentConversation[0].productCard.id, "old-card");
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ route: "chat", topic: "other", confidence: .96, replyBoundary: { salesAllowed: false, contactAllowed: true }, checkoutIssue: { ...raw, evidence: current } }) } }] }) };
  },
});
const routed = await resolveCommerceSearchIntent({ userText: current, recentMessages: history, classifyCommerce: async () => decision });
assert.equal(calls, 1);
assert.equal(routed.checkoutIssue, decision.checkoutIssue, "Full original history and prepended card preserve canonical user evidence indices");
assert.equal(routed.checkoutIssue.stage, "address");
assert.equal(routed.answerRequired, true);
assert.equal(routed.knowledgeScope, "business");
assert.equal(routed.customerServiceKnowledgeRequest, true);
assert.equal(routed.cardAllowed, false);
assert.equal(shouldSkipOrderLookupForCheckout(routed), false, "An old non-lookup request cannot bypass a possible lookup in the current turn");
const later = await resolveCommerceSearchIntent({ userText: "Tell me about the match", recentMessages: history, classifyCommerce: async () => decision });
assert.equal(later.checkoutIssue, null);
console.log("checkout support classifier/routing isolated self-check passed: one injected call, canonical history and no stale state");
