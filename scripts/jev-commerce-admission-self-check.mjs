import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { buildProductSearchIntent } = await import('../server/product-intent-service.js');
const { classifyCommerceIntent } = await import('../server/product-intent-classifier-service.js');
const { buildCommerceJevPacket, resolveJevCommerceDecision, commerceEvidenceChoices } = await import('../server/jev-commerce-decision-service.js');
const baseChoice = { route: 'store_policy', topic: 'delivery', knowledge_scope: 'business', knowledge_kind: 'business_question', query_source: 'current', business_kind: 'none', review_reason: 'none', promotion_kind: 'none', checkout_scope: 'none', checkout_stage: 'unknown', checkout_order: 'unknown', candidate_action: 'none', reference: 'none', requirement_action: 'none', request_relation: 'none', request_action: 'new', selected_index: 'none', support_followup: 'none' };
function evaluator(choices = {}, flags = {}, confidence = .98, quotes = {}) {
  const batches = [];
  const evaluate = async ({ questions, state }) => {
    assert(Object.keys(questions).length <= 32); assert(Buffer.byteLength(JSON.stringify({ state, questions }), 'utf8') <= 60000); batches.push(Object.keys(questions));
    const answers = {};
    for (const [key, question] of Object.entries(questions)) {
      if (question.type === 'choice') assert(Object.keys(question.criteria).length >= 2, 'No singleton choice reaches JEV');
      if (question.type === 'noul') answers[key] = { noul: flags[key] ?? (['answer_required', 'contact_allowed'].includes(key) ? .99 : .01) };
      else {
        const literal = quotes[key];
        const selectedQuote = literal && Object.entries(question.criteria).find(([, value]) => value === JSON.stringify(literal))?.[0];
        const selected = selectedQuote || choices[key] || baseChoice[key] || (question.criteria.absent ? 'absent' : question.criteria.none ? 'none' : Object.keys(question.criteria)[0]);
        assert(Object.hasOwn(question.criteria, selected), `Fixture selected unknown ${key}:${selected}`);
        answers[key] = { choice: selected, confidence };
      }
    }
    return { ok: true, source: 'jev', answers, llmFallbackAllowed: false };
  };
  return { evaluate, batches };
}
const original = 'Hello erdeklodom a rendelesem szallitasa utan';
const f = evaluator();
const decision = await classifyCommerceIntent(original, { resolveJevCommerce: (text, opts) => resolveJevCommerceDecision(text, { ...opts, evaluate: f.evaluate }),
  fetchImpl: async () => { throw Error('LLM forbidden after a valid JEV response'); }, jevDecision: { ok: true, confident: true, primaryIntent: 'order_lookup', orderIntent: 'lookup' } });
assert.equal(decision.route, 'store_policy'); assert.equal(decision.topic, 'delivery'); assert.equal(decision.knowledgeScope, 'business'); assert.equal(decision.answerRequired, true); assert.equal(decision.detectionSource, 'jev'); assert(f.batches.length >= 1);
const low = evaluator({ route: 'unclear' }, {}, .4);
const lowDecision = await classifyCommerceIntent(original, { resolveJevCommerce: (t, o) => resolveJevCommerceDecision(t, { ...o, evaluate: low.evaluate }), fetchImpl: async () => { throw Error('Unclear must not use an LLM'); } });
assert.equal(lowDecision.confident, false); assert(low.batches.length >= 1);
const config = { apiKey: 'fixture', baseUrl: 'https://fixture.invalid/v1', apiMode: 'chat_completions', model: 'fixture' };
let llmCalls = 0, jevCalls = 0;
const llm = async () => { llmCalls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ route: 'chat', confidence: .4, replyBoundary: { salesAllowed: true, contactAllowed: true } }) } }] })); };
await classifyCommerceIntent('Hello', { config, fetchImpl: llm, resolveJevCommerce: async () => { jevCalls++; return { ok: false, attempts: 2, exhausted: true, llmFallbackAllowed: true }; } });
assert.equal(jevCalls, 1); assert.equal(llmCalls, 1);
await classifyCommerceIntent('Hello', { config, fetchImpl: llm, jevDecision: { ok: false, attempts: 2, exhausted: true, llmFallbackAllowed: true }, resolveJevCommerce: async () => { throw Error('Do not repeat exhausted primary JEV attempts'); } });
assert.equal(llmCalls, 2);
await classifyCommerceIntent('Hello', { config, fetchImpl: llm, jevDecision: { ok: true, routingSource: 'llm_fallback', jevFailure: { exhausted: true } },
  resolveJevCommerce: async () => { throw Error('Do not reattempt JEV after inherited exhausted failure'); } });
assert.equal(llmCalls, 3);
for (const confident of [true, false]) {
 const routed = await resolveCommerceSearchIntent({ userText: original, enrichAllTurns: true, searchIntent: buildProductSearchIntent(original),
  jevDecision: { ok: true, confident, primaryIntent: 'order_lookup', orderIntent: 'lookup', productIntent: 'none' },
  classifyCommerce: async () => ({ confident: false, commerceClassificationFailure: 'timeout' }) });
 assert.equal(routed.customerServiceKnowledgeRequest === true, confident, 'Only reliable primary purpose survives domain failure');
 assert.equal(routed.answerRequired === true, confident);
 assert.equal(routed.shouldLoadProductContext, false); assert.equal(routed.cardAllowed, false);
 assert.equal(routed.replyBoundary.contactAllowed, false);
 if (confident) { assert.equal(routed.knowledgeScope, 'business'); assert.equal(routed.commerceTopic, 'delivery'); assert.equal(routed.knowledgeQuery, original); }
}

await classifyCommerceIntent('Hello', { config, fetchImpl: async () => { throw Error('Missing configuration is not remote failure'); }, resolveJevCommerce: async () => ({ ok: false, attempts: 0, llmFallbackAllowed: false }) });
const primaryShopping = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: .99, orderIntent: 'none', imageIntent: 'none', webSearchIntent: false };
const shoppingVote = { route: 'product_search', topic: 'other', confidence: .99, confident: true, boundaryVerified: true,
 replyBoundary: { salesAllowed: true, contactAllowed: true }, knowledgeScope: 'business', answerRequired: false,
 commerceConstraints: { team: { value: 'Real Madrid', role: 'product_target', evidence: 'Real Madrid' }, edition: null },
 searchQuery: 'Real Madrid shirt', productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' } };
for (const text of ['Find Real Madrid jersey; do not send a stock notification', 'Find Real Madrid jersey with the printed word refund']) {
 const lexical = buildProductSearchIntent(text);
 assert(lexical.nonShoppingReason || lexical.customerServiceKnowledgeRequest, 'Fixture must exercise an actual lexical route conflict');
 const routed = await resolveCommerceSearchIntent({ userText: text, searchIntent: lexical, jevDecision: primaryShopping,
  enrichAllTurns: true, siteId: 's', characterId: 'c', classifyCommerce: async () => ({ ...shoppingVote, knowledgeRequest: { kind: 'catalogue_only', evidence: text } }) });
 assert.equal(routed.nonShoppingReason, ''); assert.equal(routed.customerServiceKnowledgeRequest, false);
 assert.equal(routed.shouldLoadProductContext, true); assert.equal(routed.cardAllowed, true); assert.equal(routed.businessKnowledgeRequired, false);
}
for (const jevDecision of [{ ok: true, confident: false, primaryIntent: 'unclear' }, { ok: false, llmFallbackAllowed: false }]) {
 const text = 'refund';
 const routed = await resolveCommerceSearchIntent({ userText: text, searchIntent: buildProductSearchIntent(text), jevDecision,
  enrichAllTurns: true, classifyCommerce: async () => ({ route: 'unclear', confident: false, confidence: .3 }) });
 assert.equal(routed.customerServiceKnowledgeRequest, false, 'Lexical purpose cannot replace shared uncertainty/failure');
 assert.equal(routed.answerRequired, false); assert.equal(routed.shouldLoadProductContext, false);
}
const searchText = 'Find Real Madrid fan jersey with short sleeves';
const namedTeam = evaluator({ route: 'product_search', topic: 'other', knowledge_kind: 'catalogue_only', requirement_action: 'new', request_relation: 'single', requestedProductType: 'shirt', requestedEdition: 'fan', team: 't0', team_role: 'product_target' }, { sales_allowed: .99, live_required: .99, requestedFeatures_short_sleeve: .99 }, .99,
 { e_requestedProductType: 'jersey', e_requestedEdition: 'fan', team_evidence: 'Real Madrid', e_requestedFeatures: 'short sleeves' });
const teamDecision = await classifyCommerceIntent(searchText, { resolveJevCommerce: (t, o) => resolveJevCommerceDecision(t, { ...o, evaluate: namedTeam.evaluate }) });
assert.equal(teamDecision.searchQuery, 'Real Madrid'); assert.equal(teamDecision.commerceConstraints.edition.value, 'fan');
assert.deepEqual(teamDecision.productRequirement.updates.find(x => x.field === 'requestedFeatures').value, ['short_sleeve']);
const legacyText = 'Please notify me';
const legacyLexical = buildProductSearchIntent(legacyText);
const legacyRouted = await resolveCommerceSearchIntent({ userText: legacyText, searchIntent: legacyLexical,
 classifyCommerce: async () => { throw Error('Legacy early return should remain unchanged'); } });
assert.equal(legacyRouted.nonShoppingReason, legacyLexical.nonShoppingReason, 'Legacy non-chat callers without a shared decision retain their adapter');
const text = 'Find a retro Cristiano Ronaldo jersey for my daughter, size 16';
const product = evaluator({ route: 'product_search', topic: 'other', knowledge_kind: 'catalogue_only', requirement_action: 'new', request_relation: 'single', requestedProductType: 'shirt', requestedAudience: 'kids', identity_type: 'player', size_kind: 'catalogue_size' }, { sales_allowed: .99, live_required: .99, requestedVariants_retro: .99 }, .99,
  { e_requestedProductType: 'jersey', e_requestedAudience: 'daughter', identity: 'Cristiano Ronaldo', e_requestedVariants: 'retro', size_evidence: 'size 16' });
const enriched = await classifyCommerceIntent(text, { resolveJevCommerce: (t, o) => resolveJevCommerceDecision(t, { ...o, evaluate: product.evaluate }), fetchImpl: async () => { throw Error('Product JEV must not invoke LLM'); } });
assert.equal(enriched.route, 'product_search'); assert.equal(enriched.productRequirement.updates.find(x => x.field === 'requestedAudience').value, 'kids');
assert.deepEqual(enriched.productRequirement.updates.find(x => x.field === 'requestedKeywords').value, ['Cristiano Ronaldo']);
assert.equal(enriched.searchQuery, 'cristiano ronaldo', 'Literal identity is the catalogue anchor; kids/retro/size are filters');
assert.deepEqual(enriched.productRequirement.updates.find(x => x.field === 'requestedVariants').value, ['retro']);
assert(product.batches.length >= 2, 'Product evidence uses a separate bounded JEV lane');
const checkoutText = 'Checkout fails at payment: Card declined. I tried another card. I have not placed an order.';
const checkout = evaluator({ topic: 'support', checkout_scope: 'checkout_only', checkout_stage: 'payment', checkout_order: 'not_placed' }, {}, .99,
 { checkout_evidence: 'Checkout fails at payment', checkout_stage_evidence: 'payment', checkout_error_evidence: 'Card declined', checkout_attempt_0: 'I tried another card', checkout_order_evidence: 'I have not placed an order' });
const checked = await classifyCommerceIntent(checkoutText, { resolveJevCommerce: (t, o) => resolveJevCommerceDecision(t, { ...o, evaluate: checkout.evaluate }) });
assert.equal(checked.checkoutIssue.stage, 'payment'); assert.equal(checked.checkoutIssue.failedAttempts.length, 1); assert.equal(checked.checkoutIssue.orderPlaced, false);
assert(checkout.batches.length >= 2, 'Checkout evidence is a separate applicable task, not paid on ordinary order/chat');
const typoText = 'Find Real Madrid fun jersey';
const typo = evaluator({ route: 'product_search', topic: 'other', knowledge_kind: 'catalogue_only', requirement_action: 'new', request_relation: 'single', requestedProductType: 'shirt', team: 't0', team_role: 'product_target' }, { sales_allowed: .99 }, .99,
 { e_requestedProductType: 'jersey', team_evidence: 'Real Madrid', identity: 'fun', suspected_term: 'fun' });
const typoDecision = await classifyCommerceIntent(typoText, { resolveJevCommerce: (t, o) => resolveJevCommerceDecision(t, { ...o, evaluate: typo.evaluate }) });
assert.equal(typoDecision.productRequirement.suspectedTerm.value, 'fun'); assert.equal(typoDecision.commerceConstraints.edition, null, 'Do not silently convert fun into fan edition');
const unclearEvidence = evaluator({ route: 'product_search', topic: 'other', knowledge_kind: 'catalogue_only', requirement_action: 'new', request_relation: 'single', requestedProductType: 'shirt', business_kind: 'quotation', review_reason: 'quotation' },
 { sales_allowed: .99, human_explicit: .99 }, .99,
 { business_evidence: 'Find Real Madrid', human_evidence: 'Find Real Madrid', identity: 'Real Madrid', e_requestedProductType: 'jersey' });
const lowEvidence = async request => {
 const result = await unclearEvidence.evaluate(request);
 for (const key of ['business_evidence', 'human_evidence', 'identity', 'candidate_evidence', 'e_requestedProductType', 'team_evidence'])
  if (result.answers[key]) result.answers[key] = { ...result.answers[key], confidence: .2 };
 return result;
};
const noInventedQuote = await classifyCommerceIntent('Find Real Madrid jersey', { resolveJevCommerce: (t, o) => resolveJevCommerceDecision(t, { ...o, evaluate: lowEvidence }) });
assert.equal(noInventedQuote.businessInquiry, null); assert.equal(noInventedQuote.humanHandoff, null);
assert(!noInventedQuote.productRequirement?.updates.some(update => ['requestedKeywords', 'requestedProductType', 'requestedTeam'].includes(update.field)), 'Low-confidence evidence must not become the first/whole user span');
const noQuote = evaluator({ business_kind: 'quotation', review_reason: 'quotation' }, { human_explicit: .99 });
const noQuoteResult = await resolveJevCommerceDecision('Hello', { evaluate: async request => {
 const result = await noQuote.evaluate(request); for (const key of ['business_evidence', 'human_evidence']) if (result.answers[key]) result.answers[key] = { choice: 'none', confidence: .99 }; return result;
} });
assert.equal(noQuoteResult.value.businessInquiry, null); assert.equal(noQuoteResult.value.humanHandoff, null);
assert.deepEqual(noQuoteResult.value.candidateResponse, { action: 'none', evidence: '', candidateId: '' });
const longFixture = '请问现在球衣配送政策是什么？'.repeat(55);
const longRun = evaluator(); await resolveJevCommerceDecision(longFixture, { evaluate: longRun.evaluate }); assert(longRun.batches.length >= 1);
const spans = commerceEvidenceChoices(text); assert(spans.every(span => text.includes(span))); assert(spans.includes('Cristiano Ronaldo'));
assert(Object.keys(buildCommerceJevPacket(original).questions).length >= 1);
console.log('JEV commerce admission passed: valid/unclear no LLM, exhausted-only fallback, order business knowledge purpose, bounded product evidence batches, child/retro/full name conditions; no real network/DB.');
