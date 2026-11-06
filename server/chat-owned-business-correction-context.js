import { hasBusinessDemandAuditContext } from './business-claim-audit-service.js';
import { isCurrentCatalogueOwner } from './product-candidate-context-service.js';
import { isStorefrontGuidanceCharacter, resolveOrderActionPromptState } from './chat-global-reply-policy.js';
import { projectKnowledgeEvidence } from './knowledge-evidence-projection.js';
import { toImageStatusReviewContext } from './chat-image-status-context-service.js';

// A text-correction purpose, never an approval or permission to run a tool.
// Knowledge, catalogue and action ownership are independent of one another.
export function ownedBusinessTextCorrectionContext({ searchIntent = {}, knowledgeContext, productContext, character = {}, trustedSite,
  userText = '', orderActionCandidate, feedbackActionCandidate, chatImageContext, guestBenefitContext, factualContext } = {}) {
  if (!isStorefrontGuidanceCharacter(character) || !isCurrentCatalogueOwner({ character, trustedSite, siteId: trustedSite?.id })
    || !hasBusinessDemandAuditContext(searchIntent) || searchIntent.answerRequired !== true
    || !['chat', 'store_policy', 'product_question'].includes(searchIntent.commerceRoute)
    || typeof userText !== 'string' || !userText.trim() || userText.length > 4000 || searchIntent.nonShoppingReason
    || searchIntent.commerceClassificationFailure || searchIntent.commerceClassificationUnavailable
    || searchIntent.scopeUnverified || searchIntent.productScopePending || searchIntent.productCandidateInterpretationUnverified
    || searchIntent.promotionInquiry?.kind === 'benefit_request' || guestBenefitContext
    || searchIntent.shouldLoadProductContext || searchIntent.cardAllowed || searchIntent.needsLiveProductData
    || productContext?.products?.length || productContext?.candidateContext || productContext?.sizingProduct
    || ['pending', 'selected'].includes(searchIntent.productRequestState?.status)
    || searchIntent.productCandidateState?.proposal || searchIntent.confirmedCandidateId
    || factualContext?.required || factualContext?.searched || factualContext?.items?.length
    || orderActionCandidate && !resolveOrderActionPromptState(orderActionCandidate)
    || feedbackActionCandidate && (feedbackActionCandidate.kind !== 'feedback' || searchIntent.replyBoundary?.contactAllowed === false)) return null;
  const owner = knowledgeContext?.businessOwner;
  if (owner && (owner.siteId !== trustedSite.id || owner.characterId !== character.id)) return null;
  if (!Array.isArray(knowledgeContext?.items)) return null;
  const items = knowledgeContext.items;
  if (items.length && (!owner || knowledgeContext.ok !== true || knowledgeContext.selectionFailure
    || knowledgeContext.strategy !== 'business_verified_reference' || items.some(item => {
      if (item.scope === 'site' && item.siteId && item.siteId !== trustedSite.id) return true;
      const projection = projectKnowledgeEvidence(item);
      return projection.scoped ? !projection.answerEvidence.length
        : typeof item.evidenceQuote !== 'string' || !item.evidenceQuote || !item.content?.includes(item.evidenceQuote);
    }))) return null;
  // A non-requested lookup is not proof of an empty catalogue or missing policy.
  const knowledgeState = items.length ? 'verified' : searchIntent.policyKnowledgeRequest.required === false
    && knowledgeContext.ok === true && !knowledgeContext.selectionFailure && knowledgeContext.strategy === 'not_requested' ? 'not_requested'
    : owner && knowledgeContext.ok === true && !knowledgeContext.selectionFailure
      && ['business_no_verified_answer', 'business_no_relevant_section'].includes(knowledgeContext.strategy) ? 'empty'
      : owner && (knowledgeContext.selectionFailure || knowledgeContext.ok === false) ? 'unavailable' : null;
  if (!knowledgeState) return null;
  let imageStatus = null;
  if (chatImageContext) {
    const anchor = chatImageContext._imageStatusAnchor;
    imageStatus = toImageStatusReviewContext(chatImageContext);
    if (!anchor?.messageId || !anchor.scope?.sessionId || anchor.scope.characterId !== character.id
      || !(anchor.scope.ownerId || anchor.scope.guestId) || !(anchor.scope.order > 0)
      || !(anchor.displayOrder > anchor.scope.order) || !imageStatus?.currentTurn
      || !['generated', 'library'].includes(imageStatus.kind)
      || imageStatus.kind === 'generated' && !anchor.assetId
      || chatImageContext.trigger?.requestScope !== 'mixed') return null;
  }
  return { kind: 'owned_business_text', knowledgeState, imageStatus };
}
