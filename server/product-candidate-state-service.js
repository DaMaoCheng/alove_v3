import { normalizeRequirement } from './product-search-decision-service.js';
import { hasPendingProductRequest, readProductRequestState, normalizeProductRequest, productRequestOwnerEvidence } from './product-request-scope-service.js';
import { buildProductSearchIntent, extractRequirementClearFields, isAlternativeProductRequest } from './product-intent-service.js';
import { requestedProductEdition, applyRequestedProductEdition } from './product-edition-service.js';
import { PRODUCT_REQUIREMENT_SCALAR_VALUES, PRODUCT_REQUIREMENT_ARRAY_VALUES } from './product-requirement-fields.js';

// Private conversation evidence, never availability or permission to shop.
export const PRODUCT_CANDIDATE_STATE_NAMESPACE = '_productCandidateState';
const SCALARS = new Set(['requestedTeam', 'requestedProductType', 'requestedAudience', 'requestedColor', 'requestedSeason', 'requestedEdition', 'requestedPrinting']);
const ARRAYS = new Set(['requestedFeatures', 'requestedVariants', 'requestedSizes']);
const string = (value, max = 240) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const evidence = (value, userText) => string(value) && String(userText).includes(string(value)) ? string(value) : '';

export const PRODUCT_CANDIDATE_CONTRACT = `productRequirement and candidateResponse interpret only the CURRENT user message, in any language. Quote exact continuous current substrings for evidence. Requirement new establishes one current merchandise target; continue refines the existing single target or selected prior multiple item, including asking for its link; cancel withdraws it; none is unrelated. Never merge independent targets. Only with no active server target, priorTargetEvidence may quote an exact prior USER substring identifying one target; otherwise empty. Never derive user requirements from assistant text/cards. Updates MUST include every current explicit specification change/removal, never inherited conditions. Return at most one update per field, combining all CURRENT values for an array field in that single update. Do not output unchanged historical fields, absent specifications or placeholder updates. A field not explicitly specified or removed in the CURRENT message must be omitted entirely; an unspecified size does not mean requestedSizes:[]; an existing target does not excuse omitting a current revision. Keep an explicitly requested historical single year as that year; do not infer an adjacent full season from it. Use schema canonical values (shirt/top/merch are garment types, never titles); empty values require explicit removal evidence. No name AND no number means printing:none, not customization. suspectedTerm preserves a potentially mistyped catalogue term verbatim, never substitutes guessed spelling. candidateResponse confirm/reject requires the active DISPLAYED proposal's exact candidateId and current assent/refusal evidence; a request after rejecting another item does not confirm it. Product display, link, comparison and specification requests alone are not identity assent: use candidateResponse none unless a distinct current evidence span affirmatively identifies the displayed item as the intended item. Entity confirmation never relaxes unknown attributes or promotion eligibility. For every single-target turn, including continuation, productRequest is single/new/items:[]/selectedIndex:null; select/continue in productRequest are reserved for prior multiple scope.`;

export function normalizeProductRequirementDecision(value, { userText = '' } = {}) {
  if (!object(value) || !['new', 'continue', 'cancel', 'none'].includes(value.action)) return null;
  if (value.action === 'none') return { action: 'none', evidence: '', updates: [], suspectedTerm: null };
  // A continuation can be grounded in an independently exact typed revision.
  // Do not repair/reinterpret the model's punctuation or any update quotation.
  const quoted = evidence(value.evidence, userText) || (value.action === 'continue' && Array.isArray(value.updates)
    ? evidence(value.updates[0]?.evidence, userText) : '');
  if (!quoted || !Array.isArray(value.updates) || value.updates.length > 12) return null;
  const updates = [], seen = new Set();
  for (const update of value.updates) {
    if (!object(update) || seen.has(update.field) || !evidence(update.evidence, userText)) return null;
    if (!SCALARS.has(update.field) && !ARRAYS.has(update.field)) return null;
    let next;
    if (ARRAYS.has(update.field)) {
      if (!Array.isArray(update.value) || update.value.length > 8 || update.value.some(item => !string(item, 80))) return null;
      next = [...new Set(update.value.map(item => string(item, 80)))];
      if (next.some(item => !PRODUCT_REQUIREMENT_ARRAY_VALUES[update.field].includes(item))) return null;
    } else {
      if (typeof update.value !== 'string' || update.value.length > 120) return null;
      next = update.value.trim();
      if (PRODUCT_REQUIREMENT_SCALAR_VALUES[update.field] && next && !PRODUCT_REQUIREMENT_SCALAR_VALUES[update.field].includes(next)) return null;
      if (update.field === 'requestedSeason' && next && !/^\d{4}(?:\/\d{2})?$/.test(next)) return null;
      if (next && update.field === 'requestedTeam') {
        const mentioned = buildProductSearchIntent(update.evidence).requestedTeam;
        const proposed = buildProductSearchIntent(next).requestedTeam;
        if (mentioned && mentioned !== (proposed || next)) return null;
      }
    }
    seen.add(update.field);
    updates.push({ field: update.field, value: next, evidence: evidence(update.evidence, userText) });
  }
  let suspectedTerm = null;
  if (value.suspectedTerm != null) {
    const term = string(value.suspectedTerm.value, 80), quotedTerm = evidence(value.suspectedTerm.evidence, userText);
    if (!term || !quotedTerm || !quotedTerm.includes(term)) return null;
    suspectedTerm = { value: term, evidence: quotedTerm };
  }
  return { action: value.action, evidence: quoted, updates, suspectedTerm, priorTargetEvidence: string(value.priorTargetEvidence, 1200) };
}

export function normalizeCandidateResponse(value, { userText = '' } = {}) {
  if (!object(value) || !['confirm', 'reject', 'none'].includes(value.action)) return null;
  if (value.action === 'none') return { action: 'none', evidence: '', candidateId: '' };
  const quoted = evidence(value.evidence, userText), candidateId = string(value.candidateId, 160);
  return quoted && candidateId ? { action: value.action, evidence: quoted, candidateId } : null;
}

function requirements(value = {}) {
  const normalized = normalizeRequirement(value), edition = requestedProductEdition(value);
  // Old stored features can establish a version. Conflicting legacy evidence
  // stays conflicting; only an explicit validated update may replace it.
  return { ...normalized, requestedSizes: Array.isArray(value.requestedSizes) ? value.requestedSizes.filter(item => string(item, 80)).slice(0, 8) : [],
    requestedFeatures: normalized.requestedFeatures.filter(feature => !['authentic', 'fan_version'].includes(feature)),
    requestedEdition: edition === 'conflict' || PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedEdition.includes(edition) ? edition : '',
    requestedPrinting: PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedPrinting.includes(value.requestedPrinting) ? value.requestedPrinting : '' };
}

export function parseCurrentProductRequirement(userText) {
  const current = buildProductSearchIntent(userText);
  return { ...current, clearFields: extractRequirementClearFields(userText),
    sleeves: (current.requestedFeatures || []).filter(feature => PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedFeatures.includes(feature)),
    alternativeRequested: isAlternativeProductRequest(userText) };
}

export function findDisplayedProductCandidate(state, recentMessages, { siteId, characterId, allowConfirmed = false }) {
  const proposal = state?.proposal;
  if (proposal?.status !== 'displayed' && !(allowConfirmed && proposal?.status === 'confirmed')) return null;
  return recentMessages.slice(-12).find(row => row.senderType === 'character' && row.characterId === characterId
    && row.contentType === 'product' && row.product?.matchStatus === 'candidate'
    && String(row.product.siteId || '') === String(siteId)
    && String(row.product.productId || row.product.id || '') === proposal.candidateId
    && row.product.name === proposal.name)?.product || null;
}

function hasOwnedMatchedReference(previous, referencedId, recentMessages, { siteId, characterId }) {
  if (!string(referencedId, 160)) return false;
  const ownerIndex = recentMessages.findLastIndex(row => Object.hasOwn(row || {}, 'productCandidateState'));
  const owner = ownerIndex >= 0 ? readProductCandidateState([recentMessages[ownerIndex]], { siteId, characterId }) : null;
  if (!owner || JSON.stringify(owner) !== JSON.stringify(previous)) return false;
  // Only the cards in this owned reply group can explain its follow-up. An
  // older card across a user turn or target boundary cannot restore conditions.
  for (let index = ownerIndex - 1; index >= 0; index--) {
    const row = recentMessages[index];
    if ((row.senderType || row.sender_type) === 'user' || Object.hasOwn(row || {}, 'productCandidateState')) break;
    if (row.senderType === 'character' && row.characterId === characterId && row.contentType === 'product'
      && (!row.deliveryStatus || row.deliveryStatus === 'sent') && (!row.delivery_status || row.delivery_status === 'sent')
      && row.product?.matchStatus === 'matched' && row.product.siteId === siteId
      && String(row.product.productId || row.product.id || '') === referencedId) return true;
  }
  return false;
}

function normalizeTargetTransition(delta, previous, decision, current, { sameOwner, recentMessages, siteId, characterId, userText }) {
  if (delta.action !== 'new' || !sameOwner || current.alternativeRequested
    || ['alternative', 'comparison', 'multiple', 'unclear'].includes(decision.productRequest?.relation)) return delta;
  const response = normalizeCandidateResponse(decision.candidateResponse, { userText });
  if (response?.action === 'reject' && response.candidateId === previous.proposal?.candidateId
    && findDisplayedProductCandidate(previous, recentMessages, { siteId, characterId })) return delta;
  const newIdentity = current.requestedTeam && current.requestedTeam !== previous.requirements.requestedTeam
    || current.requestedProductType && current.requestedProductType !== previous.requirements.requestedProductType
    || delta.updates.some(update => ['requestedTeam', 'requestedProductType'].includes(update.field)
      && update.value && update.value !== previous.requirements[update.field]);
  const specificationRevision = delta.updates.length > 0
    || current.sleeves.length === 1 && !current.clearFields.includes('requestedFeatures');
  // Repeating a generic garment type is not a new identity, but the additional
  // recovery needs the exact displayed item reference; guesses cannot inherit.
  const sameGarmentReference = !current.requestedProductType
    || decision.referencedProductId === previous.proposal?.candidateId
      && Boolean(findDisplayedProductCandidate(previous, recentMessages, { siteId, characterId, allowConfirmed: true }))
    || hasOwnedMatchedReference(previous, decision.referencedProductId, recentMessages, { siteId, characterId });
  return !newIdentity && specificationRevision && sameGarmentReference ? { ...delta, action: 'continue' } : delta;
}

function reviseRequirements(base, delta, current) {
  const next = requirements(base);
  if (delta.action === 'continue') {
    for (const field of ['requestedPrintNumber', 'customizationRequest', 'requestedAgeRange', 'requestedSizeProfile']) {
      if (current[field]) next[field] = current[field];
    }
    if (current.requestedAgeRange && current.requestedAudience) next.requestedAudience = current.requestedAudience;
    for (const field of current.clearFields) {
      if (Object.prototype.hasOwnProperty.call(next, field)) next[field] = Array.isArray(next[field]) ? [] : '';
    }
    next.clearFields = current.clearFields;
    if (current.requestedPrinting === 'none') next.requestedPrinting = 'none';
    else if (current.customizationRequest === 'jersey' || current.requestedPrintNumber) next.requestedPrinting = '';
  }
  for (const update of delta.updates) {
    if (update.field === 'requestedFeatures') next.requestedFeatures = [
      ...next.requestedFeatures.filter(item => !PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedFeatures.includes(item)), ...update.value,
    ];
    else next[update.field] = update.value;
    if (update.field === 'requestedEdition') next.requestedFeatures = next.requestedFeatures.filter(feature => !['authentic', 'fan_version'].includes(feature));
  }
  if (current.sleeves.length === 1 && !current.clearFields.includes('requestedFeatures')
    && !delta.updates.some(update => update.field === 'requestedFeatures')) {
    next.requestedFeatures = [...next.requestedFeatures.filter(feature => !PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedFeatures.includes(feature)), ...current.sleeves];
  }
  if (next.requestedPrinting === 'none') { next.customizationRequest = ''; next.requestedPrintNumber = ''; }
  next.requestedVariant = next.requestedVariants[0] || '';
  return next;
}

function conditionEvidence(value = [], fallback = []) {
  const rows = [...new Set([...(Array.isArray(value) ? value : []), ...fallback]
    .filter(item => string(item, 1200)).map(item => string(item, 1200)))];
  // Keep the original target and the latest revisions; no unrelated scope is added.
  return rows.length <= 4 ? rows : [rows[0], ...rows.slice(-3)];
}

function validState(value) {
  if (!object(value) || value.version !== 1 || !['active', 'cleared'].includes(value.status)
    || !string(value.siteId, 160) || !string(value.characterId, 160)) return null;
  if (value.status === 'cleared') return { version: 1, status: 'cleared', siteId: value.siteId, characterId: value.characterId };
  if (!['single', 'selected'].includes(value.owner) || !string(value.targetEvidence, 1200) || !object(value.requirements)) return null;
  if (value.owner === 'selected' && (!Number.isInteger(value.selectedIndex) || !string(value.ownerEvidence, 2400))) return null;
  const proposal = value.proposal;
  if (value.suspectedTerm != null && (!object(value.suspectedTerm) || !string(value.suspectedTerm.value, 80) || !string(value.suspectedTerm.evidence))) return null;
  if (proposal != null && (!object(proposal) || !['displayed', 'confirmed', 'rejected'].includes(proposal.status)
    || !string(proposal.candidateId, 160) || !string(proposal.name, 240) || !string(proposal.reply, 2000))) return null;
  return { version: 1, status: 'active', siteId: value.siteId, characterId: value.characterId,
    owner: value.owner, ...(value.owner === 'selected' ? { selectedIndex: value.selectedIndex, ownerEvidence: value.ownerEvidence } : {}),
    targetEvidence: value.targetEvidence,
    requestedConditionEvidence: conditionEvidence(value.requestedConditionEvidence, [value.targetEvidence]), requirements: requirements(value.requirements), suspectedTerm: value.suspectedTerm || null,
    proposal: proposal ? { status: proposal.status, candidateId: proposal.candidateId, name: proposal.name, reply: proposal.reply,
      ...(string(proposal.confirmationEvidence) ? { confirmationEvidence: string(proposal.confirmationEvidence) } : {}) } : null };
}

export function readProductCandidateState(recentMessages = [], { siteId = '', characterId = '' } = {}) {
  for (const row of [...(Array.isArray(recentMessages) ? recentMessages : [])].reverse()) {
    if (!Object.prototype.hasOwnProperty.call(row || {}, 'productCandidateState')) continue;
    if ((row.senderType || row.sender_type) !== 'character') return null;
    const state = validState(row.productCandidateState);
    return state && state.siteId === String(siteId) && state.characterId === String(characterId) ? state : null;
  }
  return null;
}

export function clearProductCandidateState({ siteId = '', characterId = '' } = {}) {
  return string(String(siteId), 160) && string(String(characterId), 160)
    ? { version: 1, status: 'cleared', siteId: String(siteId), characterId: String(characterId) } : null;
}

export function applyProductCandidateState(intent = {}, decision = {}, { userText = '', recentMessages = [], siteId = '', characterId = '', currentRequirement = null } = {}) {
  let previous = readProductCandidateState(recentMessages, { siteId, characterId });
  let delta = normalizeProductRequirementDecision(decision.productRequirement, { userText });
  // A new single scope has already been classified and validated upstream.
  // Establish its USER target directly when a redundant model quotation is
  // malformed. This cannot restore an old target, select an item, confirm a
  // candidate, alter permissions, or relax typed/unknown catalogue attributes.
  const current = currentRequirement || parseCurrentProductRequirement(userText);
  const newScope = normalizeProductRequest(decision.productRequest, { userText, confidence: decision.confidence });
  const targetTeam = decision.commerceConstraints?.team?.role === 'product_target'
    ? buildProductSearchIntent(decision.commerceConstraints.team.value).requestedTeam : '';
  if (!delta && decision.confident && decision.productRequirementAction === 'new'
    && newScope.valid && newScope.relation === 'single' && newScope.action === 'new'
    && intent.primarySearchVerified === true && intent.shouldLoadProductContext === true
    && intent.replyBoundary?.salesAllowed !== false && !hasPendingProductRequest(intent) && !intent.teamConstraintUnverified
    && intent.searchState !== 'clarification_exhausted'
    && current.requestedTeam && current.requestedTeam === targetTeam && current.requestedProductType
    && current.shouldLoadProductContext && string(userText)) {
    delta = { action: 'new', evidence: string(userText), updates: [], suspectedTerm: null };
    intent = { ...intent, ...requirements(current) };
    decision = { ...decision, candidateResponse: { action: 'none', evidence: '', candidateId: '' } };
  }
  if (!decision.confident || !delta || delta.action === 'none') {
    if (!delta && decision.candidateDecisionRequired && intent.shouldLoadProductContext) {
      return { ...intent, productCandidateInterpretationUnverified: true };
    }
    return previous?.status === 'active' ? { ...intent, productCandidateState: clearProductCandidateState({ siteId, characterId }), candidateSearchAllowed: false } : intent;
  }
  if (delta.action === 'cancel') return { ...intent, productCandidateState: clearProductCandidateState({ siteId, characterId }), candidateSearchAllowed: false };
  if (hasPendingProductRequest(intent) || intent.teamConstraintUnverified || intent.searchState === 'clarification_exhausted') {
    return previous?.status === 'active' ? { ...intent, productCandidateState: clearProductCandidateState({ siteId, characterId }), candidateSearchAllowed: false } : intent;
  }
  const scope = intent.productRequestState || readProductRequestState(recentMessages, { siteId, characterId });
  const selected = scope?.status === 'selected';
  const ownerEvidence = selected ? productRequestOwnerEvidence(scope) : '';
  // Legacy conversations have no durable target. Restore only an exact prior
  // USER span selected by this turn's semantic interpretation, never a card or
  // an assistant claim. A durable cleared/invalid boundary cannot be bypassed.
  const hasBoundary = recentMessages.some(row => Object.prototype.hasOwnProperty.call(row || {}, 'productCandidateState'));
  if (!previous && !hasBoundary && !selected && delta.action === 'continue' && delta.priorTargetEvidence) {
    const userRow = recentMessages.slice(-12).reverse().find(row => (row.senderType || row.sender_type) === 'user'
      && String(row.text || row.text_content || '').includes(delta.priorTargetEvidence));
    const parsed = userRow ? buildProductSearchIntent(delta.priorTargetEvidence) : null;
    if (parsed?.requestedTeam && parsed?.requestedProductType && (!intent.requestedTeam || intent.requestedTeam === parsed.requestedTeam)) {
      previous = { version: 1, status: 'active', siteId: String(siteId), characterId: String(characterId), owner: 'single',
        targetEvidence: delta.priorTargetEvidence, requirements: requirements(parsed), suspectedTerm: null, proposal: null };
    }
  }
  const sameOwner = previous?.status === 'active' && (selected
    ? previous.owner === 'selected' && previous.selectedIndex === scope.selectedIndex && previous.ownerEvidence === ownerEvidence
    : previous.owner === 'single');
  // Establishing a new identity requires CURRENT identity evidence. An exact
  // specification-only revision of the owned target must not erase its other
  // USER conditions merely because the redundant action label says `new`.
  delta = normalizeTargetTransition(delta, previous, decision, current, { sameOwner, recentMessages, siteId, characterId, userText });
  if (delta.action === 'continue' && !sameOwner && !selected) return decision.candidateDecisionRequired
    ? { ...intent, productCandidateInterpretationUnverified: true } : intent;
  if (!string(String(siteId), 160) || !string(String(characterId), 160)) return intent;
  // Continuing keeps server-validated user requirements. A new target never
  // inherits an old one merely because the current lexical parser lacks fields.
  const next = reviseRequirements(delta.action === 'continue' && sameOwner ? previous.requirements : intent, delta, current);
  const state = { version: 1, status: 'active', siteId: String(siteId), characterId: String(characterId),
    owner: selected ? 'selected' : 'single', ...(selected ? { selectedIndex: scope.selectedIndex, ownerEvidence } : {}),
    targetEvidence: delta.action === 'continue' && sameOwner ? previous.targetEvidence : delta.evidence,
    requestedConditionEvidence: conditionEvidence(delta.action === 'continue' && sameOwner ? previous.requestedConditionEvidence : [],
      [...(selected ? [scope.items[scope.selectedIndex].evidence, scope.items[scope.selectedIndex].sharedEvidence,
        ...(scope.items[scope.selectedIndex].updates || [])] : []), delta.evidence]),
    requirements: next, suspectedTerm: delta.suspectedTerm || (delta.action === 'continue' && sameOwner ? previous.suspectedTerm : null),
    proposal: delta.action === 'continue' && sameOwner ? previous.proposal : null };
  if (state.suspectedTerm) next.requestedKeywords = [...new Set([...next.requestedKeywords, state.suspectedTerm.value.toLowerCase()])];
  const changed = !sameOwner || JSON.stringify(next) !== JSON.stringify(previous.requirements)
    || JSON.stringify(state.suspectedTerm) !== JSON.stringify(previous.suspectedTerm);
  let response = normalizeCandidateResponse(decision.candidateResponse, { userText });
  // Actual specification revisions need independent identity assent. Repeating
  // an unchanged owned condition may naturally be part of that assent; compare
  // each normalized field so an unrelated revision cannot turn that no-op into
  // an overlap failure. Whole-response review and source attributes still apply.
  if (response?.action === 'confirm' && delta.updates.some(update =>
    (!sameOwner || JSON.stringify(next[update.field]) !== JSON.stringify(previous.requirements[update.field]))
    && (response.evidence.includes(update.evidence) || update.evidence.includes(response.evidence)))) response = null;
  if (response && response.action !== 'none' && state.proposal?.status === 'displayed' && response.candidateId === state.proposal.candidateId) {
    state.proposal = { ...state.proposal, status: response.action === 'confirm' ? 'confirmed' : 'rejected',
      ...(response.action === 'confirm' ? { confirmationEvidence: response.evidence } : {}) };
  }
  if (changed && response?.action !== 'confirm' && response?.action !== 'reject') state.proposal = null;
  const effective = requestedProductEdition(next) === 'conflict' ? { ...next } : applyRequestedProductEdition(next, next.requestedEdition);
  if (state.proposal?.status === 'confirmed' && state.suspectedTerm) {
    const term = state.suspectedTerm.value.toLowerCase();
    effective.requestedKeywords = next.requestedKeywords.filter(keyword => keyword.toLowerCase() !== term);
  }
  const permitted = intent.shouldLoadProductContext === true && intent.replyBoundary?.salesAllowed !== false
    && ['product_search', 'product_question'].includes(intent.commerceRoute)
    && Boolean(next.requestedTeam && next.requestedProductType) && next.customizationRequest !== 'ambiguous';
  const query = state.suspectedTerm && state.proposal?.status !== 'confirmed' && !String(intent.query || '').toLowerCase().includes(state.suspectedTerm.value.toLowerCase())
    ? `${intent.query || ''} ${state.suspectedTerm.value}`.trim() : intent.query;
  return { ...intent, ...effective, query, productCandidateState: state, candidateSearchAllowed: permitted,
    ...(permitted ? { searchState: 'ready_to_search' } : {}),
    productCustomizationRequest: next.customizationRequest === 'jersey',
    ambiguousCustomizationRequest: next.customizationRequest === 'ambiguous',
    ...(state.proposal?.status === 'confirmed' ? { confirmedCandidateId: state.proposal.candidateId, query: state.proposal.name } : {}),
    ...(state.proposal?.status === 'rejected' ? { rejectedCandidateId: state.proposal.candidateId } : {}) };
}

// Call only after review and card selection, with the actual persisted reply.
export function markProductCandidateDisplayed(value, product = {}, { approvedReply = '', confirmationRequested = false } = {}) {
  const state = validState(value);
  if (!state || state.status !== 'active') return value;
  product = object(product) ? product : {};
  const candidateId = string(String(product.productId || product.id || ''), 160);
  const name = string(product.name, 240), reply = string(approvedReply, 2000);
  if (!candidateId || !name || !reply || !confirmationRequested || product.matchStatus !== 'candidate') return { ...state, proposal: null };
  return { ...state, proposal: { status: 'displayed', candidateId, name, reply } };
}

// Identity assent is a semantic proposal until the existing whole evidence
// review approves it and the actual item is selected. Both persistence entries
// use this boundary; a rejected/failed review cannot leave a confirmed identity.
export function finalizeProductCandidateState(value, product, { approvedReply = '', confirmationRequested = false, evidenceVerified = false } = {}) {
  const state = validState(value);
  if (!state || state.status !== 'active') return value;
  if (state.proposal?.status === 'confirmed') return evidenceVerified === true
    && String(product?.siteId || '') === state.siteId
    && String(product?.productId || product?.id || '') === state.proposal.candidateId
    ? { ...state, suspectedTerm: null, requirements: { ...state.requirements,
      requestedKeywords: state.suspectedTerm ? state.requirements.requestedKeywords.filter(term => term.toLowerCase() !== state.suspectedTerm.value.toLowerCase()) : state.requirements.requestedKeywords } }
    : { ...state, proposal: null };
  return confirmationRequested || state.proposal?.status === 'displayed'
    ? markProductCandidateDisplayed(state, product, { approvedReply, confirmationRequested }) : state;
}

export function stripProductCandidatePayload(payload) {
  if (!object(payload) || !Object.prototype.hasOwnProperty.call(payload, PRODUCT_CANDIDATE_STATE_NAMESPACE)) return payload;
  const result = { ...payload };
  delete result[PRODUCT_CANDIDATE_STATE_NAMESPACE];
  return Object.keys(result).length ? result : null;
}

export function mergeProductCandidatePayload(payload, state) {
  if (state == null) return payload;
  const result = stripProductCandidatePayload(payload), normalized = validState(state);
  return normalized ? { ...(object(result) ? result : {}), [PRODUCT_CANDIDATE_STATE_NAMESPACE]: normalized } : result;
}
