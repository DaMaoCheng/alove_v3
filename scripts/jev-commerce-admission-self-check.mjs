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
      else if (question.type === 'choice' && Object.keys(question.criteria).join(',') === 'yes,no') answers[key] = { choice: (flags[key] ?? (['answer_required', 'contact_allowed'].includes(key) ? .99 : .01)) >= .5 ? 'yes' : 'no', confidence };
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
const lowSelected = evaluator({ route: 'store_policy', topic: 'delivery', knowledge_scope: 'business' }, { answer_required: .99 }, .4);
const lowSelectedResult = await resolveJevCommerceDecision(original, { evaluate: lowSelected.evaluate });
assert.equal(lowSelectedResult.value.route, 'store_policy', 'selected semantic intent is retained below former confidence threshold');
assert.equal(lowSelectedResult.value.topic, 'delivery');
assert.equal(lowSelectedResult.value.answerRequired, true, 'binary semantic choice is used without a confidence cutoff');
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
const primaryShopping = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1, orderIntent: 'none', imageIntent: 'none', webSearchIntent: false };
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
// This fixture explicitly selects quotation/review semantics. A valid selected
// CURRENT quote no longer vetoes that choice merely because overlapping spans
// split its probability; none/invalid quotes still cannot authorize a field.
assert.equal(noInventedQuote.businessInquiry?.kind, 'quotation');
assert.equal(noInventedQuote.humanHandoff?.businessReviewRequired, true);
assert(noInventedQuote.productRequirement?.updates.some(update => update.field === 'requestedProductType'), 'Low-probability valid current spans preserve the selected product type');
for (const selected of ['none', 'e999', 'prior0']) {
 const rejectedQuote = await classifyCommerceIntent('Find Real Madrid jersey', { resolveJevCommerce: (t, o) => resolveJevCommerceDecision(t, { ...o,
  evaluate: async request => {
   const result = await unclearEvidence.evaluate(request);
   for (const key of ['business_evidence', 'human_evidence', 'identity', 'candidate_evidence', 'e_requestedProductType', 'team_evidence'])
    if (result.answers[key]) result.answers[key] = { choice: selected, confidence: .99 };
   return result;
  } }) });
 assert.equal(rejectedQuote.businessInquiry, null); assert.equal(rejectedQuote.humanHandoff, null);
 assert(!rejectedQuote.productRequirement?.updates.some(update => ['requestedKeywords', 'requestedProductType', 'requestedTeam'].includes(update.field)), 'None, out-of-range or historical selections cannot become CURRENT evidence');
}
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

// A single merchandise followup must not enter the independent multi-item
// selection state machine merely because JEV labels both actions continue.
const singleLocation = { siteId: 'scope-site', characterId: 'scope-character' };
const singleTarget = { version: 1, status: 'active', ...singleLocation, owner: 'single', targetEvidence: 'Barcelona home shirt',
  requirements: { requestedTeam: 'Barcelona', requestedProductType: 'shirt', requestedVariant: 'home', requestedVariants: ['home'], requestedKeywords: [], requestedSizes: [], requestedFeatures: [], clearFields: [] }, suspectedTerm: null, proposal: null };
const singleHistory = [{ senderType: 'user', text: 'Barcelona home shirt' }, { senderType: 'character', productCandidateState: singleTarget, text: 'Here is the shirt.' }];
const followText = 'Name and number on the back too';
const followFixture = evaluator({ route: 'product_question', requirement_action: 'continue', request_relation: 'single', request_action: 'continue' });
const singleFollow = await resolveJevCommerceDecision(followText, { ...singleLocation, recentMessages: singleHistory, evaluate: followFixture.evaluate });
assert.equal(singleFollow.value.productRequest.action, 'new', 'single target does not select from a nonexistent multiple scope');
assert.equal(singleFollow.value.productRequirement.action, 'continue', 'actual merchandise continuation is preserved');
for (const history of [[], [{ senderType: 'character', productCandidateState: { ...singleTarget, status: 'cleared' } }], [{ senderType: 'character', productCandidateState: { ...singleTarget, siteId: 'other-site' } }]]) {
  const result = await resolveJevCommerceDecision(followText, { ...singleLocation, recentMessages: history, evaluate: followFixture.evaluate });
  assert.equal(result.value.productRequest.action, 'continue', 'no single-target admission from missing, cleared or foreign history');
}

const priorComplaint = 'My parcel has been delayed and support has not replied.';
const complaintFollowup = 'I am still asking about that same delay.';
const priorFixture = evaluator({ route: 'store_policy', knowledge_kind: 'unresolved_complaint', query_source: 'prior0' });
const continuedComplaint = await resolveJevCommerceDecision(complaintFollowup, { recentMessages: [{senderType:'user',text:priorComplaint}], evaluate:priorFixture.evaluate });
assert(continuedComplaint.value.knowledgeQuery.startsWith(complaintFollowup));
assert(continuedComplaint.value.knowledgeQuery.includes(priorComplaint), 'short complaint continuation retains selected prior USER context');
const selfContained = 'Can you check whether this shirt has a sponsor logo?';
const mistakenHistory = await resolveJevCommerceDecision(selfContained, { recentMessages:[{senderType:'user',text:'Hello'}], evaluate:priorFixture.evaluate });
assert(mistakenHistory.value.knowledgeQuery.startsWith(selfContained), 'even a mistaken history choice cannot replace the current question');
const longQuestion = 'Please explain delivery timing and conditions. '.repeat(12);
const longHint = await resolveJevCommerceDecision(longQuestion, {recentMessages:[{senderType:'user',text:priorComplaint}],evaluate:priorFixture.evaluate});
assert.equal(longHint.value.knowledgeQuery,longQuestion.trim().slice(0,240), 'bounded hint retains current question first; full current message is independently supplied to retrieval');

// Exercise the actual commerce normalization and guest capability boundary;
// fixture semantic selections test protocol/permissions, not real model accuracy.
globalThis.fetch = async () => { throw Error('External calls forbidden in policy regressions'); };
const { buildGuestBenefitContext } = await import('../server/guest-benefit-guidance-service.js');
const presaleText = 'Where would my future purchase be delivered?';
const presaleFixture = evaluator({route:'store_policy', topic:'delivery'}, {policy_required:.99}, .98,
  {policy_evidence:presaleText});
const presaleDecision = await classifyCommerceIntent(presaleText, {resolveJevCommerce:(t,o)=>resolveJevCommerceDecision(t,{...o,evaluate:presaleFixture.evaluate})});
const presaleIntent = await resolveCommerceSearchIntent({ userText:presaleText, searchIntent:buildProductSearchIntent(presaleText),
  classifyCommerce:async()=>presaleDecision, jevDecision:{ok:true,confident:true,primaryIntent:'daily_chat',orderIntent:'none',imageIntent:'none',productIntent:'none'} });
assert.equal(presaleIntent.businessKnowledgeRequired,true,'read-only delivery policy request retains knowledge independently of order access');
for (const kind of ['policy','benefit_request']) {
  const text='I expect the advertised offer to apply to my basket.';
  const fixture=evaluator({route:'store_policy',topic:'price',promotion_kind:kind},{policy_required:.99},.98,
    {promotion_evidence:text,policy_evidence:text});
  const decision=await classifyCommerceIntent(text,{resolveJevCommerce:(t,o)=>resolveJevCommerceDecision(t,{...o,evaluate:fixture.evaluate})});
  const intent=await resolveCommerceSearchIntent({userText:text,searchIntent:buildProductSearchIntent(text),classifyCommerce:async()=>decision,
    jevDecision:{ok:true,confident:true,primaryIntent:'daily_chat',orderIntent:'none',imageIntent:'none',productIntent:'none'}});
  assert.equal(intent.promotionInquiry.kind,kind);
  assert.equal(Boolean(buildGuestBenefitContext({searchIntent:intent,userText:text,isGuest:true})),kind==='benefit_request',
    'policy interpretation never becomes issuance/login permission; genuine issuance retains its guard');
}

// Complete kits are USER targets, not independent shirt/shorts duplicates.
const kitText = 'Spain shirt and shorts kit and Barcelona green kit';
const kitPacket = buildCommerceJevPacket(kitText);
const kitToken = (value, boundary) => 't' + kitPacket.productTokens.findIndex(token =>
  boundary === 'start' ? token.start === kitText.indexOf(value) : token.end === kitText.indexOf(value) + value.length);
const kits = evaluator({ route: 'product_search', knowledge_kind: 'catalogue_only', requirement_action: 'none', request_relation: 'multiple', request_action: 'new', item_count: 'two',
  item_0_start: kitToken('Spain', 'start'), item_0_end: kitToken('Spain shirt and shorts kit', 'end'),
  item_1_start: kitToken('Barcelona', 'start'), item_1_end: kitToken('Barcelona green kit', 'end') });
const kitDecision = await resolveJevCommerceDecision(kitText, { evaluate: kits.evaluate });
assert.equal(kitDecision.ok, true);
assert.equal(kitDecision.value.productRequest.items.length, 2);
assert.equal(kitDecision.value.productRequest.items[0].evidence, 'Spain shirt and shorts kit');
assert.equal(kitDecision.value.productRequest.items[1].evidence, 'Barcelona green kit');
const { normalizeProductRequest } = await import('../server/product-request-scope-service.js');
assert.equal(normalizeProductRequest(kitDecision.value.productRequest, { userText: kitText, confidence: .99 }).valid, true);
const childDetail = 'male national team football kit';
const childHistory = singleHistory.map(row => row.productCandidateState ? { ...row, productCandidateState: { ...singleTarget,
  requirements: { ...singleTarget.requirements, requestedAudience: 'kids' } } } : row);
const detail = evaluator({ route: 'product_question', topic: 'sizing', requirement_action: 'continue', request_relation: 'single', request_action: 'new', requestedAudience: 'absent' });
const detailResult = await resolveJevCommerceDecision(childDetail, { ...singleLocation, recentMessages: childHistory, evaluate: detail.evaluate });
assert.equal(detailResult.value.productRequirement.action, 'continue');
assert.equal(detailResult.value.productRequirement.updates.some(update => update.field === 'requestedAudience'), false,
  'a team gender detail with no wearer update must not manufacture an adult requirement');
const { applyCommerceQuestionPromptPolicy } = await import('../server/commerce-routing-service.js');
const scopePrompt = applyCommerceQuestionPromptPolicy({ systemPrompt: 'fixture', layers: [] }, { commerceRoute: 'product_search', scopeUnverified: true, productScopePending: true });
assert(scopePrompt.layers.some(layer => layer.id === 'product_scope_selection'));
for (const patch of [{ commerceRoute: 'chat' }, { customerServiceKnowledgeRequest: true }, { promotionInquiry: { kind: 'policy' } }, { nonShoppingReason: 'user_refusal' }]) {
  const prompt = applyCommerceQuestionPromptPolicy({ systemPrompt: 'fixture', layers: [] }, { commerceRoute: 'product_search', scopeUnverified: true, ...patch });
  assert(!prompt.layers.some(layer => layer.id === 'product_scope_selection'), 'scope selection must not hijack independent business/refusal/chat turns');
}
console.log('Kit target evidence, child detail continuation and pure-scope prompt boundaries passed; real-model interpretation requires separate page acceptance.');

for (const text of ['Can this store personalize shirts?', 'Please close my account.']) {
 const fixture=evaluator({route:'chat',topic:'other',review_reason:'service_request'},{policy_required:.99},.98,
  {human_evidence:text,policy_evidence:text});
 const decision=await classifyCommerceIntent(text,{resolveJevCommerce:(t,o)=>resolveJevCommerceDecision(t,{...o,evaluate:fixture.evaluate})});
 assert.equal(decision.humanHandoff.reviewReason,'service_request','same-call service purpose survives existing normalization');
 assert.equal(decision.humanHandoff.explicitRequest,false,'service assistance does not invent an explicit human request');
 assert.equal(decision.humanHandoff.businessReviewRequired,false,'service assistance does not invent a business negotiation');
}

// The all-target projection quotes an actual prior USER condition separately
// from the current scope-wide instruction; assistant wording cannot supply it.
const kitItems = normalizeProductRequest(kitDecision.value.productRequest, { userText: kitText, confidence: .99 }).items;
const kitState = { version:1,status:'selected',siteId:'all-site',characterId:'all-character',items:kitItems,selectedIndex:1,clarificationCount:1,originalUserText:kitText };
const allHistory=[{senderType:'user',text:'name and number printing'},{senderType:'character',productRequestState:kitState,text:'Which items?'}];
const allCurrent='On both kits';
const allPacket=buildCommerceJevPacket(allCurrent,{siteId:'all-site',characterId:'all-character',recentMessages:allHistory});
const allCondition='c'+allPacket.sharedConditions.indexOf('name and number printing');
const allFixture=evaluator({route:'product_search',knowledge_kind:'catalogue_only',requirement_action:'none',request_relation:'multiple',request_action:'continue',selected_index:'all',shared_condition_0:allCondition});
const allProjected=await resolveJevCommerceDecision(allCurrent,{siteId:'all-site',characterId:'all-character',recentMessages:allHistory,evaluate:allFixture.evaluate});
assert.equal(allProjected.value.productRequest.allTargets,true);assert.deepEqual(allProjected.value.productRequest.sharedUpdates,['name and number printing']);
assert(!allPacket.sharedConditions.includes('Which items?'));
console.log('All-target JEV projection retains the explicit current instruction and exact prior USER condition, excluding assistant-only wording.');
const selectedSpan=kitItems[0].text;
const selectedHistory=[{senderType:'character',productRequestState:{...kitState,selectedIndex:0}}];
const selectedFixture=evaluator({route:'product_search',knowledge_kind:'catalogue_only',requirement_action:'none',request_relation:'multiple',request_action:'continue',selected_index:'i0',requestedProductType:'shirt'}, {}, .99, {e_requestedProductType:'shirt'});
const selectedProjection=await resolveJevCommerceDecision(selectedSpan,{siteId:'all-site',characterId:'all-character',recentMessages:selectedHistory,evaluate:selectedFixture.evaluate});
assert.equal(selectedProjection.value.productRequirement.action,'continue');
assert(selectedProjection.value.productRequirement.updates.some(update=>update.field==='requestedProductType'&&update.value==='shirt'));
console.log('Exact selected-target JEV shirt attributes survive the coarse multiple-owner none action.');
