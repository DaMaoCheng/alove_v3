import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('External calls forbidden'); };
const routing = await import('../server/commerce-routing-service.js');
const { normalizeCommerceDecision } = await import('../server/product-intent-classifier-service.js');
const resolveScope = routing.resolveCommerceKnowledgeScope || (intent => intent.commerceRoute === 'product_search' && !intent.answerRequired ? 'none' : intent.knowledgeScope);
const primary = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 };
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
for (const override of [ { knowledgeRequest: null }, { knowledgeRequest: undefined },
  { knowledgeRequest: { kind: 'unclear', evidence: '' } }, { knowledgeRequest: { kind: 'catalogue_only', evidence: 'Cristiano Ronaldo' } },
  { topic: 'delivery' }, { route: 'product_question' }, { route: 'store_policy' },
  { humanHandoff: { explicitRequest: true, businessReviewRequired: false, reviewReason: 'none', evidence: text } } ]) {
  const input = { ...value, ...override };
  assert.notEqual(resolveScope(await route(input)), 'none', 'Unknown, partial quote, policy and service classifications keep retrieval');
}
assert.equal(resolveScope(await route({ ...value, confidence: .4 })), 'none', 'Valid catalogue selection has no confidence threshold');
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

// Current-turn exchange handoff and lightweight conversation reuse the same
// classifier result. Mixed questions retain retrieval and independent lookup.
const { resolveChatFeedbackActionCandidate } = await import('../server/chat-feedback-action-service.js');
const noAction = { ok: true, confident: true, primaryIntent: 'daily_chat', orderIntent: 'none', productIntent: 'none' };
const mascot = { id: 'test_mascot', categoryId: 'mascot', profile: { language: 'Spanish' } };
for (const current of ['Quiero cambiar la talla de mi compra', 'Ya lo he recibido']) {
  const exchange = { ...value, route: 'store_policy', topic: 'sizing', needsLiveProductData: false,
    humanHandoff: { explicitRequest: false, businessReviewRequired: false, reviewReason: 'size_exchange', evidence: current },
    knowledgeRequest: { kind: 'size_exchange_only', evidence: current } };
  const intent = await route(exchange, current, { jevDecision: noAction });
  assert.equal(resolveScope(intent), 'none');
  assert.equal(resolveChatFeedbackActionCandidate({ character: mascot, userText: current, searchIntent: intent })?.reason, 'size_exchange');
  assert.equal(resolveChatFeedbackActionCandidate({ character: mascot, userText: current, searchIntent: { ...intent, replyBoundary: { contactAllowed: false } } }), null);
  const mixed = await route({ ...exchange, knowledgeRequest: { kind: 'business_question', evidence: current } }, current, { jevDecision: { ...noAction, orderIntent: 'lookup', primaryIntent: 'order_lookup' } });
  assert.equal(resolveScope(mixed), 'business');
  assert.equal(resolveChatFeedbackActionCandidate({ character: mascot, userText: current, searchIntent: mixed })?.reason, 'size_exchange');
}
const social = { ...value, route: 'chat', topic: 'other', knowledgeScope: 'general', needsLiveProductData: false, knowledgeRequest: { kind: 'conversation_only', evidence: 'Madrid' } };
assert.equal(resolveScope(await route(social, 'Madrid', { jevDecision: noAction })), 'none');
assert.notEqual(resolveScope(await route({ ...social, knowledgeRequest: { kind: 'conversation_only', evidence: 'Madrid' } }, 'Madrid y cuánto tarda el envío?', { jevDecision: noAction })), 'none', 'partial evidence cannot suppress a mixed question');
console.log('Exchange handoff, contact refusal, mixed lookup and whole-turn conversation checks passed');
const exchangePrompt = routing.applyCommerceQuestionPromptPolicy({}, {
  commerceRoute: 'store_policy', commerceTopic: 'returns', answerRequired: true,
  humanHandoff: { reviewReason: 'size_exchange' },
}).systemPrompt;
assert(exchangePrompt.includes('The server appends the exact feedback navigation'));
assert(!exchangePrompt.includes('For sizing help, continue'));

const { buildReplyReviewMessages } = await import('../server/chat-reply-review-contracts.js');
for (const [available, reason, expected] of [[true, 'size_exchange', true], [false, 'size_exchange', false], [true, 'none', false]]) {
  const messages = buildReplyReviewMessages({ feedbackActionAvailable: available, searchIntent: { humanHandoff: { reviewReason: reason } } });
  assert.equal(messages.some(message => message.content.includes('"sizeExchangeRequestAvailable":true')), expected, 'Exchange capability needs both the attached action and grounded exchange intent');
}
console.log('Exchange review capability is scoped to an attached exchange feedback action');
