import assert from "node:assert/strict";
import { isImageReplyRecoveryEligible, refreshImageReplyRecoveryContext, buildImageReplyRecoveryPrompt } from "../server/chat-image-reply-recovery-service.js";

const context = { taskCreated: true, reason: "image_task_created", imageStatus: { kind: "library", status: "ready", currentTurn: true },
  trigger: { hasIntent: true, allowed: true, classificationOutcome: "accepted", requestScope: "image_only" },
  _imageStatusAnchor: { messageId: "image-message", assetId: null, kind: "library", displayOrder: 30,
    scope: { sessionId: "session", characterId: "character", ownerId: null, guestId: "guest", order: 20, currentImageMessageId: "image-message" } } };
const base = { chatImageContext: context, reviewStatus: "valid", reviewResult: { allowed: false, boundarySupported: false, confidence: .8 },
  failedContracts: ["boundary", "image_status"], contracts: ["image_status", "language", "factual"],
  languageAssessment: { reviewStatus: "valid", languageQualitySupported: true, confidence: .54, severity: "minor", languageIssues: [{ type: "punctuation", severity: "minor" }] },
  replyResult: { sourceType: "ai", sourceRef: "chat-reply", text: "rejected candidate must not enter recovery prompt" },
  searchIntent: { commerceRoute: "unclear", knowledgeScope: "none" }, factualContext: { required: false, items: [], searched: false }, regenerateReply: async () => { throw Error("No model call permitted"); } };
let stateChecks = 0;
for (const field of ["productRequestState", "productCandidateState"]) {
  assert.equal(isImageReplyRecoveryEligible({ ...base, searchIntent: { ...base.searchIntent, [field]: { version: 1, status: "cleared" } } }), true, `${field}: cleared history is not a live task`); stateChecks++;
  for (const status of ["active", "pending", "selected", "unknown", undefined]) {
    assert.equal(isImageReplyRecoveryEligible({ ...base, searchIntent: { ...base.searchIntent, [field]: { status } } }), false, `${field}: unresolved state remains excluded`); stateChecks++;
  }
}
const clone = value => structuredClone(value);
let checks = stateChecks;
assert.equal(isImageReplyRecoveryEligible(base), true); checks++;
for (const override of [
  { reviewStatus: "invalid_fields" }, { reviewStatus: "timeout" }, { reviewResult: { ...base.reviewResult, confidence: .799 } },
  { failedContracts: [] }, { failedContracts: ["language"] }, { failedContracts: ["factual"] }, { failedContracts: ["confidence"] },
  { contracts: ["image_status", "evidence"] }, { contracts: ["image_status", "business_facts"] }, { contracts: ["image_status", "product_scope"] },
  { languageAssessment: { ...base.languageAssessment, confidence: .539 } }, { languageAssessment: { ...base.languageAssessment, reviewStatus: "invalid_json" } },
  { languageAssessment: { ...base.languageAssessment, languageQualitySupported: false } }, { languageAssessment: { ...base.languageAssessment, severity: "major" } },
  { languageRepairAttempted: true }, { retained: "partial approved answer" }, { regenerateReply: null },
  { replyResult: { ...base.replyResult, partialAnswerRetained: true } }, { replyResult: { ...base.replyResult, replyRecoveryState: {} } },
  { replyResult: { ...base.replyResult, sourceRef: "quality-guard" } }, { replyResult: { ...base.replyResult, degradationReason: "ai_request_failed_fallback" } },
  { replyResult: { ...base.replyResult, verifiedDiscountOffers: [{}] } }, { orderActionCandidate: {} }, { feedbackActionCandidate: {} }, { guestBenefitContext: {} }, { checkoutContext: {} },
  { factualContext: { required: true } }, { factualContext: { required: false, searched: true } }, { factualContext: { required: false, items: [{}] } },
]) {
  assert.equal(isImageReplyRecoveryEligible({ ...base, ...override }), false, JSON.stringify(override)); checks++;
}
for (const flag of ["needsLiveProductData", "shouldLoadProductContext", "cardAllowed", "productScopePending", "scopeUnverified", "promotionInquiry", "discountExplanationRequired", "businessInquiry", "humanHandoff", "customerServiceKnowledgeRequest", "commerceClassificationUnavailable", "factualSearchRequired", "webSearchIntent"]) {
  assert.equal(isImageReplyRecoveryEligible({ ...base, searchIntent: { ...base.searchIntent, [flag]: true } }), false, flag); checks++;
}
for (const route of ["product_search", "product_question", "store_policy", "order_lookup", "business_inquiry"]) {
  assert.equal(isImageReplyRecoveryEligible({ ...base, searchIntent: { commerceRoute: route } }), false, route); checks++;
}
for (const update of [
  value => { value.imageStatus.currentTurn = false; }, value => { value.imageStatus.status = "unknown"; },
  value => { value.reason = "quota_exhausted"; }, value => { value.trigger.requestScope = "mixed"; },
  value => { value.trigger.allowed = false; }, value => { value.taskFailed = true; },
  value => { delete value._imageStatusAnchor; }, value => { delete value._imageStatusAnchor.messageId; },
  value => { delete value._imageStatusAnchor.assetId; }, value => { value._imageStatusAnchor.scope.guestId = null; },
  value => { value._imageStatusAnchor.scope.order = 0; },
]) {
  const invalid = clone(context); update(invalid);
  assert.equal(isImageReplyRecoveryEligible({ ...base, chatImageContext: invalid }), false); checks++;
}
const fresh = clone(context);
assert.equal(await refreshImageReplyRecoveryContext(context, async () => fresh), fresh); checks++;
assert.equal(await refreshImageReplyRecoveryContext(context, null), null); checks++;
assert.equal(await refreshImageReplyRecoveryContext(context, async () => { throw Error("offline"); }), null); checks++;
for (const update of [
  value => { value.imageStatus.status = "unknown"; }, value => { value._imageStatusAnchor.messageId = "other"; },
  value => { value._imageStatusAnchor.assetId = "other-asset"; }, value => { value._imageStatusAnchor.scope.guestId = "other-guest"; },
  value => { value._imageStatusAnchor.scope.ownerId = "other-owner"; }, value => { value._imageStatusAnchor.scope.sessionId = "other-session"; },
  value => { value._imageStatusAnchor.scope.characterId = "other-character"; }, value => { value._imageStatusAnchor.scope.order = 21; },
  value => { value.blocked = true; }, value => { value.taskFailed = true; },
]) {
  const changed = clone(context); update(changed);
  assert.equal(await refreshImageReplyRecoveryContext(context, async () => changed), null); checks++;
}
const generated = clone(context);
generated.imageStatus.kind = generated._imageStatusAnchor.kind = "generated";
generated._imageStatusAnchor.assetId = "generated-asset";
assert.equal(isImageReplyRecoveryEligible({ ...base, chatImageContext: generated }), true); checks++;
const prompt = { systemPrompt: "original persona and permissions", layers: [{ id: "original", content: "original layer" }], messages: [{ role: "user", content: "current request" }], privateOption: "preserved" };
const before = clone(prompt);
const rebuilt = buildImageReplyRecoveryPrompt(prompt, { chatImageContext: fresh, failedContracts: base.failedContracts });
assert.deepEqual(prompt, before, "original prompt remains unchanged");
assert.equal(rebuilt.messages, prompt.messages); assert.equal(rebuilt.layers[0], prompt.layers[0]);
assert.equal(rebuilt.privateOption, prompt.privateOption); assert.ok(rebuilt.systemPrompt.startsWith(prompt.systemPrompt));
assert.match(rebuilt.systemPrompt, /Authoritative image fact/);
assert.match(rebuilt.systemPrompt, /fresh natural reply/);
assert.doesNotMatch(rebuilt.systemPrompt, /image-message|generated-asset|rejected candidate must not enter recovery prompt|"guest"|"session"/); checks++;
assert.equal(buildImageReplyRecoveryPrompt(prompt, { chatImageContext: null, failedContracts: base.failedContracts }), null); checks++;
assert.equal(buildImageReplyRecoveryPrompt(prompt, { chatImageContext: context, failedContracts: ["evidence"] }), null); checks++;
console.log(`image reply recovery self-check passed: ${checks} eligibility, anchor refresh and immutable prompt cases; no DB/network/model calls`);
