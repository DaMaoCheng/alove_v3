import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('No network in private batch3 draft checks'); };
const { normalizeCommerceDecision } = await import('../server/product-intent-classifier-service.js');
const { buildProductSearchIntent } = await import('../server/product-intent-service.js');
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { enforceReplyBoundary, needsBusinessFactsReview } = await import('../server/chat-reply-boundary-service.js');
const { buildCommerceDecisionLogEvent } = await import('../server/ai-reply-log-service.js');
const passed = { allowed: true, confidence: .98, factualSupported: true, boundarySupported: true, languageQualitySupported: true,
  guidanceSupported: true, businessFactsSupported: true, evidenceSupported: true, productScopeSupported: true, checkoutProblem: false };
const clock = { required: false, status: 'not_required', asOfUtc: '2026-10-20T10:00:00Z', searched: false, items: [] };
const results=[];
async function test(name,run) { try { await run(); results.push({name,pass:true}); } catch(error) { results.push({name,pass:false,error:error.message}); } }
const userText='La del paris st de dior';
const intent=await resolveCommerceSearchIntent({ userText, enrichAllTurns:true,
  classifyCommerce:async()=>({ route:'product_search', topic:'other', confidence:.7, confident:false }) });
const specific='¿La buscas para adulto o para niño?';
const options={searchIntent:intent,userText,replyResult:{sourceType:'ai',text:specific,speechText:specific},character:{id:'mascot_fixture',categoryId:'mascot'},
  factualContext:clock,language:'es',languageQualityRequired:true,independentLanguageQualityRequired:true,
  assess:async()=>passed,assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.98,languageQualitySupported:true,languageIssues:[]}),recordReview:async()=>{}};
await test('A fully reviewed relevant clarification is not replaced by a generic prewritten question',async()=>{
 const output=await enforceReplyBoundary(options); assert.equal(output.text,specific); assert.equal(output.speechText,specific);
 assert.equal(output.sourceType,'ai'); assert.equal(intent.cardAllowed,false); assert.equal(intent.shouldLoadProductContext,false);
});
await test('Rejected merchandise text gets exactly one fresh candidate and a full second review',async()=>{
 let reviews=0,generations=0;
 const output=await enforceReplyBoundary({...options,replyResult:{sourceType:'ai',text:'Buy Barcelona or Miami!',speechText:'Buy Barcelona or Miami!'},
  assess:async()=>++reviews===1?{...passed,allowed:false,boundarySupported:false}:passed,
  regenerateReply:async(_old,recovery)=>{ assert.equal(recovery.purpose,'product_clarification');generations++;return{sourceType:'ai',text:specific,speechText:specific}; }});
 assert.equal(reviews,2);assert.equal(generations,1);assert.equal(output.text,specific);assert.equal(output.speechText,specific);
});
await test('A rejected second candidate cannot leak either proposal or enable actions',async()=>{
 let reviews=0,generations=0;
 const output=await enforceReplyBoundary({...options,replyResult:{sourceType:'ai',text:'OLD_UNAPPROVED Buy Barcelona!',speechText:'OLD_UNAPPROVED Buy Barcelona!'},
  assess:async()=>{reviews++;return{...passed,allowed:false,boundarySupported:false};},
  regenerateReply:async()=>{generations++;return{sourceType:'ai',text:'NEW_UNAPPROVED Buy Miami!',speechText:'NEW_UNAPPROVED Buy Miami!'};}});
 assert.equal(generations,1);assert.equal(reviews,2);assert(!output.text.includes('UNAPPROVED'));assert.equal(output.speechText,output.text);
 assert.equal(intent.cardAllowed,false);assert.equal(intent.shouldLoadProductContext,false);assert.equal(intent.replyBoundary.contactAllowed,false);
 assert.equal(output.productScopeVerified,false);assert(!output.verifiedDiscountOffers?.length);
});
await test('Weak valid price question retains read-only policy purpose, never actions',async()=>{
 const text='Why it says the price is 19 and when you open it is 36?';
 const normalized=normalizeCommerceDecision({route:'store_policy',topic:'price',knowledgeScope:'business',knowledgeQuery:text,answerRequired:true,confidence:.72,
  replyBoundary:{salesAllowed:true,contactAllowed:true}}, {userText:text,requireBoundaryVerdict:true});
 assert.equal(normalized.confident,false);assert.equal(normalized.answerRequired,false);assert.equal(normalized.replyBoundary.salesAllowed,false);
 const weak=await resolveCommerceSearchIntent({userText:text,enrichAllTurns:true,classifyCommerce:async()=>normalized});
 assert.equal(weak.commerceRoute,'unclear');assert.equal(weak.knowledgeScope,'business');assert.equal(weak.knowledgeQuery,text);
 assert.equal(weak.replyTopicHint,'commerce_question');assert.equal(weak.cardAllowed,false);assert.equal(weak.shouldLoadProductContext,false);
 assert.equal(weak.replyBoundary.salesAllowed,false);assert.equal(weak.replyBoundary.contactAllowed,false);
 assert.equal(needsBusinessFactsReview(weak,{categoryId:'mascot'}),true);
 const event=JSON.parse(buildCommerceDecisionLogEvent({searchIntent:weak}).errorMessage);assert.equal(event.replyTopicHint,'commerce_question');
});
await test('Transport failure preserves an already-known read-only business question without calling it ambiguity',async()=>{
 const original='When will i get delivery for jersey in Fresno, California USA if i order today';
 const localIntent=buildProductSearchIntent(original); assert.equal(localIntent.customerServiceKnowledgeRequest,true);
 const weak=await resolveCommerceSearchIntent({userText:original,enrichAllTurns:true,
  searchIntent:localIntent,classifyCommerce:async()=>({commerceClassificationFailure:'timeout'})});
 assert.equal(weak.commerceClassificationFailure,'timeout');assert.equal(weak.knowledgeScope,'business');assert.equal(weak.customerServiceKnowledgeRequest,true);
 assert.equal(weak.replyBoundaryReason,'');assert.equal(weak.replyTopicHint,'');assert.equal(weak.cardAllowed,false);assert.equal(weak.shouldLoadProductContext,false);
});
await test('A failed classifier with no known business purpose does not gain business knowledge access',async()=>{
 const weak=await resolveCommerceSearchIntent({userText:'Something ambiguous',enrichAllTurns:true,classifyCommerce:async()=>({commerceClassificationFailure:'timeout'})});
 assert.notEqual(weak.knowledgeScope,'business');assert.equal(weak.cardAllowed,false);assert.equal(weak.shouldLoadProductContext,false);
});
await test('Business retrieval keeps the actual latest question primary and current-site access unchanged',async()=>{
 const {retrieveKnowledgeSections}=await import('../server/knowledge-retrieval-service.js');let selections=0,reads=0;
 const original='Porqué mi paquete lleva 3 días sin actualizarse?';
 const db={execute:async(sql,params)=>{reads++;assert(sql.trim().startsWith('SELECT'));assert(params.includes('shop'));
  return[[{knowledge_base_id:'kb_shop',knowledge_base_label:'Shop policy',category:'customer_service',scope:'site',site_id:'shop',priority:1,
   section_id:'shipping',section_key:'shipping',title:'Shipping',summary:'Source policy',content:'Processing normally takes 1 to 3 business days.',keywords_json:'[]',fuzzy_keywords_json:'[]',base_keywords_json:'[]',base_fuzzy_keywords_json:'[]',display_order:1}]];}};
 const output=await retrieveKnowledgeSections({db,query:original,knowledgeScope:'business',knowledgeQuery:'Why no tracking update for a week?',siteId:'shop',characterId:'mascot_fixture',
  selectBusinessReferences:async input=>{selections++;assert(input.query.startsWith('CURRENT user message (primary): '+original));assert(input.query.includes('never overrides current numbers'));
   assert.equal(input.siteId,'shop');assert.equal(input.sections.length,1);return{items:[],reason:'business_no_verified_answer'};}});
 assert.equal(reads,1);assert.equal(selections,1);assert.equal(output.customerServiceIntent,true);assert.equal(output.items.length,0);
});
await test('Grounded correction anchors the actual current user report instead of the rejected proposal',async()=>{
 const {repairGroundedCommerceReply}=await import('../server/chat-grounded-reply-repair-service.js');
 const original='Porqué mi paquete lleva 3 días sin actualizarse?';
 let calls=0;
 const output=await repairGroundedCommerceReply({character:{id:'mascot_fixture',category_id:'mascot'},userText:original,
  recentMessages:[{senderType:'user',text:'The carrier name was not shown.'}],language:'es',
  replyResult:{sourceType:'ai',sourceRef:'fixture',text:'Tracking is normally quiet the first week.'},
  searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business',answerRequired:true,replyBoundary:{salesAllowed:false,contactAllowed:false},cardAllowed:false,shouldLoadProductContext:false,needsLiveProductData:false},
  knowledgeContext:{strategy:'business_verified_reference',items:[{id:'policy',content:'Processing normally takes 1 to 3 business days.',evidenceQuote:'Processing normally takes 1 to 3 business days.'}]},
  reviewStatus:'valid',reviewResult:{allowed:false,boundarySupported:true,businessFactsSupported:false,confidence:.99},failedContracts:['business_facts'],
  config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},recordLog:async()=>{},
  requestText:async prompt=>{calls++;assert(prompt.systemPrompt.includes('Proposed text is a REJECTED candidate, never evidence or a user claim'));
   const input=JSON.parse(prompt.messages[0].content);assert.equal(input.latestUserMessage,original);assert.equal(input.recentUserMessages[0],'The carrier name was not shown.');
   assert(!prompt.systemPrompt.includes('This candidate has only a diagnostic wording purpose'));assert.equal(input.knowledge[0].id,'policy');
   return JSON.stringify({displayText:'Entiendo que llevas 3 días sin novedades. Solo puedo confirmar el plazo de procesamiento indicado en la política.'});}});
 assert.equal(calls,1);assert(output.text.includes('3 días'));assert(!output.text.includes('week'));
});
await test('Empty successful business evidence permits one specific clarification with complete second review',async()=>{
 const {isGroundedCommerceRepairEligible,repairGroundedCommerceReply}=await import('../server/chat-grounded-reply-repair-service.js');
 const original='Why it says the price is 19 and when you open it is 36?';
 const weakDecision=normalizeCommerceDecision({route:'store_policy',topic:'price',knowledgeScope:'business',knowledgeQuery:original,answerRequired:true,confidence:.72,
  replyBoundary:{salesAllowed:true,contactAllowed:true}}, {userText:original,requireBoundaryVerdict:true});
 const resolved=await resolveCommerceSearchIntent({userText:original,searchIntent:buildProductSearchIntent(original),siteId:'shop',characterId:'mascot_fixture',enrichAllTurns:true,classifyCommerce:async()=>weakDecision});
 const base={character:{id:'mascot_fixture',category_id:'mascot'},userText:original,language:'en',
  replyResult:{sourceType:'ai',sourceRef:'fixture',text:'OLD_UNAPPROVED: the actual cause is customization.',speechText:'OLD_UNAPPROVED: the actual cause is customization.'},
  searchIntent:resolved,
  knowledgeContext:{customerServiceIntent:true,strategy:'business_no_verified_answer',items:[]},
  reviewStatus:'valid',reviewResult:{...passed,allowed:false,guidanceSupported:false,businessFactsSupported:false},failedContracts:['guidance','business_facts']};
 assert.notEqual(resolved.scopeUnverified,true);assert.notEqual(resolved.productScopePending,true);
 assert(isGroundedCommerceRepairEligible(base));
 const pending={version:1,status:'pending',siteId:'shop',characterId:'mascot_fixture',
  items:[{evidence:'Arsenal shirt',sharedEvidence:'',text:'Arsenal shirt'},{evidence:'Chelsea shirt',sharedEvidence:'',text:'Chelsea shirt'}],selectedIndex:null,clarificationCount:1};
 const candidate={version:1,status:'active',siteId:'shop',characterId:'mascot_fixture',owner:'single',targetEvidence:'Arsenal shirt',
  requirements:{requestedTeam:'Arsenal',requestedProductType:'shirt'},suspectedTerm:null,proposal:null};
 const {readProductRequestState}=await import('../server/product-request-scope-service.js');
 for(const changed of [
  {recentMessages:[{senderType:'character',productRequestState:pending}]},
  {recentMessages:[{senderType:'character',productRequestState:{...pending,status:'selected',selectedIndex:0}}]},
  {searchIntent:{...buildProductSearchIntent(original),productRequestState:pending}},
 ]){
  if(changed.recentMessages?.[0].productRequestState)assert(readProductRequestState(changed.recentMessages,{siteId:'shop',characterId:'mascot_fixture'}));
  const scoped=await resolveCommerceSearchIntent({userText:original,searchIntent:buildProductSearchIntent(original),siteId:'shop',characterId:'mascot_fixture',enrichAllTurns:true,classifyCommerce:async()=>weakDecision,...changed});
  assert.equal(scoped.scopeUnverified,true);assert.equal(scoped.productScopePending,true);
  assert.equal(isGroundedCommerceRepairEligible({...base,searchIntent:scoped}),false,'A real existing product scope must not gain the empty-business correction');
 }
 const cleared={version:1,status:'cleared',siteId:'shop',characterId:'mascot_fixture',items:[],selectedIndex:null,clarificationCount:0};
 for(const patch of [
  {recentMessages:[{senderType:'character',productRequestState:cleared}]},
  {recentMessages:[{senderType:'character',productRequestState:{...cleared,siteId:'different-site'}}]},
  {decision:{...weakDecision,productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''}}},
  {decision:{...weakDecision,productRequest:{relation:'unclear',action:'cancel',items:[],selectedIndex:null,selectionEvidence:'cancel'}}},
 ]){
  const kept=await resolveCommerceSearchIntent({userText:original,searchIntent:{...buildProductSearchIntent(original),productRequestState:pending},siteId:'shop',characterId:'mascot_fixture',enrichAllTurns:true,
   recentMessages:patch.recentMessages||[],classifyCommerce:async()=>patch.decision||weakDecision});
  assert(!['pending','selected'].includes(kept.productRequestState?.status),'A newer scope boundary or current reset must not resurrect old input state');assert.equal(kept.cardAllowed,false);
 }
 const crossSite=await resolveCommerceSearchIntent({userText:original,searchIntent:{...buildProductSearchIntent(original),productRequestState:{...pending,siteId:'other'}},siteId:'shop',characterId:'mascot_fixture',enrichAllTurns:true,classifyCommerce:async()=>weakDecision});
 assert(!['pending','selected'].includes(crossSite.productRequestState?.status),'Cross-site input state cannot be revived');
 for(const patch of [
  {searchIntent:{...base.searchIntent,commerceClassificationFailure:'timeout'}},
  {searchIntent:{...base.searchIntent,cardAllowed:true}},
  {searchIntent:{...base.searchIntent,humanHandoff:{explicitRequest:true}}},
  {productContext:{products:[{id:'existing'}]}}, {chatImageContext:{}},
  {orderActionCandidate:{kind:'ttmall_order_lookup',siteSlug:'fixture',status:'login_required'}},
 ])assert.equal(isGroundedCommerceRepairEligible({...base,...patch}),false,'mixed/action/failure scope cannot gain this diagnostic correction: '+JSON.stringify(patch));
 for(const rejectSecond of [false,true]){
  let corrections=0,reviews=0;const repairDiagnostics=[];const fresh='You are seeing 19 before opening it and 36 afterwards. Can you share the product page?';
  const out=await enforceReplyBoundary({...base,factualContext:clock,languageQualityRequired:true,independentLanguageQualityRequired:true,
   assess:async()=>{reviews++;return reviews===1||rejectSecond?{...passed,allowed:false,guidanceSupported:false,businessFactsSupported:false}:passed;},
   assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.98,languageQualitySupported:true,languageIssues:[]}),
   regenerateReply:async()=>{throw Error('This business correction cannot use an ordinary conversation regeneration');},
   repairGroundedReply:async input=>{corrections++;return repairGroundedCommerceReply({...input,recordDiagnostic:reason=>repairDiagnostics.push(reason),config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},recordLog:async()=>{},
    requestText:async prompt=>{assert(prompt.systemPrompt.includes('Do not explain, guess or list possible causes for this store'));
     assert(prompt.systemPrompt.includes('not already supplied'));assert.equal(JSON.parse(prompt.messages[0].content).latestUserMessage,original);
     return JSON.stringify({displayText:fresh});}});},recordReview:async()=>{}});
  assert.equal(corrections,1);assert.equal(reviews,2,JSON.stringify({repairDiagnostics,text:out.text}));assert.equal(out.text===fresh,!rejectSecond);assert.equal(out.speechText,out.text);
  assert(!out.text.includes('OLD_UNAPPROVED'));assert.equal(base.searchIntent.cardAllowed,false);assert.equal(base.searchIntent.shouldLoadProductContext,false);
  assert.equal(base.searchIntent.replyBoundary.contactAllowed,false);assert(!out.verifiedDiscountOffers?.length);
 }
});
await test('A weak exact URL sizing continuation retains its purpose through a complete fresh review',async()=>{
 const original='https://www.projerseyshop.es/productdetail/Retro-2002-03-Real-Madrid-Third-Away-Soccer-Jersey/666494';
 const recentMessages=[{senderType:'user',text:'camiseta, no sé que talla elegir'},{senderType:'character',text:'¿Prefieres corte entallado o más holgado?'}];
 const decision=normalizeCommerceDecision({route:'product_question',topic:'sizing',confidence:.6,knowledgeScope:'business',needsLiveProductData:true,
  searchQuery:'Retro 2002-03 Real Madrid Third Away Soccer Jersey',replyBoundary:{salesAllowed:true,contactAllowed:true}}, {userText:original,requireBoundaryVerdict:true});
 const weak=await resolveCommerceSearchIntent({userText:original,searchIntent:buildProductSearchIntent(original),recentMessages,siteId:'shop',characterId:'mascot_fixture',enrichAllTurns:true,classifyCommerce:async()=>decision});
 const {productClarificationContext,buildReplyPurposeRecoveryPrompt}=await import('../server/chat-reply-purpose-service.js');
 const context=productClarificationContext(weak,original);assert(context);assert.equal(weak.replyTopicHint,'sizing');assert.equal(context.currentUserMessage,original);
 assert.deepEqual(context.recentUserMessages,['camiseta, no sé que talla elegir']);
 const fresh='Para orientarte sobre la talla de la camiseta del enlace, ¿cuál es tu medida de pecho?';
 const periphery={knowledgeContext:{ok:true,strategy:'general_relevant_reference',customerServiceIntent:false,
  items:[{id:'general-football',category:'football',content:'General football history, never a garment size chart.'}]},
  factualContext:{...clock,required:true,status:'blocked',reason:'private_input',decisionSource:'lexical_fallback',webSearchScore:.07}};
 let reviews=0,generations=0;
 const out=await enforceReplyBoundary({...options,...periphery,userText:original,recentMessages,searchIntent:weak,
  replyResult:{sourceType:'ai',text:'OLD_UNAPPROVED: order XL, it will fit.',speechText:'OLD_UNAPPROVED: order XL, it will fit.'},
  assess:async input=>{assert.equal(input.factualRequired,true);assert.equal(input.productScopeRequired,true);return ++reviews===1?{...passed,allowed:false,factualSupported:false,productScopeSupported:false}:passed;},
  regenerateReply:async()=>{throw Error('Grounded diagnostic must not use ordinary generation');},
  repairGroundedReply:async input=>{generations++;const {repairGroundedCommerceReply}=await import('../server/chat-grounded-reply-repair-service.js');return repairGroundedCommerceReply({...input,config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},recordLog:async()=>{},requestText:async prompt=>{assert(prompt.systemPrompt.includes('Never confirm catalogue identity from the URL'));return JSON.stringify({displayText:fresh});}});}});
 assert.equal(reviews,2);assert.equal(generations,1);assert.equal(out.text,fresh);assert.equal(out.speechText,fresh);
 assert.equal(weak.shouldLoadProductContext,false);assert.equal(weak.cardAllowed,false);assert.equal(weak.replyBoundary.contactAllowed,false);
 for(const status of ['pending','selected']){
  const prior={version:1,status,siteId:'shop',characterId:'mascot_fixture',items:[{evidence:'Arsenal',sharedEvidence:'',text:'Arsenal'},{evidence:'Chelsea',sharedEvidence:'',text:'Chelsea'}],selectedIndex:status==='selected'?0:null,clarificationCount:1};
  const scoped=await resolveCommerceSearchIntent({userText:original,searchIntent:buildProductSearchIntent(original),recentMessages:[...recentMessages,{senderType:'character',productRequestState:prior}],siteId:'shop',characterId:'mascot_fixture',enrichAllTurns:true,classifyCommerce:async()=>decision});
  let called=0;await enforceReplyBoundary({...options,...periphery,userText:original,recentMessages,searchIntent:scoped,
   assess:async()=>({...passed,allowed:false,productScopeSupported:false}),regenerateReply:async()=>{called++;return{sourceType:'ai',text:fresh,speechText:fresh};}});
  assert.equal(called,0,'Real retained product ownership must not gain text recovery');assert.equal(scoped.productScopePending,true);
 }
});
await test('Closed clarification can reference an existing USER purpose without verifying benefits or account state',async()=>{
 const {buildReplyPurposeRecoveryPrompt,CLOSED_CLARIFICATION_RECOVERY_CONTRACT}=await import('../server/chat-reply-purpose-service.js');
 const prompt=buildReplyPurposeRecoveryPrompt({systemPrompt:'Fixture',layers:[]},{kind:'purpose',purpose:'clarification',failedContracts:['confidence']});
 assert(prompt.systemPrompt.includes('specific purpose already stated in recent USER messages'));
 assert(prompt.systemPrompt.includes('Prior assistant wording is not evidence'));
 assert(CLOSED_CLARIFICATION_RECOVERY_CONTRACT.includes('do not supply, promise or verify a discount, benefit, account state'));
 const text='ya lo registre',recentMessages=[{senderType:'user',text:'dame algun cupon no?'},{senderType:'character',text:'Register to view available benefits.'}];
 const decision=normalizeCommerceDecision({route:'chat',topic:'other',knowledgeScope:'general',confidence:.5,replyBoundary:{salesAllowed:true,contactAllowed:true}}, {userText:text,requireBoundaryVerdict:true});
 const weak=await resolveCommerceSearchIntent({userText:text,recentMessages,searchIntent:buildProductSearchIntent(text),enrichAllTurns:true,classifyCommerce:async()=>decision});
 const fresh='Entiendo que dices que ya te registraste. Sobre los cupones que mencionaste, ¿qué necesitas saber?';let reviews=0,generations=0;
 const out=await enforceReplyBoundary({...options,userText:text,recentMessages,searchIntent:weak,
  replyResult:{sourceType:'ai',text:'OLD_UNAPPROVED: your account has a valid coupon.',speechText:'OLD_UNAPPROVED: your account has a valid coupon.'},
  assess:async()=>++reviews===1?{...passed,allowed:false,confidence:.5}:passed,
  regenerateReply:async(_old,recovery)=>{generations++;assert.equal(recovery.purpose,'clarification');return{sourceType:'ai',text:fresh,speechText:fresh};}});
 assert.equal(reviews,2);assert.equal(generations,1);assert.equal(out.text,fresh);assert.equal(out.speechText,fresh);
 assert.equal(weak.cardAllowed,false);assert.equal(weak.shouldLoadProductContext,false);assert.equal(weak.replyBoundary.contactAllowed,false);assert(!out.verifiedDiscountOffers?.length);
});
for(const row of results)console.log(JSON.stringify(row));
assert(results.every(row=>row.pass),'Commerce reply purpose checks did not pass');
