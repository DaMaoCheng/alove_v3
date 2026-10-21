import { readProductCandidateState, findDisplayedProductCandidate } from './product-candidate-state-service.js';
import { readProductRequestState, productRequestOwnerEvidence } from './product-request-scope-service.js';
import { PRODUCT_REQUIREMENT_SCALAR_VALUES, PRODUCT_REQUIREMENT_ARRAY_VALUES } from './product-requirement-fields.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : '';
const scalarRules = {
  requestedTeam: value => text(value, 120),
  requestedProductType: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedProductType.includes(value) ? value : '',
  requestedAudience: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedAudience.includes(value) ? value : '',
  requestedColor: value => PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedColor.includes(value) ? value : '',
  requestedSeason: value => /^\d{4}\/\d{2}$/.test(text(value, 7)) ? value : '',
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
export function normalizeChatProductRoutingContext(value) {
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
  const result = { targetEvidence: text(value.targetEvidence, 1200), requirements };
  const name = text(value.displayedCandidate?.name, 240), question = text(value.displayedCandidate?.question, 2000);
  if (name && question) result.displayedCandidate = { name, question };
  return result;
}

export function buildChatProductRoutingContext(recentMessages = [], { siteId = '', characterId = '' } = {}) {
  const state = readProductCandidateState(recentMessages, { siteId, characterId });
  if (state?.status !== 'active') return null;
  if (state.owner === 'selected') {
    const scope = readProductRequestState(recentMessages, { siteId, characterId });
    if (scope?.status !== 'selected' || scope.selectedIndex !== state.selectedIndex
      || productRequestOwnerEvidence(scope) !== state.ownerEvidence) return null;
  }
  const value = { targetEvidence: state.targetEvidence, requirements: state.requirements };
  const proposal = state.proposal;
  if (proposal?.status === 'displayed') {
    const actualCard = findDisplayedProductCandidate(state, recentMessages, { siteId, characterId });
    if (actualCard) value.displayedCandidate = { name: proposal.name, question: proposal.reply };
  }
  return normalizeChatProductRoutingContext(value);
}
