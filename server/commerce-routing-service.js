import { resolveDisplayedProductReferences } from './product-displayed-reference-service.js';
import { applyProductRequestScope, readProductRequestState, normalizeProductRequest, hasPendingProductRequest } from "./product-request-scope-service.js";
import { buildClosedProductClarificationContext, buildProductClarificationContext, productClarificationContext, PRODUCT_CLARIFICATION_CONTRACT } from "./chat-reply-purpose-service.js";
import { buildProductSearchIntent, normalizeLooseText, extractRequirementClearFields } from "./product-intent-service.js";
import { extractProductHandle } from "./product-search-match-service.js";
import { classifyCommerceIntent, normalizeCommerceAssistance } from "./product-intent-classifier-service.js";
import { normalizeCommerceConstraints } from "./product-edition-service.js";
import { applyProductCandidateState, clearProductCandidateState, readProductCandidateState, parseCurrentProductRequirement } from "./product-candidate-state-service.js";
import { applyRequestedProductEdition } from "./product-edition-service.js";
import { buildChatProductRoutingContext } from "./chat-product-routing-context-service.js";
import { resolveCandidateConfirmationIntent } from './product-candidate-confirmation-service.js';
import { SIZING_CONVERSATION_CONTRACT } from './product-sizing-guidance-service.js';

function reconcileCatalogueContinuation(decision, { userText, recentMessages, siteId, characterId, jevDecision, searchIntent, current }) {
  const action = jevDecision?.productAction;
  if (!['store_policy', 'product_question'].includes(decision.route) || decision.declaredLiveProductData !== true
    || !jevDecision?.ok || !['product_request', 'try_on'].includes(jevDecision.primaryIntent)
    || jevDecision.productIntent !== 'search' || action === null || !Number.isFinite(Number(action)) || Number(action) < .72
    || searchIntent.nonShoppingReason || decision.replyBoundary?.salesAllowed === false
    || decision.productRequirement?.action !== 'continue') return decision;
  const assistance = normalizeCommerceAssistance(decision, { userText, recentMessages });
  if (assistance.businessInquiry || assistance.humanHandoff || assistance.promotionInquiry || assistance.checkoutIssue) return decision;
  const prior = readProductCandidateState(recentMessages, { siteId, characterId });
  if (prior?.proposal?.status !== 'displayed' || prior.proposal.candidateId !== decision.referencedProductId
    || !buildChatProductRoutingContext(recentMessages, { siteId, characterId })?.displayedCandidate) return decision;
  const scope = normalizeProductRequest(decision.productRequest, { userText, confidence: decision.confidence,
    previousState: readProductRequestState(recentMessages, { siteId, characterId }) });
  if (!scope.valid || !(scope.relation === 'single' && scope.action === 'new'
    || prior.owner === 'selected' && scope.relation === 'multiple' && ['select', 'continue'].includes(scope.action) && scope.selectedIndex === prior.selectedIndex)) return decision;
  if (current.requestedTeam && current.requestedTeam !== prior.requirements.requestedTeam) return decision;
  const revision = decision.productRequirement.updates.length > 0 || current.sleeves.length === 1 && !current.clearFields.includes('requestedFeatures');
  // A verified catalogue reference plus an explicit current revision is a
  // merchandise continuation. A catalogue question without a revision can read
  // live facts, but cannot become a fresh card or erase a real policy topic.
  return { ...decision, route: revision ? 'product_search' : 'product_question', needsLiveProductData: true,
    ...(revision && decision.topic === 'support' ? { topic: 'other' } : {}) };
}

function unavailableProductInterpretation(intent, failure, { recentMessages, siteId, characterId }) {
  const old = readProductRequestState(recentMessages, { siteId, characterId });
  const candidate = readProductCandidateState(recentMessages, { siteId, characterId });
  return { ...intent, commerceClassificationFailure: failure, commerceClassificationUnavailable: true,
    shouldLoadProductContext: false, cardAllowed: false, replyBoundary: { salesAllowed: false, contactAllowed: false }, boundaryRequired: true,
    searchState: "not_product", candidateSearchAllowed: false, productScopeReason: "", scopeUnverified: false, productScopePending: false,
    // Failure grants no current updates or confirmation, but is not cancellation.
    ...(old ? { productRequestState: old } : {}),
    productCandidateState: candidate?.status === "active" ? { ...candidate, proposal: null }
      : clearProductCandidateState({ siteId, characterId }) };
}

function clearProductRoutingState(intent, { recentMessages, siteId, characterId, clearRequestScope = true }) {
  const request = clearRequestScope ? readProductRequestState(recentMessages, { siteId, characterId }) : null;
  const candidate = readProductCandidateState(recentMessages, { siteId, characterId });
  return { ...intent,
    ...(request ? { productRequestState: { ...request, status: "cleared", items: [], selectedIndex: null, clarificationCount: 0 } } : {}),
    ...(candidate ? { productCandidateState: clearProductCandidateState({ siteId, characterId }) } : {}),
    referencedProductIds: [], candidateSearchAllowed: false };
}

// This is a current-turn text purpose, never an action permission or a
// replacement commerce verdict. Keep the secondary route and closed boundaries.
function primaryConversationPurpose({ decision, jevDecision, searchIntent, recentMessages, explicitTrigger, siteId, characterId }) {
  if (jevDecision?.ok !== true || jevDecision.source !== 'jev' || jevDecision.confident !== true
    || jevDecision.primaryIntent !== 'daily_chat' || jevDecision.productIntent !== 'none'
    || jevDecision.imageIntent !== 'none' || jevDecision.orderIntent !== 'none'
    || jevDecision.webSearchIntent !== false || jevDecision.unsupported !== false
    || !Number.isFinite(jevDecision.productAction) || jevDecision.productAction < 0 || jevDecision.productAction >= .72
    || !Number.isFinite(decision?.confidence) || decision.confidence < 0 || decision.confidence > 1
    || decision?.confident !== false || !['chat', 'unclear'].includes(decision.route)
    || decision.topic !== 'other' || decision.knowledgeScope !== 'general'
    || explicitTrigger || searchIntent.explicitProductTrigger || searchIntent.searchState !== 'not_product'
    || searchIntent.nonShoppingReason || searchIntent.replyBoundary?.salesAllowed === false || searchIntent.replyBoundary?.contactAllowed === false) return undefined;
  const blocked = ['commerceClassificationFailure', 'commerceClassificationUnavailable', 'customerServiceKnowledgeRequest',
    'needsLiveProductData', 'shouldLoadProductContext', 'cardAllowed', 'productScopePending', 'scopeUnverified',
    'businessInquiry', 'humanHandoff', 'promotionInquiry', 'checkoutIssue', 'discountExplanationRequired',
    'knowledgeQuery', 'searchQuery', 'referencedProductId', 'declaredLiveProductData', 'replyTopicHint'];
  if ([decision, searchIntent].some(value => value.knowledgeScope === 'business' || blocked.some(field => value[field]))
    || decision.productRequest && decision.productRequest.relation !== 'none'
    || decision.productRequirement && decision.productRequirement.action !== 'none'
    || decision.candidateResponse && decision.candidateResponse.action !== 'none'
    || decision.commerceConstraints?.team?.role === 'product_target' || decision.commerceConstraints?.edition
    || recentMessages.slice(-12).some(row => row?.product)
    || [searchIntent.productRequestState?.status, readProductRequestState(recentMessages, { siteId, characterId })?.status]
      .some(status => ['pending', 'selected'].includes(status))
    || searchIntent.productCandidateState?.status === 'active'
    || readProductCandidateState(recentMessages, { siteId, characterId })?.status === 'active') return undefined;
  return { version: 1, kind: 'conversation', source: 'jev_daily_chat' };
}

export async function resolveCommerceSearchIntent({ userText = "", recentMessages = [], searchIntent = {}, classifyCommerce = classifyCommerceIntent, explicitTrigger = false, siteId = "", siteSlug = "", characterId = "", jevDecision = null, enrichAllTurns = false } = {}) {
  if (searchIntent.replyBoundaryReason === 'product_action_closed') {
    searchIntent = { ...searchIntent, replyBoundaryReason: '', replyTopicHint: '', replyClarificationContext: null };
  }
  // A prior turn or an injected classifier field cannot carry this authority.
  if (Object.prototype.hasOwnProperty.call(searchIntent, 'replyPurposeContext')) {
    const { replyPurposeContext: ignoredPurpose, ...currentIntent } = searchIntent;
    searchIntent = currentIntent;
  }
  // Group identities belong to this decision, never a carried previous turn.
  searchIntent = { ...searchIntent, referencedProductIds: [] };
  if (!enrichAllTurns && (explicitTrigger || (searchIntent.nonShoppingReason && searchIntent.nonShoppingReason !== "business_contact"))) return searchIntent;
  let decision;
  try { decision = classifyCommerce ? await classifyCommerce(userText, { recentMessages, siteId, characterId, jevDecision }) : null; } catch { decision = { commerceClassificationFailure: "provider" }; }
  const scope = (intent, value = decision) => applyProductRequestScope(intent, {
    ...value, confidence: value?.productRequestConfidence ?? value?.confidence,
  }, { userText, recentMessages, siteId, characterId, buildIntent: buildProductSearchIntent, getClearedFields: extractRequirementClearFields });
  if (!decision?.confident) {
    const classificationFailure = ["timeout", "provider", "parse", "missing_fields"].includes(decision?.commerceClassificationFailure)
      ? decision.commerceClassificationFailure : "";
    const primaryOther = jevDecision?.ok && jevDecision.confident && jevDecision.primaryIntent && !["product_request", "try_on"].includes(jevDecision.primaryIntent);
    const productFailure = Boolean(classificationFailure && !primaryOther && !searchIntent.nonShoppingReason
      && (searchIntent.shouldLoadProductContext || jevDecision?.productIntent === "search"
        || readProductCandidateState(recentMessages, { siteId, characterId })?.status === "active"));
    // These are fail-closed action permissions, not an inferred user refusal.
    // Keep a server-owned reason so the reply guard can ask a neutral question
    // without reopening product search, cards or contact invitations.
    const clarificationAllowed = !classificationFailure && !searchIntent.nonShoppingReason
      && searchIntent.replyBoundary?.salesAllowed !== false && searchIntent.replyBoundary?.contactAllowed !== false;
    // A tentative topic can constrain a harmless clarification, never restore
    // search/card/contact permissions or count as verified product knowledge.
    const replyClarificationContext = clarificationAllowed && !classificationFailure
      ? buildProductClarificationContext({ decision, jevDecision, searchIntent, userText, recentMessages }) : null;
    const knownBusinessQuestion = !classificationFailure && !primaryOther && decision?.knowledgeScope === "business"
      && decision.route === "store_policy";
    // normalizeCommerceDecision closes answer/action flags below its confidence
    // threshold. The retained route is only a read-only question-purpose hint,
    // never permission to search, issue cards, contact anyone or assert policy.
    const existingBusinessQuestion = searchIntent.customerServiceKnowledgeRequest === true
      || searchIntent.answerRequired === true && searchIntent.knowledgeScope === "business";
    const replyTopicHint = !classificationFailure && decision?.topic === "sizing"
      && ["store_policy", "product_question"].includes(decision.route) ? "sizing" : replyClarificationContext ? knownBusinessQuestion ? "commerce_question" : "product_selection" : "";
    const uncertain = { ...searchIntent, commerceRoute: "unclear", commerceConfidence: Number(decision?.confidence) || 0,
      replyTopicHint, replyClarificationContext,
      shouldLoadProductContext: false, cardAllowed: false, replyBoundary: { salesAllowed: false, contactAllowed: false }, boundaryRequired: true,
      replyBoundaryReason: clarificationAllowed ? "classification_uncertain" : "",
      answerRequired: searchIntent.answerRequired === true || searchIntent.customerServiceKnowledgeRequest === true || knownBusinessQuestion,
      ...(knownBusinessQuestion || existingBusinessQuestion ? {
        knowledgeScope: "business", customerServiceKnowledgeRequest: true,
        commerceTopic: knownBusinessQuestion ? decision.topic : searchIntent.commerceTopic || "other",
        knowledgeQuery: knownBusinessQuestion && typeof decision.knowledgeQuery === "string" ? decision.knowledgeQuery.trim().slice(0, 240) : searchIntent.knowledgeQuery || "",
      } : {}),
      ...normalizeCommerceAssistance({}, { userText }),
      commerceClassificationFailure: classificationFailure, commerceClassificationFailures: decision?.commerceClassificationFailures, commerceClassificationUnavailable: productFailure };
    const conversationPurpose = clarificationAllowed && primaryConversationPurpose({ decision, jevDecision,
      searchIntent, recentMessages, explicitTrigger, siteId, characterId });
    if (conversationPurpose) uncertain.replyPurposeContext = conversationPurpose;
    if (productFailure) {
      return unavailableProductInterpretation(uncertain, classificationFailure, { recentMessages, siteId, characterId });
    }
    if (primaryOther || searchIntent.nonShoppingReason) {
      return clearProductRoutingState(uncertain, { recentMessages, siteId, characterId });
    }
    // A lexical catalogue hint is not an owned product scope. In a tentative
    // policy question it must not manufacture a pending product selection.
    // Retained scopes/candidates still take the original conservative gate.
    const retainedProductScope = searchIntent.scopeUnverified || searchIntent.productScopePending
      || [searchIntent.productRequestState?.status, readProductRequestState(recentMessages, { siteId, characterId })?.status]
        .some(status => ["pending", "selected"].includes(status))
      || searchIntent.productCandidateState?.status === "active"
      || readProductCandidateState(recentMessages, { siteId, characterId })?.status === "active";
    const scopeRoute = knownBusinessQuestion && !retainedProductScope ? decision.route
      : searchIntent.shouldLoadProductContext || retainedProductScope ? "product_search" : decision?.route;
    const scoped = scope(uncertain, { ...decision, route: scopeRoute });
    const inputScope = readProductRequestState([{ senderType: "character", productRequestState: searchIntent.productRequestState }], { siteId, characterId });
    const hasNewerScopeBoundary = recentMessages.some(row => Object.prototype.hasOwnProperty.call(row || {}, "productRequestState"));
    if (!scoped.productRequestState && !hasNewerScopeBoundary && !["new", "cancel", "suspend"].includes(decision?.productRequest?.action)
      && ["pending", "selected"].includes(inputScope?.status)) scoped.productRequestState = inputScope;
    return clearProductRoutingState(scoped, { recentMessages, siteId, characterId, clearRequestScope: false });
  }
  const actionVerified = jevDecision?.productAction === undefined
    || (jevDecision.productAction !== null && Number.isFinite(Number(jevDecision.productAction)) && Number(jevDecision.productAction) >= 0.72);
  // Legacy JEV fallbacks may omit the score, but must still explicitly permit
  // search. A reliable primary label alone cannot bypass the action threshold.
  const primaryAllowsSearch = ["product_request", "try_on"].includes(jevDecision?.primaryIntent)
    && jevDecision.productIntent === "search" && actionVerified
    && !(jevDecision.unsupported && jevDecision.unsupportedIntent === "product_request");
  const primaryBlocksSearch = Boolean(jevDecision?.ok && jevDecision.confident && jevDecision.primaryIntent && !primaryAllowsSearch);
  const currentRequirement = parseCurrentProductRequirement(userText);
  const confirmation = primaryBlocksSearch && resolveCandidateConfirmationIntent(searchIntent, decision, { userText, recentMessages, siteId, siteSlug, characterId, jevDecision, currentRequirement });
  if (confirmation) return confirmation;
  decision = reconcileCatalogueContinuation(decision, { userText, recentMessages, siteId, characterId, jevDecision, searchIntent, current: currentRequirement });
  const assistance = normalizeCommerceAssistance(decision, { userText, recentMessages });
  const answerRequired = Boolean(assistance.businessInquiry || assistance.humanHandoff || assistance.promotionInquiry || assistance.checkoutIssue) || decision.answerRequired === true || ["store_policy", "product_question"].includes(decision.route);
  const knowledgeScope = assistance.businessInquiry || assistance.humanHandoff || assistance.promotionInquiry || assistance.checkoutIssue || decision.knowledgeScope === "business" || ["product_search", "product_question", "store_policy"].includes(decision.route) ? "business" : "general";
  const knowledgeRequest = ["store_policy", "product_question"].includes(decision.route) || (answerRequired && knowledgeScope === "business");
  const replyBoundary = { salesAllowed: decision.replyBoundary?.salesAllowed !== false, contactAllowed: decision.replyBoundary?.contactAllowed !== false };
  // Commerce metadata can enrich a primary action; it cannot turn a JEV chat,
  // image/order or unsupported action into a new product search/card.
  const deterministicNonShopping = Boolean(searchIntent.nonShoppingReason && searchIntent.nonShoppingReason !== "business_contact");
  const commerceRoute = explicitTrigger && !deterministicNonShopping && replyBoundary.salesAllowed ? "product_search" : decision.route;
  const shouldSearch = (decision.route === "product_question" && decision.needsLiveProductData)
    || (!primaryBlocksSearch && !deterministicNonShopping && replyBoundary.salesAllowed && commerceRoute === "product_search");
  const queryIntent = decision.searchQuery ? buildProductSearchIntent(decision.searchQuery) : {};
  const result = {
    ...searchIntent,
    nonShoppingReason: deterministicNonShopping || decision.route === "chat" ? searchIntent.nonShoppingReason : "",
    commerceRoute,
    referencedProductIds: [],
    replyTopicHint: "", replyClarificationContext: null,
    commerceTopic: decision.topic,
    commerceConfidence: decision.confidence,
    primarySearchBlocked: primaryBlocksSearch,
    primarySearchVerified: Boolean(jevDecision?.ok && jevDecision.confident && primaryAllowsSearch),
    needsLiveProductData: Boolean(decision.needsLiveProductData),
    cardAllowed: commerceRoute === "product_search" && shouldSearch && replyBoundary.salesAllowed,
    customerServiceKnowledgeRequest: knowledgeRequest,
    shouldLoadProductContext: Boolean(shouldSearch),
    knowledgeScope,
    knowledgeQuery: typeof decision.knowledgeQuery === "string" ? decision.knowledgeQuery.trim().slice(0, 240) : "",
    answerRequired,
    replyBoundary,
    boundaryRequired: !replyBoundary.salesAllowed || !replyBoundary.contactAllowed,
    // Bounded current-user evidence for coordinating merchandise and image
    // actions. It is not a stock fact or a permission to generate a picture.
    imageProductEvidence: [decision.productRequirement?.evidence,
      ...(Array.isArray(decision.productRequirement?.updates) ? decision.productRequirement.updates : []).slice(0, 12).map(update => update?.evidence),
      ...(Array.isArray(decision.productRequest?.items) ? decision.productRequest.items : []).slice(0, 4).flatMap(item => [item?.evidence, item?.sharedEvidence])]
      .filter(value => typeof value === "string" && value.trim() && value.length <= 500 && userText.includes(value.trim()))
      .map(value => value.trim()).slice(0, 6),
    ...assistance,
  };
  if (shouldSearch && decision.searchQuery) {
    result.query = decision.searchQuery;
    result.requestedKeywords = queryIntent.requestedKeywords || [];
    for (const key of ["requestedTeam", "requestedProductType", "requestedAudience", "requestedColor", "requestedSeason", "requestedVariant", "requestedAgeRange", "requestedSizeProfile"]) result[key] = searchIntent[key] || queryIntent[key] || "";
    for (const key of ["requestedVariants", "requestedSizes", "requestedFeatures"]) result[key] = searchIntent[key]?.length ? searchIntent[key] : (queryIntent[key] || []);
    // Preserve pending correction confirmation and the existing two-question limit.
    const preserveClarification = searchIntent.searchState === "clarification_exhausted"
      || (searchIntent.correctionSuggestion?.corrected && !searchIntent.correctionConfirmed);
    result.searchState = preserveClarification ? searchIntent.searchState
      : decision.route === "product_question" ? "ready_to_search" : (queryIntent.searchState || searchIntent.searchState);
  }
  const userTexts = [userText, ...recentMessages.filter((message) => (message.senderType || message.sender_type) === "user").map((message) => message.text || message.text_content || "")];
  const constraints = normalizeCommerceConstraints(decision.commerceConstraints, userTexts);
  result.commerceConstraints = constraints;
  if (decision.teamConstraintUnverified) {
    result.teamConstraintUnverified = true;
    result.requestedTeam = "";
    result.shouldLoadProductContext = false;
    result.cardAllowed = false;
    result.searchState = searchIntent.searchState === "clarification_exhausted" ? "clarification_exhausted" : "needs_clarification";
  }
  if (constraints.edition) {
    Object.assign(result, applyRequestedProductEdition(result, constraints.edition.value));
  }
  if (constraints.team) {
    const evidenceTeam = buildProductSearchIntent(constraints.team.evidence).requestedTeam;
    const canonicalTeam = buildProductSearchIntent(constraints.team.value).requestedTeam;
    if (constraints.team.role === "product_target" && (!evidenceTeam || evidenceTeam === (canonicalTeam || constraints.team.value) || normalizeLooseText(evidenceTeam) === normalizeLooseText(constraints.team.value))) {
      result.requestedTeam = canonicalTeam || constraints.team.value;
    } else if (constraints.team.role === "product_target") {
      // Contradictory semantic evidence must not fall back to the original
      // locality/first-mentioned team and issue an unrelated product card.
      result.requestedTeam = "";
      result.shouldLoadProductContext = false;
      result.cardAllowed = false;
      result.searchState = searchIntent.searchState === "clarification_exhausted" ? "clarification_exhausted" : "needs_clarification";
    } else if (constraints.team.role !== "product_target" && evidenceTeam === result.requestedTeam) {
      result.requestedTeam = "";
      // A locality must not survive as a keyword/recall anchor after clearing the
      // scalar constraint. Only use the independent catalogue query's keywords.
      result.requestedKeywords = (queryIntent.requestedKeywords || []).filter((keyword) => !constraints.team.evidence.toLowerCase().includes(keyword.toLowerCase()));
    }
  }
  if (decision.referencedProductIds?.length) {
    const references = resolveDisplayedProductReferences(decision.referencedProductIds, recentMessages, { siteId, siteSlug, characterId });
    const priorScope = readProductRequestState(recentMessages, { siteId, characterId });
    const priorTarget = readProductCandidateState(recentMessages, { siteId, characterId });
    const protectedOwner = ['pending','selected'].includes(priorScope?.status)
      || priorTarget?.status === 'active' && (priorTarget.owner === 'selected' || priorTarget.proposal || priorTarget.suspectedTerm);
    const continuing = !protectedOwner && !['new','cancel'].includes(decision.productRequirementAction) && decision.productRequirement?.action !== 'new'
      && !['cancel','suspend'].includes(decision.productRequest?.action)
      && !(decision.productRequest?.action === 'new' && decision.productRequest?.relation !== 'none')
      && !['cancel'].includes(decision.productRequirement?.action)
      && !(currentRequirement.clearFields?.length)
      && !(decision.productRequirement?.updates?.length);
    if (references && continuing && !hasPendingProductRequest(result) && !result.scopeUnverified
      && ['product_question','product_search'].includes(result.commerceRoute)) {
      result.referencedProductIds = [...decision.referencedProductIds];
    } else {
      result.referencedProductIds = [];
      result.unresolvedProductReference = true;
      result.shouldLoadProductContext = false;
      result.cardAllowed = false;
    }
  }
  if (decision.route === "product_question" && shouldSearch && decision.referencedProductId) {
    const referenced = recentMessages.slice(-12).map((message) => message.product).find((product) => product?.name && String(product.productId || product.id || "") === decision.referencedProductId);
    const sameSite = referenced && (
      (!siteId && !siteSlug)
      || (siteId && String(referenced.siteId || "") === String(siteId)
        && (!siteSlug || !referenced.siteSlug || String(referenced.siteSlug) === String(siteSlug)))
      || (!referenced.siteId && siteSlug && String(referenced.siteSlug || "") === String(siteSlug))
    );
    if (sameSite) {
      result.referencedProductId = decision.referencedProductId;
      result.referencedSiteId = referenced.siteId || "";
      result.referencedSiteSlug = referenced.siteSlug || "";
      result.query = referenced.name;
      result.productHandle = extractProductHandle(referenced.url);
      result.requestedKeywords = [];
    } else {
      result.unresolvedProductReference = true;
      result.shouldLoadProductContext = false;
    }
  }
  // Primary non-shopping actions keep their existing behavior. Expire an old
  // item scope instead of turning an order, image or service reply into selection.
  if ((primaryBlocksSearch && decision.route !== "product_question") || deterministicNonShopping || (!replyBoundary.salesAllowed && decision.route !== "product_question")) {
    const request = readProductRequestState(recentMessages, { siteId, characterId });
    const candidate = readProductCandidateState(recentMessages, { siteId, characterId });
    const clarification = buildClosedProductClarificationContext({ decision, jevDecision, searchIntent: result, userText, recentMessages,
      hasRetainedProduct: ['pending', 'selected'].includes(request?.status) || candidate?.status === 'active'
        || ['pending', 'selected'].includes(searchIntent.productRequestState?.status) || searchIntent.productCandidateState?.status === 'active' });
    const cleared = clearProductRoutingState(result, { recentMessages, siteId, characterId });
    return clarification ? { ...cleared, replyBoundaryReason: 'product_action_closed', replyClarificationContext: clarification } : cleared;
  }
  const candidateIntent = applyProductCandidateState(scope(result), decision, { userText, recentMessages, siteId, characterId, currentRequirement });
  // A validated existing-card reference does not abandon its matched target.
  // The generic candidate transition clears active tracking for action=none;
  // preserve only this unchanged single target, never a candidate proposal.
  const noRequirementChange = decision.productRequirementAction === 'none' || decision.productRequirement?.action === 'none';
  if (candidateIntent.referencedProductIds?.length && noRequirementChange
    && decision.productRequest?.relation === 'none' && decision.productRequest?.action === 'new'
    && !currentRequirement.clearFields?.length && !decision.productRequirement?.updates?.length
    && candidateIntent.productCandidateState?.status === 'cleared'
    && !hasPendingProductRequest(candidateIntent) && !candidateIntent.scopeUnverified) {
    const prior = readProductCandidateState(recentMessages, { siteId, characterId });
    if (prior?.status === 'active' && prior.owner === 'single' && !prior.proposal && !prior.suspectedTerm) {
      candidateIntent.productCandidateState = prior;
    }
  }
  return candidateIntent.productCandidateInterpretationUnverified
    ? unavailableProductInterpretation(candidateIntent, "missing_fields", { recentMessages, siteId, characterId }) : candidateIntent;
}

// This layer only applies to semantically identified product/store questions.
export function applyCommerceQuestionPromptPolicy(promptContext = {}, searchIntent = {}) {
  const tentativeSizing = searchIntent.replyTopicHint === "sizing";
  const clarification = productClarificationContext(searchIntent);
  if (clarification) {
    const layer = { id: "commerce_clarification", title: "Merchandise Clarification", content:
      `${PRODUCT_CLARIFICATION_CONTRACT}\nUSER context: ${JSON.stringify(clarification)}` };
    return { ...promptContext, systemPrompt: `${String(promptContext.systemPrompt || "").trim()}\n\n## ${layer.title}\n${layer.content}`,
      layers: [...(Array.isArray(promptContext.layers) ? promptContext.layers : []), layer] };
  }
  if (!searchIntent.answerRequired && !["product_question", "store_policy"].includes(searchIntent.commerceRoute) && !tentativeSizing) return promptContext;
  const content = [
    "Answer the user's current product or store question in their active conversation language, using the existing character's tone.",
    "Use only trusted catalogue facts and retrieved knowledge for store/product claims. A product name, brand mention, logo or photograph alone does not prove authenticity, official licensing or manufacturer origin.",
    "If a required fact is absent, state what cannot be confirmed and use relevant store policy if available; do not invent a guarantee or suggest an unrelated replacement.",
    "Answer every question in the current turn fully and concisely. A product card or its short caption must never replace or truncate the answer, including when the user also asks to shop. Continue existing order lookup/account binding rules when the question requires order access.",
    (searchIntent.commerceTopic === "sizing" && searchIntent.knowledgeScope !== "general" || tentativeSizing) ? SIZING_CONVERSATION_CONTRACT : "",
    tentativeSizing ? "The sizing purpose is tentative, not permission for actions or a verified fact. Use current conversation only to ask a relevant missing clarification; do not force this interpretation over an explicit new topic." : "",
    searchIntent.businessInquiry ? "This turn concerns a business inquiry. Answer from retrieved business knowledge and verified store policies first. Do not convert a partnership, bulk supply or negotiated quote request into a retail sales pitch. Do not invent sales volume, commercial capabilities, negotiated prices, eligibility or contract terms. A service-policy question can be answered without automatically requesting human review; negotiated terms require the existing feedback form." : "",
    searchIntent.humanHandoff ? "The server may offer the existing feedback action for this request. Do not claim that a live human is available, that a transfer has completed, or that submitting a request guarantees a response. Explain available verified support information; server-provided navigation explains the actual form submission." : "",
    searchIntent.promotionInquiry?.kind === "policy" ? "Explain only verified promotion or discount policy and its limits. Policy explanation is not issuing, applying, promising or approving a coupon or benefit. Do not invent a code, eligibility, savings or successful discount application." : "",
    searchIntent.commerceRoute === "product_search" ? "The user's shopping request may still receive a matching card; keep the substantive answer independent from any brief card caption." : "The user has asked a question, not requested a new recommendation. Do not promise a new product card, shopping link or push another item.",
  ].filter(Boolean).join("\n");
  return { ...promptContext,
    systemPrompt: `${String(promptContext.systemPrompt || "").trim()}\n\n## Commerce Question\n${content}`.trim(),
    layers: [...(promptContext.layers || []), { id: "commerce_question", title: "Commerce Question", content }],
  };
}
