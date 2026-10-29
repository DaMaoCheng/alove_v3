import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { buildProductSearchIntent } = await import('../server/product-intent-service.js');
const { requestedProductEdition } = await import('../server/product-edition-service.js');
const { evaluateProductAttributeMatch } = await import('../server/product-attribute-evidence-service.js');
const { readProductCandidateState } = await import('../server/product-candidate-state-service.js');
const { normalizeChatProductRoutingContext } = await import('../server/chat-product-routing-context-service.js');

const location = { siteId: 'transition-fixture', characterId: 'mascot-transition' };
const target = { version: 1, status: 'active', ...location, owner: 'single',
  targetEvidence: 'Real Madrid away shirt 2026/27 without printing',
  requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt', requestedVariants: ['away'],
    requestedSeason: '2026/27', requestedPrinting: 'none', requestedEdition: 'player', requestedFeatures: ['authentic'] },
  proposal: { status: 'displayed', candidateId: 'displayed-shirt', name: 'Real Madrid away shirt 2026/27', reply: 'Is this the shirt?' }, suspectedTerm: null };
const jevDecision = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 };
let checks = 0;
const failures = [];
async function check(name, run) {
  try { await run(); checks++; } catch (error) { failures.push(`${name}: ${error.message}`); }
}
async function route(userText, action, updates, previous = target, extras = {}) {
  return resolveCommerceSearchIntent({ ...location, userText, jevDecision,
    recentMessages: previous ? [{ senderType: 'character', characterId: location.characterId, contentType: 'product',
      product: { id: target.proposal.candidateId, name: target.proposal.name, siteId: location.siteId, matchStatus: 'candidate' } },
      { senderType: 'character', productCandidateState: previous }] : [],
    searchIntent: buildProductSearchIntent(userText),
    classifyCommerce: async () => ({ route: 'product_search', confident: true, confidence: .99,
      needsLiveProductData: true, declaredLiveProductData: true, searchQuery: 'Real Madrid away shirt 2026/27',
      replyBoundary: { salesAllowed: true, contactAllowed: true }, commerceConstraints: { team: null, edition: null },
      referencedProductId: target.proposal.candidateId,
      productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
      productRequirement: { action, evidence: userText, updates, suspectedTerm: null },
      candidateResponse: { action: 'none', evidence: '', candidateId: '' }, ...extras }) });
}
for (const [text, evidence] of [['La quiero en manga corta', 'manga corta'],
  ['Quiero esta camiseta en manga corta', 'manga corta'], ['I want this shirt in short sleeves', 'short sleeves']]) {
  for (const action of ['new', 'continue']) await check(`${text}/${action}`, async () => {
    const result = await route(text, action, [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence }]);
    assert.equal(result.requestedPrinting, 'none', 'specification revision must preserve no-printing');
    assert.equal(result.requestedEdition, 'player', 'specification revision must preserve edition');
    assert.equal(result.requestedTeam, 'Real Madrid');
    assert.deepEqual(result.requestedVariants, ['away']);
    assert.equal(result.requestedSeason, '2026/27');
    assert.equal(requestedProductEdition(result), 'player');
    assert.ok(result.requestedFeatures.includes('short_sleeve'));
    assert.equal(result.candidateSearchAllowed, true);
  });
}
for (const [from, feature, to] of [['player', 'authentic', 'fan'], ['fan', 'fan_version', 'player'],
  ['player', 'authentic', ''], ['fan', 'fan_version', '']]) {
  await check(`edition ${from}->${to || 'clear'}`, async () => {
    const previous = { ...target, requirements: { ...target.requirements, requestedEdition: from,
      requestedFeatures: [feature, 'short_sleeve'] } };
    const text = to ? `Change it to ${to} version` : 'Remove the version requirement';
    const evidence = to ? `${to} version` : text;
    const result = await route(text, 'continue', [{ field: 'requestedEdition', value: to, evidence }], previous,
      { commerceConstraints: { team: null, edition: to ? { value: to, evidence } : null } });
    assert.equal(requestedProductEdition(result), to, 'effective version must match the current explicit revision');
    assert.equal(result.requestedPrinting, 'none');
    assert.ok(result.requestedFeatures.includes('short_sleeve'), 'version revision must preserve sleeves');
    if (to) assert.equal(evaluateProductAttributeMatch({ name: 'Catalogue shirt', canonicalEdition: to,
      attributeEvidence: { edition: to, printing: 'none', sleeve: 'short_sleeve' } }, result).status, 'match');
    else assert.ok(!result.requestedFeatures.some(value => ['authentic', 'fan_version'].includes(value)));
  });
}
await check('explicit fresh identity resets old requirements', async () => {
  const text = 'Barcelona home shirt 2025/26';
  const result = await route(text, 'new', [], target, { searchQuery: text,
    commerceConstraints: { team: { value: 'Barcelona', role: 'product_target', evidence: 'Barcelona' }, edition: null } });
  assert.equal(result.requestedTeam, 'Barcelona');
  assert.equal(result.requestedPrinting, '');
  assert.equal(result.requestedEdition, '');
  assert.equal(result.productCandidateState.targetEvidence, text);
});
await check('unverified selection never inherits old target', async () => {
  const result = await route('I want this shirt in short sleeves', 'new', [], target,
    { productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: 'none' } });
  assert.notEqual(result.candidateSearchAllowed, true);
});
for (const [name, text, extras] of [
  ['no actual displayed target', 'I want this shirt in short sleeves', { referencedProductId: '' }],
  ['another product', 'Another shirt in short sleeves', {}],
  ['independent garment', 'I want a new shirt in short sleeves', { referencedProductId: '' }],
  ['different garment type', 'A training top in short sleeves', {}],
  ['comparison', 'Compare this shirt in short sleeves', { productRequest: { relation: 'comparison', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' } }],
]) await check(name, async () => {
  const result = await route(text, 'new', [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'short sleeves' }], target, extras);
  assert.equal(result.requestedPrinting, '', 'independent/ambiguous target cannot inherit prior no-printing');
  assert.notEqual(result.productCandidateState?.targetEvidence, target.targetEvidence);
});
for (const [edition, features] of [['fan', ['authentic']], ['player', ['fan_version']], ['conflict', []], ['', ['authentic', 'fan_version']]]) {
  await check('legacy contradictory version remains unverified', async () => {
    const previous = { ...target, requirements: { ...target.requirements, requestedEdition: edition, requestedFeatures: features } };
    const stored = readProductCandidateState([{ senderType: 'character', productCandidateState: previous }], location);
    assert.equal(requestedProductEdition(stored.requirements), 'conflict');
    assert.equal(normalizeChatProductRoutingContext(stored).requirements.requestedEdition, undefined, 'internal conflict cannot expand the JEV wire enum');
    const result = await route('La quiero en manga corta', 'continue', [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'manga corta' }], previous);
    assert.equal(requestedProductEdition(result), 'conflict', 'unrelated revision cannot repair conflicting version evidence');
    const revised = await route('Change it to fan version', 'continue', [{ field: 'requestedEdition', value: 'fan', evidence: 'fan version' }], previous,
      { commerceConstraints: { team: null, edition: { value: 'fan', evidence: 'fan version' } } });
    assert.equal(requestedProductEdition(revised), 'fan', 'grounded version revision can replace the conflict');
  });
}
await check('already confirmed actual garment retains requirements on a revision', async () => {
  const previous = { ...target, proposal: { ...target.proposal, status: 'confirmed', confirmationEvidence: 'This one.' } };
  const result = await route('I want this shirt in short sleeves', 'new',
    [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'short sleeves' }], previous);
  assert.equal(result.requestedPrinting, 'none');
  assert.equal(result.requestedEdition, 'player');
  assert.equal(result.productCandidateState.targetEvidence, target.targetEvidence);
  assert.equal(result.productCandidateState.proposal, null, 'specification revision requires a fresh reviewed proposal');
});
assert.equal(failures.length, 0, failures.join('\n'));
console.log(`Product candidate transition self-check passed (${checks} full routing cases; fixture classifier, no DB/network/model calls)`);
