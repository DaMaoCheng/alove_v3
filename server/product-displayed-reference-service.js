import { filterProductsByIntent, findRecentProductMessage } from './product-intent-service.js';
import { hasPendingProductRequest } from './product-request-scope-service.js';
import { readProductCandidateState } from './product-candidate-state-service.js';

// References identify existing cards; they never establish an action permission.
export function findRecentDisplayedProductGroup(recentMessages = [], { siteId = '', siteSlug = '', characterId = '', attributeContinuation = false } = {}) {
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
        && stateIdentity(row[key], key, attributeContinuation) !== stateIdentity(baseline[key], key, attributeContinuation)) return [];
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
function stateIdentity(value, key, attributeContinuation = false) {
  if (!value || key !== 'productCandidateState') return JSON.stringify(value ?? null);
  const normalized = readProductCandidateState([{senderType:'character',productCandidateState:value}], {siteId:value.siteId,characterId:value.characterId});
  if (!normalized) return `invalid:${JSON.stringify(value)}`;
  const { requestedConditionEvidence: ignoredEvidence, ...identity } = normalized;
  if (attributeContinuation && normalized.status === 'active' && normalized.owner === 'single' && !normalized.proposal && !normalized.suspectedTerm) {
    identity.requirements = Object.fromEntries(['requestedTeam','requestedProductType','requestedAudience','requestedSeason','requestedKeywords','requestedVariant','requestedVariants','requestedColor','requestedEdition','requestedFeatures'].map(key => [key, normalized.requirements[key]]));
  }
  return JSON.stringify(identity);
}


// A factual question about an owned displayed item refreshes that exact item.
// New requested attributes remain USER requirements, not proof that it matches.
export async function buildLiveDisplayedProductReferenceContext({ site = {}, characterId = '', searchIntent = {}, recentMessages = [], resolveProduct } = {}) {
  if (searchIntent.commerceRoute !== 'product_question' || searchIntent.needsLiveProductData !== true
    || searchIntent.cardAllowed !== false || searchIntent.productRequirementAction !== 'continue'
    || searchIntent.nonShoppingReason || hasPendingProductRequest(searchIntent) || searchIntent.scopeUnverified
    || searchIntent.candidateConfirmationOnly || searchIntent.unresolvedProductReference) return null;
  const location = { siteId: site.id, siteSlug: site.slug, characterId, attributeContinuation: true };
  const prior = readProductCandidateState(recentMessages, location);
  const current = readProductCandidateState([{ senderType: 'character', productCandidateState: searchIntent.productCandidateState }], location);
  if (!prior || !current || prior.status !== 'active' || current.status !== 'active'
    || prior.owner !== 'single' || current.owner !== 'single' || prior.proposal || current.proposal
    || prior.suspectedTerm || current.suspectedTerm
    || stateIdentity(prior, 'productCandidateState', true) !== stateIdentity(current, 'productCandidateState', true)) return null;
  const group = findRecentDisplayedProductGroup(recentMessages, location);
  const requestedId = String(searchIntent.referencedProductId || '');
  const reference = requestedId ? group.find(p => String(p.productId || p.id) === requestedId) : group.length === 1 ? group[0] : null;
  if (!reference) return null;
  const context = { sourceType: 'product_api', sourceRef: 'live-displayed-product-reference', siteId:site.id, siteSlug:site.slug,
    siteName:site.name || '', searchIntent, cardAllowed:false, searchOutcome:'source_error', products:[] };
  try {
    const result = await resolveProduct({ siteSlug:site.slug, product:reference, strictSite:true, exactProduct:true });
    const source = result?.sourceItem;
    if (result?.resolvedFromSource !== true || result.site?.id !== site.id || result.site?.slug !== site.slug
      || !source?.name || String(source.productId || source.id || '') !== String(reference.productId || reference.id)) return context;
    return { ...context, searchOutcome:'matched', products:[{...source,siteId:site.id,siteSlug:site.slug,matchStatus:'matched'}] };
  } catch { return context; }
}

// Fresh exact-ID refresh grants wording evidence only, never another card or
// confirmation that a newly requested attribute exists on this item.
export function toLiveDisplayedProductReplyContext({ productContext, searchIntent = {}, recentMessages = [], character = {}, trustedSite = null } = {}) {
  const siteId = trustedSite?.id, characterId = character.id;
  if (!siteId || !characterId || productContext?.siteId !== siteId
    || productContext.sourceRef !== 'live-displayed-product-reference' || productContext.sourceType !== 'product_api'
    || productContext.searchOutcome !== 'matched' || productContext.snapshotOnly || productContext.ok === false
    || productContext.sourceErrorCode || productContext.cardAllowed !== false || productContext.candidateContext || productContext.sizingProduct
    || searchIntent.commerceRoute !== 'product_question' || searchIntent.productRequirementAction !== 'continue'
    || searchIntent.needsLiveProductData !== true || searchIntent.cardAllowed !== false
    || searchIntent.commerceClassificationUnavailable || searchIntent.commerceClassificationFailure
    || searchIntent.scopeUnverified || searchIntent.productScopePending || searchIntent.nonShoppingReason
    || searchIntent.businessInquiry || searchIntent.humanHandoff || searchIntent.checkoutIssue || searchIntent.promotionInquiry
    || hasPendingProductRequest(searchIntent) || !Array.isArray(productContext.products) || productContext.products.length !== 1) return null;
  const product = productContext.products[0], id = String(product?.productId || product?.id || '');
  const references = findRecentDisplayedProductGroup(recentMessages, { siteId, siteSlug:trustedSite.slug, characterId, attributeContinuation:true });
  if (!id || !product.name || product.siteId !== siteId || !references.some(item => String(item.productId || item.id) === id)
    || searchIntent.referencedProductId && String(searchIntent.referencedProductId) !== id) return null;
  return { replyPurpose:'existing_product_attribute_question', productCardDelivery:{count:0},
    product:{id,name:String(product.name).slice(0,255),summary:String(product.summary || product.description || '').slice(0,1800),attributeEvidence:product.attributeEvidence || null} };
}
