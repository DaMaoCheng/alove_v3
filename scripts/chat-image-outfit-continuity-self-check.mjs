import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
process.env.VENICE_API_KEY = 'isolated-outfit-continuity';
process.env.TYPESAFE_API_KEY = '';
const { applyProductCandidateState } = await import('../server/product-candidate-state-service.js');
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { buildProductSearchIntent } = await import('../server/product-intent-service.js');
const { classifyChatImageIntent } = await import('../server/chat-image-intent-classifier-service.js');
const { maybeCreateGuestChatImagePlaceholder } = await import('../server/chat-image-generation-service.js');
const { applyChatImageCommercePolicy } = await import('../server/chat-image-commerce-policy-service.js');
const text = 'A ver pasame tu imagen';
const identity = { siteId: 'site_fixture', characterId: 'mascot_fixture', userText: text };
const chatDecision = { confident: true, confidence: 1, route: 'chat', productRequirementAction: 'new',
  productRequirement: { action: 'new', evidence: text, updates: [], suspectedTerm: null },
  productRequest: { relation: 'none', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
  replyBoundary: { salesAllowed: true, contactAllowed: true }, candidateDecisionRequired: true };
for (const commerceRoute of ['chat', 'store_policy']) {
  const state = applyProductCandidateState({ ...buildProductSearchIntent(text), commerceRoute }, chatDecision, identity);
  assert.notEqual(state.productCandidateState?.status, 'active', 'non-merchandise turn must not mint an empty current product target');
}
const routed = await resolveCommerceSearchIntent({ ...identity, siteSlug: 'fixture', searchIntent: buildProductSearchIntent(text),
  recentMessages: [], enrichAllTurns: true, jevDecision: { ok: true, confident: false }, classifyCommerce: async () => chatDecision });
assert.deepEqual(routed.imageProductEvidence, [], 'non-merchandise requirement quotations cannot become product evidence');
assert.notEqual(routed.productCandidateState?.status, 'active');
const selfie = { hasIntent: true, allowed: true, intentType: 'library_photo', actionEvidence: 'pasame tu imagen', actorEvidence: 'tu', conditions: { wants_clothing: false, wants_no_clothing: false } };
assert.equal(applyChatImageCommercePolicy(selfie, { commerceIntent: routed, userText: text }).allowed, true, 'empty metadata cannot suppress an independently requested selfie');
const productText = 'Find a Madrid shirt and send your selfie';
const productDecision = { ...chatDecision, route: 'product_search', needsLiveProductData: true,
  productRequirement: { action: 'new', evidence: productText, updates: [
    { field: 'requestedTeam', value: 'Real Madrid', evidence: 'Madrid' },
    { field: 'requestedProductType', value: 'shirt', evidence: 'shirt' },
  ], suspectedTerm: null },
  productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
};
const mixed = await resolveCommerceSearchIntent({ ...identity, userText: productText, siteSlug: 'fixture',
 searchIntent: buildProductSearchIntent(productText), recentMessages: [], enrichAllTurns: true,
 jevDecision: { ok: true, confident: false }, classifyCommerce: async () => productDecision });
assert(mixed.imageProductEvidence.includes('Madrid'));
assert(!mixed.imageProductEvidence.includes(productText), 'typed product spans must not absorb an independent selfie action');
assert.equal(applyChatImageCommercePolicy({ ...selfie, actionEvidence: 'send your selfie', actorEvidence: 'your' },
 { commerceIntent: mixed, userText: productText }).allowed, true);
let response, libraryReads = 0, entitlementReads = 0, lastPrompt, lastPayload;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
 const body = JSON.parse(options.body); lastPrompt = body.messages[0].content; lastPayload = JSON.parse(body.messages[1].content);
 return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) };
};
const baseResponse = { communicativeAction: 'request_visual_output', requestKind: 'character_image', hasIntent: true, allowed: true,
 confidence: .99, intentType: 'library_photo', imageSubject: 'character', requestScope: 'image_only', requestEvidence: text,
 actorEvidence: 'tu', actionEvidence: 'pasame tu imagen', clothingTarget: 'generic', explicitGeneration: false,
 wants_no_clothing: false, wants_clothing: true };
const character = { id: 'mascot_fixture', name: 'Valeria', category_id: 'mascot' };
const recentConversation = [{ role: 'user', kind: 'text', text: 'Como te verías con la camiseta de Perú en bikini' },
 { role: 'assistant', kind: 'text', text: 'Los colores rojo y blanco quedarían alegres.' }];
const options = { character, userText: text, jevDecision: { ok: false, confident: false }, conversationContext: { recentConversation },
 guest: { id: 'guest_fixture' }, session: { id: 'chat_fixture', character_id: character.id }, commerceSiteId: identity.siteId,
 commerceIntent: { commerceRoute: 'chat' } };
const db = { execute: async sql => {
 if (sql.includes('FROM mascot_greeting_images')) { libraryReads++; return [[]]; }
 if (sql.includes('FROM guest_image_entitlements')) { entitlementReads++; return [[]]; }
 throw new Error('Unexpected DB effect in isolated continuity check: '+sql.slice(0, 100));
} };
try {
 response = { ...baseResponse };
 const outfit = await classifyChatImageIntent(text, options);
 assert.equal(outfit.hasIntent, true);
 assert.deepEqual(lastPayload.recentConversation, recentConversation, 'a pending USER outfit survives an assistant response without a picture');
 assert.match(lastPrompt, /An assistant failure, refusal or irrelevant reply does not erase that USER description/);
 assert.match(lastPrompt, /generic includes a conceptual/);
 assert.doesNotMatch(lastPrompt, /wants_clothing is true only when the user explicitly asks the character to wear/);
 assert.equal(outfit.explicitGeneration, true, 'a verified outfit request cannot silently take the ordinary library path');
 await maybeCreateGuestChatImagePlaceholder(db, { ...options, imageDecision: outfit });
 assert.equal(libraryReads, 0, 'outfit-specific role image cannot be substituted with an unrelated gallery asset');
 assert.equal(entitlementReads, 1, 'specific output still passes the existing generation entitlement gate');
 response = { ...baseResponse, clothingTarget: 'none', wants_clothing: false };
 const ordinary = await classifyChatImageIntent(text, { ...options, conversationContext: { recentConversation: [] } });
 assert.equal(ordinary.explicitGeneration, false, 'ordinary photo does not inherit previous outfit from history alone');
 await maybeCreateGuestChatImagePlaceholder(db, { ...options, imageDecision: ordinary });
 assert.equal(libraryReads, 1, 'ordinary photo keeps its existing library path');
 response = { ...baseResponse, wants_clothing: false, wants_no_clothing: true };
 const differentComposition = await classifyChatImageIntent(text, options);
 assert.equal(differentComposition.explicitGeneration, true, 'an approved explicit composition condition cannot use a generic library photo');
 response = { ...baseResponse, hasIntent: false, allowed: false, intentType: 'none', communicativeAction: 'other', requestKind: 'non_image' };
 assert.equal((await classifyChatImageIntent('How would that outfit look on you?', options)).hasIntent, false, 'hypothetical discussion alone grants no image action');
 assert.equal((await maybeCreateGuestChatImagePlaceholder(db, { ...options, imageDecision: { ...outfit, hasIntent: false, allowed: false } })).taskCreated, false);
 const noReference = { ...outfit, clothingTarget: 'catalogue_product', intentType: 'try_on', actorEvidence: 'Wear', actionEvidence: 'Wear this shirt' };
 assert.equal(applyChatImageCommercePolicy(noReference, { commerceIntent: { commerceRoute: 'chat' }, userText: 'Wear this shirt',
  siteId: identity.siteId, characterId: character.id, recentMessages: [] }).hasIntent, false, 'real merchandise still needs a same-site reference image');
} finally { globalThis.fetch = originalFetch; }
console.log('image outfit continuity passed (ghost state, independent mixed selfie, clothing/gallery contradiction, hypothetical and source protection; fixtures only, no models/DB/image writes)');
