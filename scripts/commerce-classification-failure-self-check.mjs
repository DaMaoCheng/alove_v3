import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const {resolveCommerceSearchIntent} = await import('../server/commerce-routing-service.js');
const {buildProductSearchIntent} = await import('../server/product-intent-service.js');
const {buildCommerceClassificationFailureReply} = await import('../server/commerce-classification-failure-service.js');
const {buildCommerceConversationContext} = await import('../server/product-intent-classifier-service.js');
const {isAiTransportFallback} = await import('../server/ai-reply-fallback-service.js');
const {buildCommerceDecisionLogEvent} = await import('../server/ai-reply-log-service.js');
const {resolveChatFactualContext} = await import('../server/chat-factual-context-service.js');
const text='Busco la camiseta del Real Madrid away 2026/27';
for (const failure of ['timeout','provider','parse','missing_fields']) {
  const intent=await resolveCommerceSearchIntent({userText:text,searchIntent:buildProductSearchIntent(text),enrichAllTurns:true,
    classifyCommerce:async()=>({confident:false,confidence:0,commerceClassificationFailure:failure}),
    jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1}});
  assert.equal(intent.commerceClassificationUnavailable,true);
  assert.equal(intent.shouldLoadProductContext,false); assert.equal(intent.cardAllowed,false);
  assert.equal(intent.scopeUnverified,false); assert.equal(intent.productScopePending,false);
  assert.notEqual(intent.searchState,'needs_clarification');
  const reply=buildCommerceClassificationFailureReply(intent,{userText:text,language:'es'});
  assert.equal(buildCommerceConversationContext([{senderType:'character',text:reply.text,replyRecoveryState:reply.replyRecoveryState}])[0].text,'');
  assert.equal(isAiTransportFallback(reply),true); assert.equal(reply.text,reply.speechText);
  assert.doesNotMatch(reply.text,/no encontr|no puedo verificar|un solo producto/i);
  assert.doesNotMatch(reply.text, /búsqueda de productos|product search|termékkeresés/i, 'classification failed before any catalogue request');
  assert.equal(reply.productScopeVerified,false); assert.equal(reply.candidateEvidenceVerified,false);
  assert.equal(reply.replyBoundary.salesAllowed,false);
  const event=buildCommerceDecisionLogEvent({searchIntent:intent});
  assert.equal(JSON.parse(event.errorMessage).classificationFailure,failure);
  assert.equal(JSON.parse(event.errorMessage).outcome,'classification_unavailable');
  const factual=await resolveChatFactualContext({userText:text,searchIntent:intent,jevDecision:{ok:true,confident:true,webSearchIntent:true},search:async()=>{throw new Error('product processing failure must not become public web facts');}});
  assert.equal(factual.status,'blocked');
}
for (const primaryIntent of ['chat','order_lookup','library_photo']) {
 const intent=await resolveCommerceSearchIntent({userText:'Hello',searchIntent:{},enrichAllTurns:true,classifyCommerce:async()=>({commerceClassificationFailure:'timeout'}),jevDecision:{ok:true,confident:true,primaryIntent}});
 assert.equal(buildCommerceClassificationFailureReply(intent),null);
}
assert.equal(buildCommerceClassificationFailureReply({commerceClassificationUnavailable:true,commerceClassificationFailure:'arbitrary'}),null);

// Clearing a primary non-shopping route expires both state owners; an uncertain
// shopping route must retain the scope result derived by applyProductRequestScope.
const siteId='scope-site',characterId='scope-character';
const scopeState={version:1,status:'selected',siteId,characterId,
 items:[{evidence:'Real Madrid shirt',sharedEvidence:'',text:'Real Madrid shirt'},
  {evidence:'Barcelona shirt',sharedEvidence:'',text:'Barcelona shirt'}],selectedIndex:0,clarificationCount:1};
const candidateState={version:1,status:'active',siteId,characterId,owner:'single',targetEvidence:'Real Madrid shirt',
 requirements:{requestedTeam:'real_madrid',requestedProductType:'shirt'},suspectedTerm:null,proposal:null};
const recentMessages=[{senderType:'character',productRequestState:scopeState,productCandidateState:candidateState}];
const expectedClearedScope={version:1,status:'cleared',siteId,characterId,items:[],selectedIndex:null,clarificationCount:0};
const expectedClearedCandidate={version:1,status:'cleared',siteId,characterId};
const confidentSearch={confident:true,confidence:.95,route:'product_search',topic:'other',searchQuery:'Real Madrid shirt',
 replyBoundary:{salesAllowed:true,contactAllowed:true}};
for (const [name,decision,searchIntent,jevDecision] of [
 ['uncertain other primary',{confident:false},{},{ok:true,confident:true,primaryIntent:'chat'}],
 ['uncertain deterministic non-shopping',{confident:false},{nonShoppingReason:'generic_image'},null],
 ['confident blocked primary',confidentSearch,{}, {ok:true,confident:true,primaryIntent:'order_lookup'}],
 ['confident deterministic non-shopping',confidentSearch,{nonShoppingReason:'generic_image'},null],
 ['confident sales boundary',{...confidentSearch,replyBoundary:{salesAllowed:false,contactAllowed:true}},{},null],
]) {
 const intent=await resolveCommerceSearchIntent({userText:'Hello',searchIntent,recentMessages,siteId,characterId,
  enrichAllTurns:true,classifyCommerce:async()=>decision,jevDecision});
 assert.deepEqual(intent.productRequestState,expectedClearedScope,name);
 assert.deepEqual(intent.productCandidateState,expectedClearedCandidate,name);
 assert.equal(intent.candidateSearchAllowed,false,name);
 assert.equal(intent.cardAllowed,false,name);
 assert.equal(intent.shouldLoadProductContext,false,name);
}
const uncertainShopping=await resolveCommerceSearchIntent({userText:text,searchIntent:buildProductSearchIntent(text),
 recentMessages,siteId,characterId,enrichAllTurns:true,classifyCommerce:async()=>({confident:false,confidence:.4})});
assert.equal(uncertainShopping.productRequestState.status,'pending');
assert.deepEqual(uncertainShopping.productRequestState.items,scopeState.items);
assert.equal(uncertainShopping.productRequestState.selectedIndex,null);
assert.equal(uncertainShopping.productRequestState.clarificationCount,2);
assert.equal(uncertainShopping.productScopePending,true);
assert.equal(uncertainShopping.scopeUnverified,true);
assert.deepEqual(uncertainShopping.productCandidateState,expectedClearedCandidate);
assert.equal(uncertainShopping.candidateSearchAllowed,false);
// No historical state must not fabricate a scope or candidate owner.
const empty=await resolveCommerceSearchIntent({userText:'Hello',searchIntent:{},siteId,characterId,enrichAllTurns:true,
 classifyCommerce:async()=>({confident:false}),jevDecision:{ok:true,confident:true,primaryIntent:'chat'}});
assert.equal(Object.hasOwn(empty,'productRequestState'),false);
assert.equal(Object.hasOwn(empty,'productCandidateState'),false);
assert.equal(empty.candidateSearchAllowed,false);
assert.deepEqual(recentMessages,[{senderType:'character',productRequestState:scopeState,productCandidateState:candidateState}]);
console.log('commerce classification failure self-check passed (isolated: distinct failure, no search/card/action, language, adjacent routes and state-owner clearing)');

const attempts=[{provider:'venice',kind:'protocol_evidence',privateBody:'secret'},{provider:'other',kind:'timeout'}, {provider:'other',kind:'timeout'}];
const loggedIntent=await resolveCommerceSearchIntent({userText:text,searchIntent:buildProductSearchIntent(text),enrichAllTurns:true,
 classifyCommerce:async()=>({confidence:0,commerceClassificationFailure:'timeout',commerceClassificationFailures:attempts}),
 jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1}});
const diagnostics=buildCommerceDecisionLogEvent({searchIntent:loggedIntent});
assert.deepEqual(JSON.parse(diagnostics.errorMessage).classificationFailures,attempts.map(({provider,kind})=>({provider,kind})));
assert(!diagnostics.errorMessage.includes('secret'));
assert.deepEqual(JSON.parse(buildCommerceDecisionLogEvent({searchIntent:{commerceClassificationFailures:[{provider:'url?key=secret',kind:'timeout'}, {provider:'venice',kind:'raw text secret'}]}}).errorMessage).classificationFailures,[]);
console.log('classification failure sequence safe routing/log projection checks passed');

// Every supported reply language has its own neutral classification failure;
// actual catalogue failures retain the existing product-specific copy.
const { SUPPORTED_CHARACTER_LANGUAGES } = await import('../shared/language-library.js');
const { buildGuestProductReplyCopy } = await import('../server/guest-product-reply-copy.js');
const neutralCopies = new Set();
for (const { code } of SUPPORTED_CHARACTER_LANGUAGES) {
 const reply = buildCommerceClassificationFailureReply({ commerceClassificationUnavailable: true, commerceClassificationFailure: 'provider' }, { language: code });
 assert.equal(reply.text, reply.displayText); assert.equal(reply.text, reply.speechText);
 assert.ok(reply.text.length > 10, code); neutralCopies.add(reply.text);
 assert.notEqual(reply.text, buildGuestProductReplyCopy('unavailable', { languageCode: code }), code);
 assert.equal(reply.degradationReason, 'commerce_classification_provider');
}
assert.equal(neutralCopies.size, SUPPORTED_CHARACTER_LANGUAGES.length);
assert.match(buildGuestProductReplyCopy('unavailable', { languageCode: 'en' }), /Product search/);

// A validated FAQ never turns its named reward item into a catalogue action.
// Keep a separately classified mixed catalogue request under original permissions.
for (const [route, productIntent, action, expectedSearch] of [
 ['store_policy', 'none', 0, false], ['product_search', 'search', 1, true],
]) {
 const faq = await resolveCommerceSearchIntent({ userText: expectedSearch ? 'How does redemption work? Find a Real Madrid shirt.' : 'How does redemption work?', enrichAllTurns: true,
  classifyCommerce: async () => ({ confident: true, confidence: .96, route, topic: 'support', knowledgeScope: 'business',
   knowledgeQuery: 'How does redemption work?', answerRequired: true, needsLiveProductData: false,
   searchQuery: expectedSearch ? 'Real Madrid shirt' : '',
   productRequest: { relation: expectedSearch ? 'single' : 'none', action: expectedSearch ? 'new' : 'none', items: [], selectedIndex: null, selectionEvidence: '' },
   replyBoundary: { salesAllowed: true, contactAllowed: true } }),
  jevDecision: { ok: true, confident: true, primaryIntent: expectedSearch ? 'product_request' : 'daily_chat', productIntent, productAction: action },
 });
 assert.equal(faq.customerServiceKnowledgeRequest, true);
 assert.equal(faq.answerRequired, true); assert.equal(faq.knowledgeScope, 'business');
 assert.equal(faq.shouldLoadProductContext, expectedSearch);
}
console.log('43-language neutral classification failure and FAQ/mixed route preservation checks passed');

for (const [locale, code] of [['es-MX', 'es'], ['hu_HU', 'hu'], ['Chinese', 'zh']]) {
 const state = { commerceClassificationUnavailable: true, commerceClassificationFailure: 'parse' };
 assert.equal(buildCommerceClassificationFailureReply(state, { language: locale }).text, buildCommerceClassificationFailureReply(state, { language: code }).text);
}
