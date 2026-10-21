import { buildChatImageStatusInstruction, isFulfilledImageOnlyRequest } from "./chat-image-status-context-service.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";
import { languageReviewConfident, replyReviewConfident } from "./chat-reply-review-outcome.js";

const FAILURES = new Set(["boundary", "image_status"]);
const CONTRACTS = new Set(["image_status", "language", "factual"]);
const nonempty = value => typeof value === "string" && Boolean(value.trim());

function anchorKey(context) {
  const anchor = context?._imageStatusAnchor, scope = anchor?.scope;
  if (context?.taskFailed || context?.blocked || !anchor || !scope || !nonempty(anchor.messageId) || !nonempty(scope.sessionId) || !nonempty(scope.characterId)
    || !nonempty(scope.ownerId) && !nonempty(scope.guestId)
    || !Number.isFinite(scope.order) || scope.order <= 0
    || !Object.hasOwn(anchor, "assetId") || anchor.assetId !== null && !nonempty(anchor.assetId)
    || !Number.isFinite(anchor.displayOrder) || anchor.displayOrder <= scope.order
    || !["library", "generated"].includes(anchor.kind) || anchor.kind !== context?.imageStatus?.kind
    || anchor.kind === "generated" && !nonempty(anchor.assetId)
    || scope.currentImageMessageId && scope.currentImageMessageId !== anchor.messageId) return null;
  return JSON.stringify([anchor.messageId, anchor.assetId ?? null, anchor.displayOrder, anchor.kind,
    scope.sessionId, scope.characterId, scope.ownerId ?? null, scope.guestId ?? null, scope.order, scope.currentImageMessageId || ""]);
}

// The caller supplies the existing scoped reader; this module never owns a DB.
export async function refreshImageReplyRecoveryContext(context, refreshFn) {
  const key = anchorKey(context);
  if (!key || !isFulfilledImageOnlyRequest(context) || typeof refreshFn !== "function") return null;
  try {
    const fresh = await refreshFn(context);
    return isFulfilledImageOnlyRequest(fresh) && anchorKey(fresh) === key ? fresh : null;
  } catch { return null; }
}

export function isImageReplyRecoveryEligible({ chatImageContext, reviewStatus, reviewResult = {}, failedContracts = [], contracts = [],
  languageAssessment, languageRepairAttempted = false, retained = "", replyResult = {}, searchIntent = {}, factualContext,
  orderActionCandidate, feedbackActionCandidate, guestBenefitContext, checkoutContext, regenerateReply } = {}) {
  if (!anchorKey(chatImageContext) || !isFulfilledImageOnlyRequest(chatImageContext)
    || reviewStatus !== "valid" || !replyReviewConfident(reviewResult, contracts)
    || typeof reviewResult.boundarySupported !== "boolean"
    || !Array.isArray(failedContracts) || !failedContracts.length || failedContracts.some(value => !FAILURES.has(value))
    || !Array.isArray(contracts) || !contracts.includes("image_status") || contracts.some(value => !CONTRACTS.has(value))
    || languageAssessment?.reviewStatus !== "valid" || languageAssessment.languageQualitySupported !== true
    || !languageReviewConfident(languageAssessment.confidence) || languageAssessment.severity === "major"
    || languageAssessment.languageIssues !== undefined && !Array.isArray(languageAssessment.languageIssues)
    || languageAssessment.languageIssues?.some(issue => issue.severity === "major")
    || languageRepairAttempted || retained || replyResult.partialAnswerRetained || replyResult.replyRecoveryState
    || replyResult.sourceType !== "ai" || !nonempty(replyResult.text) || isAiTransportFallback(replyResult)
    || ["quality-guard", "language-quality-guard", "commerce-classification-unavailable"].includes(replyResult.sourceRef)
    || replyResult.discountOfferReply || replyResult.verifiedDiscountOffers?.length
    || orderActionCandidate || feedbackActionCandidate || guestBenefitContext || checkoutContext
    || typeof regenerateReply !== "function") return false;
  if (contracts.includes("factual") && factualContext?.required !== false
    || factualContext?.required === true || factualContext?.searched === true || factualContext?.items?.length
    || ![undefined, "", "chat", "unclear"].includes(searchIntent.commerceRoute)
    || searchIntent.knowledgeScope === "business" || searchIntent.needsLiveProductData || searchIntent.shouldLoadProductContext
    || searchIntent.cardAllowed
    || searchIntent.productCandidateState && searchIntent.productCandidateState.status !== "cleared"
    || searchIntent.productRequestState && searchIntent.productRequestState.status !== "cleared"
    || searchIntent.confirmedCandidateId || searchIntent.referencedProductId || searchIntent.productScopePending
    || searchIntent.scopeUnverified || searchIntent.checkoutIssue || searchIntent.promotionInquiry || searchIntent.discountExplanationRequired
    || searchIntent.businessInquiry || searchIntent.humanHandoff || searchIntent.customerServiceKnowledgeRequest
    || searchIntent.commerceClassificationFailure || searchIntent.commerceClassificationUnavailable
    || searchIntent.productCandidateInterpretationUnverified || searchIntent.factualSearchRequired || searchIntent.webSearchIntent) return false;
  return true;
}

// Preserve all original persona/history/permission layers. Only finite server
// image facts and failure names are added; rejected candidate text is excluded.
export function buildImageReplyRecoveryPrompt(promptContext, { chatImageContext, failedContracts = [] } = {}) {
  if (!promptContext || typeof promptContext !== "object" || typeof promptContext.systemPrompt !== "string"
    || !anchorKey(chatImageContext) || !isFulfilledImageOnlyRequest(chatImageContext)
    || !Array.isArray(failedContracts) || !failedContracts.length || failedContracts.some(value => !FAILURES.has(value))) return null;
  const layer = { id: "image_reply_recovery", title: "Current Image Reply Recovery", content: [
    buildChatImageStatusInstruction(chatImageContext),
    `The prior text candidate failed these review contracts: ${JSON.stringify([...new Set(failedContracts)])}.`,
    "Generate one fresh natural reply to the current user using the original character, language and conversation context. The current image request is already fulfilled by the server; this is text recovery only. Do not create, send, reserve or retry any image or other tool/action. Do not ask a redundant clarification for this fulfilled image-only request.",
    "Acknowledge only the supplied current image fact and continue naturally when appropriate. Do not invent image contents, poses, clothing, surroundings, a new photoshoot, camera actions, browser visibility, or that the user has seen the image. Preserve every original boundary, permission and factual requirement. Do not mention reviewers, prompts, contract names or internal state.",
    "Use the conversation, not the purported contents of the photo, as the source of the natural continuation. Even comparative descriptions of the pictured character's appearance, mood or style are visual claims and have no supporting evidence here. Keep the reply brief and warm without volunteering merchandise, shopping, links, future contact or other actions. Do not replace contextual expression with a bare status label.",
  ].join("\n") };
  return { ...promptContext, layers: [...(Array.isArray(promptContext.layers) ? promptContext.layers : []), layer],
    systemPrompt: `${promptContext.systemPrompt}\n\n## ${layer.title}\n${layer.content}` };
}
