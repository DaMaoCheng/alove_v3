import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('External calls forbidden'); };
const routing = await import('../server/commerce-routing-service.js');
const { normalizeCommerceDecision } = await import('../server/product-intent-classifier-service.js');
const resolveScope = routing.resolveCommerceKnowledgeScope || (intent => intent.commerceRoute === 'product_search' && !intent.answerRequired ? 'none' : intent.knowledgeScope);
const primary = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: .99 };
const text = 'Camiseta de niña retro Cristiano Ronaldo';
const value = { route: 'product_search', confidence: .99, topic: 'other', needsLiveProductData: true,
  searchQuery: 'Cristiano Ronaldo retro kids shirt', knowledgeScope: 'business', knowledgeQuery: text, answerRequired: true,
  productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
  knowledgeRequest: { kind: 'catalogue_only', evidence: text }, replyBoundary: { salesAllowed: true, contactAllowed: true } };
async function route(input = value, current = text, extra = {}) {
  return routing.resolveCommerceSearchIntent({ userText: current, enrichAllTurns: true, jevDecision: primary,
    classifyCommerce: async () => normalizeCommerceDecision(input, { userText: current, recentMessages: extra.recentMessages || [] }), ...extra });
}
const pure = await route();
assert.equal(resolveScope(pure), 'none', 'A verified whole-turn catalogue request must not load business knowledge just because it requires an answer');
assert.equal(pure.answerRequired, true, 'Normal response requirement is retained');
assert.equal(pure.cardAllowed, true, 'Existing primary router keeps card permission');
for (const override of [ { knowledgeRequest: null }, { knowledgeRequest: undefined }, { confidence: .4 },
  { knowledgeRequest: { kind: 'unclear', evidence: '' } }, { knowledgeRequest: { kind: 'catalogue_only', evidence: 'Cristiano Ronaldo' } },
  { topic: 'delivery' }, { route: 'product_question' }, { route: 'store_policy' },
  { humanHandoff: { explicitRequest: true, businessReviewRequired: false, reviewReason: 'none', evidence: text } } ]) {
  const input = { ...value, ...override };
  assert.notEqual(resolveScope(await route(input)), 'none', 'Unknown, partial quote, policy, service and low-confidence classifications keep retrieval');
}
for (const current of ['Find a retro shirt and tell me the shipping cost.', 'Busca una camiseta: ¿puedo devolverla?', 'Keress mezt, és mennyi a szállítás?', '找球衣，也问一下清关和积分兑换。']) {
  const mixed = await route({ ...value, knowledgeRequest: { kind: 'business_question', evidence: current } }, current);
  assert.equal(resolveScope(mixed), 'business');
}
for (const searchIntent of [{ customerServiceKnowledgeRequest: true }, { answerRequired: true, knowledgeScope: 'business' }, { businessKnowledgeRequired: false }]) {
  const input = searchIntent.businessKnowledgeRequired === false ? { ...value, knowledgeRequest: null } : value;
  assert.equal(resolveScope(await route(input, text, { searchIntent })), 'business', 'Known obligations and stale bypass flags cannot be lost');
}
const legacyNoAnswer = await route({ ...value, answerRequired: false, knowledgeRequest: undefined });
assert.equal(resolveScope(legacyNoAnswer), 'none', 'Legacy pure-search behavior remains');
for (const current of ['¿Y el envío?', 'What about returns?', '那运费呢？']) {
  const result = await route({ ...value, knowledgeRequest: { kind: 'unclear', evidence: '' } }, current,
    { recentMessages: [{ senderType: 'user', text: 'Find a shirt and tell me shipping costs.' }] });
  assert.equal(resolveScope(result), 'business');
}
assert.equal(resolveScope(pure, { classificationFailed: true }), 'none');
const blockedPrompt = routing.applyCommerceQuestionPromptPolicy({ systemPrompt: 'base' }, { ...pure, primarySearchBlocked: true, shouldLoadProductContext: false, cardAllowed: false });
assert(blockedPrompt.systemPrompt.includes('has not executed a catalogue search'), 'A blocked catalogue request must not be described as searched or available');
console.log('Commerce knowledge demand: whole-turn pure lookup, legacy/uncertain/mixed/history/service boundaries and unchanged reply/card permissions passed');
