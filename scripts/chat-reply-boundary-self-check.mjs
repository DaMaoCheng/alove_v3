import assert from "node:assert/strict";
process.env.VENICE_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.JEV_API_KEY = "";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { applyReplyBoundaryToProductContext, applyReplyBoundaryPromptPolicy, enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
import { normalizeGuestReplyText } from "../server/guest-chat-output-policy.js";
import { normalizeProductFollowupReply } from "../server/product-followup-sanitizer.js";
import { selectProductsForMessage } from "../server/chat-product-reply-service.js";
import { appendFeedbackFollowupCopy, resolveChatFeedbackAction, resolveChatFeedbackActionCandidate } from "../server/chat-feedback-action-service.js";
import { stripTtsControlTags } from "../server/tts-emotion-tag-service.js";

globalThis.fetch = async () => { throw new Error("External requests forbidden in this check"); };
const mascot = { id: "test", categoryId: "mascot", profile: { language: "Spanish" } };
const product = { id: "test-product", name: "Sample Home Shirt", subtitle: "Sample", url: "https://shop.invalid/sample", priceNow: "USD 40", stock: "In stock" };
const base = { products: [product], cardAllowed: true, searchIntent: {} };
const restricted = { replyBoundary: { salesAllowed: false, contactAllowed: false } };
const safeContext = applyReplyBoundaryToProductContext(base, restricted);
assert.equal(base.cardAllowed, true, "boundary application must not mutate the catalogue context");
assert.deepEqual(selectProductsForMessage(safeContext), [], "restricted turn cannot show a product card");
assert.equal(safeContext.products[0], product, "verified facts remain usable for an actual question");
assert.equal(selectProductsForMessage(applyReplyBoundaryToProductContext(base, { replyBoundary: { salesAllowed: true } })).length, 1, "explicit resumed shopping remains possible");
const candidate = { kind: "feedback", label: "Haz clic aquí" };
assert.equal(resolveChatFeedbackActionCandidate({ character: mascot, knowledgeContext: { customerServiceIntent: true, items: [] }, searchIntent: restricted }), null);
assert.equal(resolveChatFeedbackAction({ character: mascot, feedbackActionCandidate: candidate, searchIntent: restricted }), null, "a previously selected contact action cannot override withdrawal");
assert.equal(appendFeedbackFollowupCopy("Entiendo.", { character: mascot, feedbackAction: candidate, searchIntent: restricted }), "Entiendo.");
assert.match(appendFeedbackFollowupCopy("Entiendo.", { character: mascot, feedbackAction: candidate }), /formulario.*envía/, "ordinary feedback requires actual form submission");
const prompt = { systemPrompt: "Persona unchanged", layers: [] };
assert.equal(applyReplyBoundaryPromptPolicy(prompt, {}), prompt);
assert.match(applyReplyBoundaryPromptPolicy(prompt, restricted).systemPrompt, /receipt of this request does not mean/);
let calls = 0;
const reply = { text: "I understand.", speechText: "Buy another shirt!", sourceType: "ai" };
assert.equal(await enforceReplyBoundary({ replyResult: reply, assess: () => { throw new Error("must not call"); } }), reply, "ordinary turns add no assessment");
const accepted = await enforceReplyBoundary({ replyResult: reply, searchIntent: restricted, language: "en", assess: async () => { calls++; return { allowed: true, confidence: .95 }; } });
assert.equal(calls, 1);
assert.equal(accepted.speechText, accepted.text, "unreviewed sales content in speech cannot escape");
for (const result of [{ allowed: true, confidence: .3 }, { allowed: false, confidence: .99 }, { allowed: "true", confidence: 1 }, null]) {
  const guarded = await enforceReplyBoundary({ replyResult: { ...reply, text: "I've deleted your contact details. Buy another!" }, searchIntent: restricted, language: "hu-HU", assess: async () => result });
  assert.equal(guarded.text, "Értem.");
  assert.equal(guarded.speechText, guarded.text);
  assert.equal(guarded.degradationReason, "reply_boundary_unverified");
}
assert.equal((await enforceReplyBoundary({ replyResult: reply, searchIntent: restricted, language: "es", assess: async () => { throw new Error("timeout"); } })).text, "Entendido.");
const logs = [];
const config = { apiKey: "mock", model: "mock", baseUrl: "https://provider.invalid" };
const assessment = await assessReplyBoundary({ text: "Entendido.", userText: "No me contactes", language: "es", boundary: restricted.replyBoundary, config,
  fetchImpl: async (_url, request) => { const payload = JSON.parse(request.body); assert.equal(payload.response_format.type, "json_schema"); assert.equal(JSON.parse(payload.messages.find(row => row.role === "user").content).boundary.contactAllowed, false); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"allowed":true,"confidence":0.92}' } }] }) }; }, recordLog: async (event) => logs.push(event) });
assert.equal(assessment.allowed, true);
assert.equal(logs.length, 1);
assert.equal((await assessReplyBoundary({ text: "x", config, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [] }) }), recordLog: async () => {} })).allowed, false);

for (const text of [
  "This shirt costs USD 40. Cash payment cannot be confirmed. The office address is not documented.",
  "Esta camiseta es versión jugador. No puedo confirmar el pago en efectivo. No tengo una dirección de atención presencial verificada.",
  "这是球员版。现金付款暂时无法确认。没有查到可核实的门店地址。",
]) {
  const result = normalizeProductFollowupReply({ text, speechText: text, product, preserveAnswer: true });
  assert.equal(result.displayText, text, "all answers must survive card follow-up formatting");
  assert.equal(stripTtsControlTags(result.speechText).replace(/([。！？])\s+/g, "$1"), text);
  assert.equal(normalizeGuestReplyText({ text, product, productCardShown: true, productRequested: true, productSearchIntent: { answerRequired: true } }), text);
}
const mixedNoMatch = "No exact player edition is verified. Cash payment cannot be confirmed.";
assert.equal(normalizeGuestReplyText({ text: mixedNoMatch, productRequested: true, productSearchIntent: { answerRequired: true, commerceRoute: "product_search", searchState: "ready_to_search" } }), mixedNoMatch, "no-match fallback must not discard the second question");
assert.equal(normalizeProductFollowupReply({ text: mixedNoMatch, speechText: "Buy this shirt!", product, preserveAnswer: true }).displayText, mixedNoMatch, "complete answer uses visible text as canonical source");
const pure = normalizeProductFollowupReply({ text: "That fits nicely. A second sales sentence.", product });
assert.equal(pure.displayText.split(/[.!?]/).filter(Boolean).length, 1, "pure recommendation retains the old short-caption contract");
console.log("reply boundary and complete-answer self-check passed (mock classifier/source only; no network or DB writes)");

const { buildChatProductRecommendationContext } = await import("../server/chat-product-recommendation-service.js");
const { resolveGuestProductRecommendation } = await import("../server/guest-chat-product-service.js");
const { buildProductSearchIntent } = await import("../server/product-intent-service.js");
const site = { id: "site_test", slug: "test", product_api_url: "https://shop.invalid/products", currency: "USD" };
const db = { execute: async () => [[site]] };
const recentMessages = [{ senderType: "character", contentType: "product", product: { ...product, siteId: site.id, siteSlug: site.slug, imageUrl: "https://shop.invalid/image.jpg", sizes: [{ label: "L" }] } }];
for (const userText of ["Send me a picture", "Would a size L fit me?"]) {
  const precomputedSearchIntent = { ...buildProductSearchIntent(userText), ...restricted, cardAllowed: false, answerRequired: true, commerceRoute: "product_question", customerServiceKnowledgeRequest: true, shouldLoadProductContext: true };
  const unexpected = async () => { throw new Error("precomputed fast path must not classify/search again"); };
  const account = await buildChatProductRecommendationContext(db, { character: { id: "mascot_test", category_id: "mascot", site_id: site.id }, userText, recentMessages, precomputedSearchIntent, classifyCommerce: unexpected, fetchProducts: unexpected, resolveSizingProduct: async ({ product }) => ({ ...product, sizeChart: null, sizeChartResolved: false }) });
  const guest = await resolveGuestProductRecommendation(db, { guest: { site_id: site.id }, userText, recentMessages, precomputedSearchIntent, classifyCommerce: unexpected, searchProducts: unexpected, resolveSizingProduct: async ({ product }) => ({ ...product, sizeChart: null, sizeChartResolved: false }) });
  for (const context of [account, guest.context]) {
    assert.ok(context, "current product facts remain accessible without a recommendation");
    assert.deepEqual(selectProductsForMessage(context), []);
    assert.equal(context.searchIntent.answerRequired, true);
    assert.equal(context.searchIntent.replyBoundary.contactAllowed, false);
  }
}
console.log("precomputed commerce fast-path checks passed (guest/member image and sizing)");

const { needsProductEvidenceReview } = await import("../server/chat-reply-boundary-service.js");
const { buildGuestProductReplyCopy, buildGuestProductSourceErrorReply } = await import("../server/guest-product-reply-copy.js");
const missingItem = { answerRequired: true, needsLiveProductData: true, commerceRoute: "product_question", replyBoundary: { salesAllowed: true, contactAllowed: true } };
const missingContext = { products: [], searchOutcome: "no_match" };
assert.equal(needsProductEvidenceReview(missingItem, missingContext), true);
assert.equal(needsProductEvidenceReview(missingItem, { products: [product] }), false);
assert.equal(needsProductEvidenceReview(missingItem, { products: [], sourceRef: "current-product-sizing-context", sizingProduct: { name: product.name, sizes: [{ label: "L" }] } }), false, "verified sizing snapshot is real evidence without a new card");
assert.equal(needsProductEvidenceReview(missingItem, { products: [], sourceRef: "unknown", sizingProduct: { name: product.name } }), true, "unvalidated arbitrary sizing object does not suppress review");
let evidenceCalls = 0;
const falseCustomization = await enforceReplyBoundary({ replyResult: { text: "Sí, esta camiseta admite tu nombre y número y está disponible en versión jugador.", speechText: "Confirmed." }, searchIntent: missingItem, productContext: missingContext, language: "es", userText: "¿Se puede imprimir mi nombre? ¿Y aceptan tarjeta?", assess: async (options) => {
  evidenceCalls++;
  assert.equal(options.evidenceRequired, true);
  assert.equal(options.productContext.products.length, 0);
  return { allowed: false, evidenceSupported: false, confidence: .99 };
} });
assert.equal(evidenceCalls, 1);
assert.equal(falseCustomization.text, buildGuestProductReplyCopy("noMatch", { languageCode: "es" }));
assert.equal(falseCustomization.speechText, falseCustomization.text);
assert.equal(falseCustomization.degradationReason, "product_evidence_unverified");
const knowledgeContext = { items: [{ id: "policy-test", title: "Payment", content: "We accept card payments online." }] };
const fullAnswer = "No puedo confirmar que esa camiseta admita personalización. La tienda acepta pagos con tarjeta en línea.";
const supported = await enforceReplyBoundary({ replyResult: { text: fullAnswer }, searchIntent: missingItem, productContext: missingContext, knowledgeContext, language: "es", assess: async (options) => {
  assert.equal(options.knowledgeContext.items[0].content, knowledgeContext.items[0].content);
  return { allowed: true, evidenceSupported: true, confidence: .96 };
} });
assert.equal(supported.text, fullAnswer, "verified payment answer survives missing product data");
assert.equal(supported.speechText, fullAnswer);
const missingVerdict = await enforceReplyBoundary({ replyResult: { text: "Confirmed customization" }, searchIntent: missingItem, productContext: missingContext, language: "hu", assess: async () => ({ allowed: true, confidence: 1 }) });
assert.equal(missingVerdict.text, buildGuestProductReplyCopy("noMatch", { languageCode: "hu" }), "old/malformed assessor output cannot approve facts");
let combinedCalls = 0;
const combined = await enforceReplyBoundary({ replyResult: { text: "I've canceled contact. Buy this custom shirt." }, searchIntent: { ...missingItem, ...restricted }, productContext: { ...missingContext, searchOutcome: "source_error" }, language: "hu", assess: async () => { combinedCalls++; throw new Error("timeout"); } });
assert.equal(combinedCalls, 1, "boundary and evidence share a single bounded assessment");
assert.equal(combined.text, buildGuestProductSourceErrorReply({ languageCode: "hu" }), "fallback answers source failure without promising contact or sales");
await assessReplyBoundary({ text: fullAnswer, userText: "¿Personalización y tarjeta?", language: "es", evidenceRequired: true, productContext: missingContext, knowledgeContext, config,
  fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    const data = JSON.parse(body.messages[1].content);
    assert.equal(data.evidenceRequired, true);
    assert.deepEqual(data.evidence.catalogueProducts, []);
    assert.equal(data.evidence.knowledge[0].id, "policy-test");
    assert.match(data.evidence.knowledge[0].content, /card payments/);
    assert.match(body.messages[0].content, /General store policy cannot prove/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"allowed":true,"confidence":0.96,"evidenceSupported":true}' } }] }) };
  }, recordLog: async () => {} });
console.log("missing product evidence guard checks passed (unsupported customization rejected; supported payment answer retained; one combined review)");

const { mergeReplyCommerceContext } = await import("../server/chat-reply-boundary-service.js");
const requestedImageIntent = { ...buildProductSearchIntent("Send me a picture"), commerceRoute: "product_question", cardAllowed: false, answerRequired: true, shouldLoadProductContext: true, replyBoundary: { salesAllowed: true, contactAllowed: true } };
const imageOptions = { userText: "Send me a picture", recentMessages, precomputedSearchIntent: requestedImageIntent, classifyCommerce: async () => { throw new Error("already classified"); } };
const imageAccount = await buildChatProductRecommendationContext(db, { ...imageOptions, character: { id: "mascot_test", category_id: "mascot", site_id: site.id }, fetchProducts: async () => { throw new Error("current image must not re-search"); } });
const imageGuest = await resolveGuestProductRecommendation(db, { ...imageOptions, guest: { site_id: site.id }, searchProducts: async () => { throw new Error("current image must not re-search"); } });
for (const context of [imageAccount, imageGuest.context]) {
  const selected = selectProductsForMessage(context);
  assert.equal(selected.length, 1, "explicit current image remains available with product_question metadata");
  assert.equal(selected[0].id, product.id);
  assert.equal(selected[0].imageUrl, recentMessages[0].product.imageUrl);
  assert.equal(context.searchIntent.cardAllowed, true);
  assert.equal(selectProductsForMessage(mergeReplyCommerceContext(context, requestedImageIntent)).length, 1, "registered orchestrator merge preserves the deterministic image decision");
  assert.deepEqual(selectProductsForMessage(mergeReplyCommerceContext(context, { ...requestedImageIntent, ...restricted })), [], "image reuse cannot bypass explicit sales refusal");
}
assert.deepEqual(selectProductsForMessage(mergeReplyCommerceContext(base, requestedImageIntent)), [], "a generic product question still cannot send a new recommendation");
console.log("explicit current product image regression checks passed (guest/member, same image, no fresh search, refusal respected)");

// Ordinary authorized searches require evidence even when they are short captions.
const singleSearch = { commerceRoute: "product_search", shouldLoadProductContext: true, answerRequired: false, needsLiveProductData: false,
  searchState: "ready_to_search", replyBoundary: { salesAllowed: true, contactAllowed: true } };
for (const userText of ["Show me training tops", "Find a rain jacket"] ) {
  assert.equal(needsProductEvidenceReview(singleSearch, missingContext), true, userText + ": empty authorized search is reviewed independently of complete-answer flags");
  let reviews = 0;
  const rejected = await enforceReplyBoundary({ replyResult: { text: "I selected several products. Click them below.", speechText: "They are ready." }, searchIntent: singleSearch,
    productContext: missingContext, userText, assess: async ({ evidenceRequired }) => { reviews++; assert.equal(evidenceRequired, true); return { allowed: false, confidence: .99, evidenceSupported: false }; } });
  assert.equal(reviews, 1);
  assert.equal(rejected.text, buildGuestProductReplyCopy("noMatch", { languageCode: "en" }));
  assert.equal(rejected.speechText, rejected.text);
}
for (const intent of [
  { ...singleSearch, shouldLoadProductContext: undefined }, { ...singleSearch, shouldLoadProductContext: "true" },
  { ...singleSearch, commerceRoute: "chat" }, { ...singleSearch, nonShoppingReason: "football conversation" },
  { ...singleSearch, replyBoundary: { salesAllowed: false } },
  { ...singleSearch, productScopePending: true },
  { ...singleSearch, productRequestState: { status: "selected", version: 1 } },
]) assert.equal(needsProductEvidenceReview(intent, missingContext), false, "new guard does not create shopping permission or take over a multi-item scope");
assert.equal(needsProductEvidenceReview(singleSearch, { products: [{ name: "  " }, null] }), true);
assert.equal(needsProductEvidenceReview(singleSearch, { products: [product] }), false);
assert.equal(needsProductEvidenceReview(singleSearch, { products: [], sourceRef: "current-product-sizing-context", sizingProduct: { name: product.name } }), false);
assert.equal(needsProductEvidenceReview(missingItem, missingContext), true, "legacy live-facts condition remains supported");
const paymentParagraph = "Card payments are accepted online.";
const proposedProductAnswer = paymentParagraph + "\n\nI selected the requested products. Click them below.";
const retainedEvidenceVerdict = { allowed: false, confidence: .99, evidenceSupported: false, retainedTextAllowed: true, retainedText: paymentParagraph,
  retainedEvidenceSupported: true, retainedBoundarySupported: true, retainedLanguageQualitySupported: true };
async function checkSingleRetained(verdict, options = {}) {
  return enforceReplyBoundary({ replyResult: { text: proposedProductAnswer, speechText: "Unverified products are ready." }, searchIntent: singleSearch,
    productContext: missingContext, knowledgeContext, language: "en", assess: async () => verdict, ...options });
}
const retainedPayment = await checkSingleRetained(retainedEvidenceVerdict);
assert.equal(retainedPayment.text, paymentParagraph + "\n\n" + buildGuestProductReplyCopy("noMatch", { languageCode: "en" }));
assert.equal(retainedPayment.partialAnswerRetained, true);
assert.equal(retainedPayment.degradationReason, "product_evidence_unverified");
assert.equal(retainedPayment.speechText, retainedPayment.text);
for (const field of ["retainedTextAllowed", "retainedEvidenceSupported", "retainedBoundarySupported", "retainedLanguageQualitySupported"]) {
  for (const value of [undefined, false, "true"]) {
    const denied = await checkSingleRetained({ ...retainedEvidenceVerdict, [field]: value });
    assert.ok(!denied.text.includes(paymentParagraph), field + " must be strictly true");
    assert.equal(denied.partialAnswerRetained, false);
  }
}
for (const change of [{ confidence: "0.99" }, { retainedText: "payments are accepted online." }, { retainedText: "Rewritten policy." },
  { retainedText: proposedProductAnswer }, { retainedText: paymentParagraph + "\n\nClick them below." }]) {
  assert.ok(!(await checkSingleRetained({ ...retainedEvidenceVerdict, ...change })).text.includes(paymentParagraph), "score/slice/rewrite cannot authorize retention");
}
const singleLine = await checkSingleRetained(retainedEvidenceVerdict, { replyResult: { text: paymentParagraph + "\nUnverified product claim." } });
assert.ok(!singleLine.text.includes(paymentParagraph), "one newline is not a complete paragraph boundary");
for (const verdict of [null, { allowed: true, confidence: .99 }, { allowed: true, confidence: .99, evidenceSupported: "true" }]) {
  assert.ok(!(await checkSingleRetained(verdict)).text.includes("I selected"), "missing/string evidence cannot approve the original response");
}
const honestClarification = "Which kind of training top would you like?";
const honestResult = await enforceReplyBoundary({ replyResult: { text: honestClarification }, searchIntent: singleSearch, productContext: missingContext,
  assess: async () => ({ allowed: true, confidence: .99, evidenceSupported: true }) });
assert.equal(honestResult.text, honestClarification, "a reviewed honest clarification is preserved");
for (const [field, extra] of [
  ["retainedBusinessFactsSupported", { character: mascot, searchIntent: { ...singleSearch, answerRequired: true, knowledgeScope: "business" } }],
  ["retainedFactualSupported", { factualContext: { required: true, status: "disabled", asOfUtc: "2026-10-11T00:00:00Z", items: [], searched: false } }],
  ["retainedGuidanceSupported", { character: mascot, searchIntent: { ...singleSearch, knowledgeScope: "business", commerceTopic: "support" } }],
  ["retainedImageStatusSupported", { chatImageContext: { imageStatus: { kind: "generated", status: "failed", currentTurn: true } } }],
]) {
  let observed;
  const wholeField = { retainedBusinessFactsSupported: "businessFactsSupported", retainedFactualSupported: "factualSupported",
    retainedGuidanceSupported: "guidanceSupported", retainedImageStatusSupported: "imageStatusSupported" }[field];
  const all = { ...retainedEvidenceVerdict, [wholeField]: false, [field]: true };
  const approved = await checkSingleRetained(all, { ...extra, assess: async (request) => { observed = request; return all; } });
  const requiredFlag = { retainedBusinessFactsSupported: "businessFactsRequired", retainedFactualSupported: "factualRequired", retainedGuidanceSupported: "guidanceRequired", retainedImageStatusSupported: "imageStatusContext" }[field];
  assert.ok(observed[requiredFlag], field + " fixture activates the real adjacent contract");
  assert.ok(approved.text.includes(paymentParagraph), field + " true permits an independently supported paragraph");
  if (field === "retainedFactualSupported") assert.equal(approved.text, retainedPayment.text, "supported retained public facts do not receive a redundant unverified-fact warning");
  for (const value of [undefined, false, "true"]) {
    const denied = await checkSingleRetained({ ...all, [field]: value }, extra);
    assert.ok(!denied.text.includes(paymentParagraph), field + " missing/false/string must not salvage an unsupported parallel answer");
  }
}
const parsedRetained = await assessReplyBoundary({ text: proposedProductAnswer, evidenceRequired: true, productContext: missingContext, config,
  fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.match(body.messages.map(m => m.content).join("\n"), /retainedEvidenceSupported/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...retainedEvidenceVerdict, retainedGuidanceSupported: "true", retainedImageStatusSupported: "true" }) } }] }) };
  }, recordLog: async () => {} });
assert.equal(parsedRetained.evidenceSupported, false, "partial retention cannot make the complete response pass");
assert.equal(parsedRetained.retainedEvidenceSupported, true);
assert.equal(parsedRetained.retainedGuidanceSupported, undefined, "invalid retained field is not an explicit rejection");
assert.equal(parsedRetained.retainedImageStatusSupported, undefined);
console.log("ordinary single-product evidence and strict retained-paragraph regression checks passed");

// Exercise the production JSON parser without a language/facts/scope contract.
for (const confidence of [.99, "0.99"]) {
  const parsed = await assessReplyBoundary({ text: proposedProductAnswer, speechText: "The requested products are available.", evidenceRequired: true,
    productContext: missingContext, config, fetchImpl: async (_url, request) => {
      const data = JSON.parse(JSON.parse(request.body).messages.at(-1).content);
      assert.equal(data.proposedSpeech, "The requested products are available.", "evidence-only review must inspect speech too");
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...retainedEvidenceVerdict, confidence }) } }] }) };
    }, recordLog: async () => {} });
  assert.equal(parsed.confidence, typeof confidence === "number" ? .99 : 0, "string scores are rejected by the real evidence-only parser");
  const guarded = await checkSingleRetained(parsed);
  assert.equal(guarded.text.includes(paymentParagraph), typeof confidence === "number", "parser score cannot smuggle unauthorized retention");
}
const { buildGuestBenefitContext: makeRetainedBenefit } = await import("../server/guest-benefit-guidance-service.js");
const benefit = makeRetainedBenefit({ isGuest: true, userText: "coupon", languageCode: "en", searchIntent: { commerceConfidence: .96, promotionInquiry: { kind: "benefit_request", evidence: "coupon" } } });
assert.ok(benefit, "guest benefit fixture is server-built, not an arbitrary client object");
const benefitsApproved = { ...retainedEvidenceVerdict, guestBenefitSupported: false, guidanceSupported: false,
  retainedGuestBenefitSupported: true, retainedGuidanceSupported: true };
const benefitsRetained = await checkSingleRetained(benefitsApproved, { guestBenefitContext: benefit, character: mascot, userText: "coupon" });
assert.ok(benefitsRetained.text.includes(paymentParagraph), "independently supported payment paragraph survives guest-benefit review");
for (const field of ["retainedGuestBenefitSupported", "retainedGuidanceSupported"]) {
  for (const value of [undefined, false, "true"]) {
    const denied = await checkSingleRetained({ ...benefitsApproved, [field]: value }, { guestBenefitContext: benefit, character: mascot, userText: "coupon" });
    assert.ok(!denied.text.includes(paymentParagraph), field + " must independently pass the guest-benefit parallel contract");
  }
}
const allowedWithoutEvidence = await checkSingleRetained({ allowed: true, confidence: .99, evidenceSupported: false });
assert.ok(!allowedWithoutEvidence.text.includes("I selected"), "allowed=true is not permission to bypass evidenceSupported=false");
console.log("evidence-only parser and guest-benefit retained-contract checks passed");

for (const scenario of [
  { intent: { ...singleSearch, searchState: "ready_to_search" }, context: { products: [], searchOutcome: "no_match" }, outcome: "no_match" },
  { intent: { ...singleSearch, searchState: "ready_to_search" }, context: { products: [], searchOutcome: "unknown" }, outcome: "not_searched" },
  { intent: { ...singleSearch, searchState: "source_error", sourceErrorCode: "source_unconfigured" }, context: null, outcome: "source_error" },
  { intent: { ...singleSearch, searchState: "clarification_exhausted" }, context: null, outcome: "clarification_exhausted" },
]) {
  let reviewedEvidence;
  const stateVerdict = await assessReplyBoundary({ text: "Please specify one product.", evidenceRequired: true, searchIntent: scenario.intent, productContext: scenario.context, config,
    fetchImpl: async (_url, request) => {
      reviewedEvidence = JSON.parse(JSON.parse(request.body).messages.at(-1).content).evidence;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"allowed":true,"confidence":0.99,"evidenceSupported":true}' } }] }) };
    }, recordLog: async () => {} });
  assert.equal(stateVerdict.allowed, true, "real parser successfully consumes the controlled response");
  assert.equal(reviewedEvidence.searchOutcome, scenario.outcome, "the real review receives canonical state including null-context cases");
  assert.equal(reviewedEvidence.searchState, scenario.intent.searchState);
  assert.equal(reviewedEvidence.clarificationExhausted, scenario.outcome === "clarification_exhausted");
  assert.equal(reviewedEvidence.sourceErrorCode, scenario.intent.sourceErrorCode || "");
}
console.log("real evidence parser receives canonical actual-search states, including absent context");
