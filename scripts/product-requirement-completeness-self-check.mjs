import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {resolveJevCommerceDecision}=await import('../server/jev-commerce-decision-service.js');
const {normalizeCommerceDecision}=await import('../server/product-intent-classifier-service.js');
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {buildProductSearchIntent,filterProductsByIntent}=await import('../server/product-intent-service.js');
const {applyProductCandidateState,normalizeProductRequirementDecision}=await import('../server/product-candidate-state-service.js');
const {buildChatProductRoutingContext}=await import('../server/chat-product-routing-context-service.js');
const text='I want a burgundy shirt model 3041';
let calls=0;
const evaluate=async({questions})=>{calls++;return{ok:true,answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>{
 let selected=({route:'product_search',topic:'other',knowledge_scope:'business',knowledge_kind:'catalogue_only',request_relation:'single',request_action:'new',requirement_action:'new',requestedProductType:'shirt',requestedColor:'unrepresented',season:'unrepresented',sales_allowed:'yes',contact_allowed:'yes',live_required:'yes',answer_required:'yes'})[key]||(q.criteria.none?'none':q.criteria.absent?'absent':q.criteria.no?'no':Object.keys(q.criteria)[0]);
 if(key==='e_requestedColor')selected=Object.entries(q.criteria).find(([,v])=>v===JSON.stringify('burgundy'))?.[0];
 if(key==='season_evidence')selected=Object.entries(q.criteria).find(([,v])=>v===JSON.stringify('3041'))?.[0];
 if(key==='e_requestedProductType')selected=Object.entries(q.criteria).find(([,v])=>v===JSON.stringify('shirt'))?.[0];
 return[key,{choice:selected,confidence:.1}];}))};};
const result=await resolveJevCommerceDecision(text,{siteId:'s',characterId:'c',evaluate});
assert(result.ok);assert.equal(result.value.productRequirement.unresolvedRequirements?.length,2,'Explicit requirements outside canonical values remain as unresolved literal evidence');
const decision={...normalizeCommerceDecision(result.value,{userText:text}),detectionSource:'jev'};
const primary={ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1};
const routed=await resolveCommerceSearchIntent({userText:text,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:buildProductSearchIntent(text),jevDecision:primary,classifyCommerce:async()=>decision});
assert.equal(routed.shouldLoadProductContext,false);assert.equal(routed.cardAllowed,false);assert.equal(routed.searchState,'needs_clarification');
assert.equal(routed.productCandidateState.unresolvedRequirements.length,2);
const source=buildChatProductRoutingContext([{senderType:'character',productCandidateState:routed.productCandidateState}],{siteId:'s',characterId:'c'});
assert.equal(source.unresolvedRequirements.length,2);
const continuation=(input,updates,previous)=>applyProductCandidateState({shouldLoadProductContext:true,cardAllowed:true,commerceRoute:'product_search',replyBoundary:{salesAllowed:true}},
 {confident:true,confidence:.1,candidateDecisionRequired:true,productRequest:{relation:'single',action:'new',items:[],selectedIndex:null},productRequirement:{action:'continue',evidence:input,updates,suspectedTerm:null}},
 {userText:input,siteId:'s',characterId:'c',recentMessages:[{senderType:'character',productCandidateState:previous}]});
const year=continuation('2026',[{field:'requestedSeason',value:'2026',evidence:'2026'}],routed.productCandidateState);
assert.equal(year.productCandidateState.unresolvedRequirements.length,1,'A year correction must not erase an unresolved colour');assert.equal(year.shouldLoadProductContext,false);
const red=continuation('red',[{field:'requestedColor',value:'red',evidence:'red'}],year.productCandidateState);
assert.equal(red.productCandidateState.unresolvedRequirements,undefined,'Only actual same-field updates resolve remaining requirements');
assert.equal(normalizeProductRequirementDecision({action:'new',evidence:'red',updates:[],unresolvedRequirements:[{field:'requestedColor',evidence:'invented'}]},{userText:'red'}),null);
// The actual producer/null-context orchestration is verified below.
const products=[
 {id:'red',name:'Club Home Soccer Jersey 2026 - Red',summary:'Men soccer jersey - Red'},
 {id:'brand',name:"Oracle Crimson Hawks Racing Polo Shirt 2026 Black&Blue",summary:'Brand Crimson Hawks, colour Black&Blue'},
 {id:'brand-red',name:"Oracle Red Bull Racing Polo Shirt 2026 Black&Blue",summary:'Racing polo - Black&Blue'},
 {id:'kit',name:'Club Home Soccer Fan Full Kit 2026/27',summary:'Men soccer jersey full kit - Red'},
];
assert.deepEqual(filterProductsByIntent(products,{requestedProductType:'shirt',requestedColor:'red'}).map(p=>p.id),['red'],'Brand colour words, polos and full kits cannot satisfy an explicitly requested red shirt');
assert.equal(filterProductsByIntent([{name:'Club Home Jersey 2026 - Red'}],{requestedProductType:'shirt',requestedColor:'red'}).length,1);
assert.equal(filterProductsByIntent([products[3]],{requestedProductType:'shirt',requestedFeatures:['full_kit']}).length,1,'An explicitly requested complete kit retains its existing feature path');
assert.equal(filterProductsByIntent([products[2]],{requestedProductType:'shirt',requestedKeywords:['polo']}).length,1,'An explicit polo identity term is not treated as an ordinary football-shirt request');
console.log('Unrepresented field evidence, bounded current-owner continuation, exact-field resolution, no guessed numbers and strict garment/colour matching passed; no paid calls/DB');

for (const name of ['Arsenal Short Sleeve Jersey 2026','Arsenal Long Sleeve Jersey 2026','Arsenal Short-Sleeved Jersey 2026']) assert.equal(filterProductsByIntent([{name}],{requestedProductType:'shirt'}).length,1,name);
for (const name of ['Arsenal Jersey and Shorts Kit 2026','Arsenal Polo Shirt 2026','Arsenal Full Kit 2026']) assert.equal(filterProductsByIntent([{name}],{requestedProductType:'shirt'}).length,0,name);

assert.equal(filterProductsByIntent([{name:'Real Madrid Black Football Shirt'}],{requestedColor:'black',requestedProductType:'shirt'}).length,1,'A colour adjective modifying the garment is real colour evidence');
assert.equal(filterProductsByIntent([{name:'Oracle Red Bull Football Shirt'}],{requestedColor:'red',requestedProductType:'shirt'}).length,0,'A colour word inside a brand is not a garment colour adjective');
// Reinterpreting an old token is an explicit slot removal only when the USER
// actually denies that colour/year meaning. An unrelated identity is not one.
const pendingInterpretation={version:1,status:'active',siteId:'s',characterId:'c',owner:'single',targetEvidence:'A claret shirt model 3041',requirements:{requestedProductType:'shirt'},suspectedTerm:null,proposal:null,
 unresolvedRequirements:[{field:'requestedColor',evidence:'claret'},{field:'requestedSeason',evidence:'3041'}]};
for(const [input,clear] of [['Not a colour, not a year: those were identity references.',true],['The team is Venezuela and the model is Classic.',false]]){
 let colourQuestion,seasonQuestion;
 const result=await resolveJevCommerceDecision(input,{siteId:'s',characterId:'c',recentMessages:[{senderType:'character',productCandidateState:pendingInterpretation}],evaluate:async({questions})=>({ok:true,answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>{
 if(key==='requestedColor')colourQuestion=q;if(key==='season')seasonQuestion=q;
 let selected=({route:'product_search',topic:'other',knowledge_scope:'business',knowledge_kind:'catalogue_only',request_relation:'single',request_action:'new',requirement_action:'continue',sales_allowed:'yes',contact_allowed:'yes',live_required:'yes',answer_required:'yes'})[key]||(q.criteria.none?'none':q.criteria.absent?'absent':q.criteria.no?'no':Object.keys(q.criteria)[0]);
 if(['requestedColor','season'].includes(key))selected=clear?'clear':'absent';
 if(clear&&['e_requestedColor','season_evidence'].includes(key))selected='e0';
 return[key,{choice:selected,confidence:.1}];}))})});
 assert(colourQuestion.instructions.includes('actual current denial'));
 assert(seasonQuestion.criteria.clear.includes('actual current denial'));
 const normalized=normalizeCommerceDecision(result.value,{userText:input,recentMessages:[{senderType:'character',productCandidateState:pendingInterpretation}]});
 const state=applyProductCandidateState({shouldLoadProductContext:true,cardAllowed:true,commerceRoute:'product_search',replyBoundary:{salesAllowed:true}},normalized,
 {userText:input,siteId:'s',characterId:'c',recentMessages:[{senderType:'character',productCandidateState:pendingInterpretation}]});
 assert.equal(state.shouldLoadProductContext,clear);
 assert.equal(state.productCandidateState.unresolvedRequirements?.length||0,clear?0:2);
 if(clear)assert(normalized.productRequirement.updates.every(update=>update.value===''&&input.includes(update.evidence)),'Only actual current denial supplies the removal evidence');
}
console.log('Explicit current attribute-denial clears the matching unresolved slots; identity-only followups retain them');

for (const name of ['FKK New Home Kit','MESSI New Away Kit','Real Madrid Home Jersey Kit']) assert.equal(filterProductsByIntent([{name}],{requestedProductType:'shirt'}).length,1,'Ordinary single-kit catalogue titles remain valid: '+name);
const orphanText='2026';
const orphanRaw={route:'product_search',topic:'other',confidence:.7,answerRequired:false,needsLiveProductData:true,replyBoundary:{salesAllowed:true,contactAllowed:true},knowledgeScope:'business',knowledgeQuery:orphanText,
 productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:orphanText},productRequirement:{action:'continue',evidence:orphanText,priorTargetEvidence:'',updates:[{field:'requestedSeason',value:'2026',evidence:'2026'}]},candidateResponse:{action:'none',evidence:'',candidateId:''},policyKnowledgeRequest:{required:false,evidence:orphanText,query:''},commerceConstraints:{edition:null,team:null}};
const orphanDecision={...normalizeCommerceDecision(orphanRaw,{userText:orphanText}),detectionSource:'jev',candidateDecisionRequired:true};
const orphan=await resolveCommerceSearchIntent({userText:orphanText,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:buildProductSearchIntent(orphanText),jevDecision:primary,classifyCommerce:async()=>orphanDecision});
assert(!orphan.commerceClassificationUnavailable&&!orphan.commerceClassificationFailure,'An exact valid continuation with no owned target is missing context, not a provider failure');
assert(!orphan.shouldLoadProductContext&&!orphan.cardAllowed);assert.equal(orphan.commerceRoute,'unclear');assert.equal(orphan.replyTopicHint,'product_selection');assert.equal(orphan.replyClarificationContext.currentUserMessage,orphanText);assert.notEqual(orphan.productCandidateState?.status,'active');
const malformedDecision={...orphanDecision,productRequirement:null};
const malformed=await resolveCommerceSearchIntent({userText:orphanText,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:buildProductSearchIntent(orphanText),jevDecision:primary,classifyCommerce:async()=>malformedDecision});
assert(malformed.commerceClassificationUnavailable,'A malformed or forged requirement remains a real protocol failure');assert(!malformed.shouldLoadProductContext&&!malformed.cardAllowed);
console.log('Valid orphan continuations clarify without searching or inventing a target; malformed protocols remain closed');
const mixedText='2026, and how long does delivery take?';
const mixedRaw={...orphanRaw,answerRequired:true,productRequirement:{...orphanRaw.productRequirement,evidence:'2026'},policyKnowledgeRequest:{required:true,evidence:'how long does delivery take?',query:'how long does delivery take?'},knowledgeRequest:{kind:'business_question',evidence:mixedText}};
const mixedDecision={...normalizeCommerceDecision(mixedRaw,{userText:mixedText}),detectionSource:'jev',candidateDecisionRequired:true};
const mixed=await resolveCommerceSearchIntent({userText:mixedText,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:{...buildProductSearchIntent(mixedText),orderIntent:'lookup',orderRequestKind:'existing'},jevDecision:{...primary,orderIntent:'lookup'},classifyCommerce:async()=>mixedDecision});
assert.equal(mixed.knowledgeScope,'business');assert.equal(mixed.businessKnowledgeRequired,true);assert.equal(mixed.policyKnowledgeRequest.source,'jev');assert.equal(mixed.replyBoundary.contactAllowed,true,'A missing merchandise target does not revoke contact permission for an independent support answer');
assert.equal(mixed.orderIntent,'lookup');assert.equal(mixed.answerRequired,true);assert(!mixed.shouldLoadProductContext&&!mixed.cardAllowed);assert(!mixed.commerceClassificationUnavailable);
for(const route of ['order_lookup','new_image']){
 const intent={...primary,primaryIntent:route,productIntent:'none',orderIntent:route==='order_lookup'?'lookup':'none',imageIntent:route==='new_image'?'explicit_generation':'none'};
 const output=await resolveCommerceSearchIntent({userText:orphanText,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:buildProductSearchIntent(orphanText),jevDecision:intent,classifyCommerce:async()=>orphanDecision});
 assert(!output.shouldLoadProductContext&&!output.cardAllowed);assert(!output.commerceClassificationUnavailable,'An independent primary action retains its original non-shopping path');assert.equal(intent.primaryIntent,route);
}
console.log('Orphan product clarification preserves separate policy demand, lookup metadata and contact permission; other primary lanes remain unchanged');
const noContactDecision={...orphanDecision,replyBoundary:{salesAllowed:true,contactAllowed:false}};
const noContact=await resolveCommerceSearchIntent({userText:orphanText,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:buildProductSearchIntent(orphanText),jevDecision:primary,classifyCommerce:async()=>noContactDecision});
assert(noContact.replyClarificationContext,'Refusing external contact does not forbid asking which merchandise the USER means');
assert.equal(noContact.replyBoundary.contactAllowed,false);assert(!noContact.shouldLoadProductContext&&!noContact.cardAllowed);assert(!noContact.humanHandoff&&!noContact.businessInquiry);assert.deepEqual(noContact.referencedProductIds,[]);assert(!noContact.commerceClassificationUnavailable);
const mixedNoContact=await resolveCommerceSearchIntent({userText:mixedText,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:{...buildProductSearchIntent(mixedText),orderIntent:'lookup'},jevDecision:{...primary,orderIntent:'lookup'},classifyCommerce:async()=>({...mixedDecision,replyBoundary:{salesAllowed:true,contactAllowed:false}})});
assert(mixedNoContact.replyClarificationContext);assert.equal(mixedNoContact.replyBoundary.contactAllowed,false);assert.equal(mixedNoContact.businessKnowledgeRequired,true);assert.equal(mixedNoContact.orderIntent,'lookup');assert(!mixedNoContact.cardAllowed&&!mixedNoContact.shouldLoadProductContext);
console.log('No-contact boundaries remain false while harmless product clarification and independent policy/lookup purposes survive');
for(const history of [[],[{senderType:'character',text:'Invented prior target'}]]) {
 const forgedPrior={...orphanDecision,productRequirement:{...orphanDecision.productRequirement,priorTargetEvidence:'Invented prior target'}};
 const output=await resolveCommerceSearchIntent({userText:orphanText,recentMessages:history,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:buildProductSearchIntent(orphanText),jevDecision:primary,classifyCommerce:async()=>forgedPrior});
 assert(output.commerceClassificationUnavailable,'A fabricated or assistant-only prior quote remains a protocol failure, not a valid contextual continuation');assert(!output.shouldLoadProductContext&&!output.cardAllowed);
}
const {resolveGuestProductRecommendation}=await import('../server/guest-chat-product-service.js');
const {buildChatReplyPrompt}=await import('../server/chat-prompt-service.js');
const {applyCommerceQuestionPromptPolicy}=await import('../server/commerce-routing-service.js');
const {buildReplyReviewMessages}=await import('../server/chat-reply-review-contracts.js');
const owner={id:'c',site_id:'s',category_id:'mascot',categoryId:'mascot'},site={id:'s'};
const produced=await resolveGuestProductRecommendation({execute:async sql=>{assert(sql.includes('FROM sites'),'No actual conversation/database operation is needed');return[[{id:'s',slug:'fixture',site_status:'active',guest_chat_enabled:1}]];}},
 {guest:{site_id:'s',site_slug:'fixture',mascot_character_id:'c'},userText:text,precomputedSearchIntent:routed,searchProducts:async()=>{throw Error('An unresolved USER requirement cannot start a catalogue request');}});
assert.equal(produced.context,null,'The real guest producer has no product context when source lookup was closed');
const actorHistory=[{senderType:'character',text:'The burgundy colour is confirmed and the model is 3041.'}];
const pipelinePrompt=applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({character:owner,trustedSite:site,userText:text,recentMessages:actorHistory,productContext:produced.context}),produced.searchIntent,{character:owner,trustedSite:site,userText:text,recentMessages:actorHistory});
const requirementLayer=pipelinePrompt.layers.find(layer=>layer.id==='product_requirement_clarification');
assert(requirementLayer,'The real null-productContext orchestration must still receive the owned unresolved USER fields');
assert(requirementLayer.content.includes('burgundy')&&requirementLayer.content.includes('3041'));
assert(!requirementLayer.content.includes('colour is confirmed'),'Prior assistant claims cannot become current USER requirements');
const reviewPacket=JSON.parse(buildReplyReviewMessages({text:'Which meaning did you intend?',searchIntent:routed,productContext:null,userText:text,catalogueOwner:{character:owner,trustedSite:site}}).at(-1).content);
assert.deepEqual(reviewPacket.unresolvedProductRequirementContext.unresolvedRequirements,routed.productCandidateState.unresolvedRequirements,'Generation and review share the actual fields despite no product source');
for(const foreign of [{...owner,site_id:'foreign'},{...owner,id:'another'}]) {
 const p=applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({character:foreign,trustedSite:site,userText:text,productContext:null}),routed,{character:foreign,trustedSite:site,userText:text});
 assert(!p.layers.some(layer=>layer.id==='product_requirement_clarification'),'Foreign state cannot project USER requirement authority');
}
assert(mixedNoContact.replyClarificationContext.currentRequirement,'Orphan clarification exposes the same current exact typed corrections, not only prose history');
assert(mixedNoContact.replyClarificationContext.currentRequirement.updates.some(update=>update.field==='requestedSeason'&&update.value==='2026'));
console.log('Actual null-productContext producer/orchestration carries the same owned requirement evidence to generation and review');
const correctionText='Venezuela is the team, not a colour; the year is 2026.';
const correctionRaw={...orphanRaw,productRequirement:{action:'continue',evidence:correctionText,updates:[{field:'requestedTeam',value:'Venezuela',evidence:'Venezuela'},{field:'requestedColor',value:'',evidence:'not a colour'},{field:'requestedSeason',value:'2026',evidence:'2026'}]},policyKnowledgeRequest:{required:false,evidence:correctionText,query:''}};
const correctionDecision={...normalizeCommerceDecision(correctionRaw,{userText:correctionText}),detectionSource:'jev',candidateDecisionRequired:true};
const correctionIntent=await resolveCommerceSearchIntent({userText:correctionText,siteId:'s',characterId:'c',enrichAllTurns:true,searchIntent:buildProductSearchIntent(correctionText),jevDecision:primary,classifyCommerce:async()=>correctionDecision});
const currentRequirements=correctionIntent.replyClarificationContext.currentRequirement;
assert(currentRequirements.updates.some(update=>update.field==='requestedColor'&&update.value===''&&update.evidence==='not a colour'));
assert(currentRequirements.updates.some(update=>update.field==='requestedTeam'&&update.value==='Venezuela'));
assert(currentRequirements.updates.some(update=>update.field==='requestedSeason'&&update.value==='2026'));
const correctionPrompt=applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({character:owner,trustedSite:site,userText:correctionText,recentMessages:actorHistory,productContext:null}),correctionIntent,{character:owner,trustedSite:site,userText:correctionText,recentMessages:actorHistory});
const correctionLayer=correctionPrompt.layers.find(layer=>layer.id==='commerce_clarification');
assert(correctionLayer.content.includes(JSON.stringify(currentRequirements)),'The same exact current clear/team/year updates reach the actual orphan generation path');
assert(!JSON.stringify(currentRequirements).includes('burgundy'));
const correctionReview=buildReplyReviewMessages({searchIntent:correctionIntent,userText:correctionText,productContext:null,catalogueOwner:{character:owner,trustedSite:site}});
assert(correctionReview.some(row=>row.role==='system'&&row.content.includes(JSON.stringify(currentRequirements))),'The reviewer sees the identical current correction and cannot treat the old assistant colour as new USER criteria');
const {toUnresolvedProductRequirementContext}=await import('../server/product-candidate-context-service.js');
for(const patch of [{shouldLoadProductContext:true},{cardAllowed:true},{sourceErrorCode:'timeout'},{commerceRoute:'chat'},{productCandidateState:{...routed.productCandidateState,status:'cleared'}}]) assert.equal(toUnresolvedProductRequirementContext({...routed,...patch},{character:owner,trustedSite:site}),null);
console.log('Current typed clear/team/year corrections override historical assistant colour assertions in shared generation/review purpose');
const ambiguousText='Tournament 2028';
const ambiguousDecision={...normalizeCommerceDecision({...orphanRaw,searchQuery:'tournament 2028',productRequirement:{action:'none'},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:ambiguousText},policyKnowledgeRequest:{required:false,evidence:ambiguousText,query:''}},{userText:ambiguousText}),detectionSource:'jev',candidateDecisionRequired:true};
const originalRows=[{senderType:'character',productCandidateState:routed.productCandidateState}];
const ambiguous=await resolveCommerceSearchIntent({userText:ambiguousText,siteId:'s',characterId:'c',recentMessages:originalRows,enrichAllTurns:true,searchIntent:buildProductSearchIntent(ambiguousText),jevDecision:primary,classifyCommerce:async()=>ambiguousDecision});
assert.equal(ambiguous.productCandidateState.status,'active','An internally inconsistent none update cannot silently cancel an owned target while the same turn still requests a search');
assert.equal(ambiguous.productCandidateState.targetEvidence,routed.productCandidateState.targetEvidence);assert.deepEqual(ambiguous.productCandidateState.requirements,routed.productCandidateState.requirements);assert.deepEqual(ambiguous.productCandidateState.unresolvedRequirements,routed.productCandidateState.unresolvedRequirements);
assert(!ambiguous.shouldLoadProductContext&&!ambiguous.cardAllowed&&!ambiguous.commerceClassificationUnavailable);
assert.notEqual(ambiguous.requestedSeason,'2028','A none update cannot infer a new year from lexical text');
const finalText='Venezuela jersey, not a colour, year 2026';
const finalDecision={...normalizeCommerceDecision({...orphanRaw,searchQuery:'Venezuela',productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:finalText},productRequirement:{action:'continue',evidence:finalText,updates:[{field:'requestedTeam',value:'Venezuela',evidence:'Venezuela'},{field:'requestedProductType',value:'shirt',evidence:'jersey'},{field:'requestedColor',value:'',evidence:'not a colour'},{field:'requestedSeason',value:'2026',evidence:'2026'}]},commerceConstraints:{team:{value:'Venezuela',role:'product_target',evidence:'Venezuela'},edition:null},policyKnowledgeRequest:{required:false,evidence:finalText,query:''}},{userText:finalText}),detectionSource:'jev',candidateDecisionRequired:true};
const finalIntent=await resolveCommerceSearchIntent({userText:finalText,siteId:'s',characterId:'c',recentMessages:[{senderType:'character',productCandidateState:ambiguous.productCandidateState}],enrichAllTurns:true,searchIntent:buildProductSearchIntent(finalText),jevDecision:primary,classifyCommerce:async()=>finalDecision});
assert(finalIntent.shouldLoadProductContext&&finalIntent.cardAllowed,'The following explicit same-field correction must unlock the real producer');assert.equal(finalIntent.productCandidateState.unresolvedRequirements,undefined);assert.equal(finalIntent.requestedSeason,'2026');assert.equal(finalIntent.requestedColor,'');
let finalSearchCalls=0;
const finalProduced=await resolveGuestProductRecommendation({execute:async()=>[[{id:'s',slug:'fixture',site_status:'active',guest_chat_enabled:1,product_api_url:'https://catalogue.invalid/products'}]]},{guest:{site_id:'s',site_slug:'fixture',mascot_character_id:'c'},userText:finalText,precomputedSearchIntent:finalIntent,searchProducts:async options=>{finalSearchCalls++;assert.equal(options.searchIntent.requestedTeam,'Venezuela');assert.equal(options.searchIntent.requestedSeason,'2026');assert.equal(options.searchIntent.requestedColor,'');return{ok:true,site:{id:'s',slug:'fixture'},searchState:'ready_to_search',searchOutcome:'no_match',items:[]};}});
assert.equal(finalSearchCalls,1);assert.equal(finalProduced.context.searchOutcome,'no_match');
console.log('Actual producer retains the owned target through a contradictory none turn, then searches only after explicit current correction');
for(const primaryIntent of ['daily_chat','order_lookup','new_image']) {
 const other=await resolveCommerceSearchIntent({userText:ambiguousText,siteId:'s',characterId:'c',recentMessages:originalRows,enrichAllTurns:true,searchIntent:buildProductSearchIntent(ambiguousText),jevDecision:{...primary,primaryIntent,productIntent:'none'},classifyCommerce:async()=>ambiguousDecision});
 assert.notEqual(other.productCandidateInterpretationReason,'missing_current_update');assert(!other.shouldLoadProductContext&&!other.cardAllowed,'Other primary lanes cannot gain merchandise actions');
}
const foreignSet={version:1,status:'pending',siteId:'s',characterId:'c',items:[{evidence:'first shirt',sharedEvidence:'',text:'first shirt'},{evidence:'second shirt',sharedEvidence:'',text:'second shirt'}],selectedIndex:null,clarificationCount:0};
for(const scope of [foreignSet,{...foreignSet,status:'selected',selectedIndex:0},{...foreignSet,siteId:'foreign'}]) assert.equal(toUnresolvedProductRequirementContext({...routed,productRequestState:scope},{character:owner,trustedSite:site}),null,'A single target cannot borrow a pending/selected/foreign item set');
assert(toUnresolvedProductRequirementContext({...routed,productRequestState:{version:1,status:'cleared',siteId:'s',characterId:'c',items:[],selectedIndex:null,clarificationCount:0}},{character:owner,trustedSite:site}));
const mixedAmbiguous=await resolveCommerceSearchIntent({userText:mixedText,siteId:'s',characterId:'c',recentMessages:originalRows,enrichAllTurns:true,searchIntent:{...buildProductSearchIntent(mixedText),orderIntent:'lookup'},jevDecision:{...primary,orderIntent:'lookup'},classifyCommerce:async()=>({...mixedDecision,productRequirement:{action:'none'},productRequirementAction:'none',replyBoundary:{salesAllowed:true,contactAllowed:false}})});
assert.equal(mixedAmbiguous.productCandidateState.status,'active');assert.equal(mixedAmbiguous.orderIntent,'lookup');assert.equal(mixedAmbiguous.businessKnowledgeRequired,true);assert.equal(mixedAmbiguous.replyBoundary.contactAllowed,false);assert(!mixedAmbiguous.shouldLoadProductContext&&!mixedAmbiguous.cardAllowed);
console.log('Contradictory merchandise metadata does not alter other primary routes, mixed purposes or single/multiple owner boundaries');
const {repairGroundedCommerceReply}=await import('../server/chat-grounded-reply-repair-service.js');
let repairPayload,repairPrompt;
const repairedUnresolved=await repairGroundedCommerceReply({searchIntent:routed,productContext:null,character:owner,trustedSite:site,userText:text,
 replyResult:{text:'I cannot verify availability.',sourceType:'ai'},reviewStatus:'valid',reviewResult:{allowed:false,confidence:.9,boundarySupported:true,businessFactsSupported:false,evidenceSupported:false},failedContracts:['evidence','business_facts'],
 knowledgeContext:{ok:true,items:[],strategy:'not_requested',customerServiceIntent:false},factualContext:{required:false,searched:false,status:'not_required',items:[]},
 config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},recordLog:async()=>{},requestText:async prompt=>{repairPrompt=prompt;repairPayload=JSON.parse(prompt.messages[0].content);return JSON.stringify({displayText:'What did you mean by the colour and reference?'});}});
assert(repairedUnresolved);assert.deepEqual(repairPayload.unresolvedProductRequirementContext,reviewPacket.unresolvedProductRequirementContext,'The existing bounded rewrite receives the identical USER requirement projection');assert(repairPrompt.systemPrompt.includes('empty current scalar update removes that requirement'));
console.log('The existing bounded repair receives the same clarification purpose; no eligibility or retry count was added');
assert.equal(toUnresolvedProductRequirementContext({...routed,replyBoundary:{salesAllowed:false,contactAllowed:true}},{character:owner,trustedSite:site}),null,'Residual active requirements cannot reopen an explicit shopping refusal');
assert.equal(correctionIntent.replyBoundary.salesAllowed,false,'An orphan correction is action-closed after its original USER permission was validated');
const stillVisible=applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({character:owner,trustedSite:site,userText:correctionText,productContext:null}),correctionIntent,{character:owner,trustedSite:site,userText:correctionText});
assert(stillVisible.layers.find(layer=>layer.id==='commerce_clarification')?.content.includes(JSON.stringify(currentRequirements)),'Action-closed orphan purpose retains its validated typed correction despite its internally closed sales flag');
const refusalText='Do not shop, just talk.';
const refusalDecision={...normalizeCommerceDecision({...orphanRaw,route:'chat',answerRequired:false,needsLiveProductData:false,productRequest:{relation:'none',action:'new',items:[],selectedIndex:null},productRequirement:{action:'none'},knowledgeScope:'general',knowledgeQuery:'',knowledgeRequest:{kind:'conversation_only',evidence:refusalText},policyKnowledgeRequest:{required:false,evidence:refusalText,query:''},replyBoundary:{salesAllowed:false,contactAllowed:false}},{userText:refusalText}),detectionSource:'jev',candidateDecisionRequired:true};
const refusal=await resolveCommerceSearchIntent({userText:refusalText,siteId:'s',characterId:'c',recentMessages:originalRows,enrichAllTurns:true,searchIntent:buildProductSearchIntent(refusalText),jevDecision:{...primary,primaryIntent:'daily_chat',productIntent:'none'},classifyCommerce:async()=>refusalDecision});
assert.equal(refusal.replyBoundary.salesAllowed,false);assert(!refusal.shouldLoadProductContext&&!refusal.cardAllowed);assert.notEqual(refusal.productCandidateState?.status,'active');
const refusalProduced=await resolveGuestProductRecommendation({execute:async()=>[[{id:'s',slug:'fixture',product_api_url:'https://catalogue.invalid/products'}]]},{guest:{site_id:'s',site_slug:'fixture',mascot_character_id:'c'},userText:refusalText,precomputedSearchIntent:refusal,searchProducts:async()=>{throw Error('A shopping refusal cannot search');}});
const refusalPrompt=applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({character:owner,trustedSite:site,userText:refusalText,productContext:refusalProduced.context}),refusalProduced.searchIntent,{character:owner,trustedSite:site,userText:refusalText});
assert(!refusalPrompt.layers.some(layer=>['product_requirement_clarification','commerce_clarification'].includes(layer.id)),'An actual refusal cannot ask to continue the old shopping target');
console.log('Real producer separates explicit shopping refusal from an already validated action-closed orphan correction');

// A non-action turn pauses only the proven unfinished USER conditions. This
// isolation uses the real router/producer/prompt/next-turn path, not model proof.
const pauseText='Which one did you mean?';
const dailyPrimary={ok:true,confident:true,source:'jev',primaryIntent:'daily_chat',productIntent:'none',productAction:0,imageIntent:'none',orderIntent:'none',webSearchIntent:false,unsupported:false};
const pauseRaw={...orphanRaw,route:'chat',topic:'other',answerRequired:false,needsLiveProductData:false,knowledgeScope:'general',knowledgeQuery:'',
 knowledgeRequest:{kind:'conversation_only',evidence:pauseText},policyKnowledgeRequest:{required:false,evidence:pauseText,query:''},
 productRequest:{relation:'none',action:'new',items:[],selectedIndex:null,selectionEvidence:pauseText},productRequirement:{action:'none'},candidateResponse:{action:'none'}};
const pauseDecision={...normalizeCommerceDecision(pauseRaw,{userText:pauseText}),detectionSource:'jev',candidateDecisionRequired:true};
const pauseOptions={userText:pauseText,siteId:'s',characterId:'c',recentMessages:originalRows,enrichAllTurns:true,searchIntent:buildProductSearchIntent(pauseText),jevDecision:dailyPrimary,classifyCommerce:async()=>pauseDecision};
const paused=await resolveCommerceSearchIntent(pauseOptions);
assert.equal(paused.productCandidateState?.status,'active','A valid unrelated non-action is not cancellation of unfinished USER requirements');
assert.deepEqual(paused.productCandidateState,routed.productCandidateState);
assert(paused.primarySearchBlocked);assert(!paused.shouldLoadProductContext&&!paused.cardAllowed&&!paused.candidateSearchAllowed);
assert(!paused.replyClarificationContext);
let pauseSearchCalls=0;
const pausedProduced=await resolveGuestProductRecommendation({execute:async()=>[[{id:'s',slug:'fixture',product_api_url:'https://catalogue.invalid/products'}]]},
 {guest:{site_id:'s',site_slug:'fixture',mascot_character_id:'c'},userText:pauseText,precomputedSearchIntent:paused,searchProducts:async()=>{pauseSearchCalls++;throw Error('A paused USER task cannot search');}});
assert.equal(pauseSearchCalls,0);assert.equal(pausedProduced.context,null);
const pausePrompt=applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({character:owner,trustedSite:site,userText:pauseText,productContext:pausedProduced.context}),pausedProduced.searchIntent,{character:owner,trustedSite:site,userText:pauseText});
assert(!pausePrompt.layers.some(layer=>['product_requirement_clarification','commerce_clarification'].includes(layer.id)),'Pause data cannot inject a shopping clarification into ordinary chat');
const {prepareChatIntentTurn}=await import('../server/chat-intent-turn-service.js');
const pausedRows=[...originalRows,{senderType:'character',productCandidateState:paused.productCandidateState}];
let resumedMainInput;
await prepareChatIntentTurn({execute:async()=>[[]]},{session:{id:'pause-fixture'},siteId:'s',character:owner,recentMessages:pausedRows,userText:correctionText,userDisplayOrder:100,commerceForImageOnly:true,
 classify:async options=>{resumedMainInput=options;return primary;},classifyImage:async()=>({hasIntent:false,allowed:false})});
assert.equal(resumedMainInput.conversationContext.productContext.status,'active');assert.equal(resumedMainInput.conversationContext.productContext.needsClarification,true);
const resumedAfterPause=await resolveCommerceSearchIntent({userText:correctionText,siteId:'s',characterId:'c',recentMessages:pausedRows,enrichAllTurns:true,searchIntent:buildProductSearchIntent(correctionText),jevDecision:primary,classifyCommerce:async()=>correctionDecision});
assert.equal(resumedAfterPause.shouldLoadProductContext,true);assert.equal(resumedAfterPause.productCandidateState.requirements.requestedColor,'');
let resumedSearchCalls=0;
const resumedProduced=await resolveGuestProductRecommendation({execute:async()=>[[{id:'s',slug:'fixture',product_api_url:'https://catalogue.invalid/products'}]]},
 {guest:{site_id:'s',site_slug:'fixture',mascot_character_id:'c'},userText:correctionText,precomputedSearchIntent:resumedAfterPause,searchProducts:async options=>{resumedSearchCalls++;assert.equal(options.searchIntent.requestedTeam,'Venezuela');assert.equal(options.searchIntent.requestedSeason,'2026');assert.equal(options.searchIntent.requestedColor,'');return{ok:true,site:{id:'s',slug:'fixture'},searchState:'ready_to_search',searchOutcome:'no_match',items:[]};}});
assert.equal(resumedSearchCalls,1,'Only the next admitted explicit correction starts a real producer lookup');
assert.equal(resumedProduced.context.searchOutcome,'no_match');
const pauseVariants=[
 ['cancel',{productRequirement:{action:'cancel',evidence:pauseText,updates:[]}}],
 ['refusal',{replyBoundary:{salesAllowed:false,contactAllowed:true}}],
 ['new-target',{productRequirement:{action:'new',evidence:pauseText,updates:[]},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null}}],
 ['scope-cancel',{productRequest:{relation:'none',action:'cancel',items:[],selectedIndex:null,selectionEvidence:pauseText}}],
 ['scope-suspend',{productRequest:{relation:'none',action:'suspend',items:[],selectedIndex:null,selectionEvidence:pauseText}}],
 ['unverified-boundary',{}, {boundaryVerified:false}],
 ['missing-typed-requirement',{}, {productRequirement:null}],
 ['card-reference',{}, {referencedProductId:'a-card'}],
 ['source-error',{}, {}, {searchIntent:{...buildProductSearchIntent(pauseText),sourceErrorCode:'timeout'}}],
 ['nonshopping',{}, {}, {searchIntent:{...buildProductSearchIntent(pauseText),nonShoppingReason:'feedback'}}],
 ['explicit-trigger',{}, {}, {explicitTrigger:true}],
 ...['new_image','character_photo','order_lookup','unsupported_request'].map(primaryIntent=>[primaryIntent,{}, {}, {jevDecision:{...dailyPrimary,primaryIntent}}]),
 ...[
  ['foreign',{...routed.productCandidateState,siteId:'foreign'}],
  ['selected',{...routed.productCandidateState,owner:'selected',selectedIndex:0,ownerEvidence:'invalid-owner'}],
  ['finished',{...routed.productCandidateState,unresolvedRequirements:undefined}],
  ['displayed',{...routed.productCandidateState,proposal:{status:'displayed',candidateId:'p',name:'A product',reply:'Is this the one?'}}],
  ['confirmed',{...routed.productCandidateState,proposal:{status:'confirmed',candidateId:'p',name:'A product',reply:'Confirmed'}}],
 ].map(([name,state])=>[name,{}, {}, {recentMessages:[{senderType:'character',productCandidateState:state}]}]),
 ['user-state',{}, {}, {recentMessages:[{senderType:'user',productCandidateState:routed.productCandidateState}]}],
 ['no-task',{}, {}, {recentMessages:[]}],
 ['pending-scope',{}, {}, {recentMessages:[...originalRows,{senderType:'character',productRequestState:foreignSet}]}],
 ['invalid-scope',{}, {}, {recentMessages:[...originalRows,{senderType:'character',productRequestState:{broken:true}}]}],
];
for(const [name,rawPatch,decisionPatch={},optionPatch={}] of pauseVariants){
 const variantDecision={...normalizeCommerceDecision({...pauseRaw,...rawPatch},{userText:pauseText}),detectionSource:'jev',candidateDecisionRequired:true,...decisionPatch};
 const output=await resolveCommerceSearchIntent({...pauseOptions,...optionPatch,classifyCommerce:async()=>variantDecision});
 assert.notEqual(output.productCandidateState?.status,'active',name+' must retain the original clearing boundary');
 assert(!output.shouldLoadProductContext&&!output.cardAllowed,name+' must not gain search/card actions');
}
const greetingText='Good morning, how are you?';
const greetingDecision={...normalizeCommerceDecision({...pauseRaw,productRequest:{...pauseRaw.productRequest,selectionEvidence:greetingText},knowledgeRequest:{kind:'conversation_only',evidence:greetingText},policyKnowledgeRequest:{required:false,evidence:greetingText,query:''}},{userText:greetingText}),detectionSource:'jev',candidateDecisionRequired:true};
const greetingPause=await resolveCommerceSearchIntent({...pauseOptions,userText:greetingText,searchIntent:buildProductSearchIntent(greetingText),classifyCommerce:async()=>greetingDecision});
assert.equal(greetingPause.productCandidateState.status,'active','An ordinary greeting pauses, rather than cancels, the unfinished USER conditions');
assert(!greetingPause.replyClarificationContext&&!greetingPause.shouldLoadProductContext&&!greetingPause.cardAllowed);
const privatePause=await resolveCommerceSearchIntent({...pauseOptions,classifyCommerce:async()=>({...pauseDecision,replyBoundary:{salesAllowed:true,contactAllowed:false}})});
assert.equal(privatePause.productCandidateState.status,'active');assert.equal(privatePause.replyBoundary.contactAllowed,false);
console.log('A daily non-action preserves only unfinished USER state, stays absent from current reply purposes, and resumes through the actual next-turn producer');
