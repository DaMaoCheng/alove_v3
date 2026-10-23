import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('Unexpected external request'); };
const { resolveGuestProductRecommendation } = await import('../server/guest-chat-product-service.js');
const { toGuestSafeProductSearchResult, getGuestProductEvidence } = await import('../server/guest-product-sanitizer.js');
const { filterProductsByIntent } = await import('../server/product-intent-service.js');
const site = { id: 'site_test', slug: 'test', name: 'Test', site_url: 'https://shop.invalid', siteUrl: 'https://shop.invalid', product_api_url: 'https://shop.invalid/products', currency: 'USD' };
const db = { execute: async () => [[site]] };
const intent = { query: 'Real Madrid away green kids shirt', requestedTeam: 'Real Madrid', requestedColor: 'green', requestedAudience: 'kids', requestedProductType: 'shirt', requestedVariants: ['away'], commerceRoute: 'product_search', commerceTopic: 'other', searchState: 'ready', shouldLoadProductContext: true, cardAllowed: true, needsLiveProductData: true, replyBoundary: { salesAllowed: true, contactAllowed: false } };
const green = { id: 'same-id', productId: 'same-id', name: 'Kids Real Madrid Away Soccer Jersey Kit 2026/27', summary: 'Kids Real Madrid Soccer Jersey Kit 2 Pieces - Green', url: 'https://shop.invalid/green', siteId: site.id, available: true };
const blue = { ...green, summary: 'Kids Real Madrid Soccer Jersey Kit 2 Pieces - Blue', url: 'https://shop.invalid/blue' };
async function run(items) {
  return (await resolveGuestProductRecommendation(db, { guest: { site_id: site.id, mascot_character_id: 'test' }, userText: 'Quiero la camiseta verde para niño del Real Madrid', precomputedSearchIntent: intent,
    classifyCommerce: async () => { throw new Error('must use provided intent'); }, searchProducts: async () => ({ ok: true, site, searchOutcome: 'matched', searchState: 'matched', items }) })).context;
}
assert.equal(filterProductsByIntent([green], intent).length, 1);
assert.equal(filterProductsByIntent(toGuestSafeProductSearchResult({ site, items: [green] }).items, intent).length, 0, 'fixture reproduces the lost-summary projection');
const match = await run([green]);
assert.equal(match.products.length, 1, 'raw description supports explicit green requirement');
assert.equal(match.products[0].url, green.url);
assert.equal('summary' in match.products[0], false, 'private summary never becomes a public product field');
assert.equal((await run([blue])).products.length, 0, 'contradictory blue remains rejected');
assert.deepEqual((await run([blue, green])).products.map(product => product.url), [green.url], 'same ID cannot bind blue facts to green output');
for (const item of [{ ...green, url: '' }, { ...green, url: 'javascript:alert(1)' }, { ...green, url: 'https://evil.invalid/green' }, { ...green, name: `${green.name} Discount code FREE` }]) {
  assert.equal((await run([item])).products.length, 0, 'existing URL and promotion restrictions remain enforced');
}
for (const change of [{ requestedTeam: 'Barcelona' }, { requestedAudience: 'adult' }, { requestedProductType: 'jacket' }]) {
  assert.equal(filterProductsByIntent([green], { ...intent, ...change }).length, 0, 'raw matching retains each unrelated hard constraint');
}
const raw = { site, items: [green] };
assert.equal(toGuestSafeProductSearchResult(raw, { sourceItems: [{ ...green }] }).items.length, 0, 'cloned/external objects cannot be smuggled through selection');
assert.equal(toGuestSafeProductSearchResult(raw, { sourceItems: [blue] }).items.length, 0, 'same ID is not evidence provenance');
assert.equal(toGuestSafeProductSearchResult(raw, { sourceItems: [green] }).items.length, 1);
const protectedRaw = { ...green, sizes: [{ label: 'S', available: true }] };
const protectedProduct = toGuestSafeProductSearchResult({ site, searchOutcome: 'matched', items: [protectedRaw] }).items[0];
assert.equal(getGuestProductEvidence(protectedProduct).summary, green.summary, 'original matched object retains private source evidence');
assert.equal(JSON.stringify(protectedProduct).includes('summary'), false, 'private source evidence must not enter public JSON');
const clone = JSON.parse(JSON.stringify(protectedProduct));
assert.equal(getGuestProductEvidence(clone), clone, 'JSON roundtrip cannot carry source proof');
const spread = { ...protectedProduct };
assert.equal(getGuestProductEvidence(spread), spread, 'spread cannot create source proof');
protectedRaw.summary = 'Blue';
assert.equal(getGuestProductEvidence(protectedProduct).summary, green.summary, 'later source mutation cannot change bound evidence');
const observed = getGuestProductEvidence(protectedProduct);
observed.summary = 'Red';
observed.sizes[0].label = 'XL';
assert.equal(getGuestProductEvidence(protectedProduct).summary, green.summary, 'caller cannot mutate stored evidence');
assert.equal(getGuestProductEvidence(protectedProduct).sizes[0].label, 'S');
protectedProduct.sizes[0].label = 'XL';
assert.equal(getGuestProductEvidence(protectedProduct), protectedProduct, 'nested public mutation invalidates proof');
protectedProduct.sizes[0].label = 'S';
protectedProduct.url = 'https://shop.invalid/other';
assert.equal(getGuestProductEvidence(protectedProduct), protectedProduct, 'identity mutation invalidates proof');
for (const outcome of ['candidate', 'alternative']) {
  const item = toGuestSafeProductSearchResult({ site, searchOutcome: outcome, items: [green] }).items[0];
  assert.equal(getGuestProductEvidence(item), item, `${outcome} retains its separate original proof path`);
}
console.log('guest product source evidence self-check passed (isolated source and DB fixtures; no external calls or writes)');

const { hasMatchedCatalogueCaptionContext } = await import('../server/chat-grounded-reply-repair-service.js');
const { buildReplyReviewMessages } = await import('../server/chat-reply-review-contracts.js');
const reviewIntent = { ...intent, primarySearchVerified: true, commerceTopic: 'other', requestedKeywords: [] };
const evidenceContext = { ...match, searchIntent: reviewIntent };
const contextOptions = { searchIntent: reviewIntent, productContext: evidenceContext, character: { id: 'test', category_id: 'mascot', site_id: site.id },
  trustedSite: { id: site.id }, knowledgeContext: { items: [], customerServiceTopic: 'other' } };
assert.equal(hasMatchedCatalogueCaptionContext(contextOptions), true, 'caption correction reuses private green evidence instead of repeating a lossy check');
const reviewMessages = buildReplyReviewMessages({ ...contextOptions, businessFactsRequired: true, independentLanguageReview: true });
const reviewPacket = JSON.parse(reviewMessages.at(-1).content);
assert.match(reviewPacket.evidence.catalogueProducts[0].summary, /Green/, 'business review sees the same verified color evidence as matching');
assert.equal('summary' in evidenceContext.products[0], false, 'review assembly does not mutate public product fields');
assert.equal(hasMatchedCatalogueCaptionContext({ ...contextOptions, productContext: { ...evidenceContext, products: JSON.parse(JSON.stringify(evidenceContext.products)) } }), false, 'public round-trip cannot restore private color proof for correction');
console.log('Private matched source evidence survives correction and business review, without public output mutation');
const { repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
let repairPacket;
await repairGroundedCommerceReply({ ...contextOptions, language: 'es', userText: '¿Es verde?',
  replyResult: { text: 'Unsupported candidate.', speechText: 'Unsupported candidate.', sourceType: 'ai' },
  reviewStatus: 'valid', reviewResult: { allowed: false, confidence: .99, boundarySupported: true, businessFactsSupported: false },
  failedContracts: ['business_facts'], config: { apiKey: 'fixture', model: 'fixture' },
  requestText: async prompt => { repairPacket = JSON.parse(prompt.messages[0].content); return JSON.stringify({ displayText: 'La descripción del catálogo indica verde.' }); } });
assert.match(repairPacket.matchedCatalogue.products[0].summary, /Green/, 'correction and business review use the same source description, never a guessed color');
assert.equal('summary' in evidenceContext.products[0], false);
