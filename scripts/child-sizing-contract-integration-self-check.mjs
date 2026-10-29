import assert from 'node:assert/strict';
import {applyCommerceQuestionPromptPolicy} from '../server/commerce-routing-service.js';
import {buildChildProductSizingContext,CHILD_PRODUCT_SIZING_CONTRACT} from '../server/product-sizing-guidance-service.js';
import {buildReplyReviewMessages} from '../server/chat-reply-review-contracts.js';
import {enforceReplyBoundary} from '../server/chat-reply-boundary-service.js';
const intent={commerceRoute:'product_search',requestedAudience:'kids',requestedProductType:'shirt',shouldLoadProductContext:true,cardAllowed:true,knowledgeScope:'none',businessKnowledgeRequired:false};
const context=buildChildProductSizingContext({searchIntent:intent});
const generated=applyCommerceQuestionPromptPolicy({systemPrompt:'Existing persona',layers:[]},intent);
assert(generated.systemPrompt.includes(CHILD_PRODUCT_SIZING_CONTRACT));assert(generated.systemPrompt.includes('"needsSizeQuestion":true'));
const adult=applyCommerceQuestionPromptPolicy({systemPrompt:'Existing persona',layers:[]},{...intent,requestedAudience:'women'});assert(!adult.systemPrompt.includes(CHILD_PRODUCT_SIZING_CONTRACT));
const sized=applyCommerceQuestionPromptPolicy({},intent,{userText:'talla 24'});assert(sized.systemPrompt.includes('"needsSizeQuestion":false'));
const review=buildReplyReviewMessages({text:'Here is an option. What size does she wear?',speechText:'What size?',guidanceRequired:true,childProductSizingContext:context});
assert(review.some(m=>m.role==='system'&&m.content.includes(CHILD_PRODUCT_SIZING_CONTRACT)));
const packet=JSON.parse(review.at(-1).content);assert.equal(packet.childProductSizingContext.needsSizeQuestion,true);assert.equal(packet.proposedSpeech,'What size?');
let seen;await enforceReplyBoundary({replyResult:{text:'What size does she wear?'},searchIntent:intent,character:{id:'test',category_id:'mascot'},userText:'a kids shirt',language:'en',recordReview:async()=>{},assess:async options=>{seen=options;return{allowed:true,confidence:1,guidanceSupported:true,evidenceSupported:true,boundarySupported:true};}});
assert.equal(seen.childProductSizingContext.needsSizeQuestion,true);assert.equal(seen.guidanceRequired,true);
console.log('Child size guidance reaches generation and both-output review; adult scope and supplied size stay distinct.');

// A trusted site's explicit shared-mascot binding uses the same owner check for
// matched captions and near-item correction; legacy character site fields do not
// bypass another site's binding.
const {markAlternativeSearch,bindProductAlternativeContext}=await import('../server/product-alternative-service.js');
const {isGroundedCommerceRepairEligible}=await import('../server/chat-grounded-reply-repair-service.js');
const alternativeIntent={...intent,query:'Real Madrid retro kids shirt',commerceTopic:'other',requestedTeam:'Real Madrid',requestedVariants:['retro'],requestedVariant:'retro',candidateSearchAllowed:true,primarySearchVerified:true,replyBoundary:{salesAllowed:true,contactAllowed:true}};
const near={id:'kids-home',productId:'kids-home',name:'Kids Real Madrid Home Soccer Jersey Kit 2026/27',url:'https://shop.invalid/kids',siteId:'shop',available:true};
const source=markAlternativeSearch({matches:[],candidates:[],alternatives:[near]},alternativeIntent,['successful original lookup']);
const productContext=bindProductAlternativeContext({sourceType:'product_api',siteId:'shop',searchIntent:alternativeIntent,searchOutcome:'alternative',cardAllowed:true,products:[near]},source);
const repair={searchIntent:alternativeIntent,productContext,character:{id:'shared-guide',category_id:'mascot',site_id:'legacy-demo'},trustedSite:{id:'shop',identity_mascot_character_id:'shared-guide'},replyResult:{text:'Rejected caption',sourceType:'ai'},knowledgeContext:{items:[]},reviewStatus:'valid',reviewResult:{allowed:false,confidence:1,boundarySupported:true,evidenceSupported:false,guidanceSupported:false},failedContracts:['evidence','guidance']};
assert.equal(isGroundedCommerceRepairEligible(repair),true);
for(const patch of [{trustedSite:{id:'other',identity_mascot_character_id:'shared-guide'}},{trustedSite:{id:'shop',identity_mascot_character_id:'another-guide'}},{character:{...repair.character,category_id:'custom'}},{groundedRepairAttempted:true}])assert.equal(isGroundedCommerceRepairEligible({...repair,...patch}),false);
console.log('Near-item correction reuses canonical owner binding; foreign owner and second correction remain closed.');

// A non-team mention cannot clear an empty team slot and strip the actual name
// from keyword constraints just because both team parsers return ''.
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {normalizeCommerceDecision}=await import('../server/product-intent-classifier-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const nameText='Ronaldo retro kids shirt';
const nameDecision=normalizeCommerceDecision({route:'product_search',topic:'other',confidence:1,searchQuery:nameText,needsLiveProductData:true,knowledgeScope:'business',answerRequired:false,knowledgeRequest:{kind:'catalogue_only',evidence:nameText},replyBoundary:{salesAllowed:true,contactAllowed:true},commerceConstraints:{edition:null,team:{value:'Ronaldo',role:'other',evidence:'Ronaldo'}},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:{action:'new',evidence:nameText,updates:[],suspectedTerm:null},candidateResponse:{action:'none',candidateId:'',evidence:''}},{userText:nameText});
const routedName=await resolveCommerceSearchIntent({userText:nameText,siteId:'shop',characterId:'guide',searchIntent:buildProductSearchIntent(nameText),recentMessages:[],jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1},classifyCommerce:async()=>nameDecision});
assert.deepEqual(routedName.requestedKeywords,['ronaldo']);assert.equal(routedName.candidateSearchAllowed,true);
console.log('Non-team person evidence cannot erase an empty team slot or its identity keyword.');

const styleQuote = normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},commerceConstraints:{edition:{value:'fan',evidence:'retro'},team:null}},{userText:'retro kids shirt'});
assert.equal(styleQuote.commerceConstraints.edition,null,'a retro quote cannot manufacture a fan edition requirement');
const explicitEdition=normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},commerceConstraints:{edition:{value:'fan',evidence:'fan version retro'},team:null}},{userText:'fan version retro kids shirt'});
assert.equal(explicitEdition.commerceConstraints.edition.value,'fan','an explicit edition remains intact');
console.log('Retro style does not invent edition constraints; explicit fan/player evidence is preserved.');

const {commerceClassificationTimeout}=await import('../server/product-intent-classifier-service.js');
const sizeHistory=[{senderType:'character',productCandidateState:{version:1,status:'active',siteId:'shop',characterId:'guide',owner:'single',targetEvidence:'Real Madrid retro kids shirt',requirements:{requestedTeam:'Real Madrid',requestedProductType:'shirt',requestedAudience:'kids',requestedVariants:['retro']},proposal:null}}];
assert.equal(commerceClassificationTimeout('La talla es 24.',{siteId:'shop',characterId:'guide',recentMessages:sizeHistory}),40000,'an owned child-size continuation still needs the same complete typed merchandise protocol budget');
assert.equal(commerceClassificationTimeout('La talla es 24.',{siteId:'another',characterId:'guide',recentMessages:sizeHistory}),10000,'foreign state cannot affect current classification budget');

const sizingIntent={...alternativeIntent,commerceRoute:'product_question',commerceTopic:'sizing',cardAllowed:false,shouldLoadProductContext:false,needsLiveProductData:false,requestedSizes:['24'],answerRequired:true,knowledgeScope:'business',productCandidateState:{version:1,status:'active',siteId:'shop',characterId:'shared-guide',owner:'single',targetEvidence:'Real Madrid retro kids shirt',requirements:{...alternativeIntent,requestedSizes:['24']},proposal:null}};
const sizingRepair={...repair,searchIntent:sizingIntent,productContext:{sourceType:'product_api',sourceRef:'guest-current-product-sizing-context',siteId:'shop',cardAllowed:false,searchIntent:sizingIntent,sizingProduct:{...near,sizeChartResolved:true,sizeChart:{unit:'',columns:['Size','Length'],rows:[['24','58-60']]}}},knowledgeContext:{items:[],customerServiceIntent:true,customerServiceTopic:'sizing'},factualContext:{required:false,status:'not_required',searched:false,items:[],asOfUtc:'2026-10-26T01:00:00Z'},reviewResult:{allowed:false,confidence:1,boundarySupported:true,factualSupported:false,guidanceSupported:false,businessFactsSupported:false},failedContracts:['factual','guidance','business_facts']};
assert.equal(isGroundedCommerceRepairEligible(sizingRepair),true,'scoped child-size reply can correct invented chart units once without actions');
for(const patch of [{trustedSite:{id:'foreign'}},{searchIntent:{...sizingIntent,cardAllowed:true}},{searchIntent:{...sizingIntent,requestedAudience:'adult'}},{groundedRepairAttempted:true}])assert.equal(isGroundedCommerceRepairEligible({...sizingRepair,...patch}),false);

const namedUser='Ronaldo retro kids shirt';
const inferredTeam=normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},searchQuery:'Brazil retro shirt',commerceConstraints:{edition:null,team:{value:'Brazil',role:'product_target',evidence:'Ronaldo'}},productRequirement:{action:'new',evidence:namedUser,updates:[{field:'requestedKeywords',value:['Ronaldo'],evidence:'Ronaldo'}],suspectedTerm:null}},{userText:namedUser});
assert.equal(inferredTeam.commerceConstraints.team,null);assert.equal(inferredTeam.nameOnlyTeamInference,true);
const specifiedTeam=normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},commerceConstraints:{edition:null,team:{value:'Portugal',role:'product_target',evidence:'Portugal'}},productRequirement:{action:'new',evidence:'Portugal Ronaldo',updates:[{field:'requestedKeywords',value:['Ronaldo'],evidence:'Ronaldo'}],suspectedTerm:null}},{userText:'Portugal Ronaldo'});
assert.equal(specifiedTeam.commerceConstraints.team.value,'Portugal');

const sizeText='La talla es 24.';
const sizeDecision=normalizeCommerceDecision({route:'product_search',topic:'sizing',confidence:1,needsLiveProductData:false,searchQuery:'Real Madrid retro kids shirt size 24',knowledgeScope:'business',answerRequired:true,replyBoundary:{salesAllowed:true,contactAllowed:true},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:{action:'continue',evidence:sizeText,updates:[{field:'requestedSizes',value:['24'],evidence:sizeText}],suspectedTerm:null}},{userText:sizeText});
const scopedSize=await resolveCommerceSearchIntent({userText:sizeText,siteId:'shop',characterId:'guide',recentMessages:sizeHistory,searchIntent:buildProductSearchIntent(sizeText),jevDecision:{ok:true,confident:true,primaryIntent:'daily_chat',productIntent:'none',productAction:0,imageIntent:'none',orderIntent:'none',webSearchIntent:false},classifyCommerce:async()=>sizeDecision});
assert.equal(scopedSize.productCandidateState.status,'active','a no-action size answer must not cancel its original child target');assert.deepEqual(scopedSize.requestedSizes,['24']);assert.deepEqual(scopedSize.requestedVariants,['retro']);assert.equal(scopedSize.cardAllowed,false);assert.equal(scopedSize.shouldLoadProductContext,false);

const {repairGroundedCommerceReply}=await import('../server/chat-grounded-reply-repair-service.js');
for(const [scope,options] of [['alternative',repair],['child-size',sizingRepair]]){
 let packet,system,calls=0;
 await repairGroundedCommerceReply({...options,userText:'The current user request',language:'en',config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},requestText:async prompt=>{calls++;packet=JSON.parse(prompt.messages[0].content);system=prompt.systemPrompt;return JSON.stringify({displayText:'I have noted the current request without a new action.'});},recordLog:async()=>{}});
 assert.equal(calls,1);assert(!Object.hasOwn(packet,'proposedResponse'),'rejected wording is never a source for fresh scoped correction');
 if(scope==='alternative'){assert(system.includes('SERVER handles the real card'));assert(!system.includes('For these ordinary matched catalogue cards'));}
 else{assert(packet.childSizingSnapshot);assert(system.includes('merely supplies the requested size'));}
}
console.log('Fresh near-item and child-size corrections omit rejected drafts and reuse one complete-review candidate.');

const translatedAttribute=normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},searchQuery:'Real Madrid retro home kids shirt',commerceConstraints:{edition:null,team:{value:'Real Madrid',role:'product_target',evidence:'Real Madrid'}},productRequirement:{action:'new',evidence:'Real Madrid de local',updates:[{field:'requestedVariants',value:['home'],evidence:'de local'},{field:'requestedKeywords',value:['local'],evidence:'de local'}],suspectedTerm:null}},{userText:'Real Madrid de local'});
assert(!translatedAttribute.productRequirement.updates.some(u=>u.field==='requestedKeywords'),'a canonical team query does not gain an unresolved name from a translated attribute');
const wholeStyle='Busco una camiseta retro de Ronaldo';
const unmentionedEdition=normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},searchQuery:'Ronaldo retro kids shirt',commerceConstraints:{edition:{value:'fan',evidence:wholeStyle},team:null},productRequirement:{action:'new',evidence:wholeStyle,updates:[{field:'requestedVariants',value:['retro'],evidence:'retro'},{field:'requestedKeywords',value:['Ronaldo'],evidence:'Ronaldo'}],suspectedTerm:null}},{userText:wholeStyle});
// Unknown residual language is not silently discarded as a version requirement.
assert.equal(unmentionedEdition.commerceConstraints.edition.value,'fan');
assert.equal(unmentionedEdition.productRequirement,null,'inconsistent broad-edition protocol is refused, not silently weakened');

const keepName=normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},searchQuery:'Real Madrid retro kids shirt',commerceConstraints:{edition:null,team:null},productRequirement:{action:'new',evidence:'Real Madrid Ronaldo retro kids shirt',updates:[{field:'requestedKeywords',value:['Ronaldo'],evidence:'Ronaldo'}],suspectedTerm:null}},{userText:'Real Madrid Ronaldo retro kids shirt'});
assert(keepName.productRequirement.updates.some(u=>u.field==='requestedKeywords'));
const foreignEdition=normalizeCommerceDecision({route:'product_search',confidence:1,replyBoundary:{salesAllowed:true,contactAllowed:true},searchQuery:'Real Madrid retro kids shirt',commerceConstraints:{edition:{value:'fan',evidence:'versión aficionado'},team:null},productRequirement:{action:'new',evidence:'Real Madrid retro versión aficionado',updates:[{field:'requestedVariants',value:['retro'],evidence:'retro'}],suspectedTerm:null}},{userText:'Real Madrid retro versión aficionado'});
assert.equal(foreignEdition.commerceConstraints.edition.value,'fan');

const {projectChildSizingUpdatePrompt,hasUnsupportedChildSizingUnit}=await import('../server/product-sizing-guidance-service.js');
const projected=projectChildSizingUpdatePrompt({searchIntent:{...sizingIntent,childSizingUpdateOnly:true},productContext:sizingRepair.productContext,recentMessages:[{senderType:'character',text:'58-60 cm'},{senderType:'user',text:'talla 24'}]});
assert(!JSON.stringify(projected).includes('58-60'));assert.equal(sizingRepair.productContext.sizingProduct.sizeChart.rows[0][1],'58-60','real source remains intact');
assert.equal(projected.recentMessages.length,1);
assert(hasUnsupportedChildSizingUnit({...sizingRepair,searchIntent:{...sizingIntent,childSizingUpdateOnly:true},text:'length 58–60 cm',userText:'size 24'}));
assert(!hasUnsupportedChildSizingUnit({...sizingRepair,searchIntent:{...sizingIntent,childSizingUpdateOnly:true},text:'You reported 140 cm',userText:'140 cm'}));
assert(!hasUnsupportedChildSizingUnit({...sizingRepair,searchIntent:{...sizingIntent,childSizingUpdateOnly:true},text:'length 58-60 cm',productContext:{...sizingRepair.productContext,sizingProduct:{...sizingRepair.productContext.sizingProduct,sizeChart:{unit:'cm'}}}}));
assert(!hasUnsupportedChildSizingUnit({...sizingRepair,searchIntent:{...sizingIntent,childSizingUpdateOnly:true,requestedAudience:'adult'},text:'58-60 cm'}));
console.log('Size-update prompts omit irrelevant measurements/assistant drafts; unknown units cannot become unsupported physical claims.');

let unitReviews=0,unitRepairs=0;
const unitVote={allowed:true,confidence:1,boundarySupported:true,evidenceSupported:true,guidanceSupported:true,businessFactsSupported:true,factualSupported:true};
const unitOutput=await enforceReplyBoundary({...sizingRepair,searchIntent:{...sizingIntent,childSizingUpdateOnly:true},replyResult:{sourceType:'ai',text:'The length is 58-60 cm.',speechText:'The length is 58-60 cm.'},userText:'size 24',language:'en',recordReview:async()=>{},assess:async()=>{unitReviews++;return unitVote;},repairGroundedReply:async options=>{unitRepairs++;return {...options.replyResult,text:'I have noted size 24 for this request.',speechText:'I have noted size 24 for this request.'};}});
assert.equal(unitReviews,2);assert.equal(unitRepairs,1);assert.equal(unitOutput.text,'I have noted size 24 for this request.');assert(!unitOutput.degraded);

assert(!hasUnsupportedChildSizingUnit({...sizingRepair,searchIntent:{...sizingIntent,childSizingUpdateOnly:true},text:'I have noted size 24 in your original request.'}));
assert(!hasUnsupportedChildSizingUnit({...sizingRepair,text:'The delivery policy covers packages up to 2 kg.'}),'mixed/business measurement paths do not enter the update-only unit guard');

const updateDecision={...sizeDecision,declaredLiveProductData:true,knowledgeRequest:{kind:'sizing_update',evidence:sizeText}};
const updateRoute=await resolveCommerceSearchIntent({userText:sizeText,siteId:'shop',characterId:'guide',recentMessages:sizeHistory,searchIntent:buildProductSearchIntent(sizeText),jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'none',productAction:.5,imageIntent:'none',orderIntent:'none',webSearchIntent:false},classifyCommerce:async()=>updateDecision});
assert.equal(updateRoute.childSizingUpdateOnly,true);assert.equal(updateRoute.cardAllowed,false);assert.equal(updateRoute.shouldLoadProductContext,false);assert.equal(updateRoute.needsLiveProductData,false);assert.equal(updateRoute.businessKnowledgeRequired,false);assert.deepEqual(updateRoute.requestedSizes,['24']);
const explicitSearch=await resolveCommerceSearchIntent({userText:sizeText,siteId:'shop',characterId:'guide',recentMessages:sizeHistory,searchIntent:buildProductSearchIntent(sizeText),jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1,imageIntent:'none',orderIntent:'none',webSearchIntent:false},classifyCommerce:async()=>updateDecision});
assert.equal(explicitSearch.childSizingUpdateOnly,false,'a primary-approved new search is not silently converted into a sizing acknowledgment');
