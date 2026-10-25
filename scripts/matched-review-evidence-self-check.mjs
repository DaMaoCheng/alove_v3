import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('No network in matched evidence checks'); };
const { buildReplyReviewMessages } = await import('../server/chat-reply-review-contracts.js');
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const { repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
const { buildLanguageQualityFallbackReply } = await import('../server/chat-reply-language-quality.js');
const character = { id: 'guide', category_id: 'mascot', site_id: 'shop' }, trustedSite = { id: 'shop' };
const intent = { query: 'Arsenal kids away shirt', commerceRoute: 'product_search', commerceTopic: 'other', primarySearchVerified: true,
  shouldLoadProductContext: true, needsLiveProductData: true, cardAllowed: true, requestedTeam: 'Arsenal', requestedProductType: 'shirt',
  knowledgeScope: 'business', replyBoundary: { salesAllowed: true, contactAllowed: true } };
const product = { id: 'shirt', name: 'Arsenal Kids Away Jersey 2026/27', siteId: 'shop', url: 'https://fixture.invalid/shirt', available: true, matchStatus: 'matched' };
const context = { sourceType: 'product_api', sourceRef: 'guest-site-product-context', siteId: 'shop', searchOutcome: 'matched',
  cardAllowed: true, searchIntent: intent, products: [product], suppressedProductKeys: ['shop:id:shirt'] };
const clock = { required: false, status: 'not_required', searched: false, items: [], asOfUtc: '2026-10-25T00:00:00Z' };
const base = { character, trustedSite, searchIntent: intent, productContext: context, factualContext: clock,
  language: 'en', userText: 'I mean the kids shirt', replyResult: { text: 'Rejected old promise about shipping tomorrow.', speechText: 'Rejected old promise about shipping tomorrow.', sourceType: 'ai' } };
const packetFor = patch => JSON.parse(buildReplyReviewMessages({ ...base, text: base.replyResult.text, boundaryReviewRequired: true,
  catalogueOwner: { character, trustedSite }, ...patch }).findLast(x => x.role === 'user').content);
const packet = packetFor();
assert.equal(packet.productCardDelivery.count, 0);
assert.equal(packet.evidence?.catalogueProducts?.[0]?.name, product.name, 'suppressed matched cards still provide real catalogue evidence');
assert.equal(packet.evidenceRequired, false, 'known matches never use the unconfirmed-item contract');
let repairPacket, repairSystem;
await repairGroundedCommerceReply({ ...base, reviewResult: { allowed: false, confidence: .99, boundarySupported: false, factualSupported: false },
  reviewStatus: 'valid', failedContracts: ['boundary', 'factual'], config: { apiKey: 'fixture', model: 'fixture', apiMode: 'chat_completions' },
  requestText: async prompt => { repairPacket = JSON.parse(prompt.messages[0].content); repairSystem = prompt.systemPrompt; return JSON.stringify({ displayText: 'I understand you mean the kids shirt.' }); } });
assert.equal(repairPacket.matchedCatalogue.searchOutcome, 'matched');
assert.equal(repairPacket.matchedCatalogue.matchedProductCount, 1);
assert.equal(repairPacket.matchedCatalogue.productCardDelivery.count, 0);
assert.equal(repairPacket.matchedCatalogue.replyPurpose, 'existing_product_followup');
assert(repairSystem.includes('already displayed product'), 'zero new delivery selects the follow-up purpose before generation');
assert(!Object.hasOwn(repairPacket, 'proposedResponse'), 'pure matched corrections do not prime unsupported old claims');
assert(!repairSystem.includes('Never claim a full match, availability'), 'candidate-only uncertainty cannot contradict a proved matched caption');
let reviews = 0, repairs = 0;
const out = await enforceReplyBoundary({ ...base, requireIdentityReview: true, languageQualityRequired: true, independentLanguageQualityRequired: true,
  assess: async () => { reviews++; return { reviewStatus: 'valid', allowed: false, confidence: 1, boundarySupported: false, factualSupported: false, evidenceSupported: true }; },
  assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: 1, languageQualitySupported: true, languageIssues: [] }),
  repairGroundedReply: async () => { repairs++; return null; }, recordReview: async () => {} });
assert.equal(reviews, 1); assert.equal(repairs, 1);
assert.equal(out.text, buildLanguageQualityFallbackReply('en'), 'pure matched expression failure must not append unrelated factual uncertainty');
assert(out.replyRecoveryState.failedContracts.includes('factual'), 'failed factual vote remains diagnostic evidence');
console.log('Matched catalogue with zero delivery, fresh correction and honest failure checks passed');
for (const [name, patch] of [
  ['first display', { productContext: { ...context, suppressedProductKeys: [] } }],
  ['canonical shared mascot', { catalogueOwner: { character: { ...character, site_id: 'legacy' }, trustedSite: { id: 'shop', identity_mascot_character_id: character.id } } }],
]) assert.equal(packetFor(patch).evidence?.catalogueProducts.length, 1, name + ' keeps actual source facts');
for (const [name, patch] of [
  ['foreign site', { catalogueOwner: { character, trustedSite: { id: 'other' } } }],
  ['foreign role site', { catalogueOwner: { character: { ...character, site_id: 'other' }, trustedSite } }],
  ['no real owner', { catalogueOwner: null }],
  ['source error', { productContext: { ...context, searchOutcome: 'source_error' } }],
  ['hidden source error', { productContext: { ...context, sourceErrorCode: 'timeout' } }],
  ['source error state', { productContext: { ...context, searchState: 'source_error' } }],
  ['snapshot', { productContext: { ...context, snapshotOnly: true } }],
  ['blocked source intent', { searchIntent: { ...intent, primarySearchBlocked: true } }],
  ['classification failure', { searchIntent: { ...intent, commerceClassificationFailure: 'missing_fields' } }],
  ['unknown origin', { productContext: { ...context, sourceRef: 'unknown' } }],
  ['unverified search', { searchIntent: { ...intent, primarySearchVerified: false } }],
  ['candidate', { productContext: { ...context, searchOutcome: 'candidate' } }],
  ['mixed order', { orderActionState: 'login_required' }],
  ['mixed image', { imageStatusContext: { status: 'ready' } }],
]) {
  const evidence = packetFor(patch).evidence;
  assert.notEqual(evidence?.searchOutcome, 'matched', name + ' cannot borrow the pure matched evidence path');
  if (!patch.imageStatusContext) assert.equal(evidence, null, name + ' preserves its prior empty evidence packet');
}
let capturedOwner;
await enforceReplyBoundary({ ...base, requireIdentityReview: true, languageQualityRequired: true, independentLanguageQualityRequired: true,
  assess: async input => { capturedOwner = input.catalogueOwner; return { allowed: true, confidence: 1, reviewStatus: 'valid', boundarySupported: true, factualSupported: true }; },
  assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: 1, languageQualitySupported: true, languageIssues: [] }), recordReview: async () => {} });
assert.deepEqual(capturedOwner, { character: { ...character, siteId: undefined }, trustedSite: { id: 'shop', identity_mascot_character_id: undefined } });
const mixed = await enforceReplyBoundary({ ...base, factualContext: { ...clock, required: true }, requireIdentityReview: true,
  languageQualityRequired: true, independentLanguageQualityRequired: true,
  assess: async () => ({ reviewStatus: 'valid', allowed: false, confidence: 1, boundarySupported: false, factualSupported: false }),
  assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: 1, languageQualitySupported: true, languageIssues: [] }),
  recordReview: async () => {} });
assert.notEqual(mixed.text, buildLanguageQualityFallbackReply('en'), 'real public-fact requests retain their factual fallback');
assert(mixed.replyRecoveryState.failedContracts.includes('factual'));
console.log('Source/owner/mixed-purpose boundaries and true factual fallback remain intact');

for (const patch of [{ factualRequired: true, factualContext: { ...clock, required: true } },
  { knowledgeContext: { items: [{ id: 'policy', content: 'Shipping terms' }] } }]) {
  const packet = packetFor(patch);
  assert.equal(packet.evidence.catalogueProducts[0].name, product.name, 'mixed review keeps matching catalogue facts');
  assert.equal(packet.factualRequired, patch.factualRequired === true, 'public-fact review stays separately active');
}
console.log('Mixed purposes receive catalogue facts without borrowing pure caption recovery');
