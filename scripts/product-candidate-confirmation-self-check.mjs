import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw new Error('External calls forbidden in candidate confirmation checks')};
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {normalizeCommerceDecision,commerceClassificationTimeout}=await import('../server/product-intent-classifier-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const {finalizeProductCandidateState}=await import('../server/product-candidate-state-service.js');
const {selectProductsForMessage}=await import('../server/chat-product-reply-service.js');
const {productCandidateContext}=await import('../server/product-search-execution-service.js');
const {toCandidateReviewContext}=await import('../server/product-candidate-context-service.js');
const {buildChatProductRecommendationContext}=await import('../server/chat-product-recommendation-service.js');
const {buildGuestProductRecommendationContext}=await import('../server/guest-chat-product-service.js');
const {buildChatReplyPrompt}=await import('../server/chat-prompt-service.js');
const {buildReplyReviewMessages}=await import('../server/chat-reply-review-contracts.js');
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++};
const loc={siteId:'shop',characterId:'mascot_fixture'};
const product={id:'shirt',productId:'shirt',name:'Real Madrid Away Fan Jersey',siteId:'shop',siteSlug:'shop',matchStatus:'candidate',url:'https://shop.example/shirt'};
const state={version:1,status:'active',...loc,owner:'single',targetEvidence:'Real Madrid away shirt without printing',requirements:{requestedTeam:'Real Madrid',requestedProductType:'shirt',requestedPrinting:'none',requestedEdition:'fan',requestedFeatures:['short_sleeve'],requestedVariants:['away']},proposal:{status:'displayed',candidateId:'shirt',name:product.name,reply:'¿Es esta la camiseta que buscas?'}};
const history=[{senderType:'character',characterId:loc.characterId,contentType:'product',product},{senderType:'character',characterId:loc.characterId,productCandidateState:state}];
const userText='Sí, esa es la camiseta que quiero.';
const raw={route:'product_search',confidence:.99,searchQuery:'Real Madrid shirt',needsLiveProductData:true,replyBoundary:{salesAllowed:true,contactAllowed:false},commerceConstraints:{team:null,edition:null},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:{action:'continue',evidence:userText,updates:[],suspectedTerm:null},candidateResponse:{action:'confirm',candidateId:'shirt',evidence:userText}};
const jev={ok:true,confident:true,primaryIntent:'product_request',productIntent:'none',productAction:.7,webSearchIntent:false,imageIntent:'none',orderIntent:'none'};
const classify=(value=raw,text=userText)=>normalizeCommerceDecision(value,{userText:text});
async function route({text=userText,rows=history,decision=raw,primary=jev,location=loc}={}){return resolveCommerceSearchIntent({...location,userText:text,recentMessages:rows,searchIntent:buildProductSearchIntent(text),jevDecision:primary,classifyCommerce:async()=>classify(decision,text)})}
const intent=await route();
check(intent.candidateConfirmationOnly===true,'a genuine existing displayed-candidate assent uses the metadata-only branch');
check(!intent.cardAllowed&&!intent.shouldLoadProductContext&&!intent.candidateSearchAllowed&&intent.confirmedCandidateId==='shirt','confirmation never grants new search or a product card');
check(intent.productCandidateState.proposal.status==='confirmed'&&intent.requestedPrinting==='none','only tentative identity changes, user requirements remain intact');
check(intent.replyBoundary.contactAllowed===false&&intent.primarySearchVerified===false,'metadata confirmation retains contact restrictions and does not claim search approval');
check(commerceClassificationTimeout(userText,{...loc,recentMessages:history,jevDecision:jev})===40000,'trusted displayed confirmation uses the bounded candidate interpretation budget');
const authorizedSearch=await route({primary:{...jev,productIntent:'search',productAction:1}});
check(!authorizedSearch.candidateConfirmationOnly&&authorizedSearch.cardAllowed===true&&authorizedSearch.primarySearchVerified===true,'already authorized search retains its original card path rather than being suppressed by metadata confirmation');
check((await route({primary:{...jev,productAction:.55}})).candidateConfirmationOnly===true,'metadata identity assent does not lower or reuse the new-search score threshold');
const scopedItems=[{evidence:'Real Madrid away shirt without printing',sharedEvidence:'',text:'Real Madrid away shirt without printing'},
 {evidence:'Barcelona home shirt',sharedEvidence:'',text:'Barcelona home shirt'}];
const scope={version:1,status:'selected',...loc,items:scopedItems,selectedIndex:0,clarificationCount:0};
const selectedState={...state,owner:'selected',selectedIndex:0,ownerEvidence:createHash('sha256').update(JSON.stringify(scopedItems.map(item=>[item.evidence,item.sharedEvidence]))).digest('hex')};
const selectedRows=[history[0],{...history[1],productCandidateState:selectedState,productRequestState:scope}];
const selectedDecision={...raw,productRequest:{relation:'multiple',action:'continue',items:[],selectedIndex:0,selectionEvidence:userText}};
check((await route({rows:selectedRows,decision:selectedDecision})).candidateConfirmationOnly===true,'selected owner with current scope hash and index can confirm its displayed identity without a new card');
for(const [name,rows,decision] of [
 ['wrong selected index',selectedRows,{...selectedDecision,productRequest:{...selectedDecision.productRequest,selectedIndex:1}}],
 ['old owner hash',[history[0],{...history[1],productCandidateState:{...selectedState,ownerEvidence:'old-hash'},productRequestState:scope}],selectedDecision],
 ['new unselected scope',[history[0],{...history[1],productCandidateState:selectedState,productRequestState:{...scope,status:'pending',selectedIndex:null}}],selectedDecision],
])check(!(await route({rows,decision})).candidateConfirmationOnly,name+' cannot confirm an owned candidate');
for(const primary of [{...jev,primaryIntent:'order_lookup'},{...jev,webSearchIntent:true},{...jev,imageIntent:'explicit_generation'},{...jev,unsupported:true},{...jev,confident:false}]){const value=await route({primary});check(!value.candidateConfirmationOnly,'other or unreliable primary actions cannot use confirmation metadata')}
for(const [name,options] of [
 ['wrong site',{location:{...loc,siteId:'other'}}],['wrong role',{location:{...loc,characterId:'other'}}],
 ['no actual card',{rows:history.slice(1)}],['user-authored card',{rows:[{...history[0],senderType:'user'},history[1]]}],
 ['proposal timed out',{rows:[history[0],{...history[1],productCandidateState:{...state,proposal:null}}]}],
 ['cleared boundary',{rows:[...history,{senderType:'character',productCandidateState:{version:1,status:'cleared',...loc}}]}],
 ['wrong candidate id',{decision:{...raw,candidateResponse:{...raw.candidateResponse,candidateId:'other'}}}],
 ['old assent',{decision:{...raw,candidateResponse:{...raw.candidateResponse,evidence:'Earlier yes'}}}],
 ['denied sales',{decision:{...raw,replyBoundary:{salesAllowed:false,contactAllowed:false}}}],
 ['cancel',{decision:{...raw,productRequirement:{...raw.productRequirement,action:'cancel'}}}],
 ['new scope',{decision:{...raw,productRequest:{relation:'multiple',action:'new',items:[],selectedIndex:null,selectionEvidence:''}}}],
 ]){check(!(await route(options)).candidateConfirmationOnly,name+' cannot establish existing-candidate confirmation')}
const confirmation=await import('../server/product-candidate-confirmation-service.js');
const source={...product,attributeEvidence:{edition:'fan',sleeve:'unknown',printing:'none',giveaway:false},sizes:[]};
let sourceReads=0;const sourceResolver=async options=>{sourceReads++;check(options.strictSite===true&&options.exactProduct===true,'known SKU reads remain exact and current-site-bound');return{resolvedFromSource:true,site:{id:'shop',slug:'shop'},sourceItem:source}};
const context=await confirmation.buildCandidateConfirmationContext({site:{id:'shop',slug:'shop'},searchIntent:intent,recentMessages:history,userText,characterId:loc.characterId,resolveProduct:sourceResolver,buildCandidateContext:productCandidateContext});
check(sourceReads===1&&context.cardAllowed===false&&selectProductsForMessage(context).length===0,'one exact source read produces review evidence without a card');
const review=toCandidateReviewContext(context);
check(review?.entityConfirmed===true&&review.products.length===1&&review.products[0].attributeEvidence.sleeve==='unknown','review-only identity does not promote unknown catalogue attributes');
check(confirmation.getCandidateConfirmationProduct({...context})?.id==='shirt'&&!confirmation.getCandidateConfirmationProduct(JSON.parse(JSON.stringify(context))),'private review proof survives trusted context composition but cannot be reconstructed from client JSON');
const site={id:'shop',slug:'shop',site_status:'active',product_api_url:'ttmall://catalogue.example.test?websiteId=1'};
const db={execute:async()=>[[site]]};
const memberContext=await buildChatProductRecommendationContext(db,{character:{id:loc.characterId,category_id:'mascot',site_id:'shop'},
  userText,recentMessages:history,precomputedSearchIntent:intent,resolveConfirmationProduct:sourceResolver,
  fetchProducts:async()=>{throw Error('A confirmation cannot browse products')},searchCache:async()=>{throw Error('A confirmation cannot browse cached products')}});
const guestContext=await buildGuestProductRecommendationContext(db,{guest:{site_id:'shop',site_slug:'shop',mascot_character_id:loc.characterId},
  userText,recentMessages:history,precomputedSearchIntent:intent,resolveConfirmationProduct:sourceResolver,
  searchProducts:async()=>{throw Error('A guest confirmation cannot browse products')}});
for(const value of [memberContext,guestContext])check(confirmation.getCandidateConfirmationProduct(value)?.id==='shirt'
  &&selectProductsForMessage(value).length===0,'actual member and guest producers use the same exact-source no-card context');
const prompt=buildChatReplyPrompt({character:{id:loc.characterId,category_id:'mascot'},productContext:context,userText});
check(prompt.systemPrompt.includes('no new catalogue search or product card is permitted'),'generation sees the explicit reference-only action');
const reviewBody=JSON.parse(buildReplyReviewMessages({productContext:context,searchIntent:intent,evidenceRequired:true,text:'Entiendo cuál es la camiseta.'}).at(-1).content);
check(reviewBody.candidateContext.products[0].id==='shirt'&&reviewBody.evidence.catalogueProducts.length===1,'complete review sees finite source evidence while public card selection remains empty');
const noOpText='Sí, esa es. Mantén la manga corta.';
const noOp=await route({text:noOpText,decision:{...raw,productRequirement:{...raw.productRequirement,evidence:noOpText,
  updates:[{field:'requestedFeatures',value:['short_sleeve'],evidence:'manga corta'}]},candidateResponse:{...raw.candidateResponse,evidence:'Sí, esa es'}}});
check(noOp.candidateConfirmationOnly===true,'independent assent and an unchanged existing specification can confirm only identity');
const capturedText='Sí, esa Fan es la que busco. Mantén manga corta, sin nombre ni número.';
const capturedProduct={...product,id:'709334',productId:'709334',name:'[Free]Real Madrid Away Soccer Fan Jersey 2026/27'};
const capturedState={...state,targetEvidence:'Quiero ver la camiseta Real Madrid Away Soccer Fan Jersey 2026/27 de manga corta, sin nombre ni número.',
  requirements:{...state.requirements,requestedSeason:'2026/27'},proposal:{...state.proposal,candidateId:'709334',name:capturedProduct.name}};
const capturedRows=[{senderType:'character',characterId:loc.characterId,contentType:'product',product:capturedProduct},
  {senderType:'character',characterId:loc.characterId,productCandidateState:capturedState}];
const capturedRaw={route:'product_search',topic:'other',needsLiveProductData:true,searchQuery:'Real Madrid Away Fan Jersey 2026/27 short sleeve no name no number',
  referencedProductId:'709334',knowledgeScope:'general',knowledgeQuery:'',answerRequired:false,businessInquiry:null,humanHandoff:null,promotionInquiry:null,checkoutIssue:null,
  replyBoundary:{salesAllowed:true,contactAllowed:true},commerceConstraints:{edition:{value:'fan',evidence:'esa Fan es la que busco'},team:null},
  productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''},
  productRequirement:{action:'continue',evidence:'Mantén manga corta, sin nombre ni número',priorTargetEvidence:'',updates:[
    {field:'requestedEdition',value:'fan',evidence:'esa Fan es la que busco'},
    {field:'requestedFeatures',value:['short_sleeve'],evidence:'manga corta'},
    {field:'requestedPrinting',value:'none',evidence:'sin nombre ni número'}],suspectedTerm:null},
  candidateResponse:{action:'confirm',evidence:'Sí, esa Fan es la que busco',candidateId:'709334'},confidence:.9};
const capturedConfirmation=await route({text:capturedText,rows:capturedRows,decision:capturedRaw,primary:{...jev,productAction:.52}});
check(capturedConfirmation.candidateConfirmationOnly===true&&capturedConfirmation.productCandidateState.proposal.status==='confirmed',
  'Captured exact classifier output with unchanged conditions and overlapping edition assent completes the metadata-only route');
check(capturedConfirmation.cardAllowed===false&&capturedConfirmation.shouldLoadProductContext===false,
  'Captured low-action assent does not grant a new search or another card');
const changed=await route({text:'Sí, esa es. Ahora la quiero en manga larga.',decision:{...raw,productRequirement:{...raw.productRequirement,evidence:'Sí, esa es. Ahora la quiero en manga larga.',
  updates:[{field:'requestedFeatures',value:['long_sleeve'],evidence:'manga larga'}]},candidateResponse:{...raw.candidateResponse,evidence:'Sí, esa es'}}});
check(!changed.candidateConfirmationOnly,'a real specification revision cannot obtain new-search permission through identity assent');
for(const text of ['Sí, esa es. Ahora quiero una camiseta de Barcelona.','Sí, esa es. La quiero de la temporada 2025/26.',
  'Sí, esa es. La quiero en la versión third.','Sí, esa es. La quiero de color black.']) {
 const value=await route({text,decision:{...raw,productRequirement:{...raw.productRequirement,evidence:text},candidateResponse:{...raw.candidateResponse,evidence:'Sí, esa es'}}});
 check(!value.candidateConfirmationOnly,'current explicit identity or specification conflict cannot be hidden by a model that omitted its update');
}
const localityText='Vivo en Barcelona. Sí, esa es.';
const locality=await route({text:localityText,decision:{...raw,commerceConstraints:{team:{value:'Barcelona',role:'location',evidence:'Barcelona'},edition:null},
  productRequirement:{...raw.productRequirement,evidence:localityText},candidateResponse:{...raw.candidateResponse,evidence:'Sí, esa es'}}});
check(locality.candidateConfirmationOnly,'a grounded location role must not replace or invalidate the owned merchandise team');
const approved=finalizeProductCandidateState(intent.productCandidateState,confirmation.getCandidateConfirmationProduct(context),{evidenceVerified:true});
check(approved.proposal.status==='confirmed','full evidence approval can persist identity without a new card');
check(finalizeProductCandidateState(intent.productCandidateState,confirmation.getCandidateConfirmationProduct(context),{evidenceVerified:false}).proposal===null,'rejected review cannot persist confirmation');
for(const resolveProduct of [async()=>({resolvedFromSource:false}),async()=>({resolvedFromSource:true,site:{id:'other',slug:'other'},sourceItem:source}),async()=>({resolvedFromSource:true,site:{id:'shop',slug:'shop'},sourceItem:{...source,id:'other',productId:'other'}}),async()=>{throw Error('source timeout')}]){
 const result=await confirmation.buildCandidateConfirmationContext({site:{id:'shop',slug:'shop'},searchIntent:intent,recentMessages:history,userText,characterId:loc.characterId,resolveProduct,buildCandidateContext:productCandidateContext});check(!confirmation.getCandidateConfirmationProduct(result),'unverified or wrong source identity has no review proof');
}
for(const changedSource of [{...source,available:false},{...source,attributeEvidence:{...source.attributeEvidence,sleeve:'long_sleeve'}},
  {...source,attributeEvidence:{...source.attributeEvidence,printing:'printed'}},
  {...source,attributeEvidence:{...source.attributeEvidence,edition:'player'}}]) {
 const changedContext=await confirmation.buildCandidateConfirmationContext({site:{id:'shop',slug:'shop'},searchIntent:intent,recentMessages:history,userText,characterId:loc.characterId,
  buildCandidateContext:productCandidateContext,resolveProduct:async()=>({resolvedFromSource:true,site:{id:'shop',slug:'shop'},sourceItem:changedSource})});
 check(!confirmation.getCandidateConfirmationProduct(changedContext),'an unavailable or explicitly mismatching source cannot confirm a previously shown candidate');
}
for(const [name,extraRequirements,changedSource] of [
 ['team',{}, {...source,name:'Barcelona Away Fan Jersey'}],
 ['garment',{}, {...source,name:'Real Madrid Away Pants'}],
 ['variant',{}, {...source,name:'Real Madrid Home Fan Jersey'}],
 ['season',{requestedSeason:'2026/27'}, {...source,name:'Real Madrid 2025/26 Away Fan Jersey'}],
 ['audience',{requestedAudience:'adult'}, {...source,name:'Real Madrid Away Kids Fan Jersey'}],
 ['color',{requestedColor:'white'}, {...source,name:'Real Madrid Away Black Fan Jersey'}],
]) {
 const scopedHistory=[history[0],{...history[1],productCandidateState:{...state,requirements:{...state.requirements,...extraRequirements}}}];
 const scopedIntent=await route({rows:scopedHistory});
 const changedContext=await confirmation.buildCandidateConfirmationContext({site:{id:'shop',slug:'shop'},searchIntent:scopedIntent,recentMessages:scopedHistory,userText,characterId:loc.characterId,
  buildCandidateContext:productCandidateContext,resolveProduct:async()=>({resolvedFromSource:true,site:{id:'shop',slug:'shop'},sourceItem:changedSource})});
 check(!confirmation.getCandidateConfirmationProduct(changedContext)&&changedContext.searchOutcome==='source_error','same source ID with a changed '+name+' cannot override the current owned hard requirements');
}
const suspectedRows=[history[0],{...history[1],productCandidateState:{...state,suspectedTerm:{value:'Fun',evidence:'Fun'},requirements:{...state.requirements,requestedKeywords:['fun']}}}];
const suspectedIntent=await route({rows:suspectedRows});
const fanContext=await confirmation.buildCandidateConfirmationContext({site:{id:'shop',slug:'shop'},searchIntent:suspectedIntent,recentMessages:suspectedRows,userText,characterId:loc.characterId,
 buildCandidateContext:productCandidateContext,resolveProduct:async()=>({resolvedFromSource:true,site:{id:'shop',slug:'shop'},sourceItem:source})});
check(confirmation.getCandidateConfirmationProduct(fanContext)?.id==='shirt','a suspected Fun name does not hard-block exact-source Fan candidate identity assent');
const unknownEdition={...source,name:'Real Madrid Away Jersey',attributeEvidence:{...source.attributeEvidence,edition:'unknown'}};
const unknownContext=await confirmation.buildCandidateConfirmationContext({site:{id:'shop',slug:'shop'},searchIntent:intent,recentMessages:history,userText,characterId:loc.characterId,
 buildCandidateContext:productCandidateContext,resolveProduct:async()=>({resolvedFromSource:true,site:{id:'shop',slug:'shop'},sourceItem:unknownEdition})});
check(confirmation.getCandidateConfirmationProduct(unknownContext)?.id==='shirt'&&toCandidateReviewContext(unknownContext).products[0].attributeEvidence.edition==='unknown','unknown source edition stays unknown while confirming only identity');
const wrongOwnerIntent={...intent,productCandidateState:{...intent.productCandidateState,owner:'selected',selectedIndex:0,ownerEvidence:'different-owner'}};
const wrongOwnerContext=await confirmation.buildCandidateConfirmationContext({site:{id:'shop',slug:'shop'},searchIntent:wrongOwnerIntent,recentMessages:history,userText,characterId:loc.characterId,
 buildCandidateContext:productCandidateContext,resolveProduct:async()=>({resolvedFromSource:true,site:{id:'shop',slug:'shop'},sourceItem:source})});
check(!confirmation.getCandidateConfirmationProduct(wrongOwnerContext),'the producer must independently reject a staged owner inconsistent with its actual displayed owner');
console.log(`product candidate confirmation self-check passed (${checks} checks; actual routing/source/projection/finalization, no network or DB writes)`);
