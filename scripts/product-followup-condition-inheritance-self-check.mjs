import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('No external calls in condition inheritance checks'); };
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { buildProductSearchIntent } = await import('../server/product-intent-service.js');
const location = { siteId: 'followup-shop', characterId: 'followup-role' };
const initial = 'Real Madrid green away shirt for kids';
const state = { version: 1, status: 'active', ...location, owner: 'single', targetEvidence: initial,
  requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt', requestedAudience: 'kids', requestedColor: 'green',
    requestedSeason: '2026/27', requestedVariants: ['away'], requestedPrinting: 'none', requestedEdition: 'player' },
  proposal: null, suspectedTerm: null };
const card = { senderType: 'character', characterId: location.characterId, contentType: 'product',
  product: { id: 'shown', productId: 'shown', name: 'Kids Real Madrid Away Jersey', siteId: location.siteId, matchStatus: 'matched' } };
const history = [{ senderType: 'user', text: initial }, card,
  { senderType: 'character', characterId: location.characterId, contentType: 'text', text: 'Here is the shirt.', productCandidateState: state }];
const text = 'Gracias, pero estoy interesado en la camiseta para niño';
async function route({ userText = text, action = 'new', updates = [{ field: 'requestedProductType', value: 'shirt', evidence: 'camiseta' }],
  recentMessages = history, reject = true, extras = {} } = {}) {
  return resolveCommerceSearchIntent({ ...location, userText, recentMessages, searchIntent: buildProductSearchIntent(userText),
    jevDecision: { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 },
    classifyCommerce: async () => ({ route: 'product_search', topic: 'other', confident: true, confidence: .99,
      needsLiveProductData: true, declaredLiveProductData: true, searchQuery: 'Real Madrid kids away shirt',
      replyBoundary: { salesAllowed: true, contactAllowed: true }, commerceConstraints: { team: null, edition: null },
      productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
      productRequirement: { action, evidence: userText, updates, suspectedTerm: null }, referencedProductId: 'shown',
      candidateResponse: reject ? { action: 'reject', evidence: userText, candidateId: 'shown' } : { action: 'none', evidence: '', candidateId: '' },
      ...extras }) });
}
const retained = await route();
assert.equal(retained.requestedColor, 'green', 'a same-garment follow-up must not silently erase prior green');
assert.equal(retained.requestedTeam, 'Real Madrid');
assert.equal(retained.requestedAudience, 'kids');
assert.deepEqual(retained.requestedVariants, ['away']);
assert.equal(retained.requestedSeason, '2026/27');
assert.equal(retained.requestedPrinting, 'none');
assert.equal(retained.requestedEdition, 'player');
assert.equal(retained.productCandidateState.targetEvidence, initial);
assert.equal(retained.confirmedCandidateId, undefined, 'inheritance never confirms a product');
assert.equal(retained.rejectedCandidateId, undefined, 'a matched card cannot manufacture a candidate rejection');
console.log('Owned matched-garment follow-up retains independently requested conditions');
for (const [name, recentMessages, extras] of [
  ['foreign card', [history[0], { ...card, product: { ...card.product, siteId: 'other' } }, history[2]], {}],
  ['unrelated older card', [card, { senderType: 'user', text: initial }, history[2]], {}],
  ['missing card reference', history, { referencedProductId: '' }],
  ['different card reference', history, { referencedProductId: 'other' }],
  ['later target boundary', [...history, { senderType: 'character', productCandidateState: { ...state, status: 'cleared' } }], {}],
]) {
  const result = await route({ recentMessages, extras });
  assert.notEqual(result.requestedColor, 'green', name + ' cannot restore the previous target');
}
for (const [userText, updates, expected] of [
  ['Quiero esta camiseta en azul', [{ field: 'requestedColor', value: 'blue', evidence: 'azul' }], 'blue'],
  ['I want this shirt in red', [{ field: 'requestedColor', value: 'red', evidence: 'red' }], 'red'],
  ['Remove the color requirement', [{ field: 'requestedColor', value: '', evidence: 'Remove the color requirement' }], ''],
]) {
  const result = await route({ userText, updates, action: 'continue', reject: false });
  assert.equal(result.requestedColor, expected);
  assert.equal(result.requestedTeam, 'Real Madrid');
}
const fresh = await route({ userText: 'Barcelona home shirt', updates: [], reject: false,
  extras: { searchQuery: 'Barcelona home shirt', commerceConstraints: { team: { value: 'Barcelona', role: 'product_target', evidence: 'Barcelona' }, edition: null } } });
assert.equal(fresh.requestedTeam, 'Barcelona'); assert.equal(fresh.requestedColor, '');
console.log('Explicit revisions, clearing and fresh identity remain independent');
for (const [name, changedCard] of [
  ['different character', { ...card, characterId: 'other-role' }],
  ['unsent delivery', { ...card, deliveryStatus: 'pending' }],
  ['alternative card', { ...card, product: { ...card.product, matchStatus: 'alternative' } }],
]) {
  const result = await route({ recentMessages: [history[0], changedCard, history[2]] });
  assert.notEqual(result.requestedColor, 'green', name + ' cannot establish an owned matched reference');
}
for (const [userText, extras, updates] of [
  ['Another shirt for kids', {}, [{ field: 'requestedAudience', value: 'kids', evidence: 'kids' }]],
  [text, { productRequest: { relation: 'comparison', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' } }, [{ field: 'requestedProductType', value: 'shirt', evidence: 'camiseta' }]],
  ['A training top for kids', {}, [{ field: 'requestedProductType', value: 'top', evidence: 'training top' }]],
]) {
  const result = await route({ userText, extras, updates, reject: false });
  assert.notEqual(result.requestedColor, 'green', 'a distinct or comparison request cannot merge old conditions');
}
const proposal = { ...state, proposal: { status: 'displayed', candidateId: 'shown', name: card.product.name, reply: 'Is this the item?' } };
const candidateHistory = [history[0], { ...card, product: { ...card.product, matchStatus: 'candidate' } },
  { ...history[2], productCandidateState: proposal }];
const genuineNewRejection = await route({ recentMessages: candidateHistory });
assert.notEqual(genuineNewRejection.requestedColor, 'green', 'a real candidate rejection with a new target retains its existing boundary');
const genuineContinueRejection = await route({ recentMessages: candidateHistory, action: 'continue', updates: [] });
assert.equal(genuineContinueRejection.productCandidateState.proposal.status, 'rejected', 'actual candidate rejection still applies');
assert.equal(genuineContinueRejection.rejectedCandidateId, 'shown');
console.log('Matched-reference ownership, fresh/alternative/comparison requests and genuine candidate rejection boundaries passed');
