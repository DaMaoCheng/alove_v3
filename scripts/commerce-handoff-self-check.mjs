// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { classifyCommerceIntentFallback: classifyCommerceIntent, normalizeCommerceDecision } = await import("../server/product-intent-classifier-service.js");
const { resolveCommerceSearchIntent, applyCommerceQuestionPromptPolicy } = await import("../server/commerce-routing-service.js");
const { resolveChatFeedbackActionCandidate, resolveChatFeedbackAction, appendFeedbackFollowupCopy } = await import("../server/chat-feedback-action-service.js");
const { closeDbPool } = await import("../server/db.js");
const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
const mascot = { id: "mascot_test", categoryId: "mascot", profile: { language: "English" } };
const defaultDecision = { route: "chat", confidence: .99, replyBoundary: { salesAllowed: true, contactAllowed: true }, answerRequired: true,
  productRequest: { relation: "none", action: "new", items: [], selectedIndex: null, selectionEvidence: "" } };
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("External requests disabled for isolated self-check"); };
try {
  for (const [text, kind, reason] of [
    ["Je souhaite négocier un devis pour notre commande en gros.", "wholesale", "quotation"],
    ["أريد مناقشة شروط عقد توزيع مع متجركم", "distribution", "contract"],
    ["Szeretnék egyeztetni a szponzorációs szerződés feltételeiről.", "sponsorship", "commercial_terms"],
  ]) {
    let calls = 0;
    const decision = await classifyCommerceIntent(text, {
      config: { apiKey: "mock", baseUrl: "https://mock.invalid", model: "mock" },
      fetchImpl: async (_url, options) => {
        calls++;
        const request = JSON.parse(options.body);
        check(request.messages[0].content.includes("businessReviewRequired") && request.messages[0].content.includes("Routine price, payment, shipping or dropshipping policy explanation alone"), "one existing classifier interprets business authority and policy separately");
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...defaultDecision, businessInquiry: { kind, evidence: text }, humanHandoff: { explicitRequest: false, businessReviewRequired: true, reviewReason: reason, evidence: text } }) } }] }) };
      },
    });
    const jevDecision = { ok: true, confident: true, primaryIntent: "daily_chat", productIntent: "none" };
    const intent = await resolveCommerceSearchIntent({ userText: text, enrichAllTurns: true, searchIntent: { nonShoppingReason: "business_contact" }, jevDecision, classifyCommerce: async () => decision });
    const candidate = resolveChatFeedbackActionCandidate({ character: mascot, userText: text, searchIntent: intent, productContext: { products: [{ name: "Previously shown shirt" }] } });
    check(calls === 1 && intent.businessInquiry.kind === kind && intent.knowledgeScope === "business" && intent.answerRequired && !intent.cardAllowed, "business metadata survives a chat main intent without a second provider call or new product card");
    check(candidate?.kind === "feedback" && candidate.reason === "business_review", "negotiated business request uses the existing feedback form even with a product card present");
    const prompt = applyCommerceQuestionPromptPolicy({}, intent).systemPrompt;
    check(prompt.includes("retrieved business knowledge and verified store policies first") && prompt.includes("Do not invent sales volume") && prompt.includes("Do not claim that a live human is available"), "business prompt uses verified policies, scoped handoff and no invented sales claims");
    check(jevDecision.primaryIntent === "daily_chat", "business interpretation preserves JEV core decision");
  }
  const humanText = "Quiero hablar con una persona de atención al cliente.";
  const human = await resolveCommerceSearchIntent({ userText: humanText, classifyCommerce: async () => ({ ...defaultDecision, confident: true, humanHandoff: { explicitRequest: true, businessReviewRequired: false, evidence: humanText } }) });
  const humanCandidate = resolveChatFeedbackActionCandidate({ character: mascot, userText: humanText, searchIntent: human });
  check(humanCandidate?.reason === "human_request" && !human.businessInquiry && human.knowledgeScope === "business", "explicit support request is independent of business inquiries and uses support knowledge rather than general web search");
  check(resolveChatFeedbackAction({ character: mascot, userText: humanText, searchIntent: human, feedbackActionCandidate: humanCandidate, replyResult: { sourceType: "ai" } }) === humanCandidate, "existing feedback persistence accepts the verified action");
  const copy = appendFeedbackFollowupCopy("Open the settings contact form to reach a live agent.", { character: mascot, feedbackAction: humanCandidate, searchIntent: human });
  check(copy.endsWith("Use the feedback button below to open the form, then submit your question or business request for the team to review."), "server navigation is appended regardless of model navigation heuristic");
  const spanishCopy = appendFeedbackFollowupCopy("", { character: { ...mascot, profile: { language: "Spanish" } }, feedbackAction: humanCandidate, searchIntent: human });
  check(spanishCopy.includes("botón de comentarios de abajo") && spanishCopy.includes("envía"), "localized handoff copy explains below-button form submission");
  const englishCopy = appendFeedbackFollowupCopy("", { character: mascot, feedbackAction: humanCandidate, searchIntent: human });
  for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
    const localizedCharacter = { ...mascot, profile: { language: language.code } };
    const localized = appendFeedbackFollowupCopy("", { character: localizedCharacter, feedbackAction: humanCandidate, searchIntent: human });
    check(localized.length > 30 && (language.code === "en" || localized !== englishCopy), `supported ${language.code} has explicit handoff instructions without English fallback`);
    const localizedAction = resolveChatFeedbackActionCandidate({ character: localizedCharacter, userText: humanText, searchIntent: human });
    check(Boolean(localizedAction?.label) && (language.code === "en" || localizedAction.label !== "Click here"), `supported ${language.code} has a localized handoff button label`);
  }
  check(appendFeedbackFollowupCopy("Keep this answer", { character: { ...mascot, profile: { language: "unsupported-language" } }, feedbackAction: humanCandidate, searchIntent: human }) === "Keep this answer", "an unknown language does not append English handoff instructions");
  check(resolveChatFeedbackActionCandidate({ character: { ...mascot, profile: { language: "unsupported-language" } }, userText: humanText, searchIntent: human }) === null, "unknown language cannot create a new handoff action with an English fallback label");
  const policyText = "¿Admitís dropshipping?";
  const policy = await resolveCommerceSearchIntent({ userText: policyText, classifyCommerce: async () => ({ ...defaultDecision, confident: true, businessInquiry: { kind: "dropshipping", evidence: policyText }, humanHandoff: { explicitRequest: false, businessReviewRequired: false, reviewReason: "none", evidence: policyText } }) });
  check(policy.businessInquiry?.kind === "dropshipping" && !policy.humanHandoff && !resolveChatFeedbackActionCandidate({ character: mascot, userText: policyText, searchIntent: policy }), "routine business policy stays answerable and does not force a human action");
  for (const invalid of [
    { ...defaultDecision, confidence: .5 },
    { ...defaultDecision, confidence: "Infinity" },
    { ...defaultDecision, humanHandoff: { explicitRequest: true, evidence: "invented" } },
    { ...defaultDecision, humanHandoff: { explicitRequest: "true", evidence: "hello" } },
    { ...defaultDecision, businessInquiry: { kind: "dropshipping", evidence: "hello" }, humanHandoff: { businessReviewRequired: true, reviewReason: "policy_missing", evidence: "hello" } },
  ]) {
    const normalized = normalizeCommerceDecision(invalid, { userText: "hello" });
    check(normalized.humanHandoff === null, "low confidence, forged evidence, nonboolean grant and inferred policy gap cannot trigger handoff");
  }
  const stale = normalizeCommerceDecision({ ...defaultDecision, humanHandoff: { explicitRequest: true, evidence: humanText } }, { userText: "Hello, how are you?", recentMessages: [{ senderType: "user", text: humanText }] });
  check(!stale.humanHandoff, "prior request does not stick to an unrelated new turn");
  check(!resolveChatFeedbackActionCandidate({ character: mascot, userText: "Hello, how are you?", searchIntent: { commerceConfidence: .99 } }), "ordinary conversation has no feedback action");
  check(!resolveChatFeedbackActionCandidate({ character: { id: "fan_test", categoryId: "fan" }, userText: humanText, searchIntent: human }), "existing storefront character guard is retained");
  const restricted = { ...human, replyBoundary: { salesAllowed: false, contactAllowed: false } };
  check(!resolveChatFeedbackActionCandidate({ character: mascot, userText: humanText, searchIntent: restricted }), "contact withdrawal blocks even an explicit human request");
  check(!resolveChatFeedbackAction({ feedbackActionCandidate: humanCandidate, searchIntent: restricted }), "a prior candidate cannot bypass contact withdrawal at persistence");
  check(appendFeedbackFollowupCopy("Original answer", { character: mascot, feedbackAction: humanCandidate, searchIntent: restricted }) === "Original answer", "withdrawal also prevents server contact instructions");
  check(!resolveChatFeedbackActionCandidate({ character: mascot, userText: humanText, searchIntent: { ...human, replyBoundary: {} } }), "handoff does not infer contact permission from a missing verdict");
  const unverified = await resolveCommerceSearchIntent({ userText: "hello", classifyCommerce: async () => ({ ...defaultDecision, confident: true, humanHandoff: { explicitRequest: true, evidence: humanText } }) });
  check(!unverified.humanHandoff, "routing revalidates raw injected helper results against current user evidence");
  const failed = await resolveCommerceSearchIntent({ userText: humanText, searchIntent: human, classifyCommerce: async () => { throw new Error("isolated timeout"); } });
  check(!failed.humanHandoff && !failed.businessInquiry && !failed.discountExplanationRequired, "failure cannot reuse prior assistance or policy exception state");
  for (const kind of ["policy", "benefit_request"]) {
    const text = "Explain the promotional discount";
    const promotion = await resolveCommerceSearchIntent({ userText: text, classifyCommerce: async () => ({ ...defaultDecision, confident: true, promotionInquiry: { kind, evidence: text } }) });
    check(promotion.discountExplanationRequired === (kind === "policy") && promotion.discountExplanationEvidence === (kind === "policy" ? text : "") && !promotion.humanHandoff, "policy explanation is evidence-backed and distinct from granting a benefit or requesting a human");
    if (kind === "policy") check(applyCommerceQuestionPromptPolicy({}, promotion).systemPrompt.includes("Policy explanation is not issuing"), "discount explanation has a scoped policy-only instruction");
  }
  const forgedPromotion = await resolveCommerceSearchIntent({ userText: "hello", classifyCommerce: async () => ({ ...defaultDecision, confident: true, discountExplanationRequired: true, discountExplanationEvidence: "hello", promotionInquiry: { kind: "policy", evidence: "invented" } }) });
  check(!forgedPromotion.discountExplanationRequired && !forgedPromotion.discountExplanationEvidence, "a free boolean cannot unlock discount explanation exception");
  console.log(`Commerce handoff self-check passed (${checks} assertions; no external calls or database writes)`);
} finally {
  globalThis.fetch = savedFetch;
  await closeDbPool();
}
