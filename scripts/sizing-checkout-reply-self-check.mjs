import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Network disabled for reply integration self-check"); };
const { buildProductContextLayer } = await import("../server/chat-prompt-layers.js");
const { normalizeCheckoutIssue, shouldSkipOrderLookupForCheckout } = await import("../server/checkout-support-guidance.js");
const { applyCheckoutSupportPromptPolicy, enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { resolveChatFeedbackActionCandidate, appendFeedbackFollowupCopy } = await import("../server/chat-feedback-action-service.js");
const { normalizeGuestReplyText } = await import("../server/guest-chat-output-policy.js");
const character = { id: "mascot_check", categoryId: "mascot", profile: { language: "Spanish" } };
const chart = { title: "Size chart", unit: "CM", columns: ["Size", "Chest"], rows: [["M", "104"]] };
const product = { name: "Verified current shirt", sizes: [{ label: "M", available: true }], sizeChart: chart, sizeChartResolved: true };
for (const cardAllowed of [true, false]) {
  const layer = buildProductContextLayer(character, { cardAllowed, sourceRef: "current-product-sizing-context", sizingProduct: product, products: [], searchIntent: { intent: "sizing", answerRequired: true } });
  assert.match(layer.content, /Verified current shirt/);
  assert.match(layer.content, /104/);
  assert.match(layer.content, /CM/);
}
const noUnits = buildProductContextLayer(character, { cardAllowed: false, sourceRef: "guest-current-product-sizing-context", sizingProduct: { ...product, sizeChart: { ...chart, unit: "" } }, products: [], searchIntent: { intent: "sizing" } });
assert.match(noUnits.content, /Do not assume units/);
const { buildProductSizingFallback } = await import("../server/product-sizing-copy.js");
const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const text = buildProductSizingFallback({}, language.code);
  assert(text);
  if (language.code !== "en") assert.notEqual(text, buildProductSizingFallback({}, "en"));
}
for (const resolved of [true, false]) {
  const guarded = await enforceReplyBoundary({ character, searchIntent: { answerRequired: true }, productContext: { sourceRef: "current-product-sizing-context", sizingProduct: { ...product, sizeChartResolved: resolved } }, language: "es", replyResult: { text: "Guaranteed fit!", sourceType: "ai" }, assess: async (input) => {
    assert.equal(input.sizingRequired, true);
    return { allowed: false, confidence: 1 };
  } });
  assert.equal(guarded.text, buildProductSizingFallback({ ...product, sizeChartResolved: resolved }, "es"));
  if (!resolved) assert.doesNotMatch(guarded.text, /104|CM|no tiene|no existe/);
}
const recentMessages = [{ senderType: "user", text: "No he enviado ningún pedido. El proceso se bloquea al escribir la dirección; solo necesito terminar esta compra." }];
const userText = "Ya cambié de navegador y sigue saliendo Error 409; solo necesito terminar esta compra y no quiero que me contacten.";
const checkoutIssue = normalizeCheckoutIssue({ active: true, requestScope: "checkout_only", evidence: "sigue saliendo Error 409", stage: "address", stageEvidence: "escribir la dirección", errorEvidence: "Error 409", failedAttempts: ["Ya cambié de navegador y sigue saliendo Error 409"], orderPlaced: false, orderEvidence: "No he enviado ningún pedido", lookupRequested: false, lookupEvidence: "solo necesito terminar esta compra" }, { userText, recentMessages, confidence: .95 });
const intent = { checkoutIssue, answerRequired: true, knowledgeScope: "business", commerceTopic: "support", replyBoundary: { salesAllowed: false, contactAllowed: false } };
assert(shouldSkipOrderLookupForCheckout(intent));
assert(!shouldSkipOrderLookupForCheckout({ checkoutIssue: { ...checkoutIssue } }));
const base = { systemPrompt: "Persona", layers: [] };
assert.equal(applyCheckoutSupportPromptPolicy(base, intent, { categoryId: "babe" }), base);
assert.match(applyCheckoutSupportPromptPolicy(base, intent, character).systemPrompt, /Do not repeat a step/);
let calls = 0;
const accepted = await enforceReplyBoundary({ character, searchIntent: intent, userText, recentMessages, language: "es", replyResult: { text: "No puedo confirmar la causa del error 409 aquí.", speechText: "Unreviewed", sourceType: "ai" }, assess: async (input) => {
  calls++;
  assert.equal(input.guidanceRequired, true);
  assert.match(input.checkoutContext.failedAttempts[0], /navegador/);
  assert.equal(input.checkoutContext.stage, "address");
  return { allowed: true, confidence: .96, guidanceSupported: true };
} });
assert.equal(calls, 1, "combined review uses one call");
assert.equal(accepted.speechText, accepted.text);
const fallback = await enforceReplyBoundary({ character, searchIntent: intent, userText, recentMessages, language: "es", replyResult: { text: "Your address is wrong. Try another browser.", sourceType: "ai" }, assess: async () => ({ allowed: false, confidence: .99 }) });
assert.match(fallback.text, /No puedo confirmar la causa/);
assert.equal(fallback.speechText, fallback.text);
assert.equal(resolveChatFeedbackActionCandidate({ character, searchIntent: intent, knowledgeContext: { items: [] }, userText }), null);
const allowedIntent = { ...intent, replyBoundary: { salesAllowed: true, contactAllowed: true } };
const action = resolveChatFeedbackActionCandidate({ character, searchIntent: allowedIntent, knowledgeContext: { items: [] }, userText });
assert.equal(action.reason, "checkout_review");
assert.match(appendFeedbackFollowupCopy("Consulta", { character, feedbackAction: action, searchIntent: allowedIntent }), /formulario/);
assert.equal(resolveChatFeedbackActionCandidate({ character, searchIntent: allowedIntent, knowledgeContext: { items: [{ content: "Relevant verified instruction" }] }, userText }), null);
assert.equal(resolveChatFeedbackActionCandidate({ character, searchIntent: { ...allowedIntent, checkoutIssue: normalizeCheckoutIssue({ active: true, evidence: "sigue saliendo Error 409" }, { userText, recentMessages, confidence: .95 }) }, knowledgeContext: { items: [] }, userText }), null);
assert.equal(normalizeGuestReplyText({ text: "Checkout help", userText: "Error AB12345678", productSearchIntent: allowedIntent }), "Checkout help");
const controlled = await enforceReplyBoundary({ character, searchIntent: allowedIntent, userText, recentMessages, knowledgeContext: { items: [] }, language: "es", replyResult: { text: "Your address is wrong", sourceType: "ai" }, assess: async () => { throw new Error("empty knowledge checkout must not assess ungrounded candidate"); } });
assert.match(controlled.text, /No puedo confirmar la causa/);
assert.equal(controlled.text, controlled.speechText);
const mixedText = "This item costs EUR 40. I cannot verify why checkout fails.";
const mixedReply = await enforceReplyBoundary({ character, searchIntent: allowedIntent, userText, recentMessages, productContext: { products: [{ name: "Known shirt", priceNow: "EUR 40" }] }, knowledgeContext: { items: [] }, language: "en", replyResult: { text: mixedText, sourceType: "ai" }, assess: async () => ({ allowed: true, guidanceSupported: true, confidence: .95 }) });
assert.equal(mixedReply.text, mixedText, "verified concurrent product facts must survive empty checkout KB");
assert.equal(resolveChatFeedbackActionCandidate({ character, searchIntent: { answerRequired: true, replyBoundary: { contactAllowed: true } }, productContext: { sourceRef: "guest-current-product-sizing-context", sizingProduct: product, products: [] }, knowledgeContext: { customerServiceIntent: true, items: [] }, userText: "Chest measurement?" }), null, "missing policy knowledge must not add contact to a current size-chart answer");
const transportText = "El servicio no est\u00e1 disponible ahora.";
const transportReply = await enforceReplyBoundary({ character, searchIntent: allowedIntent, userText, recentMessages, knowledgeContext: { items: [] }, language: "es", replyResult: { text: transportText, sourceType: "system", degradationReason: "ai_request_failed_fallback" }, assess: async () => { throw new Error("transport fallback must not review"); } });
assert.equal(transportReply.text, transportText, "existing honest transport failures survive the checkout fallback");
let payload;
await assessReplyBoundary({ text: accepted.text, userText, guidanceRequired: true, checkoutContext: { failedAttempts: ["changed browser"], stage: "address" }, config: { apiKey: "test", model: "test", baseUrl: "https://invalid.test" }, recordLog: async () => {}, fetchImpl: async (_url, options) => {
  payload = JSON.parse(options.body);
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ allowed: true, confidence: .95, guidanceSupported: true }) } }] }) };
} });
assert.match(payload.messages.find((row) => row.content.includes("active checkout issue")).content, /Reject repeating/);
assert.deepEqual(JSON.parse(payload.messages.at(-1).content).checkoutContext.failedAttempts, ["changed browser"]);
for (const checkoutProblem of [true, false, undefined]) {
  const result = await assessReplyBoundary({ text: "Candidate", userText: "Current concern", checkoutContext: { classificationUnavailable: true, recentUserMessages: [] }, config: { apiKey: "test", model: "test", baseUrl: "https://invalid.test" }, recordLog: async () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ allowed: true, confidence: 1, checkoutProblem }) } }] }) }) });
  assert.equal(result.allowed, checkoutProblem === false, "unclear checkout cannot bypass safe fallback while other classified concerns keep normal review");
}
console.log("sizing and checkout reply integration self-check passed (prompt facts, persona scope, combined review, order gate, feedback, voice parity; no network/DB)");

// Same elliptical current turn, different USER-owned contexts. The auxiliary
// checkout check receives bounded user evidence even after many assistant/action
// rows; these scripted verdicts test transport/context, not a model simulation.
for (const [name, historyText, checkoutProblem] of [
 ['reported shipment', 'now for 6 days it says that awaiting customs clearance', false],
 ['unsubmitted checkout', 'I cannot submit my new order because the payment step fails', true],
]) {
 const recent = [{ senderType: 'user', text: historyText },
  ...Array.from({ length: 7 }, () => ({ senderType: 'character', text: 'Untrusted assistant advice' }))];
 let captured;
 const candidate = 'What result did you see after trying that?';
 const result = await enforceReplyBoundary({ character, userText: 'I tried and it’s says the same', recentMessages: recent,
  searchIntent: { commerceRoute: 'unclear', commerceTopic: 'delivery', knowledgeScope: 'business', answerRequired: true,
   replyBoundary: { salesAllowed: false, contactAllowed: false } }, language: 'en',
  knowledgeContext: { items: [], strategy: 'business_no_verified_answer' }, replyResult: { text: candidate, speechText: candidate, sourceType: 'ai' },
  recordReview: async () => {},
  assess: input => assessReplyBoundary({ ...input, config: { apiKey: 'test', model: 'test', baseUrl: 'https://invalid.test' }, recordLog: async () => {},
   fetchImpl: async (_url, options) => {
    captured = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ allowed: true, confidence: .99,
     boundarySupported: true, evidenceSupported: true, guidanceSupported: true, businessFactsSupported: true, checkoutProblem }) } }] }) };
   } }),
 });
 const evidence = JSON.parse(captured.messages.at(-1).content).checkoutContext.recentUserMessages;
 assert.deepEqual(evidence, [historyText], name + ': recent USER facts survive assistant/action rows');
 const contract = captured.messages.map(row => row.content).join('\n');
 assert.match(contract, /not yet completed.*checkout/i);
 assert.match(contract, /uncertainty.*not.*true/i);
 assert.equal(result.text === candidate, !checkoutProblem, name + ': existing true-reject/false-review gate remains');
}
console.log('unclear checkout current/recent USER evidence and preserved auxiliary gates passed');
