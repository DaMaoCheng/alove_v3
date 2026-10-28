import { jevImageAnswerFixture } from './fixtures/jev-image-answer-fixture.mjs';
import assert from "node:assert/strict";

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
process.env.VENICE_API_KEY = "isolated-image-followup";
process.env.TYPESAFE_API_KEY = "fixture-image-jev";
const { resolveCharacterImageFollowupContext, resolveRecentImageConversationContext } = await import("../server/chat-image-conversation-context-service.js");
const { classifyChatImageIntent: actualClassifyImage } = await import("../server/chat-image-intent-classifier-service.js");
const { classifyJevImageDetails } = await import('../server/jev-image-decision-service.js');
const { evaluateJevQuestions } = await import('../server/jev-intent-service.js');
const classifyChatImageIntent = (text, options) => actualClassifyImage(text, { ...options,
 classifyImageJev: (message, context) => classifyJevImageDetails(message, { ...context,
  evaluate: request => evaluateJevQuestions({ ...request, forceRefresh: true }) }) });
const { evaluateChatImageRequest } = await import("../server/chat-image-generation-service.js");
const character = { id: "mascot_test", category_id: "mascot" };
const prior = "Mándame una foto de ti";
const context = { latestImageKind: "character", recentConversation: [
  { role: "user", kind: "text", text: prior },
  { role: "assistant", kind: "mascot_library_image", text: "" },
  { role: "assistant", kind: "text", text: "Foto lista." },
] };
const noImage = { ok: true, confident: true, confidence: .98, imageIntent: "none" };
const positive = (text) => ({ communicativeAction: "request_visual_output", requestKind: "character_image", hasIntent: true,
  allowed: true, confidence: .98, intentType: "library_photo", imageSubject: "character", requestEvidence: text,
  actorEvidence: "ti", actionEvidence: text, requestScope: "image_only", clothingTarget: "none", explicitGeneration: false,
  wants_no_clothing: false, wants_clothing: false });
const originalFetch = globalThis.fetch;
let response, calls = 0, lastPayload, lastPrompt;
globalThis.fetch = async (_url, options) => {
  calls += 1;
  const body = JSON.parse(options.body);
 if (body.questions?.actor_is_character) return { ok: true, json: async () => jevImageAnswerFixture(body, response) };
  lastPrompt = body.questions ? Object.values(body.questions).map(q => q.instructions).join('\n') : body.messages[0].content;
  lastPayload = body.state || JSON.parse(body.messages[1].content);
  if (body.questions) return { ok: true, json: async () => jevImageAnswerFixture(body, response) };
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) };
};
let checks = 0;
try {
  assert.deepEqual(resolveCharacterImageFollowupContext(context), { imageKind: "mascot_library_image", requestText: prior }); checks++;
  for (const kind of ["product", "attachment", "mascot_greeting_image"]) {
    assert.equal(resolveCharacterImageFollowupContext({ recentConversation: [...context.recentConversation, { role: "assistant", kind, text: "" }] }), null, kind); checks++;
  }
  assert.equal(resolveCharacterImageFollowupContext({ recentConversation: [context.recentConversation[1]] }), null); checks++;
  assert.equal(resolveCharacterImageFollowupContext({ recentConversation: [...context.recentConversation,
    ...Array.from({ length: 6 }, () => ({ role: "user", kind: "text", text: "chat" }))] }), null); checks++;
  let reads = 0;
  const resolved = await resolveRecentImageConversationContext({ execute: async () => {
    reads++;
    return [[...context.recentConversation].reverse().map((item) => ({ sender_type: item.role === "user" ? "user" : "character", content_type: item.kind, text_content: item.text }))];
  } }, { sessionId: "isolated", beforeDisplayOrder: 4 });
  assert.equal(reads, 1); assert.deepEqual(resolveCharacterImageFollowupContext(resolved), resolveCharacterImageFollowupContext(context)); checks++;
  for (const text of ["otra", "再来一张", "még egyet", "encore une", "outra"]) {
    response = positive(text);
    const before = calls;
    const result = await classifyChatImageIntent(text, { character, jevDecision: noImage, conversationContext: context });
    assert.equal(result.allowed, true, text);
    assert.equal(result.explicitGeneration, false, "elliptical requests keep gallery-first behavior");
    assert.equal(result.requestScope, "image_only");
    assert.equal(calls, before + 2, "one JEV facet selection plus one focused grounding verification, no LLM classification");
    assert.deepEqual(lastPayload.characterImageFollowup, { imageKind: "mascot_library_image", requestText: prior }); checks++;
  }
  assert.equal(lastPayload.latestImageKind, "character", "a real library image must not be confused with an unsupported welcome-only context"); checks++;
  const repeated = { ...context, recentConversation: [...context.recentConversation,
    { role: "user", kind: "text", text: "otra" },
    { role: "assistant", kind: "mascot_library_image", text: "" },
    { role: "assistant", kind: "text", text: "Aquí tienes." },
  ] };
  response = positive("otra");
  const secondFollowup = await classifyChatImageIntent("otra", { character, jevDecision: noImage, conversationContext: repeated });
  assert.equal(secondFollowup.allowed, true, "a second elliptical request can quote the still-bounded original user subject");
  assert.deepEqual(lastPayload.characterImageFollowup, { imageKind: "mascot_library_image", requestText: "otra", priorRequestTexts: [prior] }); checks++;
  for (const kind of ["product", "attachment", "mascot_greeting_image"]) {
    const interrupted = { ...context, recentConversation: [
      context.recentConversation[0], context.recentConversation[1], { role: "assistant", kind, text: "" },
      ...repeated.recentConversation.slice(-3),
    ] };
    assert.deepEqual(resolveCharacterImageFollowupContext(interrupted), { imageKind: "mascot_library_image", requestText: "otra" },
      "older subject evidence cannot cross a product/upload/welcome image");
    response = positive("otra");
    assert.equal((await classifyChatImageIntent("otra", { character, jevDecision: noImage, conversationContext: interrupted })).allowed, false,
      "without the original subject span, a made-up inherited actor must fail grounding"); checks++;
  }
  const beyondWindow = { ...context, recentConversation: [...repeated.recentConversation, ...repeated.recentConversation.slice(-3)] };
  response = positive("otra");
  assert.equal((await classifyChatImageIntent("otra", { character, jevDecision: noImage, conversationContext: beyondWindow })).allowed, false,
    "do not expand the six-message bound or use an image alone when the original subject is out of scope"); checks++;
  assert.doesNotMatch(lastPrompt, /Only current user language that addresses the character/,
    "current-only subject wording must not contradict bounded elliptical requests");
  assert.match(lastPrompt, /additional.photo/);
  assert.match(lastPrompt, /additional photo never inherits old clothing/); checks++;
  response = positive("otra");
  const afterLocation = { ...context, recentConversation: [...context.recentConversation,
    { role: "user", kind: "text", text: "¿Dónde está la foto anterior?" },
    { role: "assistant", kind: "text", text: "Sigue arriba en nuestra conversación." },
  ] };
  const continued = await classifyChatImageIntent("otra", { character, jevDecision: { ...noImage, confident: false, confidence: .65 }, conversationContext: afterLocation });
  assert.equal(continued.allowed, true, "a related location question preserves a bounded photo subject");
  assert.equal(continued.explicitGeneration, false);
  assert.deepEqual(lastPayload.characterImageFollowup, { imageKind: "mascot_library_image", requestText: prior });
  assert.equal(lastPayload.latestImageKind, "character"); checks++;
  for (const text of ["Where is the photo?", "Nice!", "Show the candidate shirt", "How much is another shirt?"]) {
    response = { ...positive(text), communicativeAction: "other", requestKind: "non_image", hasIntent: false, allowed: false, intentType: "none" };
    assert.equal((await classifyChatImageIntent(text, { character, jevDecision: noImage, conversationContext: context })).hasIntent, false, text); checks++;
  }
  for (const bad of [
    { actorEvidence: "made up actor" }, { actionEvidence: "not in latest text" }, { requestEvidence: "not in latest text" },
    { imageSubject: "product" }, { requestKind: "non_image" }, { communicativeAction: "merchandise_question" },
    { confidence: .69 }, { wants_no_clothing: true }, { wants_clothing: true },
    { intentType: "try_on" },
  ]) {
    response = { ...positive("otra"), ...bad };
    assert.equal((await classifyChatImageIntent("otra", { character, jevDecision: noImage, conversationContext: context })).hasIntent, false, JSON.stringify(bad)); checks++;
  }
  response = { ...positive("otra"), explicitGeneration: true };
  const contradictoryLegacyFlag = await classifyChatImageIntent("otra", { character, jevDecision: noImage, conversationContext: context });
  assert.equal(contradictoryLegacyFlag.explicitGeneration, false, "JEV library choice derives a non-generation action; a legacy raw flag cannot widen it"); checks++;
  const before = calls;
  response = positive("otra");
  for (const empty of [null, {}, { recentConversation: [{ role: "assistant", kind: "mascot_greeting_image", text: "Welcome" }] }]) {
    assert.equal((await classifyChatImageIntent("otra", { character, jevDecision: noImage, conversationContext: empty })).hasIntent, false); checks++;
  }
  assert.equal(calls, before, "no added verifier without bounded user-requested character-image context"); checks++;
  const beforeLong = calls;
  assert.equal((await classifyChatImageIntent("This is a normal long conversation message about my day. ".repeat(3), {
    character, jevDecision: noImage, conversationContext: context,
  })).hasIntent, false);
  assert.equal(calls, beforeLong, "long no-image turns keep the original JEV decision without supplemental classification"); checks++;
  response = positive("otra");
  assert.equal((await classifyChatImageIntent("otra", { character: { id: "companion" }, jevDecision: noImage, conversationContext: context })).allowed, true); checks++;
  response = { ...positive("otra"), wants_no_clothing: true };
  assert.equal((await classifyChatImageIntent("otra", { character: { id: "companion" }, jevDecision: noImage, conversationContext: context })).hasIntent, false,
    "non-commerce followup cannot inherit nude conditions either"); checks++;
  response = positive("otra");
  const productProtected = await evaluateChatImageRequest(null, { character, userText: "otra", jevDecision: noImage,
    conversationContext: context, commerceIntent: { commerceRoute: "product_search" } });
  assert.equal(productProtected.trigger.hasIntent, false, "active product routing cannot be overridden by historical character image");
  assert.equal(productProtected.trigger.deferredToProduct, true); checks++;
  for (const [text, scope] of [
    ["otra y cuánto cuesta", "mixed"], ["otra y cuándo llega", "mixed"],
    ["otra y revisa mi pedido", "mixed"], ["otra y cómo estás", "mixed"],
    ["otra y quién ganó ayer", "mixed"], ["otra", undefined], ["otra", "invalid"],
  ]) {
    response = { ...positive(text), requestScope: scope };
    const result = await classifyChatImageIntent(text, { character, jevDecision: noImage, conversationContext: context });
    assert.equal(result.allowed, true, "scope annotation must not change image permission");
    assert.equal(result.requestScope, scope === "mixed" ? "mixed" : "unknown"); checks++;
  }
  response = { ...positive("otra"), requestScope: "image_only" };
  assert.equal((await classifyChatImageIntent("otra y cuándo llega", { character, jevDecision: noImage, conversationContext: context })).requestScope, "unknown", "partial evidence cannot mark the full turn image-only"); checks++;
  const beforeDirect = calls;
  const direct = await classifyChatImageIntent("send your photo", { character: { id: "companion" }, jevDecision: { ...noImage, imageIntent: "library_photo" }, conversationContext: context });
  assert.equal(direct.allowed, true); assert.equal(calls, beforeDirect, "existing non-commerce JEV positive needs no extra verifier"); checks++;
  console.log(`image followup context self-check passed: ${checks} cases; isolated provider, no image jobs or quota writes`);
} finally {
  globalThis.fetch = originalFetch;
}
