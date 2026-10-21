import { getChatOrderEntryCopy } from '../shared/chat-order-copy.js';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Unexpected network call"); };
const { normalizeGuestReplyText } = await import("../server/guest-chat-output-policy.js");
const { enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { resolveChatFeedbackActionCandidate, resolveChatFeedbackAction } = await import("../server/chat-feedback-action-service.js");
const feedbackInput = { character: { categoryId: "mascot", profile: { language: "Spanish" } }, userText: "Track my order", knowledgeContext: { customerServiceIntent: true, items: [] },
  searchIntent: { replyBoundary: { contactAllowed: true }, commerceConfidence: .95, commerceTopic: "delivery" } };

const prompt = buildChatReplyPrompt({
  character: { id: "mascot_alba_spanish_20260909", name: "Alba", categoryId: "mascot", profile: { language: "Spanish" } },
  userText: "Estado de mi pedido 680CBA3038C01CC6",
});
const policy = prompt.layers.find((layer) => layer.id === "global_reply_policy")?.content || "";
assert.match(policy, /no order, delivery, tracking/i);
assert.match(policy, /Never claim to be checking/i);
assert.match(policy, /never invent order contents or status/i);
assert.match(policy, /briefly apologize/i);
assert.match(policy, /cannot check it here/i);
for (const status of ["login_required", "binding_required"]) {
  const candidate = { kind: "ttmall_order_lookup", siteSlug: "pj", status, orderNumber: "PRIVATE_ORDER_REFERENCE" };
  assert.equal(resolveChatFeedbackActionCandidate({ ...feedbackInput, orderActionCandidate: candidate }), null, "Available order entry replaces only the generic unavailable-tracking handoff");
  assert.equal(resolveChatFeedbackAction({ ...feedbackInput, orderActionCandidate: candidate, replyResult: { sourceType: "ai", text: "Use the order entry" } }), null, "Persistence must not re-add the generic handoff");
  assert.ok(resolveChatFeedbackActionCandidate({ ...feedbackInput, orderActionCandidate: candidate,
    searchIntent: { ...feedbackInput.searchIntent, humanHandoff: { explicitRequest: true, evidence: "Track my order" } } }), "Explicit human help still works alongside an order entry");
  assert.ok(resolveChatFeedbackActionCandidate({ ...feedbackInput, orderActionCandidate: candidate, knowledgeContext: { ...feedbackInput.knowledgeContext, customerServiceTopic: "returns" } }), "Returns handoff is preserved");
  assert.ok(resolveChatFeedbackActionCandidate({ ...feedbackInput, orderActionCandidate: candidate, searchIntent: { ...feedbackInput.searchIntent, commerceTopic: "support" } }), "Unknown independent support knowledge still has its original handoff");
  const actionPrompt = buildChatReplyPrompt({ character: { categoryId: "mascot" }, userText: "Where is my order?", orderActionCandidate: candidate }).systemPrompt;
  assert.match(actionPrompt, /system will append one real order action/i);
  assert.match(actionPrompt, /not an order lookup result/i);
  assert.match(actionPrompt, status === "login_required" ? /sign in/ : /if requested/);
  assert.doesNotMatch(actionPrompt, /direct the user to the store's order page or support/);
  assert.doesNotMatch(actionPrompt, /PRIVATE_ORDER_REFERENCE/);
  const text = "Puedes usar la opción de pedidos y vincular la cuenta si se solicita.";
  assert.equal(normalizeGuestReplyText({ text, userText: "Track my order", languageCode: "es", productSearchIntent: { answerRequired: true }, orderActionCandidate: candidate }), text,
    "A real order action must not be replaced by the old external-tracking copy");
  const deliveryPrompt = buildChatReplyPrompt({ character: { categoryId: "mascot" }, orderActionCandidate: candidate,
    knowledgeContext: { customerServiceIntent: true, customerServiceTopic: "delivery", items: [{ content: "Standard shipping: 10–25 days." }] } }).systemPrompt;
  assert.doesNotMatch(deliveryPrompt, /direct the user to the carrier tracking page/);
  let calls = 0;
  const reviewed = await enforceReplyBoundary({ character: { categoryId: "mascot" }, searchIntent: { knowledgeScope: "business", commerceTopic: "delivery" },
    replyResult: { text, speechText: "Unchecked old speech" }, orderActionCandidate: candidate,
    assess: async (input) => { calls++; assert.equal(input.orderActionState, status); assert.ok(!JSON.stringify(input).includes("PRIVATE_ORDER_REFERENCE")); return { allowed: true, guidanceSupported: true, confidence: .95 }; } });
  assert.equal(calls, 1, "Reuse the existing single review");
  assert.equal(reviewed.text, text);
  assert.equal(reviewed.speechText, text);
  let body;
  await assessReplyBoundary({ text, userText: "Where is my order?", guidanceRequired: true, orderActionState: status,
    config: { apiKey: "fixture", baseUrl: "https://fixture.invalid", model: "fixture" }, recordLog: async () => {},
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"allowed":true,"guidanceSupported":true,"confidence":0.95}' } }] }) }; } });
  assert.equal(JSON.parse(body.messages.at(-1).content).orderActionState, status);
  assert.ok(body.messages.some((m) => m.content.includes("narrow exception")));
  const rejected = await enforceReplyBoundary({ character: { categoryId: "mascot" }, language: "es", searchIntent: { knowledgeScope: "business", commerceTopic: "delivery" },
    orderActionCandidate: candidate, replyResult: { text: "Your order arrives tomorrow.", speechText: "Your order arrives tomorrow." }, assess: async () => ({ allowed: false, guidanceSupported: false, confidence: .99 }) });
  assert.equal(rejected.text, getChatOrderEntryCopy("es", status), "Rejected wording keeps the truthful entry state");
  assert.equal(rejected.speechText, rejected.text);
  assert.equal(rejected.degraded, true);
}
for (const candidate of [null, {}, { kind: "feedback", status: "login_required", siteSlug: "pj" }, { kind: "ttmall_order_lookup", status: "complete", siteSlug: "pj" }, { kind: "ttmall_order_lookup", status: "login_required", siteSlug: "" }]) {
  assert.equal(buildChatReplyPrompt({ character: { categoryId: "mascot" }, userText: "Where is my order?", orderActionCandidate: candidate }).systemPrompt,
    buildChatReplyPrompt({ character: { categoryId: "mascot" }, userText: "Where is my order?" }).systemPrompt, "No valid reserved action must keep the existing policy");
}
assert.notEqual(normalizeGuestReplyText({ text: "Original answer", userText: "Track my order", languageCode: "es" }), "Original answer", "Unsupported sites keep the old tracking boundary");
assert.ok(resolveChatFeedbackActionCandidate(feedbackInput), "Unavailable order sites keep their existing feedback fallback");
const guestSource = readFileSync("server/guest-reply-service.js", "utf8");
assert.equal((guestSource.match(/await resolveTtmallOrderAction\(/g) || []).length, 1);
assert.ok(guestSource.indexOf("await resolveTtmallOrderAction(") < guestSource.indexOf("await generateChatReply("));
assert.match(guestSource, /shouldSkipOrderLookupForCheckout\(productRecommendation.searchIntent\)/);
assert.match(guestSource, /product: orderAction,/);
const orchestrator = readFileSync("server/chat-reply-orchestrator-service.js", "utf8");
assert.equal((orchestrator.match(/await resolveTtmallOrderAction\(/g) || []).length, 1);
assert.ok(orchestrator.indexOf("await resolveTtmallOrderAction(") < orchestrator.indexOf("await generateChatReply("));
assert.match(orchestrator, /!orderLookupSiteSlug/);
assert.match(orchestrator, /shouldSkipOrderLookupForCheckout\(commerceSearchIntent\)/);
const registered = readFileSync("server/chat-text-message-service.js", "utf8");
assert.doesNotMatch(registered, /resolveTtmallOrderAction/);
assert.match(registered, /orderLookupSiteSlug: siteSlug \|\| siteRow\?\.slug \|\| ""/);
assert.match(registered, /product: orderAction,/);
assert.doesNotMatch(readFileSync("server/chat-voice-message-service.js", "utf8"), /orderLookupSiteSlug|orderActionCandidate/,
  "Voice must not promise an action it does not persist");
console.log("chat-order-boundary-self-check: PASS");
