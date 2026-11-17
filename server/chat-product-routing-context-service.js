import { readProductCandidateState, findDisplayedProductCandidate, normalizeUnresolvedProductRequirements } from './product-candidate-state-service.js';
import { readProductRequestState, productRequestOwnerEvidence } from './product-request-scope-service.js';
import { PRODUCT_REQUIREMENT_SCALAR_VALUES, PRODUCT_REQUIREMENT_ARRAY_VALUES } from './product-requirement-fields.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : '';
const scalarRules = {
  requestedTeam: value => text(value, 120),
  requestedProductType: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedProductType.includes(value) ? value : '',
  requestedAudience: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedAudience.includes(value) ? value : '',
  requestedColor: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedColor.includes(value) ? value : '',
  requestedSeason: value => /^\d{4}(?:\/\d{2})?$/.test(text(value, 7)) ? text(value, 7) : '',
  requestedEdition: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedEdition.includes(value) ? value : '',
  requestedPrinting: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedPrinting.includes(value) ? value : '',
};
const arrayRules = {
  requestedVariants: PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedVariants,
  requestedFeatures: PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedFeatures,
  requestedSizes: PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedSizes,
};

// Routing context is user intent and a previously displayed question. It is
// never catalogue evidence, stock, a sales permission, or a confirmation vote.
function normalizeRequestScope(value) {
  if (!object(value) || !['pending', 'selected'].includes(value.status) || !Array.isArray(value.items)
    || value.items.length < 2 || value.items.length > 4) return null;
  const items = value.items.map(item => object(item) && text(item.evidence, 240)
    && (item.sharedEvidence === '' || text(item.sharedEvidence, 240))
    ? { evidence: text(item.evidence, 240), sharedEvidence: text(item.sharedEvidence, 240) || '' } : null);
  if (items.some(item => !item) || new Set(items.map(item => item.evidence)).size !== items.length
    || (value.status === 'pending' ? value.selectedIndex !== null
      : !Number.isInteger(value.selectedIndex) || value.selectedIndex < 0 || value.selectedIndex >= items.length)) return null;
  return { status: value.status, items, selectedIndex: value.selectedIndex };
}

export function normalizeChatProductRoutingContext(value) {
  if (!object(value)) return null;
  if (Object.hasOwn(value, 'requestScope')) {
    const requestScope = normalizeRequestScope(value.requestScope);
    return requestScope ? { requestScope } : null;
  }
  if (!object(value) || !text(value.targetEvidence, 1200) || !object(value.requirements)) return null;
  const requirements = {};
  for (const [key, rule] of Object.entries(scalarRules)) {
    const normalized = rule(value.requirements[key]);
    if (normalized) requirements[key] = normalized;
  }
  for (const [key, allowed] of Object.entries(arrayRules)) {
    if (!Array.isArray(value.requirements[key]) || value.requirements[key].length > 8) continue;
    const normalized = [...new Set(value.requirements[key].filter(item => allowed.includes(item)))];
    if (normalized.length) requirements[key] = normalized;
  }
  const unresolvedRequirements = value.unresolvedRequirements === undefined ? [] : normalizeUnresolvedProductRequirements(value.unresolvedRequirements);
  if (!unresolvedRequirements) return null;
  const hasLifecycle = Object.hasOwn(value, 'status') || Object.hasOwn(value, 'needsClarification');
  const needsClarification = unresolvedRequirements.length > 0;
  // Stored active states predate this derived routing-only property. Accept
  // that existing input shape, while rejecting an explicit contradictory vote.
  if (hasLifecycle && (value.status !== 'active' || Object.hasOwn(value, 'needsClarification')
    && (typeof value.needsClarification !== 'boolean' || value.needsClarification !== needsClarification))) return null;
  const result = { ...(hasLifecycle ? { status: 'active', needsClarification } : {}),
    targetEvidence: text(value.targetEvidence, 1200), requirements,
    ...(unresolvedRequirements.length ? { unresolvedRequirements } : {}) };
  const name = text(value.displayedCandidate?.name, 240), question = text(value.displayedCandidate?.question, 2000);
  if (name && question) result.displayedCandidate = { name, question };
  return result;
}

export function buildChatProductRoutingContext(recentMessages = [], { siteId = '', characterId = '' } = {}) {
  const scope = readProductRequestState(recentMessages, { siteId, characterId });
  const scopeContext = scope && scope.status !== 'cleared'
    ? normalizeChatProductRoutingContext({ requestScope: scope }) : null;
  // This is only the current USER's requested set. It proves no catalogue
  // item, displayed card/image, identity confirmation or search permission.
  if (scope?.status === 'pending') return scopeContext;
  const state = readProductCandidateState(recentMessages, { siteId, characterId });
  if (state?.status !== 'active') return state || recentMessages.some(row => Object.hasOwn(row || {}, 'productCandidateState')) ? null : scopeContext;
  if (state.owner === 'selected') {
    if (scope?.status !== 'selected' || scope.selectedIndex !== state.selectedIndex
      || productRequestOwnerEvidence(scope) !== state.ownerEvidence) return null;
  }
  // Preserve the verified USER task's lifecycle, rather than reducing an
  // unfinished clarification to an ambiguous recent merchandise mention.
  // These fields prove no catalogue fact, action permission or image source.
  const value = { status: state.status, needsClarification: Boolean(state.unresolvedRequirements?.length),
    targetEvidence: state.targetEvidence, requirements: state.requirements,
    ...(state.unresolvedRequirements?.length ? { unresolvedRequirements: state.unresolvedRequirements } : {}) };
  const proposal = state.proposal;
  if (proposal?.status === 'displayed') {
    const actualCard = findDisplayedProductCandidate(state, recentMessages, { siteId, characterId });
    if (actualCard) value.displayedCandidate = { name: proposal.name, question: proposal.reply };
  }
  return normalizeChatProductRoutingContext(value);
}
