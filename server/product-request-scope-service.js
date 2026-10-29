import { createHash } from 'node:crypto';
import { redactContactEmailsForPrompt } from './chat-prompt-utils.js';
// Server-owned, bounded conversation scope. This is neither a cart nor stock evidence.
export const PRODUCT_REQUEST_SCOPE_NAMESPACE = '_productRequestScope';
const RELATIONS = new Set(['single', 'multiple', 'alternative', 'comparison', 'none', 'unclear']);
const ACTIONS = new Set(['new', 'select', 'continue', 'suspend', 'cancel']);
const MAX_ITEMS = 4;
const MAX_TEXT = 240;
const MAX_QUESTIONS = 2;
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = MAX_TEXT) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : '';
const confident = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const indexValid = (value, items) => Number.isInteger(value) && value >= 0 && value < items.length;
const invalid = (reason) => ({ valid: false, reason, relation: 'unclear', action: 'suspend', items: [], selectedIndex: null, selectionEvidence: '' });

function normalizeItems(items, userText = null) {
  if (!Array.isArray(items) || items.length < 2 || items.length > MAX_ITEMS) return null;
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!object(item)) return null;
    const evidence = text(item.evidence);
    const sharedEvidence = item.sharedEvidence === undefined || item.sharedEvidence === '' ? '' : text(item.sharedEvidence);
    if (!evidence || (item.sharedEvidence && !sharedEvidence) || seen.has(evidence)) return null;
    if (userText !== null && (!userText.includes(evidence) || (sharedEvidence && !userText.includes(sharedEvidence)))) return null;
    if ([...seen].some(prior => prior.includes(evidence) || evidence.includes(prior))) return null;
    const updates = userText === null && item.updates !== undefined ? item.updates : [];
    if (!Array.isArray(updates) || updates.length > 2 || updates.some(update => !text(update))) return null;
    seen.add(evidence);
    result.push({ evidence, sharedEvidence, ...(updates.length ? { updates: updates.map(update => text(update)) } : {}),
      text: [evidence, sharedEvidence, ...updates].filter(Boolean).join(' ') });
  }
  return result;
}

function validState(value) {
  if (!object(value) || value.version !== 1 || !['pending', 'selected', 'cleared'].includes(value.status)) return null;
  const siteId = text(value.siteId, 160), characterId = text(value.characterId, 160);
  if (!siteId || !characterId || !Number.isInteger(value.clarificationCount) || value.clarificationCount < 0 || value.clarificationCount > MAX_QUESTIONS) return null;
  if (value.status === 'cleared') {
    if (!Array.isArray(value.items) || value.items.length || value.selectedIndex !== null || value.clarificationCount !== 0) return null;
    return { version: 1, status: 'cleared', siteId, characterId, items: [], selectedIndex: null, clarificationCount: 0 };
  }
  const originalUserText = value.originalUserText === undefined ? '' : text(value.originalUserText, 4000);
  if (value.originalUserText !== undefined && !originalUserText) return null;
  const items = normalizeItems(value.items);
  if (!items || value.items.some((item, index) => item.text !== items[index].text)) return null;
  if (originalUserText && !items.every(item => originalUserText.includes(redactContactEmailsForPrompt(item.evidence))
    && (!item.sharedEvidence || originalUserText.includes(redactContactEmailsForPrompt(item.sharedEvidence))))) return null;
  if (value.status === 'selected' ? !indexValid(value.selectedIndex, items) : value.selectedIndex !== null) return null;
  return { version: 1, status: value.status, siteId, characterId, items, selectedIndex: value.selectedIndex, clarificationCount: value.clarificationCount,
    ...(originalUserText ? { originalUserText: redactContactEmailsForPrompt(originalUserText) } : {}) };
}

export function normalizeProductRequest(value, { userText = '', confidence, previousState = null } = {}) {
  if (!confident(confidence)) return invalid('confidence_unverified');
  if (!object(value) || !RELATIONS.has(value.relation) || !ACTIONS.has(value.action)) return invalid('request_unverified');
  const current = String(userText || '');
  const selectionEvidence = value.selectionEvidence === undefined || value.selectionEvidence === '' ? '' : text(value.selectionEvidence);
  if (value.selectionEvidence && (!selectionEvidence || !current.includes(selectionEvidence))) return invalid('selection_evidence_unverified');
  if (value.relation === 'unclear' && !['cancel', 'suspend'].includes(value.action)) return invalid('relation_unverified');
  if (['select', 'continue'].includes(value.action)) {
    const previous = validState(previousState);
    if (!previous || previous.status === 'cleared' || !selectionEvidence) return invalid('selection_without_scope');
    // Continuing an unresolved set is not selection: retain its server-owned
    // targets while the existing pending gate keeps every search/card disabled.
    if (value.action === 'continue' && value.selectedIndex === null && previous.status === 'pending') {
      if (value.relation !== 'multiple' || !Array.isArray(value.items) || value.items.length) return invalid('pending_continuation_shape_unverified');
      return { valid: true, relation: 'multiple', action: 'continue', items: previous.items, selectedIndex: null, selectionEvidence, reason: '' };
    }
    const selectedIndex = value.action === 'continue' && value.selectedIndex == null ? previous.selectedIndex : value.selectedIndex;
    if (!indexValid(selectedIndex, previous.items)) return invalid('selection_index_unverified');
    return { valid: true, relation: 'multiple', action: value.action, items: previous.items, selectedIndex, selectionEvidence, reason: '' };
  }
  if (value.relation === 'multiple' && value.action === 'new') {
    const items = normalizeItems(value.items, current);
    if (!items || value.selectedIndex != null) return invalid('item_evidence_unverified');
    return { valid: true, relation: value.relation, action: 'new', items, selectedIndex: null, selectionEvidence: '', reason: '' };
  }
  if (!Array.isArray(value.items) || value.items.length || value.selectedIndex !== null) return invalid('non_multiple_shape_unverified');
  if (['cancel', 'suspend'].includes(value.action) && !selectionEvidence) return invalid('action_evidence_unverified');
  return { valid: true, relation: value.relation, action: value.action, items: [], selectedIndex: null, selectionEvidence, reason: '' };
}

export function readProductRequestState(recentMessages = [], { siteId = '', characterId = '' } = {}) {
  for (const row of [...(Array.isArray(recentMessages) ? recentMessages : [])].reverse()) {
    if (!object(row) || !OWN(row, 'productRequestState')) continue;
    // The latest state is a boundary, even if invalid, from another scope or user.
    if ((row.senderType || row.sender_type) !== 'character') return null;
    const state = validState(row.productRequestState);
    return state && state.siteId === String(siteId) && state.characterId === String(characterId) ? state : null;
  }
  return null;
}

function clearing(siteId, characterId) {
  return { version: 1, status: 'cleared', siteId, characterId, items: [], selectedIndex: null, clarificationCount: 0 };
}

function pendingIntent(intent, state, reason = '') {
  const count = state?.clarificationCount || 0;
  const nextState = state ? { ...state, clarificationCount: Math.min(MAX_QUESTIONS, count + 1) } : null;
  return { ...intent, productRequestState: nextState, productScopePending: true,
    scopeUnverified: Boolean(reason), productRequestUnverified: Boolean(reason), productScopeReason: reason,
    query: '', requestedTeam: '', requestedKeywords: [], referencedProductId: '', referencedSiteId: '', referencedSiteSlug: '', productHandle: '',
    shouldLoadProductContext: false, cardAllowed: false, answerRequired: true,
    searchState: count >= MAX_QUESTIONS ? 'clarification_exhausted' : 'needs_clarification' };
}

const REBUILT_KEYS = [
  'query', 'intent', 'requestedTeam', 'requestedVariant', 'requestedVariants', 'requestedProductType',
  'requestedAudience', 'requestedAgeRange', 'requestedSizeProfile', 'requestedColor', 'requestedSeason',
  'requestedFeatures', 'requestedKeywords', 'requestedSizes', 'hasBodyMeasurements', 'explicitSizingProductSearch',
  'excludeTeams', 'isCorrection', 'contextSource', 'explicitProductTrigger', 'customizationRequest', 'requestedPrintNumber',
  'genericRecommendationRequest', 'productCustomizationRequest', 'ambiguousCustomizationRequest',
  'correctionSuggestion', 'referencedProductId', 'referencedSiteId', 'referencedSiteSlug', 'productHandle', 'unresolvedProductReference',
  'requestedEdition', 'commerceConstraints', 'teamConstraintUnverified', 'sourceErrorCode',
];
const FOLLOWUP_SCALARS = ['requestedProductType', 'requestedAudience', 'requestedAgeRange', 'requestedSizeProfile', 'requestedColor', 'requestedSeason', 'customizationRequest', 'requestedPrintNumber'];
const FOLLOWUP_ARRAYS = ['requestedVariants', 'requestedSizes', 'requestedFeatures'];

export function applyProductRequestScope(searchIntent = {}, decision = {}, { userText = '', recentMessages = [], siteId = '', characterId = '', buildIntent, getClearedFields = () => [] } = {}) {
  const previous = readProductRequestState(recentMessages, { siteId, characterId });
  const active = previous && previous.status !== 'cleared' ? previous : null;
  const request = normalizeProductRequest(decision.productRequest, { userText, confidence: decision.confident === false ? NaN : decision.confidence, previousState: active });
  if (!request.valid) {
    if (!active && !['product_search', 'product_question'].includes(decision.route)) return searchIntent;
    const state = active ? { ...active, status: 'pending', selectedIndex: null, clarificationCount: active.clarificationCount } : null;
    return pendingIntent(searchIntent, state, request.reason);
  }
  if (request.action === 'cancel' || request.action === 'suspend') {
    return { ...searchIntent, shouldLoadProductContext: false, cardAllowed: false, productScopePending: false,
      scopeUnverified: false, productRequestUnverified: false, productScopeReason: '',
      ...(active ? { productRequestState: clearing(String(siteId), String(characterId)) } : {}) };
  }
  if (request.relation !== 'multiple') {
    return active ? { ...searchIntent, productRequestState: clearing(String(siteId), String(characterId)), productScopePending: false,
      scopeUnverified: false, productRequestUnverified: false, productScopeReason: '' } : searchIntent;
  }
  if (!text(String(siteId), 160) || !text(String(characterId), 160)) return pendingIntent(searchIntent, null, 'scope_unverified');
  const originalUserText = request.action === 'new' ? redactContactEmailsForPrompt(userText) : active?.originalUserText || '';
  if (request.action === 'new' && (!originalUserText || originalUserText.length > 4000)) return pendingIntent(searchIntent, null, 'original_context_unverified');
  const sameItems = active && JSON.stringify(request.items) === JSON.stringify(active.items);
  const state = { version: 1, status: request.selectedIndex === null ? 'pending' : 'selected', siteId: String(siteId), characterId: String(characterId),
    items: request.items, selectedIndex: request.selectedIndex,
    ...(originalUserText ? { originalUserText } : {}),
    clarificationCount: request.selectedIndex === null ? (sameItems ? active.clarificationCount : 0) : (active?.clarificationCount || 0) };
  if (state.status === 'pending') return pendingIntent(searchIntent, state);
  if (typeof buildIntent !== 'function') return pendingIntent(searchIntent, { ...state, status: 'pending', selectedIndex: null }, 'builder_unavailable');
  let rebuilt, current, revisions;
  try {
    rebuilt = buildIntent(getProductRequestItemText(state, state.selectedIndex));
    current = buildIntent(String(userText || ''));
    revisions = (state.items[state.selectedIndex].updates || []).map(update => buildIntent(update));
  } catch { return pendingIntent(searchIntent, { ...state, status: 'pending', selectedIndex: null }, 'builder_unverified'); }
  if (!object(rebuilt) || !object(current) || revisions.some(revision => !object(revision))
    || [...revisions, current].some(revision => revision.requestedTeam && rebuilt.requestedTeam && revision.requestedTeam !== rebuilt.requestedTeam)) {
    return pendingIntent(searchIntent, { ...state, status: 'pending', selectedIndex: null }, 'selection_conditions_unverified');
  }
  // The existing commerce call already provides a catalogue phrase in any
  // language. Use it only for this explicitly selected item, filling fields the
  // lexical parser could not recognize; never inherit the mixed turn intent.
  let semantic = {};
  try { semantic = decision.searchQuery ? buildIntent(decision.searchQuery) : {}; } catch { semantic = {}; }
  if (!object(semantic) || ['requestedTeam', 'requestedColor', 'requestedProductType', 'requestedAudience'].some(key => semantic[key] && rebuilt[key] && semantic[key] !== rebuilt[key] && !current[key])) {
    return pendingIntent(searchIntent, { ...state, status: 'pending', selectedIndex: null }, 'selected_query_unverified');
  }
  const result = { ...searchIntent };
  for (const key of REBUILT_KEYS) delete result[key];
  Object.assign(result, rebuilt);
  for (const key of ['requestedTeam', ...FOLLOWUP_SCALARS]) if (!result[key] && semantic[key]) result[key] = semantic[key];
  for (const key of FOLLOWUP_ARRAYS) if (!result[key]?.length && semantic[key]?.length) result[key] = [...semantic[key]];
  if (decision.searchQuery) { result.query = decision.searchQuery; result.requestedKeywords = semantic.requestedKeywords || []; }
  // Only explicit current-turn conditions may revise this selected item. Its
  // original validated shared size is not a general old-size inheritance rule.
  const originalConditions = { ...rebuilt };
  for (const [index, revision] of revisions.entries()) {
    for (const key of FOLLOWUP_SCALARS) if (revision[key]) originalConditions[key] = revision[key];
    for (const key of FOLLOWUP_ARRAYS) if (Array.isArray(revision[key]) && revision[key].length) originalConditions[key] = [...revision[key]];
    for (const key of getClearedFields(state.items[state.selectedIndex].updates[index])) if (['customizationRequest', 'requestedPrintNumber'].includes(key)) originalConditions[key] = '';
  }
  for (const [index, revision] of [...revisions, current].entries()) {
    for (const key of FOLLOWUP_SCALARS) if (revision[key]) result[key] = revision[key];
    for (const key of FOLLOWUP_ARRAYS) if (Array.isArray(revision[key]) && revision[key].length) result[key] = [...revision[key]];
    const raw = index < revisions.length ? state.items[state.selectedIndex].updates[index] : String(userText || '');
    for (const key of getClearedFields(raw)) if (['customizationRequest', 'requestedPrintNumber'].includes(key)) result[key] = '';
  }
  // Compare the catalogue interpretation with the final explicitly revised
  // conditions, including removals; a conflict is not silently reconciled.
  if (['requestedTeam', 'requestedColor', 'requestedProductType', 'requestedAudience', 'requestedPrintNumber'].some(key => semantic[key] && result[key] && semantic[key] !== result[key])
    || semantic.requestedSizes?.length && result.requestedSizes?.length && semantic.requestedSizes.some(size => !result.requestedSizes.includes(size))
    || getClearedFields(String(userText || '')).some(key => semantic[key])) {
    return pendingIntent(searchIntent, { ...state, status: 'pending', selectedIndex: null }, 'selected_query_conditions_unverified');
  }
  const arrayConditions = value => JSON.stringify([...new Set((Array.isArray(value) ? value : []).map(item => String(item)))].sort());
  const revisesConditions = getClearedFields(String(userText || '')).some(key => ['customizationRequest', 'requestedPrintNumber'].includes(key) && Boolean(originalConditions[key]))
    || FOLLOWUP_SCALARS.some(key => Boolean(current[key]) && current[key] !== originalConditions[key])
    || FOLLOWUP_ARRAYS.some(key => Array.isArray(current[key]) && current[key].length && arrayConditions(current[key]) !== arrayConditions(originalConditions[key]));
  if (revisesConditions) {
    const update = text(String(userText || ''));
    const item = state.items[state.selectedIndex];
    const updates = [...(item.updates || [])];
    if (!update || (updates.length >= 2 && !updates.includes(update))) {
      return pendingIntent(searchIntent, { ...state, status: 'pending', selectedIndex: null }, 'selection_conditions_unverified');
    }
    if (!updates.includes(update)) updates.push(update);
    state.items = state.items.map((entry, index) => index === state.selectedIndex ? {
      ...entry, updates, text: [entry.evidence, entry.sharedEvidence, ...updates].filter(Boolean).join(' '),
    } : entry);
  }
  const permitted = searchIntent.shouldLoadProductContext === true;
  const cardAllowed = permitted && searchIntent.cardAllowed !== false && searchIntent.replyBoundary?.salesAllowed !== false;
  result.productCustomizationRequest = result.customizationRequest === 'jersey';
  result.ambiguousCustomizationRequest = result.customizationRequest === 'ambiguous';
  return { ...result, productRequestState: state, productScopePending: false, scopeUnverified: false, productRequestUnverified: false,
    productScopeReason: '',
    shouldLoadProductContext: permitted, cardAllowed,
    answerRequired: searchIntent.answerRequired === true, searchState: rebuilt.searchState || 'ready_to_search' };
}

export function hasPendingProductRequest(intent = {}) {
  return intent?.productScopePending === true || intent?.scopeUnverified === true || intent?.productRequestState?.status === 'pending';
}

export function getProductRequestItemText(state, index) {
  const normalized = validState(state);
  return normalized && indexValid(index, normalized.items) ? normalized.items[index].text : '';
}

export function productScopeHistory(recentMessages = [], intent = {}) {
  const rows = Array.isArray(recentMessages) ? recentMessages : [];
  if (hasPendingProductRequest(intent)) return [];
  const state = validState(intent.productRequestState);
  if (!state || state.status !== 'selected') return rows;
  let boundary = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (object(rows[i]) && OWN(rows[i], 'productRequestState')) { boundary = i; break; }
  }
  // With no durable boundary (the current selection turn), keep no old cards.
  if (boundary < 0) return [];
  if ((rows[boundary].senderType || rows[boundary].sender_type) !== 'character') return [];
  const matching = row => {
    if ((row.senderType || row.sender_type) !== 'character') return false;
    const stored = validState(row.productRequestState);
    return stored?.status === 'selected' && stored.siteId === state.siteId && stored.characterId === state.characterId
      && stored.selectedIndex === state.selectedIndex && JSON.stringify(stored.items) === JSON.stringify(state.items)
      && stored.originalUserText === state.originalUserText;
  };
  if (!matching(rows[boundary])) return [];
  // Repeated same-scope text must not erase cards from earlier turns. A different,
  // pending, cleared or malformed state is a hard boundary, never skipped.
  let firstState = boundary, previousBoundary = -1;
  for (let i = boundary - 1; i >= 0; i -= 1) {
    if (!object(rows[i]) || !OWN(rows[i], 'productRequestState')) continue;
    if (!matching(rows[i])) { previousBoundary = i; break; }
    firstState = i;
  }
  const characterProduct = row => object(row) && (row.senderType || row.sender_type) === 'character'
    && (row.contentType || row.content_type) === 'product'
    && (!row.characterId && !row.character_id || String(row.characterId || row.character_id) === state.characterId);
  let start = firstState;
  // Production stores the selected product(s) immediately BEFORE its state text.
  // Include that adjacent run only when a real user turn precedes it. Without
  // that boundary, a clipped/legacy card cannot be proven to belong to this turn.
  let cardsStart = firstState;
  while (cardsStart > previousBoundary + 1 && characterProduct(rows[cardsStart - 1]) && !OWN(rows[cardsStart - 1], 'productRequestState')) cardsStart -= 1;
  if (cardsStart < firstState && cardsStart > previousBoundary + 1
    && (rows[cardsStart - 1].senderType || rows[cardsStart - 1].sender_type) === 'user') start = cardsStart;
  const segment = rows.slice(start);
  let priorOrder = null;
  const ids = new Set();
  for (const row of segment) {
    if (!object(row)) return [];
    const order = row.displayOrder ?? row.display_order;
    if (order !== undefined && order !== null) {
      if (!Number.isFinite(Number(order)) || Number(order) <= 0 || priorOrder !== null && Number(order) <= priorOrder) return [];
      priorOrder = Number(order);
    }
    if (row.id) { if (ids.has(row.id)) return []; ids.add(row.id); }
  }
  return segment.filter(characterProduct);
}

export function stripProductRequestPayload(payload) {
  if (!object(payload) || !OWN(payload, PRODUCT_REQUEST_SCOPE_NAMESPACE)) return payload;
  const result = { ...payload };
  delete result[PRODUCT_REQUEST_SCOPE_NAMESPACE];
  return Object.keys(result).length ? result : null;
}

export function mergeProductRequestPayload(payload, state) {
  if (state == null) return payload;
  const result = stripProductRequestPayload(payload);
  const normalized = validState(state);
  if (!normalized) return result;
  return { ...(object(result) ? result : {}), [PRODUCT_REQUEST_SCOPE_NAMESPACE]: normalized };
}

// Old scopes without full-turn context keep their existing identity hash. New
// scopes bind the retained USER original so identical excerpts cannot substitute
// another request's shared conditions.
export function productRequestOwnerEvidence(scope = {}) {
  const items = (scope.items || []).map(item => [item.evidence, item.sharedEvidence]);
  return createHash('sha256').update(JSON.stringify(scope.originalUserText
    ? { items, originalUserText: scope.originalUserText } : items)).digest('hex');
}

export function originalProductRequestContext(scope) {
  const state = validState(scope);
  if (state?.status !== 'selected' || !state.originalUserText) return null;
  return { text: state.originalUserText, selectedIndex: state.selectedIndex,
    selectedItemEvidence: state.items[state.selectedIndex].evidence, sharedEvidence: state.items[state.selectedIndex].sharedEvidence };
}
