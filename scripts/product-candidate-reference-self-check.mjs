import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const {resolveCommerceSearchIntent} = await import('../server/commerce-routing-service.js');
const {normalizeCommerceDecision} = await import('../server/product-intent-classifier-service.js');
const {buildCommerceJevPacket,resolveJevCommerceDecision} = await import('../server/jev-commerce-decision-service.js');
const {resolveGuestProductRecommendation} = await import('../server/guest-chat-product-service.js');
const {buildChatProductRecommendationContext} = await import('../server/chat-product-recommendation-service.js');
const {selectProductsForMessage} = await import('../server/chat-product-reply-service.js');
const {buildProductContextLayer} = await import('../server/chat-prompt-layers.js');
const {buildReplyReviewMessages} = await import('../server/chat-reply-review-contracts.js');
const {finalizeProductCandidateState} = await import('../server/product-candidate-state-service.js');
const {insertMessage} = await import('../server/chat-message-store.js');
const {isGroundedCommerceRepairEligible} = await import('../server/chat-grounded-reply-repair-service.js');
const site={id:'shop',slug:'shop',name:'Shop',site_url:'https://fixture.invalid',product_api_url:'https://fixture.invalid/products'};
const character={id:'guide',category_id:'mascot',site_id:'shop'};
const product={id:'p',productId:'p',siteId:'shop',siteSlug:'shop',name:'Ireland Home Shirt',url:'https://fixture.invalid/p',available:true,
  matchStatus:'candidate',attributeEvidence:{edition:'fan',sleeve:'unknown',printing:'none',giveaway:false},customizationOptions:[]};
const prior={version:1,status:'active',siteId:'shop',characterId:'guide',owner:'single',targetEvidence:'Ireland home jersey without SKY',
  requestedConditionEvidence:['Ireland home jersey without SKY'],requirements:{requestedTeam:'Ireland',requestedProductType:'shirt',requestedVariants:['home']},
  suspectedTerm:null,proposal:{status:'displayed',candidateId:'p',name:product.name,reply:'This is a possible shirt; SKY is unverified. Is it the item you mean?'}};
const rows=[{senderType:'user',text:prior.targetEvidence},{senderType:'character',characterId:'guide',contentType:'product',deliveryStatus:'sent',product},
  {senderType:'character',characterId:'guide',contentType:'text',text:prior.proposal.reply,productCandidateState:prior}];
const text='Player Name & number on back too';
const raw={route:'product_question',topic:'other',confidence:.9,needsLiveProductData:true,searchQuery:'Ireland',knowledgeScope:'business',
  answerRequired:true,replyBoundary:{salesAllowed:true,contactAllowed:true},referencedProductId:'p',
  productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:text},
  productRequirement:{action:'continue',evidence:text,updates:[{field:'requestedPrinting',value:'printed',evidence:text}],suspectedTerm:null},
  candidateResponse:{action:'none',candidateId:'',evidence:''},knowledgeRequest:{kind:'catalogue_only',evidence:text},candidateDecisionRequired:true};
const location={siteId:'shop',siteSlug:'shop',characterId:'guide'};
async function route(history=rows,patch={},currentText=text) {return resolveCommerceSearchIntent({...location,userText:currentText,recentMessages:history,searchIntent:{},enrichAllTurns:true,
  jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1},
  classifyCommerce:async()=>({...normalizeCommerceDecision({...raw,...patch},{userText:currentText}),candidateDecisionRequired:true})});}
let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
const packet=buildCommerceJevPacket(text,{...location,recentMessages:rows});
check(Object.values(packet.questions.reference.criteria).some(v=>v==='candidate'),'The same JEV packet may refer to the actual displayed unconfirmed candidate');
const wire=await resolveJevCommerceDecision(text,{...location,recentMessages:rows,evaluate:async({questions})=>({ok:true,answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>{
  const explicit={route:'product_question',reference:'candidate',requirement_action:'continue',request_relation:'single',request_action:'new'};
  const value=explicit[key]||(Object.keys(q.criteria).join(',')==='yes,no'?(['live_required','sales_allowed','contact_allowed','answer_required'].includes(key)?'yes':'no')
    :q.criteria.none?'none':q.criteria.absent?'absent':Object.keys(q.criteria)[0]);
  return[key,{choice:value,confidence:.99}];
}))})});
check(wire.value.referencedProductId==='p','The existing JEV reference answer maps only to the supplied candidate ID');
const intent=await route();
check(intent.candidateAttributeReadOnly===true,'Attribute continuation has an independent read-only purpose');
check(intent.productCandidateState.proposal.status==='displayed','Printing changes retain unconfirmed identity, not assent or acceptance');
check(intent.requestedPrinting==='printed'&&!intent.confirmedCandidateId&&!intent.candidateConfirmationOnly&&!intent.cardAllowed,'USER revisions survive without confirming identity or granting cards');
for(const question of ['Is it short sleeve?','Is it long sleeve?','Is it a fan version?','Can I add a name and number?']){
  const asked=await route(rows,{productRequest:{...raw.productRequest,selectionEvidence:question},productRequirement:{action:'continue',evidence:question,updates:[],suspectedTerm:null}},question);
  check(asked.candidateAttributeReadOnly===true,'A pure same-candidate attribute question does not become a requested specification');
  check(!asked.requestedFeatures.length&&!asked.customizationRequest&&!asked.requestedPrinting,'Question nouns do not pollute future USER requirements when JEV specifies no update');
  check(asked.productCandidateState.proposal.status==='displayed','Attribute questions keep identity unconfirmed');
}
for(const [field,value,statement] of [['requestedFeatures',['long_sleeve'],'I want long sleeves'],['requestedTeam','Barcelona','I want Barcelona'],
  ['requestedSeason','2025/26','I want 2025/26'],['requestedVariants',['away'],'I want away'],['requestedAudience','kids','I want kids'],
  ['requestedProductType','top','I want a top']]){
  const changed=await route(rows,{productRequest:{...raw.productRequest,selectionEvidence:statement},productRequirement:{action:'continue',evidence:statement,updates:[{field,value,evidence:statement}],suspectedTerm:null}},statement);
  check(!changed.candidateAttributeReadOnly,'Explicit semantic requirement changes cannot borrow the old candidate identity');
}
const editionChange='I want player edition';
check(!(await route(rows,{productRequest:{...raw.productRequest,selectionEvidence:editionChange},
  commerceConstraints:{edition:{value:'player',evidence:'player'},team:null},
  productRequirement:{action:'continue',evidence:editionChange,updates:[{field:'requestedEdition',value:'player',evidence:'player'}],suspectedTerm:null}},editionChange)).candidateAttributeReadOnly,
  'An explicitly requested different edition cannot be treated as a question about the existing unconfirmed candidate');
let sourceReads=0;
const source={...product,matchStatus:undefined,customizationOptions:[{id:'name',name:'Name',type:'text'},{id:'number',name:'Number',type:'number'}]};
const resolver=async({siteSlug,product:reference,strictSite,exactProduct})=>{check(siteSlug==='shop'&&reference.productId==='p'&&strictSite&&exactProduct,'Reads are exact and same-site');sourceReads++;return{resolvedFromSource:true,site,sourceItem:source};};
const db={execute:async()=>[[site]]};
for(const method of ['guest','member']){
  const args={userText:text,recentMessages:rows,precomputedSearchIntent:intent,resolveConfirmationProduct:resolver};
  const context=method==='guest'?(await resolveGuestProductRecommendation(db,{...args,guest:{site_id:'shop',mascot_character_id:'guide'},searchProducts:async()=>{throw Error('Broad search forbidden');}})).context
    :await buildChatProductRecommendationContext(db,{...args,character,fetchProducts:async()=>{throw Error('Broad search forbidden');}});
  check(context.sourceRef==='live-displayed-candidate-reference'&&context.products[0].id==='p',method+' refreshes the existing actual candidate');
  check(context.cardAllowed===false&&selectProductsForMessage(context).length===0,method+' cannot resend or confirm a candidate');
  check(context.searchIntent.productCandidateState.proposal.status==='displayed',method+' keeps the original identity question unconfirmed');
  const {toCandidateAttributeReplyContext,getCandidateAttributeReferenceState,CANDIDATE_ATTRIBUTE_REFERENCE_CONTRACT}=await import('../server/product-candidate-reference-service.js');
  const projection=toCandidateAttributeReplyContext(context);
  check(projection.identityConfirmed===false&&projection.product.customizationOptions.length===2,'Fresh attribute evidence is available without identity promotion');
  check(CANDIDATE_ATTRIBUTE_REFERENCE_CONTRACT.includes('remain unverified')&&projection.requestedConditionEvidence[0].includes('without SKY'),'Unobserved free-form requirements remain unverified');
  check(!toCandidateAttributeReplyContext(JSON.parse(JSON.stringify(context))),'Serialized/client metadata cannot manufacture a fresh source proof');
  check(!getCandidateAttributeReferenceState(JSON.parse(JSON.stringify(context))),'Serialized metadata cannot bypass the original state finalizer');
  const ordinaryFinalized=finalizeProductCandidateState(intent.productCandidateState,null,{approvedReply:'Name and Number are listed.',confirmationRequested:false,evidenceVerified:false});
  check(ordinaryFinalized.proposal===null,'The actual existing finalizer reproduces the old lost-reference boundary without a new card');
  const persistedState=getCandidateAttributeReferenceState(context)||ordinaryFinalized;
  let stored;
  await insertMessage({execute:async(sql,params)=>{check(sql.includes('INSERT INTO chat_messages'),'The actual writer produces the normal message insert');stored=JSON.parse(params[9]);return[{affectedRows:1}];}},
    {sessionId:'fixture-session',characterId:'guide',senderType:'character',contentType:'text',text:'Name and Number are listed; the sponsor remains unverified.',productCandidateState:persistedState,displayOrder:40,sourceType:'ai',sourceRef:'fixture'});
  check(stored._productCandidateState.proposal.status==='displayed'&&stored._productCandidateState.proposal.candidateId==='p','Actual writer payload preserves the original unconfirmed reference without identity assent');
  const nextHistory=[...rows,{senderType:'user',text},{senderType:'character',characterId:'guide',contentType:'text',text:'The sponsor remains unverified.',productCandidateState:stored._productCandidateState}];
  check((await route(nextHistory,{productRequirement:{...raw.productRequirement,updates:[]}})).candidateAttributeReadOnly,'Next-turn routing consumes the actual stored payload after an attribute-only answer');
  const layer=buildProductContextLayer({...character,categoryId:'mascot'},context,text);
  check(layer.content.includes('UNCONFIRMED')&&layer.content.includes('Name')&&layer.content.includes('Number'),'Generation receives fresh bounded attributes and unresolved identity together');
  const review=buildReplyReviewMessages({productContext:context,searchIntent:intent,userText:text,evidenceRequired:true,businessFactsRequired:true,
    catalogueOwner:{character,trustedSite:site},...location});
  const packet=JSON.parse(review.at(-1).content);
  check(packet.candidateAttributeContext?.identityConfirmed===false&&!packet.candidateContext&&!packet.candidateConfirmationRequired,'Review distinguishes attribute evidence from identity confirmation');
  check(packet.evidence.catalogueProducts[0].customizationOptions.length===2&&packet.productCardDelivery.count===0,'Reviewer sees the same source options and zero-card plan');
  const repair={character,trustedSite:site,searchIntent:intent,productContext:context,recentMessages:rows,userText:text,
    replyResult:{text:'Those options do not exist.',sourceType:'ai'},reviewStatus:'valid',reviewResult:{allowed:false,confidence:.9,boundarySupported:true,businessFactsSupported:false},
    failedContracts:['business_facts'],retained:'The catalogue lists the shirt.',factualContext:{required:false,searched:false,items:[]}};
  check(isGroundedCommerceRepairEligible(repair),'An actual factory-created candidate reference permits one complete correction despite a retained paragraph');
  for(const patch of [{character:{...character,id:'other'}},{trustedSite:{...site,id:'other'}},
    {productContext:JSON.parse(JSON.stringify(context))},{productContext:{...context,products:[{...context.products[0],name:'Forged'}]}},
    {groundedRepairAttempted:true}]) check(!isGroundedCommerceRepairEligible({...repair,...patch}),'Wrong owner, shape, serialized proof or an exhausted correction cannot reopen this purpose');
  for(const patch of [{siteId:'foreign'},{products:[{...context.products[0],name:'Forged product'}]},
    {searchIntent:{...context.searchIntent,referencedProductId:'other'}},{searchIntent:{...context.searchIntent,needsLiveProductData:false}}]){
    check(!toCandidateAttributeReplyContext({...context,...patch}),'Post-read mutations cannot carry source or action authority');
  }
  const {buildCandidateAttributeReferenceContext}=await import('../server/product-candidate-reference-service.js');
  const blankName=await buildCandidateAttributeReferenceContext({site,characterId:'guide',searchIntent:intent,recentMessages:rows,
    resolveProduct:async()=>({resolvedFromSource:true,site,sourceItem:{...source,name:'   '}})});
  check(blankName.searchOutcome==='source_error'&&!toCandidateAttributeReplyContext(blankName),'A blank sanitized name cannot receive product-fact authority');
  for(const reply of [{resolvedFromSource:true,site:{...site,id:'foreign'},sourceItem:source},
    {resolvedFromSource:true,site,sourceItem:{...source,id:'other',productId:'other'}},
    {resolvedFromSource:true,site,sourceItem:{...source,id:'other',productId:'p'}},
    {resolvedFromSource:true,site,sourceItem:{...source,siteId:'foreign'}},
    {resolvedFromSource:true,site,sourceItem:{...source,siteSlug:'foreign'}},
    {resolvedFromSource:false,site,sourceItem:source}]){
    const failed=await buildCandidateAttributeReferenceContext({site,characterId:'guide',searchIntent:intent,recentMessages:rows,resolveProduct:async()=>reply});
    check(failed.searchOutcome==='source_error'&&!toCandidateAttributeReplyContext(failed),'Wrong source or ID fails without inventing a confirmed item');
    check(getCandidateAttributeReferenceState(failed)?.proposal.status==='displayed','A source failure may preserve only the previously displayed identity question, not fresh product evidence');
  }
  const withoutLink=await buildCandidateAttributeReferenceContext({site,characterId:'guide',searchIntent:intent,recentMessages:rows,
    resolveProduct:async()=>({resolvedFromSource:true,site,sourceItem:{...source,url:'javascript:alert(1)'}})});
  check(toCandidateAttributeReplyContext(withoutLink)?.product.url==='','Unavailable safe URL grants no link without suppressing a valid ID-bound attribute read');
}
check(sourceReads===2,'Each producer performed one exact source read, with no classification or broad retry');
for(const history of [[],rows.filter(r=>r.contentType!=='product'),rows.map(r=>r.product?{...r,characterId:'other'}:r),
  rows.map(r=>r.product?{...r,deliveryStatus:'failed'}:r),
  rows.map(r=>r.productCandidateState?{...r,productCandidateState:{...prior,siteId:'other'}}:r),
  rows.map(r=>r.productCandidateState?{...r,productCandidateState:{...prior,proposal:{...prior.proposal,status:'rejected'}}}:r)]){
  check(!(await route(history)).candidateAttributeReadOnly,'Missing, foreign or rejected candidates cannot acquire a live read reference');
}
for(const patch of [{route:'product_search'},{referencedProductId:'other'},{replyBoundary:{salesAllowed:false,contactAllowed:false}},
  {productRequirement:{...raw.productRequirement,action:'new'}},{candidateResponse:{action:'reject',candidateId:'p',evidence:text}}]){
  check(!(await route(rows,patch)).candidateAttributeReadOnly,'New target, new action, refusal or wrong reference keeps existing boundaries');
}
const longId='p'.repeat(140);
const longRows=rows.map(row=>row.product?{...row,product:{...product,id:longId,productId:longId}}:row.productCandidateState?
  {...row,productCandidateState:{...prior,proposal:{...prior.proposal,candidateId:longId}}}:row);
const longIntent=await route(longRows,{referencedProductId:longId});
const {buildCandidateAttributeReferenceContext,toCandidateAttributeReplyContext}=await import('../server/product-candidate-reference-service.js');
const truncated=await buildCandidateAttributeReferenceContext({site,characterId:'guide',searchIntent:longIntent,recentMessages:longRows,
  resolveProduct:async()=>({resolvedFromSource:true,site,sourceItem:{...source,id:longId,productId:longId}})});
check(truncated.searchOutcome==='source_error'&&!toCandidateAttributeReplyContext(truncated),'Sanitizer-truncated IDs cannot retain an exact-ID source proof');
console.log(`Candidate attribute references: ${checks} checks passed; actual router/producers, injected sites/source only, no models or DB.`);
