import { toGuestSafeProduct } from './guest-product-sanitizer.js';
import { getServerProductOrigins } from './product-source-provenance.js';
import { filterProductsByIntent, hasExplicitProductTypeEvidence } from './product-intent-service.js';
import { filterProductsBySearchCriteria } from './product-search-match-service.js';

export const PRODUCT_ALTERNATIVE_CONTRACT = 'Start the accompanying reply with a brief explicit apology in the active language, then explain that this search did not find the original requested item. A greeting, bare no-result statement, or inability statement is NOT an apology. The server-verified season alternative is a different catalogue item, not an exact match or an unresolved identity candidate; do not claim store-wide unavailability. Recommend the single real product, explicitly state its verified catalogue season and how it differs from the requested year/season, and preserve every other hard requirement. Use only supplied price, stock and link facts; verified alternative identity does not guarantee stock or purchase availability. The original requested season is user intent, never a fact about this alternative. Do not request identity confirmation or pretend the original was found. Show the real card before the explanatory text, keep the wording natural and answer any separate supported mixed questions normally.';

const SEARCH = Symbol('server-alternative-search');
const CONTEXT = Symbol('server-alternative-context');
const signature = value => JSON.stringify(value);
const facts = product => { const { paymentMethods, analytics, ...rest } = product || {}; return signature(rest); };
const identity = product => signature([String(product?.productId || product?.id || ''), product?.name, product?.url]);
const season = product => {
  const match = String(product?.name || '').match(/\b((?:19|20)\d{2})\s*[/-]\s*((?:19|20)\d{2}|\d{2})\b/);
  if (!match) return '';
  const start = Number(match[1]), end = Number(match[2].length === 2 ? `${match[1].slice(0,2)}${match[2]}` : match[2]);
  return end > start && end <= start + 2 ? `${start}/${String(end).slice(-2)}` : '';
};

export function productAlternativeIntent(intent = {}) {
  if (intent.commerceRoute !== 'product_search' || intent.replyBoundary?.salesAllowed === false || ['source_error','not_product','needs_clarification','clarification_exhausted'].includes(intent.searchState) || intent.candidateSearchAllowed !== true || !intent.requestedSeason || !intent.requestedTeam || !intent.requestedProductType
    || !intent.shouldLoadProductContext || intent.cardAllowed === false || intent.productScopePending || intent.scopeUnverified
    || intent.nonShoppingReason || intent.productCandidateState?.proposal || intent.confirmedCandidateId || intent.rejectedCandidateId
    || intent.referencedProductId || intent.customizationRequest || intent.requestedPrintNumber || intent.explicitSizingProductSearch
    || intent.referencedProductIds?.length || intent.productRequestState?.items?.length > 1
    || intent.productRequestState?.status === 'pending' || intent.isCorrection || (intent.requestedVariants || []).length > 1) return null;
  return { ...intent, requestedSeason: '' };
}

// Called only after all exact recalls finished successfully with zero matches
// and zero unresolved candidates. Source errors throw before reaching this gate.
export function markAlternativeSearch(result, intent, queries) {
  const relaxed = productAlternativeIntent(intent);
  const product = result.alternatives?.[0];
  if (!relaxed || result.matches?.length || result.candidates?.length || result.alternatives?.length !== 1
    || !product?.url || product.available === false || !season(product)
 || !hasExplicitProductTypeEvidence(product, intent.requestedProductType)
    || !filterProductsByIntent([product], relaxed).length
    || !filterProductsBySearchCriteria([product], '', relaxed).length
    || filterProductsByIntent([product], intent).length) return result;
  const view = Object.freeze({ originalSearchOutcome: 'no_match', relaxedFields: ['requestedSeason'],
    requestedSeason: intent.requestedSeason, alternativeSeason: season(product),
    productId: String(product.productId || product.id || ''), productName: product.name,
    preservedConstraints: Object.fromEntries(['requestedTeam','requestedProductType','requestedVariant','requestedVariants','requestedAudience',
      'requestedAgeRange','requestedSizeProfile','requestedSizes','requestedColor','requestedFeatures','requestedEdition','requestedPrinting','requestedKeywords']
      .map(key => [key, intent[key] ?? null])), exactQueryCount: queries.length, exactQueries: queries.map(query => String(query).slice(0,240)) });
  Object.defineProperty(result, SEARCH, { value: { intent: signature(intent), product: identity(product), facts: facts(product), original: structuredClone(product), view }, enumerable: true });
  return result;
}

export function hasProductAlternativeSearch(source) {
  return Boolean(source?.[SEARCH] && source.alternatives?.length === 1 && facts(source.alternatives[0]) === source[SEARCH].facts);
}

export function transferAlternativeSearch(source, target) {
  const proof = source?.[SEARCH];
  if (proof && target.items?.length === 1 && facts(target.items[0]) === proof.facts) {
    Object.defineProperty(target, SEARCH, { value: proof, enumerable: true });
  }
  return target;
}

export function alternativeProductsForSearch(source, intent, products) {
  const proof = source?.[SEARCH], relaxed = productAlternativeIntent(intent);
  const genuineFacts = proof && products?.length === 1 && (facts(products[0]) === proof.facts
    || (source.site && signature(products[0]) === signature(toGuestSafeProduct(proof.original, source.site,
      { allowedOrigins: getServerProductOrigins(source), includeAttributeEvidence: true }))));
  return genuineFacts && relaxed && proof.intent === signature(intent) && products?.length === 1 && identity(products[0]) === proof.product
    && filterProductsByIntent(products, relaxed).length === 1 ? products : [];
}

export function bindProductAlternativeContext(context, source) {
  const products = alternativeProductsForSearch(source, context.searchIntent, context.products);
  if (context.searchOutcome !== 'alternative' || !products.length || !context.siteId) return context;
  Object.defineProperty(context, CONTEXT, { value: { intent: signature(context.searchIntent), products: signature(context.products),
    siteId: context.siteId, view: source[SEARCH].view }, enumerable: true });
  return context;
}

export function isProductAlternativeContext(context) {
  const proof = context?.[CONTEXT];
  return Boolean(proof && context.searchOutcome === 'alternative' && context.siteId === proof.siteId
    && signature(context.searchIntent) === proof.intent && signature(context.products) === proof.products);
}
export function toAlternativeReviewContext(context) {
  return isProductAlternativeContext(context) ? JSON.parse(signature(context[CONTEXT].view)) : null;
}

// A caller-local evidence audit, not a new provider or action permission. The
// semantic reviewer supplies quotes; deterministic checks bind them to BOTH
// actual outputs before its approval can be used.
export const PRODUCT_ALTERNATIVE_AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['display', 'speech', 'boundedSearchOnly'],
  properties: {
    display: { type: 'object', additionalProperties: false, required: ['apologyQuote', 'originalSearchQuote', 'differenceQuote'],
      properties: { apologyQuote: { type: 'string' }, originalSearchQuote: { type: 'string' }, differenceQuote: { type: 'string' } } },
    speech: { type: 'object', additionalProperties: false, required: ['apologyQuote', 'originalSearchQuote', 'differenceQuote'],
      properties: { apologyQuote: { type: 'string' }, originalSearchQuote: { type: 'string' }, differenceQuote: { type: 'string' } } },
    boundedSearchOnly: { type: 'boolean' },
  },
};

export const PRODUCT_ALTERNATIVE_AUDIT_CONTRACT = 'Also return alternativeAudit with display and speech objects, each containing apologyQuote, originalSearchQuote and differenceQuote strings, plus boundedSearchOnly:boolean. Audit each actual complete output separately. Quote exact contiguous substrings, at most 240 characters each. apologyQuote must express actual explicit regret or apology for not finding the requested original; greetings, no-result statements and inability statements alone are not apologies. originalSearchQuote must explicitly include the requested year/season and say this search did not find that original; reject claims that the store is out of stock or that the original is unavailable store-wide. differenceQuote must explicitly include the actual alternative year/season and explain that the real proposed alternative has a different verified catalogue year/season from the requested original, naming that difference correctly; a bare product name without the difference does not suffice. Return an empty string for any missing, unsupported or unsatisfied requirement, never invent a quote or borrow it from the other output. boundedSearchOnly=true requires BOTH complete outputs to preserve the limited original-search result, without claiming store-wide absence, stock unavailability or that the original was found. This audit never supplies missing text, verifies stock, authorizes a card or overrides another review.';

export function validateProductAlternativeAudit(audit, { text = '', speechText = text, context = null } = {}) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fields = ['apologyQuote', 'originalSearchQuote', 'differenceQuote'];
  if (!object(audit) || !Object.hasOwn(audit, 'display') || !Object.hasOwn(audit, 'speech')
    || !Object.hasOwn(audit, 'boundedSearchOnly')) return { valid: false, accepted: false, reason: 'missing_fields' };
  if (typeof audit.boundedSearchOnly !== 'boolean') return { valid: false, accepted: false, reason: 'invalid_fields' };
  for (const key of ['display', 'speech']) {
    if (!object(audit[key])) return { valid: false, accepted: false, reason: 'invalid_fields' };
    if (fields.some(field => !Object.hasOwn(audit[key], field))) return { valid: false, accepted: false, reason: 'missing_fields' };
    if (fields.some(field => typeof audit[key][field] !== 'string')) return { valid: false, accepted: false, reason: 'invalid_fields' };
  }
  const outputs = { display: text, speech: speechText };
  const supported = Object.entries(outputs).every(([key, output]) => typeof output === 'string'
    && fields.every(field => {
      const quote = audit[key][field];
      return quote.trim().length > 0 && Array.from(quote).length <= 240 && output.includes(quote);
    }));
  // Parse only finite year/season tokens, never apology-language keywords.
  const canonical = value => {
    const match = String(value || '').match(/^((?:19|20)\d{2})(?:\s*[/\-–—]\s*((?:19|20)\d{2}|\d{2}))?$/);
    return match ? match[2] ? `${match[1]}/${match[2].slice(-2)}` : match[1] : '';
  };
  const hasSeason = (quote, expected) => {
    const target = canonical(expected);
    return Boolean(target && [...quote.matchAll(/\b(?:19|20)\d{2}(?:\s*[/\-–—]\s*(?:(?:19|20)\d{2}|\d{2}))?\b/g)]
      .some(match => canonical(match[0]) === target));
  };
  const seasonsSupported = ['display', 'speech'].every(key =>
    hasSeason(audit[key].originalSearchQuote, context?.requestedSeason)
    && hasSeason(audit[key].differenceQuote, context?.alternativeSeason));
  return { valid: true, accepted: audit.boundedSearchOnly && supported && seasonsSupported };
}
