import { resolveChatImageRequestConstraints } from "./chat-image-variation-service.js";
import { readProductCandidateState } from "./product-candidate-state-service.js";
import { hasChatImageVisualAction, hasExplicitChatImageGenerationAction } from "./chat-image-trigger-service.js";
import { filterProductsByIntent } from "./product-intent-service.js";
import { hasPendingProductRequest } from "./product-request-scope-service.js";
// This admission rule runs before placeholders, quota reservations or jobs.
// Product photographs are catalogue evidence; an avatar cannot stand in for them.
export function applyChatImageCommercePolicy(trigger = {}, { commerceIntent = null, recentMessages = [], siteId = '', userText = '', characterName = '', characterId = '' } = {}) {
  if (!trigger.hasIntent || !trigger.allowed) return trigger;
  const commerceProduct = ['product_search', 'product_question'].includes(commerceIntent?.commerceRoute)
    || hasPendingProductRequest(commerceIntent)
    || (commerceIntent?.commerceRoute === 'unclear' && commerceIntent.replyTopicHint === 'product_selection')
    || commerceIntent?.productCandidateState?.status === 'active'
    || (commerceIntent?.commerceRoute === 'unclear' && readProductCandidateState(recentMessages, { siteId, characterId })?.status === 'active');
  const wantsClothing = trigger.conditions?.wants_clothing === true || trigger.intentType === 'try_on';
  const defer = () => ({ ...trigger, hasIntent: false, allowed: false, explicitGeneration: false, deferredToProduct: true, productReferenceRequired: true });
  const action = String(trigger.actionEvidence || '');
  const actorIsCharacter = characterName && String(trigger.actorEvidence || '').trim().toLowerCase() === String(characterName).trim().toLowerCase();
  const productEvidence = Array.isArray(commerceIntent?.imageProductEvidence) ? commerceIntent.imageProductEvidence.filter(span => typeof span === 'string' && span).slice(0, 6) : [];
  const start = String(userText).indexOf(action), end = start + action.length;
  const overlapsProduct = productEvidence.some(span => {
    const at = String(userText).indexOf(span);
    return at >= 0 && start >= 0 && at < end && start < at + span.length;
  });
  const wearAction = hasExplicitChatImageGenerationAction(action) || resolveChatImageRequestConstraints({ userText: action }).wants_clothing;
  if (commerceProduct && !wantsClothing && (!hasChatImageVisualAction(action) || overlapsProduct)) return defer();
  if (!wantsClothing) return trigger;
  const independentGeneric = trigger.clothingTarget === 'generic' && (!commerceProduct || (actorIsCharacter
    && wearAction && !overlapsProduct));
  if (commerceProduct && (!wearAction || (trigger.clothingTarget === 'generic' && !independentGeneric))) return defer();
  const required = trigger.clothingTarget === 'catalogue_product' || (commerceProduct && trigger.clothingTarget !== 'user_upload' && !independentGeneric);
  if (!required) return trigger;
  if (!commerceIntent) return defer();
  // An ambiguous or undisplayed candidate is not the product the user agreed to wear.
  // Current classification is provisional: admission runs before reply review.
  // Only a previously finalized, persisted confirmation grants reference access.
  const persisted = readProductCandidateState(recentMessages, { siteId, characterId });
  const current = commerceIntent.productCandidateState;
  const historicalId = persisted?.status === 'active' && persisted.proposal?.status === 'confirmed'
    ? persisted.proposal.candidateId : '';
  const currentId = commerceIntent.confirmedCandidateId || (current?.proposal?.status === 'confirmed' ? current.proposal.candidateId : '');
  const confirmedId = historicalId && (!currentId || currentId === historicalId)
    && (!current || current.status === 'active' && current.proposal?.status === 'confirmed' && current.proposal.candidateId === historicalId)
    ? historicalId : '';
  const product = [...recentMessages].reverse().find(row => {
    const p = row.product;
    return (row.contentType || row.content_type) === 'product' && p?.id && p?.name && p?.imageUrl
      && siteId && String(p.siteId || p.site_id || '') === String(siteId)
      && (!(p.matchStatus === 'candidate') || String(p.id) === String(confirmedId || '')
        && row.senderType === 'character' && row.characterId === characterId && p.name === persisted.proposal.name)
      && (!confirmedId || String(p.id) === String(confirmedId))
      && (!currentId || String(p.id) === String(currentId))
      && filterProductsByIntent([p], commerceIntent).length === 1;
  })?.product;
  if (!product || commerceIntent.commerceRoute === 'unclear' || hasPendingProductRequest(commerceIntent)
    || commerceIntent.searchState === 'clarification_exhausted' || (product.matchStatus === 'candidate' && commerceIntent.productCandidateState?.status === 'active' && !confirmedId)
    || (product.candidateUnknownFields?.includes('sleeve') && commerceIntent.requestedFeatures?.some(feature => ['short_sleeve', 'long_sleeve', 'sleeveless'].includes(feature)))
    || (product.candidateUnknownFields?.includes('printing') && commerceIntent.requestedPrinting)) {
    return defer();
  }
  return { ...trigger, productReferenceRequired: true, referenceProduct: {
    id: String(product.id), name: String(product.name).slice(0, 240), siteId: String(product.siteId || product.site_id || siteId),
    siteSlug: String(product.siteSlug || product.site_slug || ''), imageUrl: String(product.imageUrl).slice(0, 1000),
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls.filter(url => typeof url === 'string').slice(0, 4) : [],
  } };
}
