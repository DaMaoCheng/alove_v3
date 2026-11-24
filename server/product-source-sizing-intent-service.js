import { filterProductsByIntent } from './product-intent-service.js';
import { parseExternalSourceContext } from './external-source-context-service.js';
import { productClarificationContext } from './chat-reply-purpose-service.js';
import { normalizeProductRequirementDecision, applyProductCandidateState, readProductCandidateState, parseCurrentProductRequirement } from './product-candidate-state-service.js';

const sourceReads = new WeakSet();
export function isSourceSizingRead(intent) { return sourceReads.has(intent); }

// A signed current product page supplies a read target, not USER catalogue
// requirements or permission to recommend. Recover only the missing-target
// sizing lane whose current JEV action already authorizes a product lookup.
export function sourceProductSizingIntent(intent, { sourceContext, siteId, siteSlug, characterId, userText, recentMessages = [] } = {}) {
  const source = parseExternalSourceContext(sourceContext);
  const clarification = productClarificationContext(intent, userText);
  if (!source || source.siteId !== siteId || source.siteSlug !== siteSlug || source.mascotCharacterId !== characterId
    || !source.sourceProductId || intent.primarySearchVerified !== true || intent.commerceTopic !== 'sizing'
    || intent.scopeUnverified !== true || intent.productScopePending || intent.nonShoppingReason
    || intent.commerceClassificationFailure || intent.commerceClassificationUnavailable
    || intent.productRequestState && intent.productRequestState.status !== 'cleared'
    || intent.businessInquiry || intent.humanHandoff || intent.checkoutIssue || intent.promotionInquiry
    || !clarification?.currentRequirement || !['product_clarification'].includes(clarification.kind)) return null;
  const delta = normalizeProductRequirementDecision({ action: 'new', evidence: userText, updates: clarification.currentRequirement.updates }, { userText });
  if (!delta || delta.updates.some(update => !['requestedAudience','requestedSizes'].includes(update.field))) return null;
  const recovered = { ...intent, commerceRoute: 'product_question', intent: 'sizing', sourceProductId: source.sourceProductId,
    shouldLoadProductContext: true, needsLiveProductData: true, cardAllowed: false, candidateSearchAllowed: false,
    scopeUnverified: false, productScopePending: false, searchState: 'ready_to_search',
    replyBoundaryReason: '', replyTopicHint: '', replyClarificationContext: null,
    replyBoundary: { ...intent.replyBoundary, salesAllowed: true } };
  const result = applyProductCandidateState(recovered, { confident: true, confidence: 1,
    productRequirement: delta, productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
    candidateResponse: { action: 'none', evidence: '', candidateId: '' } }, { userText, recentMessages, siteId, characterId });
  if (result.productCandidateInterpretationUnverified) return null;
  sourceReads.add(result);
  return result;
}

// Eligibility to READ the unchanged source anchor, never permission to inherit
// requirements before the actual source product passes the current constraints.
export function sourceSizingPrior(intent, { sourceContext, siteId, siteSlug, characterId, userText, recentMessages = [] } = {}) {
  const source = parseExternalSourceContext(sourceContext);
  const prior = readProductCandidateState(recentMessages, { siteId, characterId });
  const current = parseCurrentProductRequirement(userText);
  if (!source?.sourceProductId || source.siteId !== siteId || source.siteSlug !== siteSlug || source.mascotCharacterId !== characterId
    || prior?.status !== 'active' || prior.owner !== 'single' || prior.proposal || prior.sourceProductId !== source.sourceProductId
    || prior.requirements.requestedAudience !== 'kids' || current.alternativeRequested
    || intent.primarySearchVerified !== true || intent.replyBoundary?.salesAllowed !== true || intent.nonShoppingReason || intent.scopeUnverified || intent.productScopePending
    || ['pending','selected'].includes(intent.productRequestState?.status)
    || intent.commerceClassificationFailure || intent.commerceClassificationUnavailable
    || !['product_search','product_question'].includes(intent.commerceRoute)
    || !['new','continue'].includes(intent.productRequirementAction)
    || ['alternative','comparison','multiple','unclear'].includes(intent.productRequestRelation)
    || intent.requestedAudience && intent.requestedAudience !== 'kids'
    || intent.businessInquiry || intent.humanHandoff || intent.promotionInquiry || intent.checkoutIssue
    || intent.productCandidateState?.proposal || intent.productCandidateState?.suspectedTerm) return null;
  return prior;
}

export function restoreSourceSizingContinuation(intent, options, product) {
  const prior = sourceSizingPrior(intent, options);
  const source = parseExternalSourceContext(options.sourceContext);
  if (!prior || String(product?.productId || product?.id || '') !== source.sourceProductId
    || product.siteId && product.siteId !== options.siteId || product.siteSlug && product.siteSlug !== options.siteSlug
    || !filterProductsByIntent([product], { ...intent, requestedAudience: 'kids' }).length) return null;
  const current = intent.productCandidateState;
  if (current?.status !== 'active' || current.owner !== 'single' || current.siteId !== options.siteId || current.characterId !== options.characterId) return null;
  const clear = new Set(current.requirements.clearFields || []);
  const wearer = {};
  for (const field of ['requestedAudience','requestedSizes','requestedAgeRange','requestedSizeProfile','hasBodyMeasurements']) {
    const value = current.requirements[field];
    if (!clear.has(field) && !(Array.isArray(value) ? value.length : value)) wearer[field] = prior.requirements[field];
  }
  const evidence = [...new Set([prior.targetEvidence, ...(prior.requestedConditionEvidence || []), ...(current.requestedConditionEvidence || [])])];
  const conditions = evidence.length <= 4 ? evidence : [evidence[0], ...evidence.slice(-3)];
  return { ...intent, ...wearer, productRequirementAction: 'continue',
    productCandidateState: { ...current, sourceProductId: source.sourceProductId, targetEvidence: prior.targetEvidence,
      requestedConditionEvidence: conditions, requirements: { ...current.requirements, ...wearer } } };
}
