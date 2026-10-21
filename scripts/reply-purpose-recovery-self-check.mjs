import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('No network in reply purpose regression');};
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const {resolveCommerceSearchIntent,applyCommerceQuestionPromptPolicy}=await import('../server/commerce-routing-service.js');
const passed={allowed:true,confidence:.98,factualSupported:true,boundarySupported:true,languageQualitySupported:true,guidanceSupported:true,businessFactsSupported:true,evidenceSupported:true,productScopeSupported:true};
const tests=[];
const test=async(name,fn)=>{try{await fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:e.message});}};
await test('A context-specific merchandise clarification is preserved after complete approval',async()=>{
 const userText='Help me choose two shirts with my requirements';
 const searchIntent=await resolveCommerceSearchIntent({userText,enrichAllTurns:true,classifyCommerce:async()=>({route:'product_search',topic:'other',confidence:.7,confident:false})});
 const text='¿De qué temporada buscas las camisetas?';
 const base={searchIntent,userText,replyResult:{sourceType:'ai',text,speechText:text},language:'es',character:{id:'mascot_fixture',categoryId:'mascot'},
  factualContext:{required:false,status:'not_required',searched:false,items:[]},languageQualityRequired:true,independentLanguageQualityRequired:true,
  assess:async input=>{assert.equal(input.text,text);return{...passed,checkoutProblem:false};},
  assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.98,languageQualitySupported:true,languageIssues:[]}),recordReview:async()=>{}};
 const out=await enforceReplyBoundary(base);
 assert.equal(out.text,text);assert.equal(out.speechText,text);assert.equal(out.sourceType,'ai');
 assert.equal(searchIntent.cardAllowed,false);assert.equal(searchIntent.shouldLoadProductContext,false);assert.equal(searchIntent.replyBoundary.contactAllowed,false);
 // Other active purposes and verified facts retain their original complete review.
 for(const patch of [{chatImageContext:{}},{orderActionCandidate:{}},{feedbackActionCandidate:{}},{guestBenefitContext:{}},
  {factualContext:{required:true,status:'available',searched:true,items:[{id:'fact'}]}},
  {knowledgeContext:{customerServiceIntent:true,items:[{id:'policy'}]}},
  {knowledgeContext:{customerServiceIntent:false,items:[{id:'offside-rule'}]},searchIntent:{...searchIntent,knowledgeScope:'general'}},
  {searchIntent:{...searchIntent,answerRequired:true,knowledgeScope:'business'}},
  {searchIntent:{...searchIntent,productRequestState:{status:'selected'}}}]){
   const {isPureProductClarification}=await import('../server/chat-reply-purpose-service.js');
   assert.equal(isPureProductClarification({...base,...patch}),false,JSON.stringify(patch));
 }
});
await test('Marketing rejection gets one fresh contextual question and full re-review, or safe fallback',async()=>{
 const userText='Help me choose shirts';
 const searchIntent=await resolveCommerceSearchIntent({userText,enrichAllTurns:true,classifyCommerce:async()=>({route:'product_search',topic:'other',confidence:.7,confident:false})});
 for(const rejectSecond of [false,true]){
  let reviews=0,generations=0;const replacement='¿Qué temporada buscas?';
  const out=await enforceReplyBoundary({searchIntent,userText,replyResult:{sourceType:'ai',text:'Unapproved marketing: buy Barcelona!',speechText:'Unapproved marketing: buy Barcelona!'},
   character:{id:'mascot_fixture',categoryId:'mascot'},language:'es',factualContext:{required:false,status:'not_required',searched:false,items:[]},
   languageQualityRequired:true,independentLanguageQualityRequired:true,
   assess:async input=>{reviews++;assert.equal(input.boundary.salesAllowed,false);assert.equal(input.boundary.contactAllowed,false);
    if(reviews===1)assert(input.text.startsWith('Unapproved marketing:'));
    return{...passed,checkoutProblem:false,...(reviews===1||rejectSecond?{allowed:false,boundarySupported:false}:{})};},
   assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.98,languageQualitySupported:true,languageIssues:[]}),
   regenerateReply:async(_old,recovery)=>{generations++;assert.equal(recovery.purpose,'product_clarification');return{sourceType:'ai',text:replacement,speechText:replacement};},recordReview:async()=>{}});
  assert.equal(generations,1);assert.equal(reviews,2);assert(!out.text.includes('Unapproved marketing:'));assert.equal(out.text,out.speechText);
  assert.equal(out.text===replacement,!rejectSecond);assert.equal(searchIntent.cardAllowed,false);assert.equal(searchIntent.shouldLoadProductContext,false);
  assert.equal(searchIntent.replyBoundary.contactAllowed,false);assert(!out.verifiedDiscountOffers?.length);
 }
});
await test('Tentative merchandise purpose survives without restoring actions',async()=>{
 const userText='Can you help me choose shirts?';
 const intent=await resolveCommerceSearchIntent({userText,enrichAllTurns:true,classifyCommerce:async()=>({route:'product_search',topic:'other',confidence:.7,confident:false})});
 assert.equal(intent.replyTopicHint,'product_selection');
 assert.equal(intent.shouldLoadProductContext,false);assert.equal(intent.cardAllowed,false);assert.equal(intent.replyBoundary.contactAllowed,false);
 const prompt=applyCommerceQuestionPromptPolicy({systemPrompt:'Original character voice'},intent);
 assert(prompt.systemPrompt.includes('Original character voice'));assert(prompt.systemPrompt.includes('clarification'));
});
await test('Ordinary conversation rejection regenerates the answer once',async()=>{
 let reviews=0,regenerations=0;const replacement='Az ALOVE egy AI-beszélgetőfelület. Lilla vagyok, itt beszélgethetünk.';
 const out=await enforceReplyBoundary({character:{id:'mascot_purpose_check',categoryId:'mascot',name:'Lilla',roleTitle:'AI companion'},userText:'Mi ez az alove',language:'hu',searchIntent:{commerceRoute:'chat',knowledgeScope:'general'},
  factualContext:{required:false,status:'not_required',asOfUtc:'2026-10-19T08:00:00.000Z',timeZone:'UTC',items:[],searched:false},
  replyResult:{sourceType:'ai',text:'The current championship has already ended.',speechText:'The current championship has already ended.'},
  independentLanguageQualityRequired:true,languageQualityRequired:true,
  assess:async()=>++reviews===1?{...passed,allowed:false,factualSupported:false}:passed,
  assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.98,languageQualitySupported:true,languageIssues:[]}),
  regenerateReply:async()=>{regenerations++;return{sourceType:'ai',text:replacement,speechText:replacement};},recordReview:async()=>{}});
 assert.equal(regenerations,1);assert.equal(reviews,2);assert.equal(out.text,replacement);assert.equal(out.speechText,replacement);
});
for(const t of tests)console.log(`${t.passed?'PASS':'FAIL'} ${t.name}${t.error?': '+t.error:''}`);
assert(tests.every(t=>t.passed),'Reply purpose regression failures');
const {isConversationReplyRecoveryEligible,productClarificationContext,buildReplyPurposeRecoveryPrompt}=await import('../server/chat-reply-purpose-service.js');
const {buildTrustedCharacterIdentity,normalizeCharacter,TRUSTED_IDENTITY_CONTRACT}=await import('../server/chat-prompt-utils.js');
const {buildPersonaLayer}=await import('../server/chat-prompt-layers.js');
const {buildCommerceDecisionLogEvent,buildReplyReviewLogEvent}=await import('../server/ai-reply-log-service.js');
const clock={required:false,status:'not_required',asOfUtc:'2026-10-19T08:00:00.000Z',timeZone:'UTC',items:[],searched:false};
const eligible={replyResult:{sourceType:'ai',text:'A candidate'},searchIntent:{commerceRoute:'chat',knowledgeScope:'general'},factualContext:clock,
 reviewResult:passed,reviewStatus:'valid',failedContracts:['factual'],contracts:['factual','language'],
 languageAssessment:{reviewStatus:'valid',confidence:.98,languageQualitySupported:true,languageIssues:[]},regenerateReply:async()=>null};
assert(isConversationReplyRecoveryEligible(eligible));
for(const patch of [
 {factualContext:{...clock,required:true}}, {factualContext:{...clock,searched:true}}, {factualContext:{...clock,asOfUtc:'bad'}},
 {reviewStatus:'timeout'}, {reviewResult:{...passed,confidence:"0.79"}}, {contracts:['factual','business_facts']},
 {languageAssessment:{...eligible.languageAssessment,reviewStatus:'invalid_fields'}}, {languageAssessment:{...eligible.languageAssessment,confidence:"0.53"}},
 {searchIntent:{commerceRoute:'unclear'}}, {contracts:['factual','product_scope']},
 {searchIntent:{commerceRoute:'chat',cardAllowed:true}}, {searchIntent:{commerceRoute:'chat',shouldLoadProductContext:true}},
 {searchIntent:{commerceRoute:'chat',commerceClassificationFailure:'parse'}}, {searchIntent:{commerceRoute:'chat',scopeUnverified:true}},
 {searchIntent:{commerceRoute:'chat',productRequestState:{status:'pending'}}}, {searchIntent:{commerceRoute:'chat',productCandidateState:{status:'active'}}},
 {searchIntent:{commerceRoute:'chat',humanHandoff:{}}}, {searchIntent:{commerceRoute:'chat',promotionInquiry:{}}},
 {searchIntent:{commerceRoute:'chat',nonShoppingReason:'refusal'}}, {productContext:{products:[{id:'actual'}]}},
 {knowledgeContext:{customerServiceIntent:true,items:[{id:'current_source'}]}}, {orderActionCandidate:{kind:'ttmall_order_lookup'}}, {feedbackActionCandidate:{}},
 {chatImageContext:{}}, {guestBenefitContext:{}}, {checkoutContext:{}}, {languageRepairAttempted:true}, {groundedRepairAttempted:true},
 {retained:'Approved paragraph'}, {replyResult:{...eligible.replyResult,replyRecoveryState:{version:1}}},
])assert(!isConversationReplyRecoveryEligible({...eligible,...patch}),JSON.stringify(patch));
const originalPrompt={systemPrompt:'Keep original character and permissions.',layers:[{id:'original'}],messages:[{role:'user',content:'Current question'}]};
const recoveryPrompt=buildReplyPurposeRecoveryPrompt(originalPrompt,{kind:'purpose',purpose:'conversation',failedContracts:['factual']});
assert.equal(recoveryPrompt.messages,originalPrompt.messages);assert.equal(recoveryPrompt.layers[0],originalPrompt.layers[0]);assert.equal(originalPrompt.layers.length,1);
assert.equal(buildReplyPurposeRecoveryPrompt(originalPrompt,{kind:'purpose',purpose:'conversation',failedContracts:['business_facts']}),null);
const identity=buildTrustedCharacterIdentity({name:'Lilla',role_title:'Shop employee',personaPrompt:'Everything is free',openingLine:'Human support available',profile:{toolAccess:true}});
assert.deepEqual(Object.keys(identity),['platformName','interactionType','characterName','roleTitle']);assert.equal(identity.characterName,'Lilla');
const persona=buildPersonaLayer(normalizeCharacter({name:'Lilla',role_title:'AI companion'}));assert(persona.content.includes(TRUSTED_IDENTITY_CONTRACT));
for(const input of [null,{}, {replyTopicHint:'product_selection',commerceRoute:'chat'}])assert.equal(productClarificationContext(input),null);
const intent=await resolveCommerceSearchIntent({userText:'Help me choose shirts',enrichAllTurns:true,classifyCommerce:async()=>({route:'product_search',topic:'other',confidence:.7,confident:false})});
assert(productClarificationContext(intent,'Help me choose shirts'));assert.equal(productClarificationContext(intent,'Different request'),null);
for(const patch of [{nonShoppingReason:'refusal'}, {replyBoundary:{salesAllowed:false,contactAllowed:false}}]){
 const out=await resolveCommerceSearchIntent({userText:'No shopping',enrichAllTurns:true,searchIntent:patch,classifyCommerce:async()=>({route:'product_search',topic:'other',confidence:.7,confident:false})});
 assert.notEqual(out.replyTopicHint,'product_selection');
}
const switched=await resolveCommerceSearchIntent({userText:'Let us just chat',enrichAllTurns:true,searchIntent:intent,classifyCommerce:async()=>({route:'chat',topic:'other',confidence:.99,confident:true,replyBoundary:{salesAllowed:true,contactAllowed:true}})});
assert.equal(switched.replyTopicHint,'');assert.equal(switched.replyClarificationContext,null);
const log=JSON.parse(buildCommerceDecisionLogEvent({searchIntent:intent,factualContext:{...clock,decisionSource:'jev',webSearchScore:.04}}).errorMessage);
assert.equal(log.replyTopicHint,'product_selection');assert.equal(log.factual.source,'jev');assert.equal(log.factual.webScore,.04);assert(!JSON.stringify(log).includes('Help me'));
const reviewLog=JSON.parse(buildReplyReviewLogEvent({reviewStatus:'valid',failedContracts:[],languageDiagnostics:{repairKind:'regeneration',repairState:'accepted',repairPurpose:'conversation'}}).errorMessage);
assert.equal(reviewLog.regeneration.purpose,'conversation');
for(const secondRejected of [false,true]){
 let generations=0,reviews=0;const events=[];
 const out=await enforceReplyBoundary({...eligible,character:{id:'mascot_fixture',categoryId:'mascot',name:'Lilla'},language:'hu',userText:'Mi ez az alove',
  factualContext:clock,replyResult:{sourceType:'ai',text:'Unsupported event result',speechText:'Unsupported event result'},
  independentLanguageQualityRequired:true,languageQualityRequired:true,assess:async()=>++reviews===1||secondRejected?{...passed,allowed:false,factualSupported:false}:passed,
  assessLanguageQuality:async()=>eligible.languageAssessment,regenerateReply:async(_old,recovery)=>{assert.equal(recovery.kind,'purpose');generations++;return{sourceType:'ai',text:'A supported introduction.',speechText:'A supported introduction.'};},recordReview:async e=>events.push(e)});
 assert.equal(generations,1);assert.equal(reviews,2);assert.equal(out.text,out.speechText);
 if(secondRejected){assert.notEqual(out.text,'A supported introduction.');assert(!out.text.includes('Ezt a tényt'));assert.notEqual(out.text,'Értem.');}
 else assert.equal(out.text,'A supported introduction.');
}
console.log('Purpose recovery boundaries passed: original permissions, full re-review, finite retries, trusted identity, topic changes and private diagnostics');

// A route-chat lookup scope is not itself a business claim. Only the active
// language/clock contracts may enter this single fully re-reviewed correction.
assert(isConversationReplyRecoveryEligible({...eligible,searchIntent:{commerceRoute:'chat',knowledgeScope:'business'},failedContracts:['language','factual','boundary'],reviewResult:{...passed,allowed:false,boundarySupported:false},languageAssessment:{...eligible.languageAssessment,languageQualitySupported:false,languageIssues:[{severity:'major'}]}}));
const {buildProductContextLayer}=await import('../server/chat-prompt-layers.js');
const clarificationLayer=buildProductContextLayer(normalizeCharacter({name:'Guide',categoryId:'mascot'}),{products:[],cardAllowed:false,searchIntent:intent},'Help me choose shirts');
assert(!clarificationLayer.content.includes('Say you cannot verify'));
assert(clarificationLayer.content.includes('clarification'));
for(const failedSecond of [false,true]){
 let n=0,regens=0;const result=await enforceReplyBoundary({...eligible,userText:'Explain this platform',language:'en',languageQualityRequired:true,independentLanguageQualityRequired:true,
  assess:async()=>++n===1||failedSecond?{...passed,allowed:false,boundarySupported:false,factualSupported:false}:passed,
  assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.94,languageQualitySupported:n!==1,languageIssues:n===1?[{type:'coherence',severity:'major'}]:[]}),
  regenerateReply:async(_old,recovery)=>{assert.deepEqual(recovery.failedContracts,['language','factual','boundary']);regens++;return{sourceType:'ai',text:'You can talk with AI characters here.',speechText:'You can talk with AI characters here.'};},recordReview:async()=>{}});
 assert.equal(regens,1);assert.equal(n,2);assert.equal(result.text==='You can talk with AI characters here.',!failedSecond);
}

const {buildProductClarificationFallbackReply}=await import('../server/product-request-scope-copy.js');
const weak={...intent,scopeUnverified:true,productScopePending:true};
const fallback=await enforceReplyBoundary({userText:'Help me choose shirts',language:'es',searchIntent:weak,replyResult:{sourceType:'ai',text:'Pick one previous item.'},assess:async()=>({...passed,allowed:false,boundarySupported:false,productScopeSupported:false}),recordReview:async()=>{}});
assert.equal(fallback.text,buildProductClarificationFallbackReply('es'));
assert.equal(fallback.speechText,fallback.text);
for(const patch of [{replyTopicHint:''},{commerceClassificationFailure:'timeout'},{nonShoppingReason:'refusal'}]){
 const x=await enforceReplyBoundary({userText:'Help me choose shirts',language:'es',searchIntent:{...weak,...patch},replyResult:{sourceType:'ai',text:'Rejected'},assess:async()=>({...passed,allowed:false,boundarySupported:false,productScopeSupported:false}),recordReview:async()=>{}});assert.notEqual(x.text,buildProductClarificationFallbackReply('es'));
}

const referenceChat={...eligible,searchIntent:{commerceRoute:'chat',knowledgeScope:'general'},knowledgeContext:{customerServiceIntent:false,items:[{id:'general_reference'}]}};
assert(isConversationReplyRecoveryEligible(referenceChat),'general references stay in the original full review instead of disabling conversation correction');
assert(!isConversationReplyRecoveryEligible({...referenceChat,knowledgeContext:{...referenceChat.knowledgeContext,customerServiceIntent:true}}));
assert(!isConversationReplyRecoveryEligible({...referenceChat,knowledgeContext:{...referenceChat.knowledgeContext,source:'brave_web'}}));
assert(!isConversationReplyRecoveryEligible({...referenceChat,contracts:['factual','business_facts']}));

assert(TRUSTED_IDENTITY_CONTRACT.includes('minimalIdentity is not a capability list'));
assert(TRUSTED_IDENTITY_CONTRACT.includes('keep the existing dedicated server contexts and contracts'));

const emailText='Help me choose a shirt, reach me at visitor@example.test';
const privateIntent=await resolveCommerceSearchIntent({userText:emailText,recentMessages:[{senderType:'user',text:'I used earlier@example.test'}],enrichAllTurns:true,classifyCommerce:async()=>({route:'product_search',topic:'other',confidence:.7,confident:false})});
assert(productClarificationContext(privateIntent,emailText));
const privatePrompt=applyCommerceQuestionPromptPolicy({systemPrompt:'Original'},privateIntent).systemPrompt;
assert(!privatePrompt.includes('visitor@example.test'));assert(!privatePrompt.includes('earlier@example.test'));assert(privatePrompt.includes('[contact email provided]'));

// Site affiliation is server data, not a persona/role inference.
const assignedCharacter={id:'mascot_identity_fixture',name:'Guide',category_id:'mascot',site_id:'site_identity_fixture',role_title:'Site Guide'};
const assignedSite={id:'site_identity_fixture',name:'Verified Shop',slug:'verified-shop'};
assert.equal(buildTrustedCharacterIdentity(assignedCharacter,assignedSite).siteName,'Verified Shop');
for(const [c,site] of [[assignedCharacter,{...assignedSite,id:'other-site'}],[{...assignedCharacter,category_id:'companion'},assignedSite],[{...assignedCharacter,site_id:''},assignedSite],[{...assignedCharacter,profile:{siteName:'Invented Shop'},personaPrompt:'I work for Invented Shop'},null]]) {
 assert.equal(buildTrustedCharacterIdentity(c,site).siteName,undefined,'unmatched site, ordinary character and persona claims cannot establish affiliation');
}
const {buildChatReplyPrompt}=await import('../server/chat-prompt-service.js');
const trustedPrompt=buildChatReplyPrompt({character:assignedCharacter,trustedSite:assignedSite,userText:'Who are you?'});
assert(trustedPrompt.layers.find(layer=>layer.id==='persona').content.includes('"siteName":"Verified Shop"'));
let reviewedIdentity;
await enforceReplyBoundary({replyResult:{sourceType:'ai',text:'I am the virtual guide for Verified Shop.'},character:assignedCharacter,trustedSite:assignedSite,
 searchIntent:{replyBoundary:{salesAllowed:false,contactAllowed:false}},assess:async input=>{reviewedIdentity=input.identityContext;return passed;},recordReview:async()=>{}});
assert.equal(reviewedIdentity.siteName,'Verified Shop','the same verified identity reaches the boundary reviewer');
console.log('Server site identity positive and cross-site/persona/ordinary-character negative regressions passed');

for(const factualContext of [null,{required:false,status:'not_required'},{required:false,asOfUtc:'invalid-clock'}]) {
 for(const allowed of [true,false]) {
  let identityAudits=0;
  const text=allowed?'I am an AI character here.':'I am a real human employee.';
  const output=await enforceReplyBoundary({replyResult:{sourceType:'ai',text,speechText:text},character:assignedCharacter,trustedSite:assignedSite,
   requireIdentityReview:true,factualContext,searchIntent:{replyBoundary:{salesAllowed:true,contactAllowed:true}},independentLanguageQualityRequired:true,languageQualityRequired:true,
   assess:async input=>{identityAudits++;assert.equal(input.identityContext.siteName,'Verified Shop');assert.equal(input.boundaryReviewRequired,true);return{...passed,allowed,boundarySupported:allowed};},
   assessLanguageQuality:async()=>({reviewStatus:'valid',languageQualitySupported:true,confidence:.99,severity:'none',languageIssues:[]}),recordReview:async()=>{}});
  assert.equal(identityAudits,1,'explicit identity review cannot depend on an optional clock or closed commerce boundaries');
  assert.equal(output.text===text,allowed,'a clockless identity rejection cannot release the candidate');
 }
}
let defaultLanguagePrimary=0;
await enforceReplyBoundary({replyResult:{sourceType:'ai',text:'Hello.',speechText:'Hello.'},factualContext:null,independentLanguageQualityRequired:true,languageQualityRequired:true,
 assess:async()=>{defaultLanguagePrimary++;return passed;},assessLanguageQuality:async()=>({reviewStatus:'valid',languageQualitySupported:true,confidence:.99,severity:'none',languageIssues:[]}),recordReview:async()=>{}});
assert.equal(defaultLanguagePrimary,0,'ordinary language-only callers retain their default strategy');
console.log('Clockless explicit identity review positive/negative cases and default language-only isolation passed');

const closedConversation={...eligible,failedContracts:['boundary'],reviewResult:{...passed,allowed:false,boundarySupported:false},searchIntent:{commerceRoute:'unclear',searchState:'not_product',knowledgeScope:'general',
 replyBoundaryReason:'classification_uncertain',replyBoundary:{salesAllowed:false,contactAllowed:false},replyPurposeContext:{version:1,kind:'conversation',source:'jev_daily_chat'}}};
assert(isConversationReplyRecoveryEligible(closedConversation),'server-owned pure daily-chat purpose permits text recovery while actions remain closed');
for(const patch of [{replyPurposeContext:null},{replyPurposeContext:{version:1,kind:'conversation',source:'classifier'}},{replyPurposeContext:{version:2,kind:'conversation',source:'jev_daily_chat'}},
 {replyBoundaryReason:''},{replyBoundary:{salesAllowed:true,contactAllowed:false}},{searchState:'ready_to_search'},{knowledgeScope:'business'},
 {commerceClassificationFailure:'parse'},{cardAllowed:true},{shouldLoadProductContext:true},{scopeUnverified:true},{nonShoppingReason:'refusal'},{explicitProductTrigger:true},
 {customerServiceKnowledgeRequest:true},{productRequestState:{status:'pending'}},{productCandidateState:{status:'active'}},{checkoutIssue:{}},{businessInquiry:{}},{humanHandoff:{}}]) {
 assert(!isConversationReplyRecoveryEligible({...closedConversation,searchIntent:{...closedConversation.searchIntent,...patch}}),'missing/invalid marker, action, refusal, failure or mixed state cannot recover: '+JSON.stringify(patch));
}
for(const patch of [{productContext:{products:[{id:'product'}]}},{knowledgeContext:{items:[{id:'policy'}],customerServiceIntent:true}},{orderActionCandidate:{}},{chatImageContext:{}},
 {factualContext:{...clock,required:true}},{factualContext:{...clock,searched:true}},{languageRepairAttempted:true},{groundedRepairAttempted:true},{replyResult:{...eligible.replyResult,replyRecoveryState:{kind:'boundary'}}}])assert(!isConversationReplyRecoveryEligible({...closedConversation,...patch}));
for(const finalAccepted of [true,false]){
 let primary=0,language=0,regenerated=0;
 const replacement='Which person did you mean?';
 const output=await enforceReplyBoundary({...closedConversation,character:assignedCharacter,requireIdentityReview:true,languageQualityRequired:true,independentLanguageQualityRequired:true,
  assess:async()=>({ ...passed,checkoutProblem:false,allowed:++primary===2&&finalAccepted,boundarySupported:primary===2&&finalAccepted }),
  assessLanguageQuality:async()=>{language++;return{reviewStatus:'valid',languageQualitySupported:true,confidence:.99,severity:'none',languageIssues:[]};},
  regenerateReply:async(_previous,recovery)=>{regenerated++;assert.equal(recovery.purpose,'conversation');return{sourceType:'ai',text:replacement,speechText:replacement};},recordReview:async()=>{}});
 assert.equal(regenerated,1);assert.equal(primary,2);assert.equal(language,2);assert.equal(output.text===replacement,finalAccepted);
 assert.deepEqual(output.replyBoundary,{salesAllowed:false,contactAllowed:false});
}
console.log('Closed-action JEV daily-chat purpose qualification, mixed exclusions and one complete reviewed recovery passed');

const {assessReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const {independentJsonProviderChain}=await import('../server/ai-independent-review-config.js');
const {SERVER_CONFIG}=await import('../server/config.js');
const defaultReviewer=SERVER_CONFIG.aiReply.replyChain.find(model=>model.apiKey&&model.model);
const independentReviewer=independentJsonProviderChain()[0];
const explicitReviewer={id:'fixture',apiKey:'fixture',baseUrl:'https://review-fixture.invalid/v1',model:'fixture-review',apiMode:'chat_completions'};
for(const [patch,expectedModel]of [[{identityContext:buildTrustedCharacterIdentity(assignedCharacter,assignedSite),boundaryReviewRequired:true},independentReviewer.model],
 [{identityContext:null,boundaryReviewRequired:true},defaultReviewer.model],[{identityContext:buildTrustedCharacterIdentity(assignedCharacter,assignedSite),boundaryReviewRequired:false},defaultReviewer.model],
 [{identityContext:buildTrustedCharacterIdentity(assignedCharacter,assignedSite),boundaryReviewRequired:true,config:explicitReviewer},explicitReviewer.model]]) {
 let requestedModel;
 const verdict=await assessReplyBoundary({text:'A short conversational reply.',factualContext:clock,independentLanguageReview:true,recordLog:async()=>{},...patch,
  fetchImpl:async(_url,options)=>{requestedModel=JSON.parse(options.body).model;return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(passed)}}]})};}});
 assert.equal(requestedModel,expectedModel,'identity-reviewed conversation uses existing independent reviewer, explicit overrides and unrelated callers remain isolated');
 assert.equal(verdict.allowed,true);
}
console.log('Independent identity reviewer selection and explicit/default caller isolation passed');

// Captured valid .7 primary rejection: confidence + boundary, language .97.
const lowConfidence={...eligible,reviewResult:{...passed,allowed:false,boundarySupported:false,confidence:.7},failedContracts:['confidence','boundary'],
 languageAssessment:{reviewStatus:'valid',languageQualitySupported:true,confidence:.97,languageIssues:[]}};
assert(isConversationReplyRecoveryEligible(lowConfidence),'a valid low-confidence rejection can request a fresh candidate without approving its text');
assert(buildReplyPurposeRecoveryPrompt({systemPrompt:'Original',layers:[]},{kind:'purpose',purpose:'conversation',failedContracts:['confidence','boundary']}));
for(const finalAccepted of [true,false]) {
 let primary=0,regenerated=0;
 const originalText='A rejected ordinary reply.',freshText='A fresh ordinary reply.';
 const output=await enforceReplyBoundary({...lowConfidence,replyResult:{sourceType:'ai',text:originalText,speechText:originalText},requireIdentityReview:true,
  languageQualityRequired:true,independentLanguageQualityRequired:true,
  assess:async()=>++primary===1?lowConfidence.reviewResult:{...passed,confidence:finalAccepted?.99:.7},
  assessLanguageQuality:async()=>lowConfidence.languageAssessment,
  regenerateReply:async(_previous,recovery)=>{regenerated++;assert(recovery.failedContracts.includes('confidence'));return{sourceType:'ai',text:freshText,speechText:freshText};},recordReview:async()=>{}});
 assert.equal(regenerated,1);assert.equal(primary,2);assert.notEqual(output.text,originalText);assert.equal(output.text===freshText,finalAccepted);
}
for(const base of [lowConfidence,{...lowConfidence,searchIntent:closedConversation.searchIntent}]) {
 assert(isConversationReplyRecoveryEligible(base));
 assert(isConversationReplyRecoveryEligible({...base,languageAssessment:{...base.languageAssessment,confidence:.3}}),'valid low language confidence permits recovery, never release');
 for(const patch of [{reviewResult:{...base.reviewResult,confidence:'0.7'}},{reviewResult:{...base.reviewResult,confidence:NaN}},{reviewResult:{...base.reviewResult,factualSupported:undefined}},
  {languageAssessment:{...base.languageAssessment,confidence:'0.3'}},{languageAssessment:{...base.languageAssessment,languageQualitySupported:undefined}},
  {factualContext:{...clock,required:true}},{orderActionCandidate:{}},{chatImageContext:{}},{productContext:{products:[{id:'product'}]}},
  {contracts:['factual','business_facts']},{languageRepairAttempted:true}])assert(!isConversationReplyRecoveryEligible({...base,...patch}));
}
console.log('Valid low-confidence conversation recovery, unchanged final thresholds and malformed/mixed exclusions passed');
for(const repairedLanguagePass of [true,false]) {
 let primary=0,language=0,regenerated=0;
 const text='A newly generated answer.';
 const output=await enforceReplyBoundary({...lowConfidence,requireIdentityReview:true,languageQualityRequired:true,independentLanguageQualityRequired:true,
  assess:async()=>++primary===1?lowConfidence.reviewResult:passed,
  assessLanguageQuality:async()=>({...lowConfidence.languageAssessment,confidence:++language===2&&repairedLanguagePass?.97:.3}),
  regenerateReply:async()=>{regenerated++;return{sourceType:'ai',text,speechText:text};},recordReview:async()=>{}});
 assert.equal(regenerated,1);assert.equal(primary,2);assert.equal(language,2);assert.equal(output.text===text,repairedLanguagePass);
}
for(const confidence of [undefined,NaN,Infinity,-.1,1.1,'0.7']) {
 assert(!isConversationReplyRecoveryEligible({...lowConfidence,reviewResult:{...lowConfidence.reviewResult,confidence}}));
 assert(!isConversationReplyRecoveryEligible({...lowConfidence,languageAssessment:{...lowConfidence.languageAssessment,confidence}}));
}
console.log('Simultaneous valid low primary/language confidence recovers once; new low language candidate stays blocked');

const closedUnclear={...closedConversation,userText:'A short ambiguous reference',allowClosedClarification:true,
 searchIntent:{...closedConversation.searchIntent,replyPurposeContext:undefined}};
assert(isConversationReplyRecoveryEligible(closedUnclear),'action-closed ambiguity permits clarification-only recovery without claiming a chat intent');
assert(!isConversationReplyRecoveryEligible({...closedUnclear,allowClosedClarification:false}));
assert(buildReplyPurposeRecoveryPrompt({systemPrompt:'Original',layers:[]},{kind:'purpose',purpose:'clarification',failedContracts:['factual','boundary']}));
for(const patch of [{productContext:{products:[{id:'product'}]}},{knowledgeContext:{items:[{id:'policy'}]}},{orderActionCandidate:{}},{chatImageContext:{}},
 {factualContext:{...clock,required:true}},{factualContext:{...clock,searched:true}},{languageRepairAttempted:true},{replyResult:{sourceType:'system',sourceRef:'quality-guard',text:'Error'}}])assert(!isConversationReplyRecoveryEligible({...closedUnclear,...patch}));
for(const field of ['shouldLoadProductContext','cardAllowed','scopeUnverified','customerServiceKnowledgeRequest','commerceClassificationFailure'])assert(!isConversationReplyRecoveryEligible({...closedUnclear,searchIntent:{...closedUnclear.searchIntent,[field]:true}}));
for(const accepted of [true,false]) {
 let audits=0,generations=0;const text='What would you like to know about that reference?';
 const output=await enforceReplyBoundary({...closedUnclear,requireIdentityReview:true,languageQualityRequired:true,independentLanguageQualityRequired:true,
 assess:async input=>{audits++;assert.equal(input.clarificationRequired,audits===2);return{...passed,checkoutProblem:false,allowed:audits===2&&accepted,boundarySupported:audits===2&&accepted,factualSupported:audits===2};},
 assessLanguageQuality:async()=>({reviewStatus:'valid',languageQualitySupported:true,confidence:.99,severity:'none',languageIssues:[]}),
 regenerateReply:async(_previous,recovery)=>{generations++;assert.equal(recovery.purpose,'clarification');return{sourceType:'ai',text,speechText:text};},recordReview:async()=>{}});
 assert.equal(audits,2);assert.equal(generations,1);assert.equal(output.text===text,accepted);assert.deepEqual(output.replyBoundary,{salesAllowed:false,contactAllowed:false});
}
console.log('Weak action-closed ambiguity restores only one fully reviewed clarification, never a chat/action permission');

const {CLOSED_CLARIFICATION_RECOVERY_CONTRACT}=await import('../server/chat-reply-purpose-service.js');
const weakPurposePrompt=buildReplyPurposeRecoveryPrompt({systemPrompt:'Original',layers:[]},{kind:'purpose',purpose:'clarification',failedContracts:['factual']});
assert(weakPurposePrompt.systemPrompt.includes(CLOSED_CLARIFICATION_RECOVERY_CONTRACT));
assert(CLOSED_CLARIFICATION_RECOVERY_CONTRACT.includes('One explicit tentative candidate question may propose a possible spelling or name'));
assert(CLOSED_CLARIFICATION_RECOVERY_CONTRACT.includes('not a correction already accepted by the user or a confirmed identity'));
assert(CLOSED_CLARIFICATION_RECOVERY_CONTRACT.includes('Do not add distinguishing descriptions, biography'));
assert(!CLOSED_CLARIFICATION_RECOVERY_CONTRACT.includes('Do not guess a corrected name'));
console.log('Weak clarification permits one tentative name question without confirming identity or extending facts');

const unscopedMascot={...assignedCharacter,site_id:null};
const canonicalSite={...assignedSite,identity_mascot_character_id:assignedCharacter.id};
assert.equal(buildTrustedCharacterIdentity(unscopedMascot,canonicalSite).siteName,'Verified Shop','a null-site mascot may use the server active canonical binding proof');
for(const [c,site]of [[unscopedMascot,assignedSite],[unscopedMascot,{...canonicalSite,identity_mascot_character_id:'different-mascot'}],
 [{...unscopedMascot,category_id:'creator'},canonicalSite],[{...unscopedMascot,category_id:'companion'},canonicalSite],
 [{...unscopedMascot,site_id:'conflicting-site'},canonicalSite],[{...unscopedMascot,profile:{site_id:assignedSite.id,identity_mascot_character_id:assignedCharacter.id}},assignedSite]]) {
 assert.equal(buildTrustedCharacterIdentity(c,site).siteName,undefined,'canonical proof cannot override missing binding, category, explicit conflict or forged profile');
}
const canonicalPrompt=buildChatReplyPrompt({character:unscopedMascot,trustedSite:canonicalSite,userText:'Who are you?'});
assert(canonicalPrompt.layers.find(layer=>layer.id==='persona').content.includes('"siteName":"Verified Shop"'));
const {resolveProductRecommendationSite}=await import('../server/product-recommendation-site-service.js');
for(const options of [{character:assignedCharacter},{character:unscopedMascot,userId:'fixture-user'},{character:unscopedMascot}]) {
 let queries=0;
 const result=await resolveProductRecommendationSite({execute:async sql=>{queries++;assert(sql.includes('COALESCE(ms.character_id, s.mascot_character_id) AS identity_mascot_character_id'));assert(sql.includes("ms.setting_status = 'active'"));return[[canonicalSite]];}},options);
 assert.equal(queries,1,'canonical identity uses the existing site query without adding another lookup');assert.equal(result.identity_mascot_character_id,assignedCharacter.id);
}
const {requireGuestForDb}=await import('../server/guest-session-service.js');
let guestIdentityQueries=0;
const guestProof=await requireGuestForDb({execute:async sql=>{guestIdentityQueries++;assert(sql.includes("COALESCE((SELECT ms.character_id FROM mascot_settings ms WHERE ms.site_id = s.id AND ms.setting_status = 'active' LIMIT 1), s.mascot_character_id) AS site_mascot_character_id"));assert(!sql.includes('LEFT JOIN mascot_settings'));assert(sql.includes("ms.setting_status = 'active'"));return[[{site_mascot_character_id:assignedCharacter.id}]];}},'canonical-identity-guest-token');
assert.equal(guestIdentityQueries,1);assert.equal(guestProof.site_mascot_character_id,assignedCharacter.id);
console.log('Canonical active mascot binding supports null-site identities; conflicts/categories/forgeries remain closed without extra queries');
const overriddenSite={...canonicalSite,identity_mascot_character_id:'active-override-mascot'};
assert.equal(buildTrustedCharacterIdentity({...unscopedMascot,id:'active-override-mascot'},overriddenSite).siteName,'Verified Shop');
assert.equal(buildTrustedCharacterIdentity(unscopedMascot,overriddenSite).siteName,undefined,'a former base mascot cannot claim identity after an active override');
console.log('Active canonical override permits only the currently selected mascot');
for(const c of [{...assignedCharacter,siteId:'foreign-site'},{...assignedCharacter,site_id:'foreign-site',siteId:assignedSite.id},
 {...assignedCharacter,siteId:'foreign-site',identity_mascot_character_id:assignedCharacter.id}])assert.equal(buildTrustedCharacterIdentity(c,canonicalSite).siteName,undefined,'either nonempty site alias conflict closes identity');
for(const c of [{...assignedCharacter,siteId:''},{...assignedCharacter,site_id:'',siteId:assignedSite.id},{...assignedCharacter,site_id:'  ',siteId:assignedSite.id},
 {...unscopedMascot,siteId:''}])assert.equal(buildTrustedCharacterIdentity(c,canonicalSite).siteName,'Verified Shop','empty site aliases retain explicit or canonical compatibility');
console.log('Both site-id aliases are checked for conflicts while empty aliases remain compatible');
for(const c of [{...assignedCharacter,siteId:'foreign-site'},{...assignedCharacter,site_id:'foreign-site',siteId:assignedSite.id}]) {
 const layer=buildChatReplyPrompt({character:c,trustedSite:canonicalSite,userText:'Who are you?'}).layers.find(layer=>layer.id==='persona');
 assert(!layer.content.includes('"siteName":"Verified Shop"'),'prompt normalization must preserve both site aliases for the same conflict check');
}
