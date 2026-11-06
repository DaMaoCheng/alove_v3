import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { buildProductSearchIntent, extractRequestedSizes, extractExplicitProductSeasons } = await import('../server/product-intent-service.js');
const { resolveJevCommerceDecision } = await import('../server/jev-commerce-decision-service.js');
const { resolveCommerceSearchIntent, applyCommerceQuestionPromptPolicy } = await import('../server/commerce-routing-service.js');
const { normalizeCommerceDecision, normalizeGeneralExplanationRequest } = await import('../server/product-intent-classifier-service.js');
const { resolveGuestProductRecommendation } = await import('../server/guest-chat-product-service.js');
const { buildChatProductRecommendationContext } = await import('../server/chat-product-recommendation-service.js');
const { normalizeChatProductRoutingContext } = await import('../server/chat-product-routing-context-service.js');
const { applyGuestProductClarificationPromptPolicy, normalizeGuestReplyText } = await import('../server/guest-chat-output-policy.js');
const failures = [];
let checks = 0;
async function check(name, fn) { try { await fn(); checks++; } catch (e) { failures.push(`${name}: ${e.message}`); } }
// Inject only JEV's wire answers. No model, network, DB or provider is called.
function evaluate(choices = {}, quotes = {}, flags = {}, evidenceConfidence = .99) {
  return async ({ questions }) => ({ ok: true, answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    const quoted = quotes[key] && Object.entries(q.criteria).find(([, text]) => text === JSON.stringify(quotes[key]))?.[0];
    const selected = quoted || choices[key] || (Object.keys(q.criteria).join(',') === 'yes,no' ? (flags[key] ? 'yes' : 'no')
      : q.criteria.absent ? 'absent' : q.criteria.none ? 'none' : Object.keys(q.criteria)[0]);
    assert(Object.hasOwn(q.criteria, selected), `invalid fixture ${key}:${selected}`);
    return [key, { choice: selected, confidence: quoted ? evidenceConfidence : .99 }];
  })) });
}
const shopping = { route: 'product_search', topic: 'other', knowledge_scope: 'business', knowledge_kind: 'catalogue_only',
  query_source: 'current', requirement_action: 'new', request_relation: 'single', request_action: 'new', requestedProductType: 'shirt' };
const flags = { sales_allowed: true, contact_allowed: true, live_required: true, answer_required: true };
await check('primary product lane uses commerce subtype without a repeated binary action veto', async () => {
  const text = 'Real Madrid shirt';
  const decision = normalizeCommerceDecision({ route: 'product_search', topic: 'other', confidence: .98, needsLiveProductData: true,
    searchQuery: 'Real Madrid', knowledgeScope: 'business', replyBoundary: { salesAllowed: true, contactAllowed: true },
    productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: text },
    productRequirement: { action: 'new', evidence: text, updates: [{ field: 'requestedTeam', value: 'Real Madrid', evidence: 'Real Madrid' },
      { field: 'requestedProductType', value: 'shirt', evidence: 'shirt' }], suspectedTerm: null }, candidateDecisionRequired: true,
    commerceConstraints: { team: { value: 'Real Madrid', role: 'product_target', evidence: 'Real Madrid' }, edition: null },
    knowledgeRequest: { kind: 'catalogue_only', evidence: text } }, { userText: text });
  for (const primaryIntent of ['product_request', 'daily_chat', 'character_photo', 'new_image', 'order_lookup', 'unsupported_request']) {
    const out = await resolveCommerceSearchIntent({ userText: text, searchIntent: buildProductSearchIntent(text), enrichAllTurns: true, siteId: 's', characterId: 'c',
      classifyCommerce: async () => decision,
      jevDecision: { ok: true, confident: true, primaryIntent, productIntent: 'none', productAction: 0 } });
    assert.equal(out.shouldLoadProductContext, primaryIntent === 'product_request', `${primaryIntent}: only the primary product lane may search`);
    assert.equal(out.cardAllowed, primaryIntent === 'product_request');
    if (primaryIntent === 'product_request') assert.equal(out.productCandidateState?.status, 'active');
  }
});
await check('routing projection retains canonical single-year user conditions', () => {
  const context = normalizeChatProductRoutingContext({ targetEvidence: 'Real Madrid jersey 2022', requirements: { requestedSeason: '2022', requestedTeam: 'Real Madrid' } });
  assert.equal(context.requirements.requestedSeason, '2022');
  assert(!normalizeChatProductRoutingContext({ targetEvidence: 'a shirt', requirements: { requestedSeason: 'garbage' } }).requirements.requestedSeason);
});
await check('low-confidence selected CURRENT spans preserve independently selected product types', async () => {
  const text = 'Have u the Harry Kane special shirt for a child ??';
  const out = await resolveJevCommerceDecision(text, { evaluate: evaluate({ ...shopping, requestedAudience: 'kids', identity_type: 'player' },
    { e_requestedProductType: 'shirt', e_requestedAudience: 'a child', identity: 'Harry Kane' }, flags, .4) });
  assert.equal(out.value.productRequirement.updates.find(x => x.field === 'requestedProductType')?.value, 'shirt');
  assert.equal(out.value.productRequirement.updates.find(x => x.field === 'requestedAudience')?.value, 'kids');
  assert.deepEqual(out.value.productRequirement.updates.find(x => x.field === 'requestedKeywords')?.value, ['Harry Kane']);
});
await check('none invalid and historical-only spans never supply current product updates', async () => {
  for (const selected of ['none', 'e999', 'old-context-not-in-current-pool']) {
    const current = 'Show a shirt';
    const baseEvaluate = evaluate({ ...shopping, requestedAudience: 'kids' }, {}, flags);
    const out = await resolveJevCommerceDecision(current, { recentMessages: [{ senderType: 'user', text: 'a child' }],
      evaluate: async input => {
        const result = await baseEvaluate(input);
        if (result.answers.e_requestedAudience) result.answers.e_requestedAudience = { choice: selected, confidence: .99 };
        return result;
      } });
    assert(!out.value.productRequirement.updates.some(x => x.field === 'requestedAudience'));
  }
});
await check('explicit hyphenated seasons retain both years', async () => {
  const text = 'Real Madrid camiseta 2026-27';
  const out = await resolveJevCommerceDecision(text, { evaluate: evaluate({ ...shopping, team: 't0', team_role: 'product_target', season: 'y0' },
    { e_requestedProductType: 'camiseta', team_evidence: 'Real Madrid', season_evidence: '2026-27' }, flags) });
  assert.equal(out.value.productRequirement.updates.find(x => x.field === 'requestedSeason')?.value, '2026/27');
  assert.deepEqual(extractExplicitProductSeasons('2022, 2021/22, 2026–2027, 2028/99'), ['2022', '2021/22', '2026/27']);
});
await check('semantic size evidence preserves copula and complete parallel sizes', async () => {
  for (const [text, expected] of [['La talla es 28.', ['28']], ['Talla 28 o 30.', ['28', '30']]]) {
    const out = await resolveJevCommerceDecision(text, { evaluate: evaluate({ ...shopping, requirement_action: 'continue', size_kind: 'catalogue_size' },
      { size_evidence: text }, flags) });
    assert.deepEqual(out.value.productRequirement.updates.find(x => x.field === 'requestedSizes')?.value, expected);
  }
});
await check('invalid size parsing never fabricates explicit removal', async () => {
  const text = 'Size 148';
  const out = await resolveJevCommerceDecision(text, { evaluate: evaluate({ ...shopping, size_kind: 'catalogue_size' }, { size_evidence: text }, flags) });
  assert(!out.value.productRequirement.updates.some(x => x.field === 'requestedSizes'));
  assert.deepEqual(extractRequestedSizes('number 28, year 2026, height 148 cm'), []);
  const cleared = await resolveJevCommerceDecision('Any size is fine', { evaluate: evaluate({ ...shopping, size_kind: 'clear' }, { size_evidence: 'Any size is fine' }, flags) });
  assert.deepEqual(cleared.value.productRequirement.updates.find(x => x.field === 'requestedSizes')?.value, []);
});
await check('conditional process explanation is independent of actual order lookup', async () => {
  const text = 'What does waiting for customs mean, and can you check my order?';
  const r = await resolveJevCommerceDecision(text, { evaluate: evaluate({ route: 'store_policy', topic: 'delivery', knowledge_scope: 'business',
    knowledge_kind: 'business_question', query_source: 'current', requirement_action: 'none', request_relation: 'none', general_explanation_kind:'reported_status_meaning' },
    { general_explanation_evidence: text }, { answer_required: true, contact_allowed: true }) });
  const decision = { ...normalizeCommerceDecision(r.value, { userText: text }), detectionSource: 'jev' };
  const routed = await resolveCommerceSearchIntent({ userText: text, searchIntent: buildProductSearchIntent(text), siteId: 's', characterId: 'c', enrichAllTurns: true,
    classifyCommerce: async () => decision, jevDecision: { ok: true, primaryIntent: 'order_lookup', orderIntent: 'lookup', productIntent: 'none', confident: true } });
  assert.equal(routed.commerceRoute, 'store_policy');
  assert.deepEqual(routed.generalExplanationRequest, { source: 'jev', kind:'reported_status_meaning', required: true, evidence: text });
  assert.equal(routed.generalTermExplanation, true);
  assert.equal(routed.cardAllowed, false);
  assert.equal(routed.shouldLoadProductContext, false);
  assert(applyCommerceQuestionPromptPolicy({}, routed, { userText: text, character:{id:'c',category_id:'mascot',site_id:'s'}, trustedSite:{id:'s'} }).systemPrompt.includes('first explain that reported status'));
});
await check('pure lookup and forged explanation cannot inherit explanation authority', async () => {
  const text = 'Check my order';
  assert.equal(normalizeGeneralExplanationRequest({ source: 'jev', required: true, evidence: 'What does customs mean?' }, { userText: text }), null);
  const r = await resolveJevCommerceDecision(text, { evaluate: evaluate({ route: 'store_policy', topic: 'delivery', knowledge_scope: 'business',
    knowledge_kind: 'business_question', query_source: 'current', requirement_action: 'none', request_relation: 'none' }, {}, { answer_required: true }) });
  assert.deepEqual(r.value.generalExplanationRequest, { kind:'none', required: false, evidence: text });
  const base = { ...normalizeCommerceDecision(r.value, { userText: text }), detectionSource: 'jev' };
  const old = { source: 'jev', required: true, evidence: 'What does customs mean?' };
  const routed = await resolveCommerceSearchIntent({ userText: text, searchIntent: { ...buildProductSearchIntent(text), generalExplanationRequest: old },
    classifyCommerce: async () => base, enrichAllTurns: true, jevDecision: { ok: true, confident: true, primaryIntent: 'order_lookup', orderIntent: 'lookup' } });
  assert.equal(routed.generalExplanationRequest.required, false);
  assert.equal(routed.generalTermExplanation, false);
  const fallback = await resolveCommerceSearchIntent({ userText: text, searchIntent: { generalExplanationRequest: old },
    classifyCommerce: async () => ({ ...base, detectionSource: 'llm' }), enrichAllTurns: true,
    jevDecision: { ok: true, confident: true, primaryIntent: 'order_lookup', orderIntent: 'lookup' } });
  assert.equal(fallback.generalExplanationRequest, undefined);
});
await check('same-call explanation kind separates meanings from case diagnosis', async () => {
  for(const [kind,text,required] of [
    ['term_meaning','What does player version mean?',true],
    ['reported_status_meaning','What does awaiting customs mean, and check my parcel?',true],
    ['case_diagnosis','Why does this shirt cost more than that one?',false],
    ['none','Check my order',false],
  ]) {
    const r=await resolveJevCommerceDecision(text,{evaluate:evaluate({route:'product_question',topic:'other',knowledge_scope:'business',knowledge_kind:'business_question',query_source:'current',requirement_action:'none',request_relation:'none',general_explanation_kind:kind},{general_explanation_evidence:text},{answer_required:true})});
    assert.deepEqual(r.value.generalExplanationRequest,{kind,required,evidence:text});
    const normalized=normalizeGeneralExplanationRequest({...r.value.generalExplanationRequest,required:!required},{userText:text});
    assert.equal(normalized.required,required,'required is derived from the selected kind, not another boolean vote');
  }
  const low=await resolveJevCommerceDecision('What does player version mean?',{evaluate:async input=>{const result=await evaluate({general_explanation_kind:'term_meaning'},{general_explanation_evidence:'What does player version mean?'})(input);if(result.answers.general_explanation_kind)result.answers.general_explanation_kind.confidence=.2;return result;}});
  assert.equal(low.value.generalExplanationRequest.required,true,'the selected explanation type has no additional score threshold');
  assert.equal(normalizeGeneralExplanationRequest({kind:'term_meaning',required:true,evidence:'prior-only words'},{userText:'What does player version mean?'}),null);
  assert.equal(normalizeGeneralExplanationRequest({kind:'unknown',required:true,evidence:'x'},{userText:'x'}),null);
  assert.deepEqual(normalizeGeneralExplanationRequest({required:true,evidence:'x'},{userText:'x'}),{required:true,evidence:'x'},'legacy missing kind remains compatible');
});
await check('current corrected policy query cannot be replaced by prior question', async () => {
  const text = 'Actually, I mean delivery to Ireland, not France.';
  const out = await resolveJevCommerceDecision(text, { recentMessages: [{ senderType: 'user', text: 'Do you ship to France?' }],
    evaluate: evaluate({ route: 'store_policy', topic: 'delivery', knowledge_scope: 'business', knowledge_kind: 'business_question', query_source: 'prior0' },
      { policy_evidence: text }, { policy_required: true, answer_required: true }) });
  assert.equal(out.value.policyKnowledgeRequest.query, text);
});
await check('final training requirements determine readiness, not simplified query', async () => {
  const text = 'Show me training tops';
  const decision = normalizeCommerceDecision({ route: 'product_search', topic: 'other', confidence: 1, replyBoundary: { salesAllowed: true, contactAllowed: true },
    searchQuery: 'top', needsLiveProductData: true, knowledgeScope: 'business', answerRequired: true,
    productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: text },
    productRequirement: { action: 'new', evidence: text, updates: [{ field: 'requestedProductType', value: 'top', evidence: 'training tops' }], suspectedTerm: null },
    knowledgeRequest: { kind: 'catalogue_only', evidence: text }, candidateDecisionRequired: true }, { userText: text });
  const out = await resolveCommerceSearchIntent({ userText: text, searchIntent: buildProductSearchIntent(text), enrichAllTurns: true, siteId: 's', characterId: 'c',
    jevDecision: { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 }, classifyCommerce: async () => decision });
  assert.deepEqual(out.requestedFeatures, ['training']);
  assert.equal(out.searchState, 'ready_to_search');
});
await check('guest producer refreshes exact displayed item without broad search', async () => {
  const site = { id: 's', slug: 'fixture', name: 'Fixture', commerce_enabled: 1, product_api_url: 'https://fixture.invalid/products' };
  const state = { version: 1, status: 'active', siteId: 's', characterId: 'c', owner: 'single', targetEvidence: 'Ireland home shirt',
    requestedConditionEvidence: ['Ireland home shirt'], requirements: { requestedTeam: 'Ireland', requestedProductType: 'shirt', requestedVariants: ['home'] }, suspectedTerm: null, proposal: null };
  const product = { id: 'p', productId: 'p', name: 'Ireland Home Shirt', siteId: 's', siteSlug: 'fixture', matchStatus: 'matched', url: 'https://fixture.invalid/p' };
  const history = [{ senderType: 'user', text: 'Ireland home shirt' }, { senderType: 'character', characterId: 'c', contentType: 'product', product },
    { senderType: 'character', characterId: 'c', contentType: 'text', productCandidateState: state, text: 'Here is the shirt.' }];
  const intent = { commerceRoute: 'product_question', commerceTopic: 'other', productRequirementAction: 'continue', needsLiveProductData: true,
    shouldLoadProductContext: true, cardAllowed: false, referencedProductId: 'p', replyBoundary: { salesAllowed: true },
    productCandidateState: { ...state, requestedConditionEvidence: [...state.requestedConditionEvidence, 'Name on back too'] } };
  let exact = 0;
  const out = await resolveGuestProductRecommendation({ execute: async () => [[site]] }, { guest: { site_id: 's', mascot_character_id: 'c' },
    userText: 'Name on back too', recentMessages: history, precomputedSearchIntent: intent,
    searchProducts: async () => { throw Error('ordinary search forbidden for same-item followup'); },
    resolveConfirmationProduct: async ({ strictSite, exactProduct }) => { assert(strictSite && exactProduct); exact++; return { resolvedFromSource: true, site, sourceItem: product }; } });
  assert.equal(exact, 1);
  assert.equal(out.context?.sourceRef, 'live-displayed-product-reference');
  assert.equal(out.context?.cardAllowed, false);
});
await check('clarification produces natural text while server owns state and limits', () => {
  for (const state of ['needs_clarification', 'clarification_exhausted']) {
    const p = applyGuestProductClarificationPromptPolicy({ systemPrompt: 'persona' }, { productRequested: true, searchIntent: { searchState: state, answerRequired: true } });
    assert(!p.systemPrompt.includes('[guest_product_clarification'));
    assert(p.systemPrompt.includes(state === 'needs_clarification' ? 'exactly one' : 'Do not ask another question'));
  }
  const text = 'Which team did you mean?';
  assert.equal(normalizeGuestReplyText({ text, productRequested: true, productSearchIntent: { searchState: 'needs_clarification', answerRequired: true } }), text);
});
await check('empty sizing searches preserve completed no-match in guest and member producers', async () => {
  const site = { id: 's', slug: 'fixture', name: 'Fixture', currency: 'USD', product_api_url: 'https://fixture.invalid/products' };
  const intent = { query: 'Mallorca', intent: 'sizing', requestedTeam: 'Mallorca', requestedProductType: 'shirt', requestedAudience: 'kids',
    requestedSeason: '2026/27', requestedSizes: ['28', '30'], explicitSizingProductSearch: true, commerceRoute: 'product_search', commerceTopic: 'sizing',
    shouldLoadProductContext: true, cardAllowed: true, searchState: 'ready_to_search', needsLiveProductData: true, replyBoundary: { salesAllowed: true }, candidateSearchAllowed: false };
  const db = { execute: async () => [[site]] };
  const guest = await resolveGuestProductRecommendation(db, { guest: { site_id: 's', mascot_character_id: 'c' }, userText: 'Talla 28 o 30',
    precomputedSearchIntent: intent, searchProducts: async () => ({ ok: true, searchState: 'ready_to_search', searchOutcome: 'no_match', items: [], site }) });
  assert.equal(guest.context.searchOutcome, 'no_match');
  assert.equal(guest.context.searchIntent.searchState, 'ready_to_search');
  const member = await buildChatProductRecommendationContext(db, { character: { id: 'c', category_id: 'mascot', site_id: 's' }, userText: 'Talla 28 o 30',
    precomputedSearchIntent: intent, fetchProducts: async () => [] });
  assert.equal(member.searchOutcome, 'no_match');
  assert.equal(member.searchIntent.searchState, 'ready_to_search');
});
await check('size stock evidence stays distinct from unknown options and failed sources', async () => {
  const site = { id: 's', slug: 'fixture', name: 'Fixture', currency: 'USD', siteUrl: 'https://fixture.invalid', product_api_url: 'https://fixture.invalid/products' };
  const intent = { query: 'Mallorca', intent: 'sizing', requestedTeam: 'Mallorca', requestedProductType: 'shirt', requestedAudience: 'kids',
    requestedSizes: ['28'], explicitSizingProductSearch: true, commerceRoute: 'product_search', commerceTopic: 'sizing',
    shouldLoadProductContext: true, cardAllowed: true, searchState: 'ready_to_search', needsLiveProductData: true, replyBoundary: { salesAllowed: true } };
  const product = { id: 'p', name: 'Kids Mallorca Shirt', url: 'https://fixture.invalid/p', available: true, matchStatus: 'matched', sizes: [{ label: '20', available: true }] };
  const invoke = async (items, outcome = 'matched', patch = {}) => (await resolveGuestProductRecommendation({ execute: async () => [[site]] }, {
    guest: { site_id: 's', mascot_character_id: 'c' }, userText: 'Talla 28', precomputedSearchIntent: { ...intent, candidateSearchAllowed: outcome === 'candidate' },
    searchProducts: async () => ({ ok: true, searchState: 'ready_to_search', searchOutcome: outcome, items, site, ...patch }),
  })).context;
  assert.equal((await invoke([product])).searchOutcome, 'size_unavailable', 'A real source item with known different options may report no requested size');
  const unknown = await invoke([{ ...product, sizes: [] }]);
  assert.notEqual(unknown.searchOutcome, 'size_unavailable');
  assert.equal(unknown.cardAllowed, false, 'Unknown ordinary size options do not create a sized-product card');
  const candidate = await invoke([{ ...product, matchStatus: 'candidate', sizes: [], candidateUnknownFields: ['sleeve'] }], 'candidate');
  assert.equal(candidate.searchOutcome, 'candidate', 'An actual candidate with unknown options retains uncertainty instead of a stock denial');
  const failed = await invoke([], 'source_error', { ok: false, searchState: 'source_error', sourceErrorCode: 'source_timeout' });
  assert.equal(failed.searchOutcome, 'source_error');
  const memberKnown = await buildChatProductRecommendationContext({ execute: async () => [[site]] }, {
    character: { id: 'c', category_id: 'mascot', site_id: 's' }, userText: 'Talla 28', precomputedSearchIntent: intent,
    fetchProducts: async () => [product],
  });
  assert.equal(memberKnown.searchOutcome, 'size_unavailable');
  const memberUnknown = await buildChatProductRecommendationContext({ execute: async () => [[site]] }, {
    character: { id: 'c', category_id: 'mascot', site_id: 's' }, userText: 'Talla 28', precomputedSearchIntent: intent,
    fetchProducts: async () => [{ ...product, sizes: [] }],
  });
  assert.notEqual(memberUnknown.searchOutcome, 'size_unavailable');
  assert.equal(memberUnknown.cardAllowed, false);
  const memberFailed = await buildChatProductRecommendationContext({ execute: async () => [[site]] }, {
    character: { id: 'c', category_id: 'mascot', site_id: 's' }, userText: 'Talla 28', precomputedSearchIntent: intent,
    fetchProducts: async () => { throw Object.assign(new Error('fixture source unavailable'), { code: 'ETIMEDOUT' }); },
  });
  assert.equal(memberFailed.searchOutcome, 'source_error');
});
await check('owned final fullname sizing searches bypass generic guidance for both producers', async () => {
  const site = { id: 's', slug: 'fixture', name: 'Fixture', currency: 'USD', product_api_url: 'https://fixture.invalid/products' };
  const requirements = { requestedProductType: 'shirt', requestedAudience: 'kids', requestedVariants: ['retro'], requestedKeywords: ['cristiano ronaldo'], requestedSizes: ['28'] };
  const state = { version: 1, status: 'active', siteId: 's', characterId: 'c', owner: 'single', targetEvidence: 'Camiseta de niña retro Cristiano Ronaldo',
    requestedConditionEvidence: ['Camiseta de niña retro Cristiano Ronaldo', 'La talla es 28.'], requirements, suspectedTerm: null, proposal: null };
  const intent = { ...requirements, query: 'cristiano ronaldo', intent: 'sizing', explicitSizingProductSearch: false, commerceRoute: 'product_search', commerceTopic: 'sizing',
    productRequirementAction: 'continue', primarySearchVerified: true, shouldLoadProductContext: true, cardAllowed: true, searchState: 'ready_to_search',
    needsLiveProductData: true, replyBoundary: { salesAllowed: true }, candidateSearchAllowed: true, productCandidateState: state };
  const history = [{ senderType: 'user', text: state.targetEvidence }, { senderType: 'character', characterId: 'c', productCandidateState: state, text: 'Source was unavailable.' }];
  const call = async (method, override = {}) => {
    let calls = 0;
    const args = { userText: 'La talla es 28.', recentMessages: history, precomputedSearchIntent: { ...intent, ...override } };
    const context = method === 'guest' ? (await resolveGuestProductRecommendation({ execute: async () => [[site]] }, { ...args,
      guest: { site_id: 's', mascot_character_id: 'c' }, searchProducts: async () => { calls++; return { ok: true, site, items: [], searchOutcome: 'no_match', searchState: 'ready_to_search' }; } })).context
      : await buildChatProductRecommendationContext({ execute: async () => [[site]] }, { ...args,
        character: { id: 'c', category_id: 'mascot', site_id: 's' }, fetchProducts: async () => { calls++; return []; } });
    return { context, calls };
  };
  for (const method of ['guest', 'member']) {
    const result = await call(method);
    assert(result.calls > 0, `${method}: the owned final search must actually reach its existing source path`);
    assert.equal(result.context.searchOutcome, 'no_match');
    assert.deepEqual(result.context.searchIntent.requestedSizes, ['28']);
    for (const override of [{ productCandidateState: null }, { primarySearchVerified: false }, { replyBoundary: { salesAllowed: false } },
      { commerceRoute: 'product_question' }, { productCandidateState: { ...state, siteId: 'other' } },
      { productCandidateState: { ...state, characterId: 'other' } },
      { productRequestState: { status: 'pending' }, productScopePending: true }, { productCandidateState: { ...state, proposal: { status: 'displayed', candidateId: 'p', name: 'Another shirt', reply: 'Is this the item?' } } }]) {
      assert.equal((await call(method, override)).calls, 0, `${method}: closed, unowned or read-only sizing remains guidance, not a new search`);
    }
  }
});
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Product evidence regression: ${checks} checks passed (isolated contracts; no external calls).`);
