import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {normalizeCommerceDecision}=await import('../server/product-intent-classifier-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const {resolveGuestProductRecommendation}=await import('../server/guest-chat-product-service.js');
const {buildChatProductRecommendationContext}=await import('../server/chat-product-recommendation-service.js');
const {getCandidateAttributeReferenceState,toCandidateAttributeReplyContext}=await import('../server/product-candidate-reference-service.js');
const {finalizeProductCandidateState}=await import('../server/product-candidate-state-service.js');
const {insertMessage}=await import('../server/chat-message-store.js');
const site={id:'s',slug:'fixture',name:'Fixture',product_api_url:'https://fixture.invalid/products'};
const character={id:'c',category_id:'mascot',site_id:'s'};
const target='Camiseta de niña retro Cristiano Ronaldo';
const product={id:'p',productId:'p',siteId:'s',siteSlug:'fixture',name:'Portugal RONALDO Kids Kit 2026',matchStatus:'candidate',url:'https://fixture.invalid/p'};
const state={version:1,status:'active',siteId:'s',characterId:'c',owner:'single',targetEvidence:target,requestedConditionEvidence:[target],
  requirements:{requestedProductType:'shirt',requestedAudience:'kids',requestedVariants:['retro'],requestedKeywords:['cristiano ronaldo']},suspectedTerm:null,
  proposal:{status:'displayed',candidateId:'p',name:product.name,reply:'This candidate is not retro. Does its catalogue name identify your reference?'}};
const rows=[{senderType:'user',text:target},{senderType:'character',characterId:'c',contentType:'product',deliveryStatus:'sent',product},
  {senderType:'character',characterId:'c',contentType:'text',productCandidateState:state,text:state.proposal.reply}];
const text='La talla es 28.';
const raw={route:'product_question',topic:'sizing',confidence:.9,needsLiveProductData:false,knowledgeScope:'business',answerRequired:true,
  replyBoundary:{salesAllowed:true,contactAllowed:true},searchQuery:'cristiano ronaldo',
  productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:text},
  productRequirement:{action:'continue',evidence:text,updates:[{field:'requestedSizes',value:['28'],evidence:text}],suspectedTerm:null},
  candidateResponse:{action:'none',candidateId:'',evidence:''},knowledgeRequest:{kind:'sizing_update',evidence:text},
  policyKnowledgeRequest:{required:false,evidence:text,query:''}};
const location={siteId:'s',siteSlug:'fixture',characterId:'c'};
async function route(history=rows,patch={}) {return resolveCommerceSearchIntent({...location,userText:text,recentMessages:history,searchIntent:buildProductSearchIntent(text),enrichAllTurns:true,
  jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1,imageIntent:'none',orderIntent:'none',webSearchIntent:false},
  classifyCommerce:async()=>({...normalizeCommerceDecision({...raw,...patch},{userText:text}),candidateDecisionRequired:true})});}
let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
const intent=await route();
check(intent.childSizingUpdateOnly===true,'Independent sizing_update/no-live is not vetoed by a primary binary search vote or unconfirmed displayed proposal');
check(!intent.cardAllowed&&!intent.shouldLoadProductContext&&!intent.needsLiveProductData,'Only the provided USER size is acknowledged, with no new source or card action');
check(intent.productCandidateState.proposal.status==='displayed'&&!intent.confirmedCandidateId&&!intent.candidateConfirmationOnly,'A size answer never confirms or accepts the different candidate');
check(intent.requestedSizes[0]==='28'&&intent.requestedAudience==='kids'&&intent.requestedVariants.includes('retro')&&intent.requestedKeywords.includes('cristiano ronaldo'),'All original target conditions survive');
for(const method of ['guest','member']){
  const forbidden=async()=>{throw Error('Pure USER size update must not search, refresh a product or read a chart');};
  const args={userText:text,recentMessages:rows,precomputedSearchIntent:intent,resolveSizingProduct:forbidden,resolveConfirmationProduct:forbidden};
  const context=method==='guest'?(await resolveGuestProductRecommendation({execute:async()=>[[site]]},{...args,guest:{site_id:'s',mascot_character_id:'c'},searchProducts:forbidden})).context
    :await buildChatProductRecommendationContext({execute:async()=>[[site]]},{...args,character,fetchProducts:forbidden});
  check(!context.products.length&&!context.sizingProduct&&!context.cardAllowed,'The actual '+method+' producer supplies no catalogue/chart facts');
  check(!toCandidateAttributeReplyContext(context),'Size acknowledgement cannot acquire the fresh candidate-attribute evidence capability');
  const persisted=getCandidateAttributeReferenceState(context)||finalizeProductCandidateState(intent.productCandidateState,null,{approvedReply:'Anotado, talla 28.'});
  let payload;await insertMessage({execute:async(sql,params)=>{payload=JSON.parse(params[9]);return[{affectedRows:1}];}},
    {sessionId:'fixture',characterId:'c',senderType:'character',contentType:'text',text:'Anotado, talla 28.',productCandidateState:persisted,displayOrder:40,sourceType:'ai',sourceRef:'fixture'});
  check(payload._productCandidateState.proposal.status==='displayed','The actual message payload keeps the candidate unconfirmed after '+method+' acknowledgement');
  const again=await route([...rows,{senderType:'user',text},{senderType:'character',characterId:'c',productCandidateState:payload._productCandidateState,text:'Anotado, talla 28.'}]);
  check(again.childSizingUpdateOnly&&again.productCandidateState.proposal.status==='displayed','A consecutive size-only turn remains an acknowledgement, not a chart query or substitute acceptance');
}
for(const patch of [{needsLiveProductData:true,knowledgeRequest:{kind:'business_question',evidence:text}},
  {route:'product_search',needsLiveProductData:true,knowledgeRequest:{kind:'catalogue_only',evidence:text}},
  {productRequirement:{...raw.productRequirement,action:'new'}},
  {productRequirement:{...raw.productRequirement,updates:[...raw.productRequirement.updates,{field:'requestedFeatures',value:['short_sleeve'],evidence:text}]}},
  {replyBoundary:{salesAllowed:false,contactAllowed:false}},
  {policyKnowledgeRequest:{required:true,evidence:text,query:text}}]) check(!(await route(rows,patch)).childSizingUpdateOnly,'Actual lookup, shopping, changed targets or independent policy retain their original routes');
for(const history of [[],rows.filter(r=>r.contentType!=='product'),rows.map(r=>r.productCandidateState?{...r,productCandidateState:{...state,siteId:'other'}}:r),
  [...rows,{senderType:'character',productCandidateState:state,productRequestState:{version:1,status:'pending',siteId:'s',characterId:'c',selectedIndex:null,clarificationCount:0,
    items:[{evidence:'Cristiano Ronaldo shirt',sharedEvidence:'',text:'Cristiano Ronaldo shirt'},{evidence:'Ireland shirt',sharedEvidence:'',text:'Ireland shirt'}]}}],
  rows.map(r=>r.productCandidateState?{...r,productCandidateState:{...state,owner:'selected',selectedIndex:0,ownerEvidence:'foreign'}}:r)]){
  check(!(await route(history)).childSizingUpdateOnly,'Missing, foreign or multiple targets cannot acquire the pure update purpose');
}
console.log(`Pure size update purpose: ${checks} checks passed; actual routing/producers/writer with injected sources only.`);
