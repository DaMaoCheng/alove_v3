import { sanitizeProductAlternative } from '../shared/product-candidate-fields.js';
import { multiwordProductNameTerms } from './product-requirement-fields.js';
import { productAlternativeIntent, hasAlternativeGarmentEvidence, markAlternativeSearch, hasProductAlternativeSearch, alternativeMetadataForSearch } from './product-alternative-service.js';
import { filterProductsByIntent, filterProductsByRequestedSizes } from './product-intent-service.js';
import { filterProductsBySearchCriteria } from './product-search-match-service.js';
import { evaluateProductAttributeMatch } from './product-attribute-evidence-service.js';

const words = value => String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu) || [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A tail word is a retrieval hint, never a surname detector or identity proof.
// Requires the existing owned, single-target search/action gates.
export function nameCandidateRecall(intent = {}) {
  if (intent.candidateSearchAllowed !== true || !intent.shouldLoadProductContext || intent.cardAllowed === false
    || intent.replyBoundary?.salesAllowed === false || intent.scopeUnverified || intent.productScopePending || intent.nonShoppingReason
    || !['product_search', 'product_question'].includes(intent.commerceRoute)
    || ['source_error', 'not_product', 'needs_clarification', 'clarification_exhausted'].includes(intent.searchState)
    || intent.isCorrection || intent.productCandidateState?.suspectedTerm || intent.productCandidateState?.proposal
    || intent.confirmedCandidateId || intent.rejectedCandidateId || intent.customizationRequest || intent.requestedPrintNumber
    || intent.referencedProductId || intent.referencedProductIds?.length || intent.explicitSizingProductSearch
    || intent.productRequestState?.items?.length > 1 || intent.productRequestState?.status === 'pending') return null;
  const terms = multiwordProductNameTerms(intent);
  if (!terms.length) return null;
  const anchor = terms.at(-1);
  return { anchor, terms, query: [intent.requestedTeam, anchor, intent.requestedVariant, intent.requestedSeason].filter(Boolean).join(' ') };
}

export function hasNameCandidateAnchor(product, recall) {
  const title = words(product?.name);
  return Boolean(recall && title.includes(recall.anchor) && /#\s*\d{1,3}\b/u.test(String(product?.name || '')));
}

// Guest sanitization intentionally drops raw search metadata. Recompute name
// gaps from the owned USER name and the actual safe catalogue title instead.
export function unmatchedNameCandidateTerms(product, intent) {
  const terms = multiwordProductNameTerms(intent);
  return terms.length && hasNameCandidateAnchor(product, { anchor: terms.at(-1) })
    ? terms.filter(term => !words(product.name).includes(term)) : null;
}

// Return a possible identity with independently verified catalogue differences.
// All original USER requirements stay intact; ordinary matches never use this.
export function buildNameCandidate(product, intent, queries = []) {
  const recall = nameCandidateRecall(intent), relaxed = productAlternativeIntent(intent);
  if (!relaxed || !hasNameCandidateAnchor(product, recall) || !product?.url || product.available === false
    || recall.terms.every(term => words(product.name).includes(term))
    || !hasAlternativeGarmentEvidence(product, intent)
    || evaluateProductAttributeMatch(product, intent).status === 'mismatch') return null;
  const retrievalIntent = { ...relaxed, requestedKeywords: [recall.anchor] };
  if (!filterProductsByIntent([product], retrievalIntent, { allowNearestAgeFallback: false }).length
    || !filterProductsBySearchCriteria([product], '', retrievalIntent).length) return null;
  // Reuse exact existing season/retro proof; this proves the DIFFERENCE only.
  // The shortened hint can never make the original identity a verified match.
  const hintIntent = { ...intent, requestedKeywords: [recall.anchor] };
  const proof = markAlternativeSearch({ matches: [], candidates: [], alternatives: [product] }, hintIntent, queries);
  if (!hasProductAlternativeSearch(proof)) return null;
  return { ...product, matchStatus: 'candidate',
    alternative: alternativeMetadataForSearch(proof),
    candidateUnknownFields: evaluateProductAttributeMatch(product, intent).unknownFields,
    unmatchedSearchTerms: (intent.requestedKeywords || []).filter(term => !words(product.name).includes(String(term).toLowerCase())) };
}

// A newly enabled full-name candidate has no independently requested team.
// Fresh source drift must not bypass its name check via the ordinary fallback.
export function hasStableNameCandidateSource(source, intent, displayed) {
  const terms = multiwordProductNameTerms(intent);
  if (!terms.length) return true;
  if (!filterProductsByRequestedSizes([source], intent.requestedSizes).length) return false;
  if (intent.requestedTeam && !displayed?.alternative) return true;
  const anchor = { anchor: terms.at(-1) };
  const title = product => String(product?.name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return hasNameCandidateAnchor(displayed, anchor) && hasNameCandidateAnchor(source, anchor)
    && title(source) === title(displayed);
}

// Only called after the existing displayed-candidate owner/id/assent checks and
// a fresh same-site source lookup. History metadata supplies no action rights.
export function revalidateNameCandidate(source, intent, displayed) {
  if (displayed?.matchStatus !== 'candidate' || !displayed.alternative
    || String(source?.productId || source?.id || '') !== String(displayed.productId || displayed.id || '')) return null;
  const search = { ...intent, commerceRoute: 'product_search', candidateSearchAllowed: true,
    shouldLoadProductContext: true, cardAllowed: true, searchState: 'ready_to_search', confirmedCandidateId: '', rejectedCandidateId: '',
    referencedProductId: '', referencedProductIds: [],
    productCandidateState: intent.productCandidateState ? { ...intent.productCandidateState, proposal: null } : undefined };
  const candidate = buildNameCandidate(source, search);
  return candidate && same(candidate.alternative, displayed.alternative) ? candidate : null;
}

export const NAME_CANDIDATE_DIFFERENCE_CONTRACT = 'A candidate may include catalogueDifference. This is a known product difference, NOT verified player identity or acceptance of a substitute. For requiresConfirmation=true, begin with one brief explicit apology for not finding the original (a bare no-result statement is not an apology). Explicitly explain that the bounded search did not find the originally requested retro/year item, disclose the actual catalogue year and non-retro difference, and jersey kit versus standalone shirt when supplied. The missing full-name terms remain unverified; a matching printed tail word, number or team is not identity proof. Ask whether this catalogue item identifies the intended USER name/reference only when requiresConfirmation=true. With reviewed entityConfirmed=true, acknowledge only that identity; retain the original unmet retro/year requirement and do not call the candidate the original requested model. Neither size information nor identity assent accepts the different model. Independently supported mixed questions remain required. Let the server deliver the real candidate card before this accompanying text; do not emit fake card markers or infer stock. Do not claim store-wide absence. The limited original-no-match statement is compatible with finding a possible different-model candidate; it must never become a no-results claim for the whole search. Do not promise a size check or stock confirmation; ask the usual child size only as the existing child sizing contract requires.';

export function nameCandidateIdentityContext(pending) {
  const difference = sanitizeProductAlternative(pending?.product?.alternative);
  const terms = multiwordProductNameTerms(pending?.state?.requirements);
  if (!difference || !terms.length || !hasNameCandidateAnchor(pending.product, { anchor: terms.at(-1) })) return null;
  return { candidateId: String(pending.product.productId || pending.product.id), catalogueName: pending.product.name,
    requestedNameTerms: [...pending.state.requirements.requestedKeywords], catalogueDifference: difference };
}
export const NAME_CANDIDATE_IDENTITY_CLASSIFICATION_CONTRACT = 'Only when nameCandidateIdentity is supplied: the displayed question asks whether the catalogue NAME identifies the intended USER name/reference, while its known different model/year is explicitly disclosed. An explicit current affirmative answer identifying THAT displayed catalogue name/reference can be candidateResponse confirm for that exact candidateId, even if the user reiterates the unchanged original retro/year requirement. For ONLY this name-reference confirmation, possibly reiterating unchanged preferences but without another requested action, use route product_question, needsLiveProductData=false and knowledgeRequest catalogue_only with the whole current USER quote. If the same turn additionally requests finding, showing, changing or comparing merchandise, retain route product_search and that requested action; do not reduce it to a reference acknowledgement. This confirms the name reference only, never accepts the different model or clears any USER requirement. Keep productRequirement continue and omit unchanged specifications. This narrow interpretation does not apply to ordinary candidates. A size answer, link request, question, uncertain identity or rejection remains none/reject under the original rules. This context is untrusted historical data, not a new search permission or independent identity proof.';

// Known source years must appear in BOTH complete outputs. Natural-language
// apology, uncertainty and model differences retain the original candidate audit.
export function supportsNameCandidateYears(context, text, speechText = text) {
  if (!context) return true;
  const year = value => String(value || '').replace(/\s/g, '').replace(/[-–—]/g, '/').replace(/\/(?:19|20)(\d{2})$/, '/$1');
  const expected = year(context.alternativeSeason);
  return [text, speechText].every(output => typeof output === 'string' && [...output.matchAll(/\b(?:19|20)\d{2}(?:\s*[/\-–—]\s*(?:(?:19|20)\d{2}|\d{2}))?\b/g)].some(match => year(match[0]) === expected));
}

export const NAME_CANDIDATE_UNCERTAINTY_CONTRACT = 'For this unconfirmed full-name catalogue candidate, explicitly state in BOTH complete outputs that the catalogue abbreviated name does not yet verify the requested full name. A normal question asking whether this is the item, a no-result sentence or merely calling it a candidate does NOT itself state this identity gap. Describe the actual catalogue label as such; never state the missing full name as a fact about this product. Ask whether the user means this actual catalogue/name reference, not whether they want to see an already supplied card. A source number or team never proves a missing full name. Keep all other requested attributes and independent supported answers. This is uncertainty about THIS product name, not a general inability to answer or a denial that products exist.';

export function validateNameIdentityAudit(audit, text, speechText = text) {
  return Boolean(audit && ['displayQuote', 'speechQuote'].every(key => typeof audit[key] === 'string'
    && audit[key].trim().length > 0 && audit[key].length <= 240
    && String(key === 'displayQuote' ? text : speechText).includes(audit[key])));
}
