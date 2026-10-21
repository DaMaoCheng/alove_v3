import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { enforceReplyBoundary, assessReplyBoundary, needsSupportGuidanceReview } = await import("../server/chat-reply-boundary-service.js");
const { buildChatReplyPrompt } = await import("../server/chat-prompt-service.js");

const character = { id: "mascot_support_check", categoryId: "mascot", profile: { language: "Spanish" } };
const intent = { knowledgeScope: "business", commerceTopic: "support", answerRequired: true,
  replyBoundary: { salesAllowed: true, contactAllowed: true } };
const action = { kind: "feedback", label: "Haz clic aquí", reason: "human_request" };
assert(needsSupportGuidanceReview(intent, character));
assert(needsSupportGuidanceReview({ commerceRoute: "store_policy", commerceTopic: "price", knowledgeScope: "business", answerRequired: true, businessInquiry: null, discountExplanationRequired: false }, character), "missing assistance metadata must not skip price-policy review");
assert(!needsSupportGuidanceReview(intent, { categoryId: "babe" }));
assert(!needsSupportGuidanceReview({ commerceTopic: "delivery", knowledgeScope: "business" }, character));
assert(!needsSupportGuidanceReview({}, character));
const prompt = buildChatReplyPrompt({ character, userText: "Quiero hablar con una persona", feedbackActionCandidate: action });
assert.match(prompt.systemPrompt, /Navigation is a verified capability/);
assert.match(prompt.systemPrompt, /not live human chat/);
assert.match(prompt.systemPrompt, /user still needs to submit/);
assert.doesNotMatch(buildChatReplyPrompt({ character: { categoryId: "babe" } }).systemPrompt, /Navigation is a verified capability/);
let calls = 0;
const safe = await enforceReplyBoundary({ character, searchIntent: intent, feedbackActionCandidate: action,
  replyResult: { text: "El plazo confirmado es de 10 a 25 días. No puedo consultar tu pedido aquí.", speechText: "Click the help menu!", sourceType: "ai" },
  assess: async (input) => { calls++; assert.equal(input.guidanceRequired, true); assert.equal(input.feedbackActionAvailable, true); return { allowed: true, guidanceSupported: true, confidence: .95 }; } });
assert.equal(calls, 1);
assert.match(safe.text, /10 a 25/);
assert.equal(safe.speechText, safe.text, "unreviewed spoken navigation must not escape");
for (const verdict of [null, { allowed: true, confidence: .95 }, { allowed: true, guidanceSupported: true, confidence: .2 }, { allowed: true, guidanceSupported: false, confidence: .99 }]) {
  const result = await enforceReplyBoundary({ character, searchIntent: intent, language: "es", feedbackActionCandidate: action,
    replyResult: { text: "Abre Ayuda en el menú superior izquierdo.", sourceType: "ai" }, assess: async () => verdict });
  assert.equal(result.text, verdict?.allowed === true && verdict.guidanceSupported === undefined
    ? "No pude expresar bien la respuesta. Inténtalo de nuevo."
    : "No puedo verificar esas condiciones o ese canal de atención aquí.", "malformed review fields use expression fallback; valid refusal/low confidence keep original guidance limit");
  assert.equal(result.degradationReason, "support_guidance_unverified");
}
const unavailable = await enforceReplyBoundary({ character, searchIntent: intent, language: "hu", replyResult: { text: "Click the bottom form", sourceType: "ai" }, assess: async () => { throw new Error("timeout"); } });
assert.equal(unavailable.text, "Itt nem tudom ellenőrizni ezeket a feltételeket vagy az ügyfélszolgálati csatornát.");
calls = 0;
await enforceReplyBoundary({ character, searchIntent: { ...intent, replyBoundary: { salesAllowed: false, contactAllowed: false } }, feedbackActionCandidate: action,
  replyResult: { text: "Entendido.", sourceType: "ai" }, assess: async (input) => { calls++; assert.equal(input.feedbackActionAvailable, false); return { allowed: true, guidanceSupported: true, confidence: .95 }; } });
assert.equal(calls, 1, "contact and UI constraints share one assessment");
let payload;
const result = await assessReplyBoundary({ text: safe.text, guidanceRequired: true, feedbackActionAvailable: true,
  knowledgeContext: { items: [{ id: "site_policy", scope: "site", siteId: "site_test", content: "Standard shipping: 10–25 days." }] },
  config: { apiKey: "test", model: "test", baseUrl: "https://provider.invalid" }, recordLog: async () => {},
  fetchImpl: async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ allowed: true, guidanceSupported: true, confidence: .93 }) } }] }) }; } });
assert.equal(result.guidanceSupported, true);
assert.equal(payload.messages.filter(row => row.role === "user").length, 1);
assert.equal(payload.response_format.type, "json_schema");
assert(payload.response_format.json_schema.schema.required.includes("guidanceSupported"));
const data = JSON.parse(payload.messages.at(-1).content);
assert.equal(data.evidence.knowledge[0].scope, "site");
assert.equal(data.feedbackActionAvailable, true);
assert.match(payload.messages[1].content, /Reject ALL generated instructions/);
assert.match(payload.messages[1].content, /placeholders are not current site policy/);


const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
const { buildSupportGuidanceUnavailableCopy } = await import("../server/support-guidance-copy.js");
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const text = buildSupportGuidanceUnavailableCopy(language.code);
  assert(text, `guidance limit copy missing ${language.code}`);
  if (language.code !== "en") assert.notEqual(text, buildSupportGuidanceUnavailableCopy("en"));
}

console.log("support guidance self-check passed (scoped review, mixed answer, fail-closed, 43 languages; no network/database)");
