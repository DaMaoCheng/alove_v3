import assert from 'node:assert/strict';
Object.assign(process.env,{AIOVE_PROVIDER_LOG_WRITE_ENABLED:'false',AI_REPLY_PROVIDER:'venice',
  VENICE_API_KEY:'fixture-venice',VENICE_BASE_URL:'https://venice.fixture.invalid/v1',VENICE_MODEL:'fixture-generator',
  OPENAI_API_KEY:'fixture-openai',OPENAI_BASE_URL:'https://openai.fixture.invalid/v1',OPENAI_MODEL:'fixture-second',OPENAI_API_MODE:'chat_completions',
  OPENAI_FALLBACK_API_KEY:'fixture-third',OPENAI_FALLBACK_MODEL:'fixture-third'});
globalThis.fetch = async () => { throw new Error('External requests forbidden'); };
const { isGroundedCommerceRepairEligible, repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
const knowledge = { strategy: 'business_verified_reference', items: [{ id: 'policy', scope: 'site', siteId: 'shop', title: 'Policy', content: 'Only region A has a delivery estimate. Check the destination at checkout.', evidenceQuote: 'Only region A has a delivery estimate.' }] };
const original = { text: 'Delivery to region B is guaranteed.', speechText: 'Delivery to region B is guaranteed.', sourceType: 'ai', sourceRef: 'venice-chat-completions', aiModel: 'generator', voiceMeta: { languageCode: 'en' },
  productScopeVerified: true, candidateEvidenceVerified: true, candidateConfirmationVerified: true, partialAnswerRetained: true, replyRecoveryState: { kind: 'boundary' }, verifiedDiscountOffers: [], discountOfferReply: false };
const base = { replyResult: { ...original, partialAnswerRetained: false, replyRecoveryState: undefined }, character: { category_id: 'mascot' }, reviewStatus: 'valid', reviewResult: { allowed: false, confidence: .97, boundarySupported: true }, failedContracts: ['business_facts'], retained: '',
  searchIntent: { commerceRoute: 'store_policy', knowledgeScope: 'business', answerRequired: true, replyBoundary: { salesAllowed: false, contactAllowed: false } }, knowledgeContext: knowledge };
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; };
check(isGroundedCommerceRepairEligible(base), 'concrete policy correction preserves a no-sales/no-contact boundary');
check(isGroundedCommerceRepairEligible({ ...base, reviewResult: { ...base.reviewResult, boundarySupported: false }, failedContracts: ['boundary', 'business_facts'] }), 'an initial forbidden navigation can yield new policy wording, never approval of the rejected original');
check(isGroundedCommerceRepairEligible({ ...base, reviewResult: { ...base.reviewResult, retainedText: 'Unapproved paragraph.', retainedLanguageQualitySupported: false } }), 'an unapproved proposed remainder cannot prevent correction of new text');
check(isGroundedCommerceRepairEligible({ ...base, searchIntent: { ...base.searchIntent, teamConstraintUnverified: true, shouldLoadProductContext: false, needsLiveProductData: false, cardAllowed: false } }), 'an inactive merchandise evidence marker cannot block verified pure policy wording');
for (const patch of [{ reviewStatus: 'timeout' }, { reviewResult: { ...base.reviewResult, confidence: .79 } }, { reviewResult: { ...base.reviewResult, confidence: '0.99' } },
  { reviewResult: { ...base.reviewResult, boundarySupported: undefined } }, { groundedRepairAttempted: true }, { languageRepairAttempted: true }, { retained: 'Approved paragraph' },
  { orderActionCandidate: {} }, { guestBenefitContext: {} }, { chatImageContext: {} }, { character: {} }, { failedContracts: [] },
  { replyResult: { ...base.replyResult, sourceRef: 'quality-guard' } }, { replyResult: { ...base.replyResult, sourceRef: 'ai-request-fallback' } },
  { replyResult: { ...base.replyResult, partialAnswerRetained: true } }, { knowledgeContext: { ...knowledge, strategy: 'business_no_verified_answer' } },
  { knowledgeContext: { ...knowledge, items: [] } }, { knowledgeContext: { ...knowledge, items: [{ ...knowledge.items[0], evidenceQuote: 'Invented policy quote.' }] } }]) {
  check(!isGroundedCommerceRepairEligible({ ...base, ...patch }), 'ineligible recovery path must not request another verdict');
}
for (const failure of ['product_scope', 'factual', 'confidence', 'identity', 'image_status', 'guest_benefit']) check(!isGroundedCommerceRepairEligible({ ...base, failedContracts: ['boundary', 'business_facts', failure] }), 'hard contracts cannot be repaired through commerce generation');
for (const patch of [{ checkoutIssue: {} }, { commerceClassificationFailure: 'parse' }, { commerceClassificationUnavailable: true }, { scopeUnverified: true }, { productScopePending: true }, { confirmedCandidateId: 'old' },
  { productRequestState: { status: 'selected', items: [{}, {}] } }, { discountExplanationRequired: true }, { promotionInquiry: {} }]) {
  check(!isGroundedCommerceRepairEligible({ ...base, searchIntent: { ...base.searchIntent, ...patch } }), 'action/scope/discount classification remains outside correction');
}
const product = { id: 'p1', name: 'Club Away Fan Jersey', unknownFields: ['sleeve'], unmatchedSearchTerms: ['fun'], attributeEvidence: { sleeve: 'unknown', edition: 'fan' } };
const candidate = { ...base, knowledgeContext: null, failedContracts: ['evidence', 'candidate_confirmation'], searchIntent: { commerceRoute: 'product_search', knowledgeScope: 'business', shouldLoadProductContext: true, cardAllowed: true, replyBoundary: { salesAllowed: true, contactAllowed: true }, requestedFeatures: ['short_sleeve'], productCandidateState: { secret: 'must-not-prompt' } },
  productContext: { searchOutcome: 'candidate', cardAllowed: true, products: [product], candidateContext: { requiresConfirmation: true, entityConfirmed: false, products: [product] } } };
check(isGroundedCommerceRepairEligible(candidate), 'an actual unconfirmed selectable catalogue candidate may obtain corrected wording');
check(!isGroundedCommerceRepairEligible({ ...base, productContext: candidate.productContext }), 'policy correction cannot bypass a concurrent candidate contract');
for (const patch of [{ productContext: { products: [product] } }, { productContext: { cardAllowed: true } },
  { searchIntent: { ...base.searchIntent, shouldLoadProductContext: true } }, { searchIntent: { ...base.searchIntent, needsLiveProductData: true } },
  { searchIntent: { ...base.searchIntent, cardAllowed: true } }]) {
  const options = { ...base, ...patch, searchIntent: { ...base.searchIntent, ...patch.searchIntent, teamConstraintUnverified: true } };
  check(!isGroundedCommerceRepairEligible(options), 'policy with a merchandise marker cannot repair alongside actual products or live/card permission');
}
check(!isGroundedCommerceRepairEligible({ ...base, productContext: { ...candidate.productContext, candidateContext: { ...candidate.productContext.candidateContext, requiresConfirmation: false, entityConfirmed: true } } }), 'policy correction cannot reopen a confirmed candidate');
for (const patch of [{ productContext: { ...candidate.productContext, cardAllowed: false } }, { productContext: { ...candidate.productContext, products: [] } },
  { productContext: { ...candidate.productContext, candidateContext: { ...candidate.productContext.candidateContext, entityConfirmed: true } } },
  { searchIntent: { ...candidate.searchIntent, replyBoundary: { salesAllowed: false } } }, { searchIntent: { ...candidate.searchIntent, confirmedCandidateId: 'p1' } }, { searchIntent: { ...candidate.searchIntent, teamConstraintUnverified: true } },
  { productContext: { ...candidate.productContext, sizingProduct: {} } }]) check(!isGroundedCommerceRepairEligible({ ...candidate, ...patch }), 'candidate permission or identity cannot be manufactured by correction');
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { buildCandidateConfirmationContext } = await import('../server/product-candidate-confirmation-service.js');
const { productCandidateContext } = await import('../server/product-search-execution-service.js');
const confirmationText = 'Yes, that is the item.';
const confirmationCharacter = { id: 'mascot_fixture', category_id: 'mascot' };
const confirmationProduct = { id: 'p1', productId: 'p1', name: 'Real Madrid Away Fan Jersey', siteId: 'shop', siteSlug: 'shop',
  matchStatus: 'candidate', available: true, attributeEvidence: { edition: 'fan', sleeve: 'unknown', printing: 'none', giveaway: true }, candidateUnknownFields: ['sleeve'] };
const priorState = { version: 1, status: 'active', siteId: 'shop', characterId: confirmationCharacter.id, owner: 'single',
  targetEvidence: 'Real Madrid away fan shirt without printing', requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt',
    requestedEdition: 'fan', requestedPrinting: 'none', requestedFeatures: ['short_sleeve'], requestedVariants: ['away'] },
  proposal: { status: 'displayed', candidateId: 'p1', name: confirmationProduct.name, reply: 'Is this the item you mean?' } };
const confirmationRows = [{ senderType: 'character', characterId: confirmationCharacter.id, contentType: 'product', product: confirmationProduct },
  { senderType: 'character', productCandidateState: priorState }];
const confirmationIntent = await resolveCommerceSearchIntent({ userText: confirmationText, recentMessages: confirmationRows,
  siteId: 'shop', siteSlug: 'shop', characterId: confirmationCharacter.id,
  jevDecision: { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'none', productAction: .5 },
  classifyCommerce: async () => ({ confident: true, confidence: .99, route: 'product_search', topic: 'other', replyBoundary: { salesAllowed: true, contactAllowed: true },
    productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
    productRequirement: { action: 'continue', evidence: confirmationText, updates: [], suspectedTerm: null },
    candidateResponse: { action: 'confirm', candidateId: 'p1', evidence: confirmationText } }) });
const confirmationContext = await buildCandidateConfirmationContext({ site: { id: 'shop', slug: 'shop' }, searchIntent: confirmationIntent,
  recentMessages: confirmationRows, userText: confirmationText, characterId: confirmationCharacter.id,
  resolveProduct: async () => ({ resolvedFromSource: true, site: { id: 'shop', slug: 'shop' }, sourceItem: confirmationProduct }), buildCandidateContext: productCandidateContext });
const confirmationOptions = { ...base, character: confirmationCharacter, knowledgeContext: null, userText: confirmationText,
  searchIntent: confirmationIntent, productContext: confirmationContext, failedContracts: ['evidence', 'business_facts'] };
check(isGroundedCommerceRepairEligible(confirmationOptions), 'Only the actual exact-source private confirmation proof can obtain text-only correction');
for (const patch of [
  { productContext: JSON.parse(JSON.stringify(confirmationContext)) },
  { productContext: { ...confirmationContext, products: [] } },
  { productContext: { ...confirmationContext, candidateContext: { ...confirmationContext.candidateContext, entityConfirmationEvidence: '' } } },
  { productContext: { ...confirmationContext, candidateContext: { ...confirmationContext.candidateContext, priorConfirmationQuestion: '' } } },
  { productContext: { ...confirmationContext, candidateContext: { ...confirmationContext.candidateContext, entityConfirmationEvidence: 'Earlier yes' } } },
  { productContext: { ...confirmationContext, candidateContext: { ...confirmationContext.candidateContext, priorConfirmationQuestion: 'Different question' } } },
  { userText: 'A different current user message.' },
  { character: { ...confirmationCharacter, id: 'other' } },
  { searchIntent: { ...confirmationIntent, candidateConfirmationOnly: false } },
  { searchIntent: { ...confirmationIntent, confirmedCandidateId: 'other' } },
  { searchIntent: { ...confirmationIntent, referencedProductId: 'other' } },
  { searchIntent: { ...confirmationIntent, shouldLoadProductContext: true } },
  { searchIntent: { ...confirmationIntent, needsLiveProductData: true } },
  { searchIntent: { ...confirmationIntent, cardAllowed: true } },
  { searchIntent: { ...confirmationIntent, productCandidateState: { ...confirmationIntent.productCandidateState, requirements: { ...confirmationIntent.productCandidateState.requirements, requestedEdition: 'player' } } } },
  { searchIntent: { ...confirmationIntent, productCandidateState: { ...confirmationIntent.productCandidateState, proposal: { ...confirmationIntent.productCandidateState.proposal, status: 'displayed' } } } },
  { searchIntent: { ...confirmationIntent, promotionInquiry: { kind: 'benefit_request' } } },
]) check(!isGroundedCommerceRepairEligible({ ...confirmationOptions, ...patch }), 'A forged, stale, changed or action-granting confirmation cannot obtain text correction');
const config = { apiKey: 'fixture', model: 'fixture', apiMode: 'chat_completions', timeoutMs: 9000 };
let confirmationCalls = 0;
const confirmedCorrection = await repairGroundedCommerceReply({ ...confirmationOptions, config, language: 'en', requestText: async (prompt) => {
  confirmationCalls++;
  const packet = JSON.parse(prompt.messages[0].content);
  check(packet.candidate.entityConfirmed === true && packet.candidate.entityConfirmationEvidence === confirmationText,
    'The correction sees the exact original assent, never a newly invented approval');
  check(packet.candidate.priorConfirmationQuestion === priorState.proposal.reply && packet.candidate.products[0].attributeEvidence.sleeve === 'unknown',
    'The prior question and unknown attribute survive correction unchanged');
  check(packet.candidate.products[0].attributeEvidence.giveaway === true && prompt.systemPrompt.includes('activity conditions apply'),
    'An omitted giveaway qualification can be restored using actual supplied evidence');
  return JSON.stringify({ displayText: 'I understand your selection. Sleeve length remains unverified. Activity conditions apply and your eligibility remains unverified.' });
} });
check(confirmationCalls === 1 && confirmedCorrection.text === confirmedCorrection.speechText,
  'A trusted confirmation obtains only one unapproved text candidate');
check(!confirmedCorrection.candidateConfirmationVerified && !confirmedCorrection.candidateEvidenceVerified,
  'Correction cannot grant confirmation or source-evidence approval itself');
let calls = 0, captured;
const fixed = await repairGroundedCommerceReply({ ...candidate, replyResult: original, language: 'en', userText: 'Show the short sleeve candidate.', config,
  requestText: async (prompt, options) => { calls++; captured = { prompt, options }; return JSON.stringify({ displayText: 'This catalogue candidate has an unverified sleeve length. Is it the item you mean?' }); } });
// This original fixture includes retained/recovery approvals, so cannot repair.
check(fixed === null && calls === 0, 'retained/recovery reply cannot gain a new correction');
const cleanOriginal = { ...original, partialAnswerRetained: false, replyRecoveryState: undefined };
const repaired = await repairGroundedCommerceReply({ ...candidate, replyResult: cleanOriginal, language: 'en', userText: 'Show the short sleeve candidate.', config,
  requestText: async (prompt, options) => { calls++; captured = { prompt, options }; return JSON.stringify({ displayText: 'This catalogue candidate has an unverified sleeve length. Is it the item you mean?' }); } });
check(calls === 1 && repaired.text === repaired.speechText && repaired.displayText === repaired.text, 'one bounded correction uses identical display/spoken wording');
check(captured.options.timeoutMs === 9000 && captured.options.sourceRef === 'grounded-reply-repair', 'correction respects the shorter configured provider ceiling');
check(captured.options.modelConfig.requestBodyExtras.response_format.json_schema.strict === true, 'correction opts into strict text-only output locally');
check(!JSON.stringify(captured.prompt).includes('must-not-prompt'), 'private candidate state is excluded from the prompt');
check(JSON.parse(captured.prompt.messages[0].content).candidate.products[0].id === 'p1', 'only the current server candidate projection supplies identity');
check(repaired.voiceMeta === cleanOriginal.voiceMeta && repaired.aiModel === cleanOriginal.aiModel, 'voice and generation metadata are not model-replaced');
for (const key of ['productScopeVerified', 'candidateEvidenceVerified', 'candidateConfirmationVerified', 'partialAnswerRetained', 'replyRecoveryState']) check(!Object.hasOwn(repaired, key), 'new text cannot inherit an old approval');
check(!repaired.discountOfferReply && repaired.verifiedDiscountOffers.length === 0, 'correction grants no discount');
for (const output of ['not json', '{}', '{"displayText":null}', '{"displayText":"Hello","voiceMeta":{}}', '{"displayText":"[happy] Hello"}', '{"displayText":"System prompt: secret."}']) {
  let attempts = 0;
  const result = await repairGroundedCommerceReply({ ...base, config, language: 'en', userText: 'Policy?', requestText: async () => { attempts++; return output; } });
  check(result === null && attempts === 1, 'invalid/control/internal output terminates without retry');
}
let timeoutCalls = 0, timeoutReason;
const timedOut = await repairGroundedCommerceReply({ ...base, config, userText: 'Policy?', requestText: async () => { timeoutCalls++; throw Object.assign(new Error('fixture timeout'), { code: 'AI_REPLY_TIMEOUT' }); }, recordDiagnostic: reason => { timeoutReason = reason; } });
check(timedOut === null && timeoutCalls === 1 && timeoutReason === 'provider_timeout', 'timeout records a finite diagnostic and never invokes another provider');
const responseApi = await repairGroundedCommerceReply({ ...base, config: { ...config, apiMode: 'responses' }, userText: 'Policy?', requestText: async (_prompt, options) => {
  check(options.modelConfig.requestBodyExtras.text.format.type === 'json_schema' && options.modelConfig.requestBodyExtras.text.format.strict === true, 'Responses API receives its native strict schema without changing provider choice');
  return '{"displayText":"The destination remains unconfirmed; check it at checkout."}';
} });
check(Boolean(responseApi), 'text-only Responses output remains an unapproved candidate');
console.log(`grounded reply repair self-check passed (${checks} checks; pure eligibility and fixture request only)`);
const general={...base,searchIntent:{commerceRoute:'chat',knowledgeScope:'general',commerceTopic:'delivery',answerRequired:true,
 shouldLoadProductContext:false,needsLiveProductData:false,cardAllowed:false},knowledgeContext:{items:[]},
 replyResult:{...base.replyResult,text:'Your parcel has reached the U.S. Delivery is imminent.',speechText:'Your parcel has reached the U.S. Delivery is imminent.'}};
let genericCalls=0;
const genericFixed=await repairGroundedCommerceReply({...general,config,language:'en',userText:'What does this status mean?',
 requestText:async prompt=>{genericCalls++;assert(prompt.systemPrompt.includes('character location/nationality'));
 assert(prompt.systemPrompt.includes('conditional definition'));
 assert.match(prompt.systemPrompt, /waiting or pending.*not.*(started|underway)/i);
 assert.match(prompt.systemPrompt, /in progress.*not.*completed/i);return JSON.stringify({displayText:'This status usually means arrival in the destination country; it does not confirm clearance or a delivery date.'});}});
check(genericCalls===1&&genericFixed.text.includes('usually means'),'general correction uses one conditional definition candidate, not invented shipment facts');
console.log('general explanation corrective prompt regression passed');

// Ordinary matched cards already have stock evidence. Only their accompanying
// wording may be corrected; this is neither a new search nor a candidate vote.
const matchedIntent = { commerceRoute:'product_search',commerceTopic:'other',knowledgeScope:'business',knowledgeQuery:'',
  query:'Arsenal shirt',primarySearchVerified:true,shouldLoadProductContext:true,needsLiveProductData:true,cardAllowed:true,
  requestedTeam:'Arsenal',requestedProductType:'shirt',requestedKeywords:[],searchState:'ready_to_search',replyBoundary:{salesAllowed:true,contactAllowed:false} };
const matchedProducts = [{id:'matched-home',name:'Arsenal Home Jersey 2026/27',siteId:'shop',url:'https://example.test/home',available:true,
  attributeEvidence:{edition:'unknown',sleeve:'unknown',printing:'unknown',giveaway:null}}];
const matched = { ...base,character:{id:'mascot_fixture',category_id:'mascot',site_id:'shop'},searchIntent:matchedIntent,knowledgeContext:{items:[]},
  productContext:{sourceType:'product_api',sourceRef:'guest-site-product-context',siteId:'shop',searchOutcome:'matched',cardAllowed:true,
    searchIntent:matchedIntent,products:matchedProducts},
  reviewResult:{reviewStatus:'valid',allowed:false,confidence:.9,boundarySupported:true,evidenceSupported:true,businessFactsSupported:false,
    guidanceSupported:true,languageQualitySupported:true,factualSupported:true},failedContracts:['business_facts'] };
check(isGroundedCommerceRepairEligible(matched),'ordinary current-source matching cards permit one caption correction');
check(isGroundedCommerceRepairEligible({...matched,character:{...matched.character,site_id:null},trustedSite:{id:'shop'}}),'current trusted site binds a mascot with no direct site_id');
check(isGroundedCommerceRepairEligible({...matched,reviewResult:{...matched.reviewResult,confidence:.5},failedContracts:['confidence','business_facts']}),
  'a valid low-confidence review may request new wording but never approve it');
for (const patch of [
  {productContext:{...matched.productContext,sourceType:'history'}},
  {productContext:{...matched.productContext,sourceRef:'guest-current-product-image-context'}},
  {productContext:{...matched.productContext,siteId:'foreign'}},
  {trustedSite:{id:'foreign'}},
  {character:{...matched.character,siteId:'foreign'}},
  {character:{...matched.character,site_id:'foreign',siteId:'shop'},trustedSite:{id:'shop'}},
  {productContext:{...matched.productContext,searchOutcome:'no_match'}},
  {productContext:{...matched.productContext,products:[]}},
  {productContext:{...matched.productContext,products:[{...matchedProducts[0],siteId:'foreign'}]}},
  {productContext:{...matched.productContext,products:[{...matchedProducts[0],name:'Chelsea Home Jersey'}]}},
  {productContext:{...matched.productContext,products:[{...matchedProducts[0],available:false}]}},
  {productContext:{...matched.productContext,products:[{...matchedProducts[0],matchStatus:'candidate'}]}},
  {productContext:{...matched.productContext,candidateContext:{requiresConfirmation:true,products:[]}}},
  {productContext:{...matched.productContext,cardAllowed:false}},
  {searchIntent:{...matchedIntent,requestedFeatures:['long_sleeve']}},
  {searchIntent:{...matchedIntent,requestedEdition:'player'}},
  {searchIntent:{...matchedIntent,requestedKeywords:['unverified-name']}},
  {searchIntent:{...matchedIntent,commerceTopic:'delivery',knowledgeQuery:'shipping policy'}},
  {searchIntent:{...matchedIntent,replyBoundary:{salesAllowed:false,contactAllowed:false}}},
  {searchIntent:{...matchedIntent,productRequestState:{status:'selected'}}},
  {searchIntent:{...matchedIntent,scopeUnverified:true}},
  {searchIntent:{...matchedIntent,primarySearchVerified:false}},
  {knowledgeContext:knowledge},
  {knowledgeContext:{items:[],customerServiceIntent:true,customerServiceTopic:'delivery'}},
  {failedContracts:null},{failedContracts:'business_facts'},{failedContracts:{}},
  {orderActionCandidate:{}},{chatImageContext:{}},{guestBenefitContext:{}},
  {reviewStatus:'missing_fields'},
  {reviewResult:{...matched.reviewResult,confidence:.5,businessFactsSupported:undefined},failedContracts:['confidence','business_facts']},
]) check(!isGroundedCommerceRepairEligible({...matched,...patch}),'matched-caption correction cannot absorb unverified, different-site or mixed purposes');
const matchedBefore = JSON.stringify({intent:matchedIntent,products:matchedProducts});
let matchedCalls = 0;
const matchedFixed = await repairGroundedCommerceReply({...matched,config,language:'en',userText:'Which shirt would you choose?',requestText:async prompt=>{
  matchedCalls++; const packet=JSON.parse(prompt.messages[0].content);
  check(packet.matchedCatalogue.products[0].id==='matched-home' && packet.matchedCatalogue.products[0].name===matchedProducts[0].name,'caption correction receives finite actual matched products');
  check(!('url' in packet.matchedCatalogue.products[0]) && !('price' in packet.matchedCatalogue.products[0]),'caption repair does not invite price/link narration');
  check(prompt.systemPrompt.includes('subjective preference'),'style preferences are distinguished from unsupported product claims');
  return JSON.stringify({displayText:'I would lean towards the home style. Which look suits you?'});
}});
check(matchedCalls===1 && matchedFixed?.text.includes('home style'),'matched caption receives one fresh unapproved text candidate');
check(JSON.stringify({intent:matchedIntent,products:matchedProducts})===matchedBefore,'caption repair leaves cards and search permissions unchanged');
console.log('matched catalogue caption correction checks passed');

const matchedClock = {required:false,status:'not_required',asOfUtc:'2026-10-20T02:00:00.000Z',searched:false,items:[]};
const matchedFactual = {...matched,factualContext:matchedClock,reviewResult:{...matched.reviewResult,factualSupported:false},
  failedContracts:['factual','business_facts']};
check(isGroundedCommerceRepairEligible(matchedFactual),'a same-source matched caption may correct a clock-only incidental fact');
for(const factualContext of [null,{}, {...matchedClock,required:true},{...matchedClock,status:'matched'},
  {...matchedClock,searched:true},{...matchedClock,items:[{text:'public fact'}]},
  {...matchedClock,items:undefined},{...matchedClock,asOfUtc:'invalid'},{...matchedClock,searched:undefined}]) {
  check(!isGroundedCommerceRepairEligible({...matchedFactual,factualContext}),'only complete clock-only evidence permits this factual correction');
}
check(!isGroundedCommerceRepairEligible({...base,factualContext:matchedClock,failedContracts:['factual']}),'policy recovery never inherits the matched-caption factual exception');
const defaultMatchedTransport = async outcomes => {
  const calls=[],logs=[]; let diagnostic;
  const result=await repairGroundedCommerceReply({...matched,userText:'Which style would you choose?',recordLog:async event=>logs.push(event),
    recordDiagnostic:reason=>{diagnostic=reason;},fetchImpl:async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});const outcome=outcomes[calls.length-1];assert(outcome,'unexpected extra repair request');
      if(outcome.throw)throw outcome.throw;
      if(outcome.raw)return new Response(outcome.raw,{headers:{'Content-Type':'text/event-stream'}});
      if(outcome.status)return new Response(JSON.stringify({error:{message:'fixture provider failure'}}),{status:outcome.status});
      return new Response(JSON.stringify({choices:[{message:{content:outcome.text}}]}));
    }});
  return {result,calls,logs,diagnostic};
};
for(const first of [{throw:new Error('fetch failed')},{status:429},{status:402},{status:503},
  {text:''},{raw:'data: {"choices":[],"usage":{"completion_tokens":0}}\n\ndata: [DONE]\n\n'}]) {
  const reply=await defaultMatchedTransport([first,{text:JSON.stringify({displayText:'I would lean towards the home style. Which look suits you?'})}]);
  check(reply.calls.length===2 && Boolean(reply.result),'matched default transport failure uses a single different configured provider');
  check(new Set(reply.calls.map(call=>call.url+'|'+call.body.model)).size===2,'matched transport fallback never repeats an endpoint/model');
  check(reply.logs.map(event=>event.status).join(',')==='error,success','the actual successful provider is logged after a failed transport');
}
const bothFailed=await defaultMatchedTransport([{throw:new Error('fetch failed')},{throw:new Error('fetch failed')}]);
check(!bothFailed.result && bothFailed.calls.length===2,'two failed repair transports terminate without a third provider');
for(const text of [JSON.stringify({displayText:null}),'malformed semantic JSON',JSON.stringify({displayText:42}),JSON.stringify({displayText:'[happy] Invented repair'}),JSON.stringify({displayText:matched.replyResult.text})]) {
  const reply=await defaultMatchedTransport([{text}]);
  check(!reply.result && reply.calls.length===1,'valid null or semantic/quality/no-change rejection never shops for another repair candidate');
}
let isolatedRequests=0;
const isolatedMatched=await repairGroundedCommerceReply({...matched,config,requestText:async()=>{isolatedRequests++;throw new Error('fetch failed');}});
check(isolatedMatched===null && isolatedRequests===1,'an explicit config/requestText override keeps one isolated provider');
console.log('matched clock-only factual and finite transport fallback regressions passed');

const unauthorizedRepair=await defaultMatchedTransport([{status:401}]);
check(!unauthorizedRepair.result && unauthorizedRepair.calls.length===1,'authorization failures remain terminal in matched repair');
let timedMatchedCalls=0,firstSignal;
const independentRepairBudget=await repairGroundedCommerceReply({...matched,timeoutMs:25,recordLog:async()=>{},fetchImpl:async(_url,{signal})=>{
  timedMatchedCalls++;
  if(timedMatchedCalls===1){firstSignal=signal;await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('fixture body aborted'),{name:'AbortError'})),{once:true}));}
  check(signal!==firstSignal && !signal.aborted,'the second repair transport receives its own live deadline');
  await new Promise(resolve=>setTimeout(resolve,10));
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({displayText:'I would lean towards the home style. Which look suits you?'})}}]}));
}});
check(timedMatchedCalls===2 && firstSignal.aborted && Boolean(independentRepairBudget),'an exhausted first repair timeout cannot starve the independently bounded backup');
console.log('matched repair independent deadlines and HTTP authority regression passed');
let explicitConfigCalls=0, legacyPolicyCalls=0;
const savedRepairFetch=globalThis.fetch;
try {
  globalThis.fetch=async()=>{explicitConfigCalls++;throw new Error('fetch failed');};
  const explicitOnly=await repairGroundedCommerceReply({...matched,config,recordLog:async()=>{}});
  check(explicitOnly===null && explicitConfigCalls===1,'an explicit config alone never reaches configured repair backups');
  globalThis.fetch=async()=>{legacyPolicyCalls++;throw new Error('fetch failed');};
  const legacyPolicy=await repairGroundedCommerceReply({...base,recordLog:async()=>{}});
  check(legacyPolicy===null && legacyPolicyCalls===1,'ordinary policy default repair remains a single-provider request');
} finally {globalThis.fetch=savedRepairFetch;}
let injectedOnlyCalls=0;
const injectedOnly=await repairGroundedCommerceReply({...matched,requestText:async()=>{injectedOnlyCalls++;throw new Error('fetch failed');}});
check(injectedOnly===null && injectedOnlyCalls===1,'requestText injection alone never reaches configured repair backups');
console.log('matched repair override isolation and legacy single-provider regression passed');

// A real server order entry is compatible with one read-only diagnostic reply
// when no product or public-fact search is in play, including unavailable KB.
const orderDiagnostic = { ...base, userText: 'The quoted tracking status has stayed unchanged for six days.',
 searchIntent: { ...base.searchIntent, commerceTopic: 'delivery' },
 orderActionCandidate: { kind: 'ttmall_order_lookup', status: 'login_required', siteSlug: 'shop' },
 factualContext: { required: false, status: 'not_required', searched: false, items: [], asOfUtc: '2026-10-22T00:00:00Z' },
 knowledgeContext: { strategy: 'business_selection_unavailable', items: [], selectionFailure: { stage: 'evidence', kind: 'protocol_shape' } },
 failedContracts: ['language', 'factual', 'guidance', 'business_facts'],
 reviewResult: { allowed: false, confidence: .99, boundarySupported: true, factualSupported: false, guidanceSupported: false,
  businessFactsSupported: false, languageQualitySupported: false },
};
check(isGroundedCommerceRepairEligible(orderDiagnostic), 'mixed language/business rejection may use the existing one diagnostic correction with a real order entry');
for (const patch of [
 { orderActionCandidate: {} }, { orderActionCandidate: { kind: 'ttmall_order_lookup', status: 'completed' } },
 { factualContext: { ...orderDiagnostic.factualContext, required: true } },
 { factualContext: { ...orderDiagnostic.factualContext, searched: true } },
 { factualContext: { ...orderDiagnostic.factualContext, items: [{}] } }, { factualContext: null },
 { productContext: { products: [{ id: 'one' }] } }, { chatImageContext: {} }, { guestBenefitContext: {} },
 { feedbackActionCandidate: {} }, { groundedRepairAttempted: true }, { languageRepairAttempted: true },
]) check(!isGroundedCommerceRepairEligible({ ...orderDiagnostic, ...patch }), 'diagnostic order correction retains original product/action/public-fact and finite-reentry limits');
let orderDiagnosticCalls = 0;
const correctedOrderDiagnostic = await repairGroundedCommerceReply({ ...orderDiagnostic, config, language: 'en', requestText: async prompt => {
 orderDiagnosticCalls++;
 assert.match(prompt.systemPrompt, /technically unavailable/);
 assert.match(prompt.systemPrompt, /not a successful empty search/);
 assert.match(prompt.systemPrompt, /conditional definition/);
 assert.match(prompt.systemPrompt, /waiting or pending.*not.*(started|underway)/i);
 assert.match(prompt.systemPrompt, /server will append a real order action/i);
 const packet = JSON.parse(prompt.messages[0].content);
 assert.equal(packet.orderActionState, 'login_required');
 assert.equal(packet.knowledge.length, 0);
 return JSON.stringify({ displayText: 'That quoted status usually means waiting for review or release; it does not confirm a review has started or a release date. Use the supplied order entry to view your order.' });
} });
check(orderDiagnosticCalls === 1 && correctedOrderDiagnostic?.sourceType === 'ai', 'only a fresh unapproved text candidate is created; no order lookup or action mutation');
assert.equal(orderDiagnostic.orderActionCandidate.status, 'login_required');
console.log('read-only order diagnostic correction eligibility, bounded evidence, source failure and action-preservation checks passed');

// A source-owned unconfirmed candidate may advance transport/protocol only;
// explicit test/provider overrides and valid semantic null remain terminal.
const { markCandidateContextSource } = await import('../server/product-candidate-source-proof.js');
const transportCandidate = { ...candidate, character: { ...candidate.character, id: 'owned-role', site_id: 'owned-site' },
 replyResult: { ...candidate.replyResult, aiModel: 'fixture-generator' },
 productContext: { ...candidate.productContext, siteId: 'owned-site', sourceType: 'product_api', searchIntent: candidate.searchIntent,
  candidateContext: { ...candidate.productContext.candidateContext } } };
markCandidateContextSource(transportCandidate.productContext.candidateContext, transportCandidate.searchIntent,
 transportCandidate.productContext.products, { siteId: 'owned-site', characterId: 'owned-role' });
const candidateTransport = async (sequence, extra = {}) => {
 const models = [];
 const result = await repairGroundedCommerceReply({ ...transportCandidate, language: 'en', userText: 'Show the candidate.',
  recordLog: async () => {}, ...extra, fetchImpl: async (_url, options) => {
   models.push(JSON.parse(options.body).model);
   const output = sequence[Math.min(models.length - 1, sequence.length - 1)];
   if (output instanceof Error) throw output;
   return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  } });
 return { models, result };
};
const freshCandidate = { displayText: 'This could be the shirt you mean, but its sleeve detail remains unconfirmed. Is this the one?' };
for (const first of [Object.assign(new Error('timeout'), { code: 'AI_REPLY_TIMEOUT' }), {}, { displayText: 12 }]) {
 const recovered = await candidateTransport([first, freshCandidate]);
 assert.deepEqual(recovered.models, ['fixture-second', 'fixture-third']);
 assert.equal(recovered.result.text, freshCandidate.displayText);
 assert.equal(recovered.result.candidateEvidenceVerified, undefined, 'a correction never inherits card approval');
}
const exhaustedCandidate = await candidateTransport([new Error('fetch failed')]);
assert.equal(exhaustedCandidate.models.length, 2); assert.equal(exhaustedCandidate.result, null);
const nullCandidate = await candidateTransport([{ displayText: null }, freshCandidate]);
assert.equal(nullCandidate.models.length, 1); assert.equal(nullCandidate.result, null);
let explicitCandidateCalls = 0;
for (const terminalText of ['', transportCandidate.replyResult.text]) {
 const terminalCandidate = await candidateTransport([{ displayText: terminalText }, freshCandidate]);
 assert.equal(terminalCandidate.models.length, 1); assert.equal(terminalCandidate.result, null);
}
const explicitCandidate = await candidateTransport([{}, freshCandidate], { config, requestText: async () => { explicitCandidateCalls++; return '{}'; } });
assert.equal(explicitCandidateCalls, 1); assert.equal(explicitCandidate.models.length, 0); assert.equal(explicitCandidate.result, null);
const unprovedCandidate = await candidateTransport([{}, freshCandidate], { productContext: JSON.parse(JSON.stringify(transportCandidate.productContext)) });
assert.equal(unprovedCandidate.models.length, 0, 'loss of source proof cannot enter the finite fetchImpl transport chain');
assert.equal(unprovedCandidate.result, null);
console.log('Trusted candidate correction finite transport/protocol fallback, original reviewer order and terminal/null/override isolation passed');

const { resolveReplyRepairBudget, GROUNDED_COMMERCE_REPAIR_TIMEOUT_MS } = await import('../server/chat-reply-review-outcome.js');
const { recoverReviewedLanguageReply } = await import('../server/chat-reply-language-recovery-service.js');
assert.equal(GROUNDED_COMMERCE_REPAIR_TIMEOUT_MS, 30000);
assert.equal(resolveReplyRepairBudget(99999), 15000);
assert.equal(resolveReplyRepairBudget(99999, 'unknown'), 15000);
assert.equal(resolveReplyRepairBudget(99999, 'grounded_commerce'), 30000);
assert.equal(resolveReplyRepairBudget(8000, 'grounded_commerce'), 8000);
for (const [repairScope, expected] of [['',15000], ['grounded_commerce',30000], ['unknown',15000]]) {
 let actual;
 await recoverReviewedLanguageReply({ repairScope, repairTimeoutMs: 60000,
  repairLanguageReply: async input => { actual = input; return null; } });
 assert.equal(actual.timeoutMs, expected); assert.equal(actual.repairScope, repairScope);
}
console.log('Scoped grounded 30s correction and unchanged generic 15s recovery ceilings passed');

for (const options of [{ ...base }, { ...base, repairScope: 'grounded_commerce', timeoutMs: 60000 }]) {
 let policyTimeout;
 await repairGroundedCommerceReply({ ...options, config: { ...config, timeoutMs: 120000 }, language: 'en', userText: 'Policy?',
  requestText: async (_prompt, request) => { policyTimeout = request.timeoutMs; return JSON.stringify({ displayText: 'The estimate applies only to region A.' }); } });
 assert.equal(policyTimeout, 15000, 'non-product policy correction cannot acquire the product budget, even with an explicit scope');
}
let scopedCandidateTimeout;
await repairGroundedCommerceReply({ ...transportCandidate, config: { ...config, timeoutMs: 120000 }, language: 'en', userText: 'Show the candidate.',
 requestText: async (_prompt, request) => { scopedCandidateTimeout = request.timeoutMs; return JSON.stringify(freshCandidate); } });
assert.equal(scopedCandidateTimeout, 30000, 'direct eligible candidate correction defaults to product budget');
console.log('Direct policy corrections retain 15s and eligible candidate corrections use 30s without global expansion');
