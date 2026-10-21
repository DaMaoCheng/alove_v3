import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const { isGroundedCommerceRepairEligible, repairGroundedCommerceReply }=await import('../server/chat-grounded-reply-repair-service.js');
const { productCandidateContext }=await import('../server/product-search-execution-service.js');
const { toCandidateReviewContext }=await import('../server/product-candidate-context-service.js');
const { readProductCandidateState, applyProductCandidateState }=await import('../server/product-candidate-state-service.js');
const location={siteId:'site',characterId:'role'};
const items=[{evidence:'Real Madrid shirt with a collar, budget 29 EUR',sharedEvidence:'',text:'Real Madrid shirt with a collar, budget 29 EUR'},
 {evidence:'Barcelona home shirt',sharedEvidence:'',text:'Barcelona home shirt'}];
const scope={version:1,status:'selected',...location,items,selectedIndex:0,clarificationCount:0};
const state={version:1,status:'active',...location,owner:'selected',selectedIndex:0,
 ownerEvidence:createHash('sha256').update(JSON.stringify(items.map(i=>[i.evidence,i.sharedEvidence]))).digest('hex'),
 targetEvidence:items[0].evidence,requirements:{requestedTeam:'Real Madrid',requestedProductType:'shirt',requestedKeywords:['collar']},proposal:null};
const intent={commerceRoute:'product_search',shouldLoadProductContext:true,cardAllowed:true,replyBoundary:{salesAllowed:true,contactAllowed:false},
 requestedTeam:'Real Madrid',requestedProductType:'shirt',requestedKeywords:['collar'],productRequestState:scope,productCandidateState:state};
const product={id:'p',productId:'p',name:'Real Madrid Home Fan Jersey',siteId:'site',url:'https://site.invalid/p',price:'50.99 EUR',available:true,
 matchStatus:'candidate',attributeEvidence:{edition:'fan',sleeve:'unknown',printing:'none',giveaway:false}};
const context={sourceType:'product_api',sourceRef:'site-product-context',siteId:'site',cardAllowed:true,searchOutcome:'candidate',searchIntent:intent,
 products:[product],candidateContext:productCandidateContext([product],intent)};
const options={character:{id:'role',category_id:'mascot'},replyResult:{text:'This design matches your request.',sourceType:'ai',sourceRef:'venice-chat-completions'},
 reviewStatus:'valid',reviewResult:{confidence:.97,boundarySupported:true},failedContracts:['evidence','product_scope'],searchIntent:intent,productContext:context};
assert.equal(isGroundedCommerceRepairEligible(options),true,'validated selected owner/source must allow one wording correction, not block solely on product_scope');
for(const patch of [
 {searchIntent:{...intent,productRequestState:{...scope,status:'pending',selectedIndex:null}}},
 {searchIntent:{...intent,scopeUnverified:true}},
 {searchIntent:{...intent,productCandidateState:{...state,selectedIndex:1}}},
 {searchIntent:{...intent,productCandidateState:{...state,ownerEvidence:'other'}}},
 {character:{id:'other',category_id:'mascot'}},
 {productContext:{...context,siteId:'other'}},
 {productContext:JSON.parse(JSON.stringify(context))},
 {productContext:{...context,products:[{...product,attributeEvidence:{...product.attributeEvidence,sleeve:'long_sleeve'}}]},searchIntent:{...intent,requestedFeatures:['short_sleeve']}},
])assert.equal(isGroundedCommerceRepairEligible({...options,...patch}),false,'pending/unverified/wrong owner/source/hard mismatch must remain ineligible');
let calls=0;
const fixed=await repairGroundedCommerceReply({...options,config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},userText:'Show the candidate.',
 requestText:async prompt=>{calls++;const packet=JSON.parse(prompt.messages[0].content);
 assert.deepEqual(packet.requirements.requestedKeywords,['collar']);
 assert.ok(packet.candidate.requestedConditionEvidence.includes(items[0].evidence));
 assert.equal(packet.candidate.products[0].price,'50.99 EUR');
 assert.match(prompt.systemPrompt,/budget/);
 return JSON.stringify({displayText:'This is a possible catalogue item. The collar and your budget remain unverified. Is this the item you mean?'});
 }});
assert.ok(fixed&&calls===1&&!fixed.productScopeVerified,'correction supplies no card/review approval');
const projected=toCandidateReviewContext(context);
assert.ok(projected.requestedConditionEvidence.includes(items[0].evidence),'free condition/budget evidence survives finite attribute projection');
const continuation='I need a concealed zipper.';
const next=applyProductCandidateState(intent,{confident:true,confidence:.99,productRequirement:{action:'continue',evidence:continuation,updates:[],suspectedTerm:null},candidateResponse:{action:'none'}},
 {...location,userText:continuation,recentMessages:[{senderType:'character',productCandidateState:state,productRequestState:scope}]});
const loaded=readProductCandidateState([{senderType:'character',productCandidateState:next.productCandidateState}],location);
assert.ok(loaded.requestedConditionEvidence.includes(items[0].evidence)&&loaded.requestedConditionEvidence.includes(continuation),'generic new untyped conditions survive state read and later confirmation');
console.log('selected candidate repair and free-condition evidence self-check passed (no external calls/DB)');
// Build an actual private confirmation context rather than copying an approval.
const { buildCandidateConfirmationContext }=await import('../server/product-candidate-confirmation-service.js');
const assent='Yes, that is the item.';
const displayedState={...state,requestedConditionEvidence:loaded.requestedConditionEvidence,proposal:{status:'displayed',candidateId:'p',name:product.name,reply:'Is this the item you mean?'}};
const confirmedIntent={...intent,commerceRoute:'product_question',cardAllowed:false,shouldLoadProductContext:false,needsLiveProductData:false,
 candidateConfirmationOnly:true,confirmedCandidateId:'p',referencedProductId:'p',productCandidateState:{...displayedState,proposal:{...displayedState.proposal,status:'confirmed',confirmationEvidence:assent}}};
const confirmedContext=await buildCandidateConfirmationContext({site:{id:'site',slug:'site'},characterId:'role',userText:assent,searchIntent:confirmedIntent,
 recentMessages:[{senderType:'character',characterId:'role',contentType:'product',product},
 {senderType:'character',characterId:'role',productCandidateState:displayedState,productRequestState:scope}],
 resolveProduct:async()=>({resolvedFromSource:true,site:{id:'site',slug:'site'},sourceItem:product}),buildCandidateContext:productCandidateContext});
const confirmedProjection=toCandidateReviewContext(confirmedContext);
assert.ok(confirmedProjection.entityConfirmed);
assert.ok(confirmedProjection.requestedConditionEvidence.includes(continuation));
assert.ok(confirmedProjection.products[0].unmatchedSearchTerms.includes('collar'),'identity assent must not erase an unverified search condition');
assert.equal(isGroundedCommerceRepairEligible({...options,userText:assent,searchIntent:confirmedIntent,productContext:confirmedContext}),true,
 'selected identity-only confirmation may correct wording with exact private source, without a new card');
for(const [mutateIntent,mutateProduct] of [
 [(i)=>({...i,productCandidateState:{...i.productCandidateState,ownerEvidence:'wrong-scope'}}),(p)=>p],
 [(i)=>({...i,requestedFeatures:['short_sleeve']}),(p)=>({...p,attributeEvidence:{...p.attributeEvidence,sleeve:'long_sleeve'}})],
 [(i)=>i,(p)=>({...p,siteId:'different-site'})],
 [(i)=>i,(p)=>({...p,available:false})],
]) {
 const alteredIntent=mutateIntent(intent),alteredProduct=mutateProduct(product);
 const signedContext={...context,searchIntent:alteredIntent,products:[alteredProduct],candidateContext:productCandidateContext([alteredProduct],alteredIntent)};
 assert.equal(isGroundedCommerceRepairEligible({...options,searchIntent:alteredIntent,productContext:signedContext}),false,
  'even a newly constructed source proof cannot authorize wrong scope/site, unavailable stock or conflicting hard attributes');
}
console.log('selected confirmation preserves free conditions; fresh source proofs do not relax hard constraints');

const memberSource={...product};delete memberSource.siteId;
const memberContext={...context,products:[memberSource],candidateContext:productCandidateContext([memberSource],intent,location)};
assert.equal(isGroundedCommerceRepairEligible({...options,productContext:memberContext}),true,
 'member source rows without siteId retain the actual server-resolved site binding');
for(const fakeLocation of [{...location,siteId:'other'},{...location,characterId:'other'}]) {
 const fakeContext={...context,products:[memberSource],candidateContext:productCandidateContext([memberSource],intent,fakeLocation)};
 assert.equal(isGroundedCommerceRepairEligible({...options,productContext:fakeContext}),false,'a mismatched trusted location cannot borrow another owner/site');
}
console.log('member raw-source location binding checks passed');

const contactContext={...context,candidateContext:{...context.candidateContext,requestedConditionEvidence:['A collar, contact visitor@example.test']}};
const privateProjection=toCandidateReviewContext(contactContext);
assert(!JSON.stringify(privateProjection).includes('visitor@example.test'));
assert(privateProjection.requestedConditionEvidence[0].includes('[contact email provided]'));
console.log('Free-condition prompt projection retains existing contact redaction');
const uncertain={...options,reviewResult:{...options.reviewResult,allowed:false,confidence:.6,evidenceSupported:false,candidateConfirmationSupported:false},failedContracts:['confidence','evidence','candidate_confirmation']};
assert.equal(isGroundedCommerceRepairEligible(uncertain),true,'uncertain but well-shaped review may regenerate only a trusted selected candidate');
for(const patch of [
 {reviewStatus:'missing_fields'}, {reviewStatus:'timeout'},
 {reviewResult:{...uncertain.reviewResult,confidence:NaN}}, {reviewResult:{...uncertain.reviewResult,confidence:-.1}},
 {reviewResult:{...uncertain.reviewResult,confidence:1.1}}, {reviewResult:{confidence:.6}}, {reviewResult:{...uncertain.reviewResult,evidenceSupported:undefined}},
 {productContext:JSON.parse(JSON.stringify(context))}, {groundedRepairAttempted:true},
 {searchIntent:{...intent,productRequestState:{...scope,status:'pending',selectedIndex:null}}},
])assert.equal(isGroundedCommerceRepairEligible({...uncertain,...patch}),false,'protocol failure, lost proof, pending scope and another repair cannot use uncertainty as permission');
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
for(const finalConfidence of [.98,.6]) {
 let corrections=0,wholeReviews=0;
 const texts=[];
 const pass={allowed:true,confidence:finalConfidence,boundarySupported:true,evidenceSupported:true,businessFactsSupported:true,
  productScopeSupported:true,candidateConfirmationSupported:true,languageQualitySupported:true,guidanceSupported:true,factualSupported:true};
 const result=await enforceReplyBoundary({character:options.character,searchIntent:intent,productContext:context,
  userText:'Show the possible candidate.',language:'en',replyResult:options.replyResult,
  languageQualityRequired:true,independentLanguageQualityRequired:true,
  assess:async review=>{wholeReviews++;texts.push(review.text);assert.deepEqual(review.boundary,intent.replyBoundary);
   assert.equal(review.productContext,context,'same server evidence must be fully reviewed again');
   return wholeReviews===1?{...pass,allowed:false,confidence:.6,evidenceSupported:false,candidateConfirmationSupported:false}:pass;},
  assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.99,languageQualitySupported:true,languageIssues:[],severity:'none'}),
  repairGroundedReply:async input=>repairGroundedCommerceReply({...input,config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},
   requestText:async()=>{corrections++;return JSON.stringify({displayText:'The collar remains unverified. Is this the item you mean?'});}}),
  recordReview:async()=>{},
 });
 assert.equal(corrections,1,'uncertainty permits exactly one new text, never repeated approval attempts');
 assert.equal(wholeReviews,2,'the fresh candidate receives the whole original review');
 assert.notEqual(texts[0],texts[1],'never review the rejected original again');
 if(finalConfidence>=.8)assert.equal(result.text,'The collar remains unverified. Is this the item you mean?');
 else assert.equal(result.sourceRef,'reply-boundary-guard','fresh low-confidence assessment still fails the unchanged final .8 gate');
}
console.log('uncertain selected source permits one regeneration and full unchanged-threshold re-review');
