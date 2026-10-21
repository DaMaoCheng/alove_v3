import { filterProductsByIntent, findRecentProductMessage } from './product-intent-service.js';
import { hasPendingProductRequest } from './product-request-scope-service.js';
import { readProductCandidateState } from './product-candidate-state-service.js';

// References identify existing cards; they never establish an action permission.
export function findRecentDisplayedProductGroup(recentMessages = [], { siteId = '', siteSlug = '', characterId = '' } = {}) {
  if (!siteId || !characterId) return [];
  const latest = findRecentProductMessage(recentMessages);
  if (!latest) return [];
  // A newer persisted clear/new/owner boundary ends the old group. State
  // copied on the group's own caption or unchanged continuations is harmless.
  const stateKeys = ['productRequestState', 'productCandidateState'];
  let nextUser = recentMessages.findIndex((row, index) => index > latest.messageIndex
    && (row.senderType || row.sender_type) === 'user');
  if (nextUser >= 0) {
    const baseline = {};
    for (const row of recentMessages.slice(0, nextUser)) {
      for (const key of stateKeys) if (Object.hasOwn(row || {}, key)) baseline[key] = row[key];
    }
    for (const row of recentMessages.slice(nextUser)) {
      for (const key of stateKeys) if (Object.hasOwn(row || {}, key)
        && stateIdentity(row[key], key) !== stateIdentity(baseline[key], key)) return [];
    }
  }
  const rows = [];
  for (let i = latest.messageIndex; i >= 0 && i >= latest.messageIndex - 11; i--) {
    const row = recentMessages[i];
    if ((row.senderType || row.sender_type) === 'user') break;
    if ((row.contentType || row.content_type) === 'product') rows.unshift(row);
  }
  if (!rows.length || rows.length > 2) return [];
  const session = rows[0].sessionId || rows[0].session_id;
  if (rows.some(row => (row.senderType || row.sender_type) !== 'character'
    || String(row.characterId || row.character_id || '') !== String(characterId)
    || session && String(row.sessionId || row.session_id || '') !== String(session)
    || !row.product?.name || !String(row.product.productId || row.product.id || '')
    || ['failed','pending','cancelled'].includes(row.deliveryStatus || row.delivery_status)
    || row.product.matchStatus === 'candidate'
    || String(row.product.siteId || row.product.site_id || '') !== String(siteId)
    || siteSlug && String(row.product.siteSlug || row.product.site_slug || '') !== String(siteSlug))) return [];
  const products = rows.map(row => row.product);
  return new Set(products.map(p => String(p.productId || p.id))).size === products.length ? products : [];
}

export function resolveDisplayedProductReferences(referenceIds, recentMessages, location) {
  if (!Array.isArray(referenceIds) || referenceIds.length < 1 || referenceIds.length > 2
    || referenceIds.some(id => typeof id !== 'string' || !id || id.length > 160)
    || new Set(referenceIds).size !== referenceIds.length) return null;
  const group = findRecentDisplayedProductGroup(recentMessages, location);
  const products = referenceIds.map(id => group.find(p => String(p.productId || p.id) === id));
  return products.every(Boolean) ? products : null;
}

export function buildDisplayedProductReferenceContext({ site = {}, characterId = '', searchIntent = {}, recentMessages = [] } = {}) {
  if (['new','cancel'].includes(searchIntent.productRequirementAction) || hasPendingProductRequest(searchIntent) || searchIntent.scopeUnverified || searchIntent.unresolvedProductReference
    || searchIntent.nonShoppingReason || searchIntent.candidateConfirmationOnly
    || ['pending','selected'].includes(searchIntent.productRequestState?.status)) return null;
  if (searchIntent.productCandidateState?.status === 'active') {
    const prior = readProductCandidateState(recentMessages, { siteId:site.id, characterId });
    const current = searchIntent.productCandidateState;
    if (!prior || prior.owner !== 'single' || current.owner !== 'single' || prior.proposal || current.proposal
      || prior.suspectedTerm || current.suspectedTerm || stateIdentity(prior, 'productCandidateState') !== stateIdentity(current, 'productCandidateState')) return null;
  }
  const references = resolveDisplayedProductReferences(searchIntent.referencedProductIds, recentMessages, { siteId:site.id,siteSlug:site.slug,characterId });
  if (!references) return null;
  const readOnly = searchIntent.commerceRoute === 'product_question' && searchIntent.commerceTopic === 'other'
    && searchIntent.needsLiveProductData !== true;
  const resend = searchIntent.commerceRoute === 'product_search' && searchIntent.shouldLoadProductContext === true
    && searchIntent.cardAllowed === true && searchIntent.replyBoundary?.salesAllowed !== false;
  if (!readOnly && !resend) return null;
  const products = readOnly ? references.map(product => ({ ...product,price:'',priceNow:'',priceWas:'',stock:'',available:null,sizes:[],sizeChart:null,sizeChartResolved:false }))
    : filterProductsByIntent(references, searchIntent);
  if (products.length !== references.length) return null;
  return { sourceType:'product_api',sourceRef:'displayed-product-reference',siteId:site.id,siteSlug:site.slug,siteName:site.name||'',
    searchIntent,cardAllowed:resend,snapshotOnly:true,searchOutcome:'matched',products };
}

// Continuations may append USER evidence without changing the owned target.
// That append is not a new owner; every other persisted state field is retained.
function stateIdentity(value, key) {
  if (!value || key !== 'productCandidateState') return JSON.stringify(value ?? null);
  const normalized = readProductCandidateState([{senderType:'character',productCandidateState:value}], {siteId:value.siteId,characterId:value.characterId});
  if (!normalized) return `invalid:${JSON.stringify(value)}`;
  const { requestedConditionEvidence: ignoredEvidence, ...identity } = normalized;
  return JSON.stringify(identity);
}
