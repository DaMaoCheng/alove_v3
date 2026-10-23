import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('Unexpected external request in isolated commerce routing check'); };
const { classifyCommerceIntent, normalizeCommerceDecision } = await import('../server/product-intent-classifier-service.js');
const { resolveCommerceSearchIntent, applyCommerceQuestionPromptPolicy } = await import('../server/commerce-routing-service.js');
const { buildProductSearchIntent } = await import('../server/product-intent-service.js');
const { resolveGuestProductRecommendation } = await import('../server/guest-chat-product-service.js');
const { buildCommerceDecisionLogEvent } = await import('../server/ai-reply-log-service.js');
const { selectProductsForMessage } = await import('../server/chat-product-reply-service.js');
const config = { apiKey: 'isolated-test-key', baseUrl: 'https://classifier.invalid', model: 'test' };
const singleProductRequest = { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' };
let checks = 0;
for (const value of [null, [], 'bad', { route: 'injected', confidence: 1 }, { route: 'chat', confidence: .2 }]) {
  assert.equal(normalizeCommerceDecision(value).confident, false); checks++;
}
assert.equal(normalizeCommerceDecision({ searchQuery: { secret: true } }).searchQuery, '');
for (const [text, route, knowledgeScope, primaryIntent] of [
  ['What does in transit mean in general? I am not asking you to check an order.', 'chat', 'general', 'daily_chat'],
  ['Mi pedido 123456 no llega; comprueba su seguimiento real.', 'chat', 'business', 'order_lookup'],
  ['What delivery times does this store offer?', 'store_policy', 'business', 'daily_chat'],
  ['Explain in transit, tell me your delivery policy and check my actual order 123456.', 'store_policy', 'business', 'order_lookup'],
]) {
  const decision = await classifyCommerceIntent(text, { config, jevDecision: { ok: true, primaryIntent, productIntent: 'none', productAction: 0 },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body), packet = JSON.parse(body.messages[1].content);
      assert.equal(packet.primaryAction.primaryIntent, primaryIntent, 'general explanations never replace the existing order router action');
      assert.equal(body.messages.at(-1).content, text);
      assert.match(body.messages[0].content, /Classify the purpose, not merely the topic, across all languages and domains/);
      assert.match(body.messages[0].content, /Explaining what an order status means is not a request to inspect an actual order/);
      assert.match(body.messages[0].content, /retain all current questions/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ route, topic: 'delivery', knowledgeScope,
        knowledgeQuery: text, confidence: .95, needsLiveProductData: false, answerRequired: true,
        replyBoundary: { salesAllowed: false, contactAllowed: true }, productRequest: { relation: 'none', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
      }) } }] }) };
    } });
  assert.equal(decision.route, route);
  assert.equal(decision.topic, 'delivery', 'a subject label alone does not force business policy routing');
  assert.equal(decision.knowledgeScope, knowledgeScope);
  assert.equal(decision.needsLiveProductData, false, 'order or policy questions never authorize merchandise lookup');
  assert.equal(decision.knowledgeQuery, text, 'mixed/current questions are not discarded by normalization'); checks++;
}
for (const [text, route, topic, live, query] of [
  ['Szia a Messi bucsumeze az adidas ?', 'product_question', 'authenticity', true, 'Messi Argentina farewell jersey'],
  ['Magyarul', 'chat', 'other', false, ''],
  ['A termekfoton nem lattam azert irtam', 'product_question', 'authenticity', true, 'Messi Argentina farewell jersey'],
  ['配達には何日かかりますか', 'store_policy', 'delivery', false, ''],
  ['Mostra quelle grandi', 'product_search', 'sizing', true, 'Liverpool home jersey size L'],
]) {
  const recentMessages = [{ senderType: 'user', text: 'Messi Argentina farewell jersey' }];
  const response = { route, topic, needsLiveProductData: live, searchQuery: query, confidence: .95, replyBoundary: { salesAllowed: true, contactAllowed: true },
    productRequest: { ...singleProductRequest, relation: ['product_search', 'product_question'].includes(route) ? 'single' : 'none' } };
  const decision = await classifyCommerceIntent(text, { config, recentMessages, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /any language/);
    assert.match(body.messages[0].content, /available customization/);
    assert.match(body.messages[0].content, /Earlier assistant claims are not catalogue evidence/);
    assert.equal(JSON.parse(body.messages[1].content).latestMessage, text);
    assert.equal(JSON.parse(body.messages[1].content).recentConversation[0].text, recentMessages[0].text);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) };
  } });
  const intent = await resolveCommerceSearchIntent({ userText: text, searchIntent: buildProductSearchIntent(text), classifyCommerce: async () => decision });
  assert.equal(intent.commerceRoute, route); assert.equal(intent.shouldLoadProductContext, live);
  assert.equal(intent.cardAllowed, route === 'product_search');
  if (topic === 'sizing') { assert.deepEqual(intent.requestedSizes, ['L']); assert.deepEqual(intent.requestedVariants, ['home']); }
  checks++;
}
const uncertain = buildProductSearchIntent('Arsenal away kids jersey size M');
for (const classifyCommerce of [async () => { throw new Error('timeout'); }, async () => ({ confident: false })]) {
  const fallback = await resolveCommerceSearchIntent({ searchIntent: uncertain, classifyCommerce });
  assert.equal(fallback.shouldLoadProductContext, false);
  assert.equal(fallback.cardAllowed, false);
  assert.equal(fallback.query, fallback.commerceClassificationFailure ? uncertain.query : '');
  if (fallback.commerceClassificationFailure) {
    assert.notEqual(fallback.replyBoundaryReason, 'classification_uncertain', 'thrown provider errors are not requests for user clarification');
    assert.equal(fallback.commerceClassificationUnavailable, true, 'provider failure preserves the request without authorizing a search');
  }
  assert.deepEqual(fallback.requestedSizes, uncertain.requestedSizes); checks++;
}
const priceUncertain = await resolveCommerceSearchIntent({ userText: 'Why do these items have different prices?', searchIntent: {},
  classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_question', confidence: .7 }) });
assert.equal(priceUncertain.replyBoundaryReason, 'classification_uncertain');
assert.deepEqual(priceUncertain.replyBoundary, { salesAllowed: false, contactAllowed: false });
assert.equal(priceUncertain.shouldLoadProductContext, false); assert.equal(priceUncertain.cardAllowed, false); checks++;
for (const searchIntent of [{ nonShoppingReason: 'sales_refusal' }, { replyBoundary: { salesAllowed: false } }, { replyBoundary: { contactAllowed: false } }]) {
  const refusal = await resolveCommerceSearchIntent({ searchIntent, enrichAllTurns: true,
    classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_question', confidence: .7 }) });
  assert.notEqual(refusal.replyBoundaryReason, 'classification_uncertain'); checks++;
}
const technicalFailure = await resolveCommerceSearchIntent({ searchIntent: uncertain,
  classifyCommerce: async () => ({ confident: false, commerceClassificationFailure: 'timeout' }) });
assert.notEqual(technicalFailure.replyBoundaryReason, 'classification_uncertain');
assert.equal(technicalFailure.commerceClassificationUnavailable, true); checks++;
const conflict = await resolveCommerceSearchIntent({ searchIntent: uncertain, classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_search', searchQuery: 'Arsenal home adult jersey size L', confidence: .99, productRequest: singleProductRequest }) });
assert.deepEqual(conflict.requestedSizes, ['M']); assert.deepEqual(conflict.requestedVariants, ['away']); assert.equal(conflict.requestedAudience, 'kids'); checks++;
const business = buildProductSearchIntent('Which designer does Nike collaborate with on this jersey?');
assert.equal(business.nonShoppingReason, 'business_contact');
const collaboration = await resolveCommerceSearchIntent({ searchIntent: business, classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_question', topic: 'material', confidence: .99, productRequest: singleProductRequest }) });
assert.equal(collaboration.nonShoppingReason, ''); assert.equal(collaboration.commerceRoute, 'product_question'); checks++;
const exhausted = await resolveCommerceSearchIntent({ searchIntent: { ...uncertain, searchState: 'clarification_exhausted' }, classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_search', searchQuery: 'Arsenal jersey', confidence: .99, productRequest: singleProductRequest }) });
assert.equal(exhausted.searchState, 'clarification_exhausted'); checks++;
const db = { execute: async () => [[{ id: 'site_test', slug: 'test', product_api_url: 'https://shop.invalid/products', currency: 'HUF' }]] };
let sourceCalls = 0;
const products = [{ id: 'test-p', name: 'Arsenal Home Jersey', price: '19000 HUF', currency: 'HUF', url: 'https://shop.invalid/test-p' }];
const options = { guest: { site_id: 'site_test' }, userText: 'Arsenal jersey', searchProducts: async () => { sourceCalls++; return { ok: true, items: products, site: { id: 'site_test', slug: 'test', currency: 'HUF', storefrontUrl: 'https://shop.invalid' } }; } };
for (const route of ['store_policy', 'chat', 'product_question']) {
  const before = sourceCalls;
  const result = await resolveGuestProductRecommendation(db, { ...options, classifyCommerce: async () => normalizeCommerceDecision({ route, confidence: .99, productRequest: { ...singleProductRequest, relation: route === 'product_question' ? 'single' : 'none' } }) });
  assert.equal(result.requested, false); assert.equal(sourceCalls, before); checks++;
}
const fact = await resolveGuestProductRecommendation(db, { ...options, classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_question', topic: 'price', needsLiveProductData: true, searchQuery: 'Arsenal jersey', confidence: .99, productRequest: singleProductRequest }) });
assert.equal(fact.context.products.length, 1); assert.equal(fact.context.cardAllowed, false); assert.deepEqual(selectProductsForMessage(fact.context), []); checks++;
const recentCard = { product: { id: 'p_recent', name: 'Arsenal shirt exact', url: 'https://shop.invalid/products/arsenal-exact' } };
const anchored = await resolveCommerceSearchIntent({ searchIntent: buildProductSearchIntent('Mennyibe kerül?'), recentMessages: [recentCard], classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_question', topic: 'price', needsLiveProductData: true, searchQuery: 'generic jersey', referencedProductId: 'p_recent', confidence: .99, productRequest: singleProductRequest }) });
assert.equal(anchored.query, recentCard.product.name); assert.equal(anchored.productHandle, 'arsenal-exact'); assert.deepEqual(anchored.requestedKeywords, []); checks++;
const invented = await resolveCommerceSearchIntent({ searchIntent: {}, recentMessages: [recentCard], classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_question', needsLiveProductData: true, referencedProductId: 'invented', confidence: .99, productRequest: singleProductRequest }) });
assert.equal(invented.referencedProductId, undefined); assert.equal(invented.shouldLoadProductContext, false); checks++;
const foreign = await resolveCommerceSearchIntent({ siteId: 'current', searchIntent: {}, recentMessages: [{ product: { ...recentCard.product, siteId: 'foreign' } }], classifyCommerce: async () => normalizeCommerceDecision({ route: 'product_question', needsLiveProductData: true, referencedProductId: 'p_recent', confidence: .99, productRequest: singleProductRequest }) });
assert.equal(foreign.shouldLoadProductContext, false); assert.equal(foreign.referencedProductId, undefined); checks++;
const ordinaryPrompt = { systemPrompt: 'Existing persona', layers: [] };
assert.equal(applyCommerceQuestionPromptPolicy(ordinaryPrompt, { commerceRoute: 'chat' }), ordinaryPrompt);
assert.match(applyCommerceQuestionPromptPolicy(ordinaryPrompt, { commerceRoute: 'product_question' }).systemPrompt, /does not prove authenticity/); checks++;
const log = buildCommerceDecisionLogEvent({ searchIntent: { ...fact.searchIntent, sourceErrorCode: 'market_currency_mismatch', secret: 'secret-token' }, knowledgeContext: { items: [{ id: 'kb_test_section', content: 'secret-token' }] }, sessionId: 'chat_test' });
assert.equal(log.status, 'error'); assert.equal(JSON.parse(log.errorMessage).sourceErrorCode, 'market_currency_mismatch'); assert.equal(JSON.parse(log.errorMessage).knowledgeIds[0], 'kb_test_section'); assert.ok(!JSON.stringify(log).includes('secret-token')); assert.ok(log.errorMessage.length <= 500); checks++;
const failed = await classifyCommerceIntent('Arsenal jersey', { config, fetchImpl: async () => { throw new Error('network'); } });
for (const status of ['not_required', 'disabled', 'matched', 'no_result', 'error', 'blocked']) {
  const event = buildCommerceDecisionLogEvent({ searchIntent: { commerceRoute: 'product_question', commerceTopic: 'authenticity', commerceConfidence: .1234567890123456, sourceErrorCode: 'market_currency_mismatch' },
    knowledgeContext: { strategy: 'customer_service_no_reference', items: Array.from({length: 3}, () => ({id: 'k'.repeat(64)})) }, productContext: { searchOutcome: 'clarification_exhausted' },
    factualContext: { required: true, status, searched: true, reason: 'business_or_order_scope', items: [{content:'secret-token',url:'https://private.invalid/secret-token'}] } });
  assert.ok(event.errorMessage.length <= 500);
  const details = JSON.parse(event.errorMessage);
  assert.equal(details.factual.status, status); assert.equal(details.factual.refs, 1); assert.ok(!event.errorMessage.includes('secret-token')); checks++;
}
const unsafeFactLog = buildCommerceDecisionLogEvent({ factualContext: { status: 'secret-token', reason: 'secret-token' } });
assert.equal(JSON.parse(unsafeFactLog.errorMessage).factual.reason, 'unknown'); assert.ok(!unsafeFactLog.errorMessage.includes('secret-token')); checks++;
for (const strategy of ['not_requested', 'no_business_reference', 'business_directory_limit', 'business_selection_unavailable', 'business_no_relevant_section', 'business_no_verified_answer', 'business_verified_reference']) {
  const event = buildCommerceDecisionLogEvent({ knowledgeContext: { strategy, items: [{ id: 'new_policy_section', content: 'private-content' }] },
    factualContext: { required: false, status: 'not_required', searched: false, reason: 'not_requested' } });
  assert.equal(JSON.parse(event.errorMessage).knowledgeStrategy, strategy);
  assert.ok(event.errorMessage.length <= 500); assert.ok(!event.errorMessage.includes('private-content')); checks++;
}
assert.equal(JSON.parse(buildCommerceDecisionLogEvent({ knowledgeContext: { strategy: 'private-content' } }).errorMessage).knowledgeStrategy, ''); checks++;
assert.equal(failed.confident, false); checks++;
for(const kind of ['timeout','parse','provider','missing_fields','not_configured']) {
 const event=buildCommerceDecisionLogEvent({searchIntent:{commerceRoute:'product_question',commerceTopic:'authenticity',commerceConfidence:.1234567890123456,sourceErrorCode:'market_currency_mismatch',commerceClassificationFailure:'missing_fields',commerceClassificationFailures:Array(3).fill({provider:'deepseek',kind:'protocol_evidence'}),productScopeReason:'selection_evidence_unverified',replyBoundary:{salesAllowed:false}},productContext:{searchOutcome:'clarification_exhausted'},knowledgeContext:{strategy:'business_selection_unavailable',selectionFailure:{stage:'directory',kind,raw:'private-content'}},factualContext:{required:true,status:'not_required',reason:'business_or_order_scope'}});
 assert(event.errorMessage.length<=500,'maximum combined diagnostics remain valid JSON within DB bound');
 assert.deepEqual(JSON.parse(event.errorMessage).knowledgeFailure,{stage:'directory',kind});
 assert(!event.errorMessage.includes('private-content'));checks++;
}
assert.equal(JSON.parse(buildCommerceDecisionLogEvent({knowledgeContext:{selectionFailure:{stage:'secret',kind:'secret'}}}).errorMessage).knowledgeFailure,undefined);checks++;
// Primary conversation purpose survives only a pure, action-closed weak
// secondary decision; it never grants a tool, sale, policy or contact action.
const pureConversationMarker = { version: 1, kind: 'conversation', source: 'jev_daily_chat' };
const purposeJev = { ok:true, source:'jev', confident:true, primaryIntent:'daily_chat', confidence:.72,
  productIntent:'none', productAction:.07, imageIntent:'none', orderIntent:'none', webSearchIntent:false, unsupported:false };
const purposeDecision = { confident:false, confidence:.7, route:'unclear', topic:'other', knowledgeScope:'general',
  needsLiveProductData:false, searchQuery:'', referencedProductId:'', knowledgeQuery:'' };
const purposeSite = 'purpose-site', purposeCharacter = 'purpose-character';
const purposeBase = { userText:'Bobby Carlton', searchIntent:buildProductSearchIntent('Bobby Carlton'),
  siteId:purposeSite, characterId:purposeCharacter, enrichAllTurns:true, jevDecision:purposeJev,
  classifyCommerce:async()=>purposeDecision };
const purePurpose = await resolveCommerceSearchIntent(purposeBase);
assert.deepEqual(purePurpose.replyPurposeContext,pureConversationMarker);
assert.equal(purePurpose.commerceRoute,'unclear');
assert.deepEqual(purePurpose.replyBoundary,{salesAllowed:false,contactAllowed:false});
assert.equal(purePurpose.cardAllowed,false); assert.equal(purePurpose.shouldLoadProductContext,false); checks++;
const pendingPurposeScope = {version:1,status:'pending',siteId:purposeSite,characterId:purposeCharacter,
  items:[{evidence:'Arsenal shirt',sharedEvidence:'',text:'Arsenal shirt'},{evidence:'Chelsea shirt',sharedEvidence:'',text:'Chelsea shirt'}],selectedIndex:null,clarificationCount:1};
const activePurposeCandidate = {version:1,status:'active',siteId:purposeSite,characterId:purposeCharacter,owner:'single',
  targetEvidence:'Arsenal shirt',requirements:{requestedTeam:'Arsenal',requestedProductType:'shirt'},suspectedTerm:null,proposal:null};
for (const [label, changed] of [
  ['JEV failed',{jevDecision:{...purposeJev,ok:false}}],
  ['JEV low confidence',{jevDecision:{...purposeJev,confident:false}}],
  ['different primary',{jevDecision:{...purposeJev,primaryIntent:'product_request'}}],
  ['product action',{jevDecision:{...purposeJev,productIntent:'search'}}],
  ['contradictory action score',{jevDecision:{...purposeJev,productAction:.9}}],
  ['legacy source',{jevDecision:{...purposeJev,source:'lexical_fallback'}}],
  ['image action',{jevDecision:{...purposeJev,imageIntent:'explicit_generation'}}],
  ['order action',{jevDecision:{...purposeJev,orderIntent:'lookup'}}],
  ['web action',{jevDecision:{...purposeJev,webSearchIntent:true}}],
  ['unsupported',{jevDecision:{...purposeJev,unsupported:true}}],
  ['explicit trigger',{explicitTrigger:true}],
  ['input pending owner',{searchIntent:{...purposeBase.searchIntent,productRequestState:pendingPurposeScope}}],
  ['input active candidate',{searchIntent:{...purposeBase.searchIntent,productCandidateState:activePurposeCandidate}}],
  ['pending owner',{recentMessages:[{senderType:'character',productRequestState:pendingPurposeScope}]}],
  ['selected owner',{recentMessages:[{senderType:'character',productRequestState:{...pendingPurposeScope,status:'selected',selectedIndex:0}}]}],
  ['active candidate',{recentMessages:[{senderType:'character',productCandidateState:activePurposeCandidate}]}],
  ['current card',{recentMessages:[{senderType:'character',product:{id:'card',name:'Arsenal shirt'}}]}],
  ...['customerServiceKnowledgeRequest','shouldLoadProductContext','needsLiveProductData','cardAllowed','productScopePending','scopeUnverified'].map(field=>
    [field,{searchIntent:{...purposeBase.searchIntent,[field]:true}}]),
  ['knowledge business',{searchIntent:{...purposeBase.searchIntent,knowledgeScope:'business'}}],
  ['explicit no sales',{searchIntent:{...purposeBase.searchIntent,replyBoundary:{salesAllowed:false,contactAllowed:true}}}],
  ['explicit no contact',{searchIntent:{...purposeBase.searchIntent,replyBoundary:{salesAllowed:true,contactAllowed:false}}}],
  ['non-shopping refusal',{searchIntent:{...purposeBase.searchIntent,nonShoppingReason:'declined_shopping'}}],
]) {
  const result = await resolveCommerceSearchIntent({...purposeBase,...changed});
  assert.equal(result.replyPurposeContext,undefined,label); checks++;
}
for (const [label, changed] of [
  ['confident secondary',{confident:true,confidence:.9,route:'chat'}],
  ['failure',{commerceClassificationFailure:'timeout'}],
  ['business knowledge',{knowledgeScope:'business'}],
  ['mixed retrieval',{knowledgeQuery:'shipping policy'}],
  ['policy route',{route:'store_policy'}],
  ['product route',{route:'product_search'}],
  ['product fact',{route:'product_question'}],
  ['business topic',{topic:'delivery'}],
  ['live request',{needsLiveProductData:true}],
  ['declared live request',{declaredLiveProductData:true}],
  ['shopping query',{searchQuery:'Arsenal shirt'}],
  ['item scope',{productRequest:{relation:'single',action:'new'}}],
  ['typed garment',{productRequirement:{action:'new',evidence:'shirt'}}],
  ['candidate assent',{candidateResponse:{action:'confirm',candidateId:'card'}}],
  ['target team constraint',{commerceConstraints:{team:{role:'product_target',value:'Arsenal'}}}],
  ['edition constraint',{commerceConstraints:{edition:{value:'player'}}}],
  ['product reference',{referencedProductId:'card'}],
  ...['businessInquiry','humanHandoff','promotionInquiry','checkoutIssue'].map(field=>[field,{[field]:{evidence:'Bobby Carlton'}}]),
  ['discount',{discountExplanationRequired:true}],
]) {
  const result = await resolveCommerceSearchIntent({...purposeBase,classifyCommerce:async()=>({...purposeDecision,...changed,replyPurposeContext:pureConversationMarker})});
  assert.equal(result.replyPurposeContext,undefined,label+' cannot inject a trusted conversation marker'); checks++;
}
const injectedPurpose = await resolveCommerceSearchIntent({...purposeBase,
  searchIntent:{...purposeBase.searchIntent,replyPurposeContext:pureConversationMarker},
  jevDecision:{...purposeJev,ok:false},classifyCommerce:async()=>({...purposeDecision,replyPurposeContext:pureConversationMarker})});
assert.equal(injectedPurpose.replyPurposeContext,undefined,'neither input intent nor classifier metadata can invent JEV provenance'); checks++;
const weakChatPurpose = await resolveCommerceSearchIntent({...purposeBase,classifyCommerce:async()=>({...purposeDecision,route:'chat'})});
assert.deepEqual(weakChatPurpose.replyPurposeContext,pureConversationMarker,'a weak secondary chat retains the same text purpose without becoming an action permission'); checks++;
console.log(`commerce routing self-check passed: ${checks} cases; isolated classifier/source/DB, no external calls`);

// Identical elliptical wording must be interpreted from USER facts, not an old
// assistant diagnostic. The scripted result checks classifier transport/normal-
// ization and prompt propagation; real model semantics are accepted separately.
for (const [historyText, expectedCheckout] of [
 ['now for 6 days it says that awaiting customs clearance', false],
 ['I cannot complete placing my new order; I do not know which step fails', true],
]) {
 const current = 'I tried and it’s says the same';
 const recentMessages = [{ senderType: 'user', text: historyText },
  { senderType: 'character', text: 'Try again and tell me what happens.' }];
 let captured = false;
 const decision = await classifyCommerceIntent(current, { config, recentMessages,
  fetchImpl: async (_url, options) => {
   captured = true;
   const request = JSON.parse(options.body), packet = JSON.parse(request.messages[1].content);
   assert(packet.recentConversation.some(row => row.role === 'user' && row.text === historyText));
   assert.equal(request.messages.at(-1).content, current);
   assert.match(request.messages[0].content, /an unsubmitted purchase/i);
   assert.match(request.messages[0].content, /a shipment.*not.*checkout/i);
   assert.match(request.messages[0].content, /knowledgeQuery.*elliptical/i);
   return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    route: 'store_policy', topic: expectedCheckout ? 'support' : 'delivery', knowledgeScope: 'business', confidence: .96,
    knowledgeQuery: historyText, answerRequired: true, needsLiveProductData: false,
    replyBoundary: { salesAllowed: false, contactAllowed: true }, productRequest: { relation: 'none', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
    checkoutIssue: expectedCheckout ? { active: true, evidence: current, requestScope: 'checkout_only', stage: 'unknown', stageEvidence: '', errorEvidence: '',
     failedAttempts: [], orderPlaced: null, orderEvidence: '', lookupRequested: null, lookupEvidence: '' } : null,
   }) } }] }) };
  },
 });
 assert(captured); assert.equal(Boolean(decision.checkoutIssue), expectedCheckout);
 assert.equal(decision.knowledgeQuery, historyText);
 if (expectedCheckout) assert.equal(decision.checkoutIssue.stage, 'unknown', 'an established unsubmitted purchase can keep unknown stage');
}
console.log('elliptical support classifier USER context, contextual retrieval and checkout distinction contract checks passed');

const safeAlternative = { kind: 'season_alternative', requestedSeason: '2022', alternativeSeason: '2024/25' };
const alternativeHistory = [{ senderType: 'character', characterId: 'fixture-character', contentType: 'product', sessionId: 'fixture-session',
 product: { id: 'alternative-shirt', name: 'Real Madrid Home 2024/25', siteId: 'fixture-site', alternative: { ...safeAlternative, unsafe: 'must-not-pass' } } }];
let alternativePacket;
await classifyCommerceIntent('Does this mean the original 2022 shirt was found?', { config, recentMessages: alternativeHistory,
 siteId: 'fixture-site', characterId: 'fixture-character', fetchImpl: async (_url, options) => {
  const body = JSON.parse(options.body); alternativePacket = JSON.parse(body.messages[1].content);
  assert.match(body.messages[0].content, /alternative.*does not.*original/i);
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ route: 'chat', confidence: .95,
   replyBoundary: { salesAllowed: false, contactAllowed: true } }) } }] }) };
 } });
assert.deepEqual(alternativePacket.recentConversation[0].productCard.alternative, safeAlternative);
assert.deepEqual(alternativePacket.displayedProductGroup[0].alternative, safeAlternative);
const { buildCommerceConversationContext } = await import('../server/product-intent-classifier-service.js');
assert(!Object.hasOwn(buildCommerceConversationContext([{ ...alternativeHistory[0], product: { ...alternativeHistory[0].product,
 alternative: { ...safeAlternative, requestedSeason: 'invented' } } }])[0].productCard, 'alternative'));
console.log('sanitized season-alternative history retained without authorizing original-target match');
