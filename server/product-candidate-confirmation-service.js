import { revalidateNameCandidate, hasStableNameCandidateSource } from './product-name-candidate-service.js';
import { readProductCandidateState, findDisplayedProductCandidate, normalizeCandidateResponse, applyProductCandidateState, parseCurrentProductRequirement } from './product-candidate-state-service.js';
import { buildChatProductRoutingContext } from './chat-product-routing-context-service.js';
import { normalizeProductRequest, readProductRequestState } from './product-request-scope-service.js';
import { evaluateProductAttributeMatch, resolveProductAttributeEvidence } from './product-attribute-evidence-service.js';
import { requestedProductEdition } from './product-edition-service.js';
import { buildProductCandidateConstraintIntent, filterProductsByIntent } from './product-intent-service.js';

const REVIEW_PRODUCT = Symbol('candidateConfirmationReviewProduct');
const sameId = (left, right) => String(left?.productId || left?.id || '') === String(right?.productId || right?.id || '');

// This proves a displayed reference, not new-search authority or identity assent.
export function pendingDisplayedCandidate({ recentMessages = [], siteId = '', characterId = '' } = {}) {
  const state = readProductCandidateState(recentMessages, { siteId, characterId });
  if (state?.status !== 'active' || state.proposal?.status !== 'displayed'
    || !buildChatProductRoutingContext(recentMessages, { siteId, characterId })?.displayedCandidate) return null;
  const product = findDisplayedProductCandidate(state, recentMessages, { siteId, characterId });
  return product ? { state, product } : null;
}

export function hasCandidateConfirmationInterpretationContext({ recentMessages = [], siteId = '', characterId = '', jevDecision = null } = {}) {
  return Boolean(jevDecision?.ok === true && jevDecision.confident === true && jevDecision.primaryIntent === 'product_request'
    && !jevDecision.unsupported && jevDecision.webSearchIntent !== true && jevDecision.orderIntent !== 'lookup'
    && (!jevDecision.imageIntent || jevDecision.imageIntent === 'none')
    && pendingDisplayedCandidate({ recentMessages, siteId, characterId }));
}

// The model supplies current semantic assent. Code verifies its exact quotation,
// identity/owner and no-op requirements. The complete reply review still decides
// whether that assent and the resulting explanation are supported.
export function resolveCandidateConfirmationIntent(intent, decision, options) {
  if (!hasCandidateConfirmationInterpretationContext(options) || !decision?.confident
    || !['product_search', 'product_question'].includes(decision.route) || decision.replyBoundary?.salesAllowed !== true
    || intent.nonShoppingReason || decision.businessInquiry || decision.humanHandoff || decision.promotionInquiry || decision.checkoutIssue
    || decision.discountExplanationRequired || decision.teamConstraintUnverified
    || !['none', 'continue'].includes(decision.productRequirement?.action)) return null;
  const pending = pendingDisplayedCandidate(options);
  const current = options.currentRequirement || parseCurrentProductRequirement(options.userText);
  const team = decision.commerceConstraints?.team;
  const nonTargetTeam = team && team.role !== 'product_target'
    && parseCurrentProductRequirement(team.evidence).requestedTeam === current.requestedTeam;
  if (current.requestedTeam && current.requestedTeam !== pending.state.requirements.requestedTeam && !nonTargetTeam
    || team?.role === 'product_target' && (parseCurrentProductRequirement(team.value).requestedTeam || team.value) !== pending.state.requirements.requestedTeam
    || ['requestedProductType', 'requestedAudience', 'requestedColor', 'requestedSeason', 'requestedPrinting'].some(field =>
      current[field] && current[field] !== pending.state.requirements[field])
    || ['requestedVariants', 'requestedSizes'].some(field => current[field]?.length
      && JSON.stringify([...current[field]].sort()) !== JSON.stringify([...(pending.state.requirements[field] || [])].sort()))
    || requestedProductEdition(current) && requestedProductEdition(current) !== requestedProductEdition(pending.state.requirements)) return null;
  const response = normalizeCandidateResponse(decision.candidateResponse, { userText: options.userText });
  if (response?.action !== 'confirm' || response.candidateId !== pending.state.proposal.candidateId) return null;
  const previousScope = readProductRequestState(options.recentMessages, options);
  if (previousScope?.status === 'pending' || previousScope?.status === 'selected' && pending.state.owner !== 'selected') return null;
  const scope = normalizeProductRequest(decision.productRequest, { userText: options.userText, confidence: decision.confidence,
    previousState: previousScope });
  if (!scope.valid || !(scope.relation === 'single' && scope.action === 'new' && pending.state.owner === 'single'
    || scope.relation === 'multiple' && ['select', 'continue'].includes(scope.action) && pending.state.owner === 'selected'
      && scope.selectedIndex === pending.state.selectedIndex)) return null;
  const delta = decision.productRequirement.action === 'none'
    ? { action: 'continue', evidence: response.evidence, updates: [], suspectedTerm: null } : decision.productRequirement;
  const interpreted = applyProductCandidateState({ ...intent, commerceRoute: 'product_question', cardAllowed: false,
    knowledgeScope: 'business', commerceConfidence: decision.confidence, commerceTopic: decision.topic,
    replyBoundary: { ...decision.replyBoundary }, boundaryRequired: decision.replyBoundary.contactAllowed === false,
    primarySearchBlocked: true, primarySearchVerified: false,
    shouldLoadProductContext: false, needsLiveProductData: false }, { ...decision, productRequirement: delta }, options);
  if (interpreted.productCandidateState?.proposal?.status !== 'confirmed'
    || JSON.stringify(interpreted.productCandidateState.requirements) !== JSON.stringify(pending.state.requirements)) return null;
  return { ...interpreted, candidateConfirmationOnly: true, candidateSearchAllowed: false, shouldLoadProductContext: false,
    needsLiveProductData: false, cardAllowed: false, answerRequired: true, commerceRoute: 'product_question',
    referencedProductId: response.candidateId, referencedSiteId: options.siteId, referencedSiteSlug: options.siteSlug || '',
    confirmedCandidateId: response.candidateId };
}

export function getCandidateConfirmationProduct(context) {
  const product = context?.[REVIEW_PRODUCT], state = context?.searchIntent?.productCandidateState;
  return product && context.cardAllowed === false && context.searchIntent.candidateConfirmationOnly === true
    && state?.status === 'active' && state.proposal?.status === 'confirmed' && state.siteId === context.siteId
    && String(product.siteId) === String(context.siteId) && state.proposal.candidateId === String(product.productId || product.id)
    ? product : null;
}

export async function buildCandidateConfirmationContext({ site = {}, searchIntent = {}, recentMessages = [], userText = '', characterId = '', resolveProduct, buildCandidateContext } = {}) {
  const empty = { sourceType: 'product_api', sourceRef: 'candidate-confirmation-source-error', siteId: site.id || '', siteSlug: site.slug || '',
    searchIntent, cardAllowed: false, searchOutcome: 'source_error', products: [],
    candidateContext: { requiresConfirmation: false, entityConfirmed: true, products: [], entityConfirmationEvidence: '', priorConfirmationQuestion: '' } };
  if (searchIntent.candidateConfirmationOnly !== true) return null;
  const pending = pendingDisplayedCandidate({ recentMessages, siteId: site.id, characterId });
  const staged = readProductCandidateState([{ senderType: 'character', productCandidateState: searchIntent.productCandidateState }], { siteId: site.id, characterId });
  const assent = normalizeCandidateResponse({ action: 'confirm', candidateId: searchIntent.confirmedCandidateId,
    evidence: searchIntent.productCandidateState?.proposal?.confirmationEvidence }, { userText });
  if (!pending || !staged || !assent || JSON.stringify(staged.requirements) !== JSON.stringify(pending.state.requirements)
    || staged.owner !== pending.state.owner || staged.selectedIndex !== pending.state.selectedIndex || staged.ownerEvidence !== pending.state.ownerEvidence
    || searchIntent.confirmedCandidateId !== pending.state.proposal.candidateId
    || searchIntent.productCandidateState?.proposal?.status !== 'confirmed'
    || searchIntent.productCandidateState.proposal.candidateId !== pending.state.proposal.candidateId
    || searchIntent.productCandidateState.characterId !== characterId || searchIntent.productCandidateState.siteId !== site.id) return empty;
  try {
    const result = await resolveProduct({ siteSlug: site.slug, product: pending.product, strictSite: true, exactProduct: true });
    const source = result?.sourceItem;
    if (result?.resolvedFromSource !== true || result.site?.id !== site.id || result.site?.slug !== site.slug
      || !source?.name || !sameId(source, pending.product) || !source.id && !source.productId || typeof buildCandidateContext !== 'function') return empty;
    if (!hasStableNameCandidateSource(source, pending.state.requirements, pending.product)) return empty;
    const constraintIntent = buildProductCandidateConstraintIntent({ ...searchIntent, ...pending.state.requirements });
    const nameCandidate = revalidateNameCandidate(source, { ...searchIntent, ...pending.state.requirements }, pending.product);
    if (!nameCandidate && !filterProductsByIntent([source], constraintIntent, { allowNearestAgeFallback: false }).length) return empty;
    const attributes = evaluateProductAttributeMatch(source, { ...searchIntent, ...pending.state.requirements, commerceRoute: 'product_search' });
    if (source.available === false || attributes.status === 'mismatch') return empty;
    const product = { ...source, ...(nameCandidate ? { alternative: nameCandidate.alternative } : {}), siteId: site.id, siteSlug: site.slug, matchStatus: 'candidate',
      attributeEvidence: resolveProductAttributeEvidence(source), candidateUnknownFields: attributes.unknownFields,
      unmatchedSearchTerms: [...new Set([...(pending.product.unmatchedSearchTerms || []), ...(searchIntent.requestedKeywords || [])])]
        .filter(term => typeof term === 'string' && term.length <= 80 && !String(source.name || '').toLowerCase().includes(term.toLowerCase())).slice(0, 8) };
    const context = { ...empty, sourceRef: 'current-candidate-confirmation-context', searchOutcome: 'candidate', products: [product],
      candidateContext: buildCandidateContext([product], searchIntent, { siteId: site.id, characterId }) };
    // Enumerable symbol survives trusted {...context} composition; JSON never
    // exports it and client-shaped objects cannot reconstruct this proof.
    Object.defineProperty(context, REVIEW_PRODUCT, { value: product, enumerable: true });
    return context;
  } catch { return empty; }
}
