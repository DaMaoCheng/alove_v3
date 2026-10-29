import assert from 'node:assert/strict';
import { executeProductSearchDetailed, productCandidateContext } from '../server/product-search-execution-service.js';
import { nameCandidateRecall, buildNameCandidate, revalidateNameCandidate } from '../server/product-name-candidate-service.js';
import { toCandidateReviewContext, toNameCandidateDifferenceContext } from '../server/product-candidate-context-service.js';
import { buildReplyReviewFormat } from '../server/chat-reply-review-contracts.js';
import { selectProductsForMessage } from '../server/chat-product-reply-service.js';
import { toGuestSafeProduct } from '../server/guest-product-sanitizer.js';
const intent={commerceRoute:'product_search',shouldLoadProductContext:true,cardAllowed:true,candidateSearchAllowed:true,
 requestedProductType:'shirt',requestedAudience:'kids',requestedVariant:'retro',requestedVariants:['retro'],requestedKeywords:['cristiano','ronaldo'],query:'Cristiano Ronaldo retro kids jersey',replyBoundary:{salesAllowed:true}};
const p=(id,name)=>({productId:id,name,url:'https://shop.example/'+id,available:true,price:'$43.99'});
const kit=p('kit','Kids RONALDO #7 Portugal Home Soccer Jersey Kit World Cup 2026');
let calls=[];const result=await executeProductSearchDetailed({searchIntent:intent,query:intent.query,fetchProducts:async(_,i)=>{calls.push(i.query);return i.query.toLowerCase().includes('cristiano')?[]:[kit]}});
assert.equal(result.matches.length,0);assert.equal(result.alternatives?.length||0,0);assert.equal(result.candidates[0].productId,'kit');
assert.equal(result.candidates[0].matchStatus,'candidate');assert.deepEqual(result.candidates[0].unmatchedSearchTerms,['cristiano']);
assert.equal(result.candidates[0].alternative.kind,'retro_alternative');assert.equal(result.candidates[0].alternative.alternativeGarment,'jersey_kit');assert.equal(result.candidates[0].alternative.alternativeSeason,'2026');
assert.ok(calls[0].includes('Cristiano'));assert.ok(calls.some(q=>/ronaldo/.test(q)&&!/cristiano/i.test(q)));assert.ok(calls.length<=4);
assert.deepEqual(intent.requestedKeywords,['cristiano','ronaldo']);assert.deepEqual(intent.requestedVariants,['retro']);
for(const patch of [{requestedTeam:'Real Madrid'},{requestedAudience:'women'},{requestedVariant:'away',requestedVariants:['retro','away']},{requestedFeatures:['long_sleeve']},{requestedSizes:['XL']},{requestedPrinting:'none'},{cardAllowed:false},{candidateSearchAllowed:false},{replyBoundary:{salesAllowed:false}},{nonShoppingReason:'chat'},{scopeUnverified:true},{productScopePending:true},{customizationRequest:'jersey'},{requestedPrintNumber:'9'},{productCandidateState:{suspectedTerm:{value:'ronaldo'}}}]){
 const r=await executeProductSearchDetailed({searchIntent:{...intent,...patch},query:intent.query,fetchProducts:async()=>[kit]});assert.equal(r.candidates?.length||0,0,JSON.stringify(patch));assert.equal(r.alternatives?.length||0,0,JSON.stringify(patch));
}
for(const name of ['Kids MESSI #10 Argentina Retro Jersey 2010/11','Kids RONALDOS #7 Portugal Jersey Kit 2026','Kids RONALDO Portugal Jersey Kit 2026','Kids RONALDO #7 Portugal Training Jacket 2026']){
 const r=await executeProductSearchDetailed({searchIntent:intent,query:intent.query,fetchProducts:async()=>[p('wrong',name)]});assert.equal(r.candidates.length,0,name);
}
for(const requestedKeywords of [['ronaldo'],['C.','Ronaldo'],['克里斯蒂亚诺','罗纳尔多'],['a','ronaldo'],['one','two','three','four','five','six']])assert.equal(nameCandidateRecall({...intent,requestedKeywords}),null);
const phrase=nameCandidateRecall({...intent,requestedKeywords:['Cristiano Ronaldo']});assert.equal(phrase.anchor,'ronaldo');
const exact=p('exact','Kids CRISTIANO RONALDO #7 Portugal Retro Soccer Jersey 2010/11');
const exactResult=await executeProductSearchDetailed({searchIntent:intent,query:intent.query,fetchProducts:async()=>[exact]});assert.equal(exactResult.matches[0].productId,'exact');assert.equal(exactResult.candidates.length,0);
let count=0;await assert.rejects(executeProductSearchDetailed({searchIntent:intent,query:intent.query,fetchProducts:async()=>{if(++count===2)throw Error('source failed');return[kit]}}),/source failed/);
const short=await executeProductSearchDetailed({searchIntent:{...intent,requestedKeywords:['ronaldo']},query:'Ronaldo retro kids jersey',fetchProducts:async()=>[kit]});assert.equal(short.alternatives[0].productId,'kit','old single-name verified alternative remains');
const safe=toGuestSafeProduct(result.candidates[0],{id:'test',slug:'shop'},{allowedOrigins:['https://shop.example'],includeAttributeEvidence:true});assert.equal(safe.matchStatus,'candidate');assert.equal(safe.alternative.alternativeGarment,'jersey_kit');
const makeContext=products=>({siteId:'test',searchIntent:intent,searchOutcome:'candidate',cardAllowed:true,products,candidateContext:productCandidateContext(products,intent,{siteId:'test',characterId:'role'})});
const context=makeContext([safe]);assert.equal(toCandidateReviewContext(context).products[0].catalogueDifference.alternativeSeason,'2026');assert.equal(toNameCandidateDifferenceContext(context).identityUnverified,true);
assert.equal(buildReplyReviewFormat({productContext:context,evidenceRequired:true}).json_schema.schema.properties.alternativeAudit,undefined,'uncertain candidate reuses its original complete review, without a second quote audit');
assert.equal(selectProductsForMessage(context)[0].alternative.kind,'retro_alternative');assert.equal(selectProductsForMessage(context)[0].matchStatus,'candidate');
const confirmed={...intent,cardAllowed:false,shouldLoadProductContext:false,commerceRoute:'product_question',confirmedCandidateId:'kit',productCandidateState:{proposal:{status:'confirmed',candidateId:'kit'}}};
const fresh=revalidateNameCandidate(kit,confirmed,safe);assert.equal(fresh.productId,'kit');assert.deepEqual(confirmed.requestedVariants,['retro']);
for(const changed of [{...kit,name:kit.name.replace('2026','2027')},{...kit,name:kit.name.replace('Kids','Adult')},{...kit,productId:'foreign'},{...kit,available:false}])assert.equal(revalidateNameCandidate(changed,confirmed,safe),null);
assert.equal(buildNameCandidate({...kit,name:kit.name.replace('RONALDO','CRISTIANO RONALDO')},intent),null,'full evidence should stay on normal strict path');
console.log('Player-name candidate self-check passed: bounded recall, unverified identity, full constraints, finite difference, guest/history and fresh-source confirmation.');

const ordinary={...intent,requestedVariant:'home',requestedVariants:['home'],query:'Cristiano Ronaldo kids home jersey'};
const ordinarySource=p('ordinary','Kids RONALDO #7 Portugal Home Soccer Jersey 2026');
const ordinaryResult=await executeProductSearchDetailed({searchIntent:ordinary,query:ordinary.query,fetchProducts:async()=>[ordinarySource]});
assert.equal(ordinaryResult.candidates[0].productId,'ordinary');assert.equal(ordinaryResult.candidates[0].alternative,undefined);
const {productCandidateConditionsContract,PRODUCT_CANDIDATE_CONDITIONS_CONTRACT}=await import('../server/product-candidate-context-service.js');
const ordinaryContext=makeContext(ordinaryResult.candidates);assert.ok(productCandidateConditionsContract(ordinaryContext).includes('does not yet verify'));
assert.equal(productCandidateConditionsContract({...ordinaryContext,searchIntent:{...intent,requestedKeywords:['ronaldo']}}),PRODUCT_CANDIDATE_CONDITIONS_CONTRACT);
assert.ok(productCandidateConditionsContract(context).includes('catalogueDifference'));
assert.equal(buildReplyReviewFormat({productContext:ordinaryContext,evidenceRequired:true}).json_schema.schema.properties.alternativeAudit,undefined);
console.log('Ordinary full-name search and unchanged ordinary candidate contracts passed.');
const {applyProductCandidateState}=await import('../server/product-candidate-state-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const userText='Cristiano Ronaldo kids home jersey';
const ownedIntent={...buildProductSearchIntent(userText),commerceRoute:'product_search',shouldLoadProductContext:true,cardAllowed:true,replyBoundary:{salesAllowed:true}};
const decision={confident:true,productRequirement:{action:'new',evidence:userText,updates:[{field:'requestedKeywords',value:['Cristiano Ronaldo'],evidence:'Cristiano Ronaldo'}],suspectedTerm:null}};
const owned=applyProductCandidateState(ownedIntent,decision,{siteId:'test',characterId:'role',userText});
assert.equal(owned.candidateSearchAllowed,true);assert.equal(owned.requestedTeam,'');assert.deepEqual(owned.requestedKeywords,['cristiano ronaldo']);
for(const patch of [{shouldLoadProductContext:false},{replyBoundary:{salesAllowed:false}},{commerceRoute:'store_policy'}]){
 assert.notEqual(applyProductCandidateState({...ownedIntent,...patch},decision,{siteId:'test',characterId:'role',userText}).candidateSearchAllowed,true);
}
console.log('Owned ordinary fullname routing, no inferred team, and unchanged closed actions passed.');

const {hasStableNameCandidateSource}=await import('../server/product-name-candidate-service.js');
assert.equal(hasStableNameCandidateSource(ordinarySource,ordinary,ordinaryResult.candidates[0]),true);
assert.equal(hasStableNameCandidateSource({...ordinarySource,name:'Kids MESSI #10 Argentina Home Soccer Jersey 2026'},ordinary,ordinaryResult.candidates[0]),false);
assert.equal(hasStableNameCandidateSource({...kit,name:'Kids MESSI #10 Argentina Retro Home Soccer Jersey 2010/11'},intent,result.candidates[0]),false);
assert.equal(hasStableNameCandidateSource({...kit,name:kit.name.replace('Portugal','Brazil').replace('#7','#9')},intent,result.candidates[0]),false);
assert.equal(hasStableNameCandidateSource({...ordinarySource,price:'$45'},ordinary,ordinaryResult.candidates[0]),true,'price refresh is not identity drift');
console.log('Fresh full-name candidate title drift and fallback bypass are closed; same-source price refresh remains valid.');
const {buildCandidateConfirmationContext,getCandidateConfirmationProduct}=await import('../server/product-candidate-confirmation-service.js');
const {nameCandidateIdentityContext}=await import('../server/product-name-candidate-service.js');
const loc={siteId:'test',characterId:'role'},shown={...safe,siteId:'test',siteSlug:'test'};
const oldState={version:1,status:'active',...loc,owner:'single',targetEvidence:'Cristiano Ronaldo retro kids jersey',requirements:intent,
 proposal:{status:'displayed',candidateId:'kit',name:kit.name,reply:'Is this catalogue name the player you mean? This is a different 2026 model, not the retro shirt.'}};
assert.equal(nameCandidateIdentityContext({state:oldState,product:shown}).candidateId,'kit');
assert.equal(nameCandidateIdentityContext({state:oldState,product:ordinarySource}),null);
const assent='Yes, that is Cristiano Ronaldo. I still want a retro shirt.';
const staged={...oldState,proposal:{...oldState.proposal,status:'confirmed',confirmationEvidence:assent}};
const confirmationIntent={...intent,commerceRoute:'product_question',candidateConfirmationOnly:true,confirmedCandidateId:'kit',cardAllowed:false,shouldLoadProductContext:false,needsLiveProductData:false,productCandidateState:staged};
const history=[{senderType:'character',characterId:'role',contentType:'product',product:shown},{senderType:'character',characterId:'role',productCandidateState:oldState}];
const sourceContext=async source=>buildCandidateConfirmationContext({site:{id:'test',slug:'test'},searchIntent:confirmationIntent,recentMessages:history,userText:assent,characterId:'role',buildCandidateContext:productCandidateContext,
 resolveProduct:async()=>({resolvedFromSource:true,site:{id:'test',slug:'test'},sourceItem:source})});
const confirmationContext=await sourceContext(kit);assert.equal(confirmationContext.searchOutcome,'candidate');assert.equal(getCandidateConfirmationProduct(confirmationContext).productId,'kit');assert.equal(selectProductsForMessage(confirmationContext).length,0);
assert.deepEqual(confirmationContext.searchIntent.productCandidateState.requirements.requestedVariants,['retro']);
for(const name of ['Kids MESSI #10 Argentina Home Soccer Jersey 2026','Kids MESSI #10 Argentina Retro Home Soccer Jersey 2010/11']){
 const ctx=await sourceContext({...kit,name});assert.equal(ctx.searchOutcome,'source_error');assert.equal(getCandidateConfirmationProduct(ctx),null,'fresh source cannot use strict-attribute fallback to change identity');
}
console.log('Actual confirmation producer: exact source, identity-only assent, original retro retained, zero cards and changed-player fallback blocked.');
const {hasCandidateContextSource}=await import('../server/product-candidate-source-proof.js');
const mutable=[structuredClone(safe)],bound=productCandidateContext(mutable,intent,{siteId:'test',characterId:'role'});
assert.equal(hasCandidateContextSource(bound,intent,mutable,{siteId:'test',characterId:'role'}),true);
mutable[0].alternative.alternativeSeason='2027';assert.equal(hasCandidateContextSource(bound,intent,mutable,{siteId:'test',characterId:'role'}),false,'difference metadata is included in the source binding');
console.log('Candidate difference metadata mutation cannot preserve a source proof.');
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const {repairGroundedCommerceReply}=await import('../server/chat-grounded-reply-repair-service.js');
const candidateBase={character:{id:'role',category_id:'mascot',site_id:'test'},trustedSite:{id:'test'},language:'es',userText:'Cristiano Ronaldo retro kids jersey',searchIntent:intent,
 productContext:{...context,sourceType:'product_api'},knowledgeContext:{items:[],customerServiceIntent:false},
 replyResult:{text:'Rejected malformed candidate.',speechText:'Rejected malformed candidate.',sourceType:'ai',sourceRef:'fixture'}};
const supported={allowed:true,confidence:1,reviewStatus:'valid',boundarySupported:true,evidenceSupported:true,businessFactsSupported:true,guidanceSupported:true,factualSupported:true,candidateConfirmationSupported:true};
let reviews=0,languages=0,repairs=0,regenerations=0;
const corrected=await enforceReplyBoundary({...candidateBase,languageQualityRequired:true,independentLanguageQualityRequired:true,recordReview:async()=>{},
 assess:async()=>{reviews++;return supported},assessLanguageQuality:async()=>({reviewStatus:'valid',languageQualitySupported:++languages>1,confidence:1,severity:languages>1?'none':'major',languageIssues:[]}),
 regenerateReply:async()=>{regenerations++;throw Error('Unconstrained regeneration must not consume the correction')},
 repairGroundedReply:async()=>{repairs++;return {...candidateBase.replyResult,text:'Lo siento, no encontré la retro. Es un kit de 2026. ¿Es el jugador que buscas?',speechText:'Lo siento, no encontré la retro. Es un kit de 2026. ¿Es el jugador que buscas?'}}});
assert.equal(repairs,1);assert.equal(regenerations,0);assert.equal(reviews,2);assert.equal(languages,2);assert.equal(corrected.candidateEvidenceVerified,true);
let repairPrompt;
await repairGroundedCommerceReply({...candidateBase,reviewResult:supported,reviewStatus:'valid',failedContracts:['language'],
 config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},recordLog:async()=>{},
 requestText:async prompt=>{repairPrompt=prompt;return JSON.stringify({displayText:'Lo siento, esta búsqueda no encontró la retro; este kit es de 2026. ¿Es el jugador que buscas?'})}});
assert.ok(repairPrompt.systemPrompt.includes('Start with a brief explicit apology'));assert.equal(JSON.parse(repairPrompt.messages[0].content).proposedResponse,undefined);
assert.equal(JSON.parse(repairPrompt.messages[0].content).candidate.products[0].catalogueDifference.alternativeSeason,'2026');
console.log('Language failure uses the existing single grounded correction, omits rejected text, retains source differences and fully re-reviews; no extra regeneration.');
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {normalizeCommerceDecision}=await import('../server/product-intent-classifier-service.js');
const confirmedRaw={knowledgeRequest:{kind:'catalogue_only',evidence:assent},route:'product_question',topic:'other',confidence:.99,needsLiveProductData:false,searchQuery:'Cristiano Ronaldo retro kids jersey',replyBoundary:{salesAllowed:true,contactAllowed:true},commerceConstraints:{team:null,edition:null},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:{action:'continue',evidence:assent,updates:[],suspectedTerm:null},candidateResponse:{action:'confirm',candidateId:'kit',evidence:assent}};
const primary={ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1,webSearchIntent:false,imageIntent:'none',orderIntent:'none'};
const routedAssent=await resolveCommerceSearchIntent({...loc,userText:assent,recentMessages:history,searchIntent:buildProductSearchIntent(assent),jevDecision:primary,classifyCommerce:async()=>normalizeCommerceDecision(confirmedRaw,{userText:assent})});
assert.equal(routedAssent.candidateConfirmationOnly,true);assert.equal(routedAssent.cardAllowed,false);assert.equal(routedAssent.shouldLoadProductContext,false);assert.deepEqual(routedAssent.requestedVariants,['retro']);
for(const changedPrimary of [{...primary,imageIntent:'explicit_generation'},{...primary,webSearchIntent:true},{...primary,primaryIntent:'order_lookup'},{...primary,confident:false}]){
 const blocked=await resolveCommerceSearchIntent({...loc,userText:assent,recentMessages:history,searchIntent:buildProductSearchIntent(assent),jevDecision:changedPrimary,classifyCommerce:async()=>normalizeCommerceDecision(confirmedRaw,{userText:assent})});assert.notEqual(blocked.candidateConfirmationOnly,true);
}
console.log('Actual routing narrows only this explicit name assent to read-only confirmation, preserving retro and other primary actions.');

const mixedAssent=await resolveCommerceSearchIntent({...loc,userText:assent,recentMessages:history,searchIntent:buildProductSearchIntent(assent),jevDecision:primary,
 classifyCommerce:async()=>normalizeCommerceDecision({...confirmedRaw,knowledgeRequest:{kind:'business_question',evidence:assent},topic:'delivery'},{userText:assent})});
assert.notEqual(mixedAssent.candidateConfirmationOnly,true,'mixed policy must retain original business routing rather than the new name-only override');

const liveAssent=await resolveCommerceSearchIntent({...loc,userText:assent,recentMessages:history,searchIntent:buildProductSearchIntent(assent),jevDecision:primary,
 classifyCommerce:async()=>normalizeCommerceDecision({...confirmedRaw,needsLiveProductData:true},{userText:assent})});
assert.notEqual(liveAssent.candidateConfirmationOnly,true,'a new live attribute/availability question must not use the name-only override');

const anotherText='Yes, that is Cristiano Ronaldo. Show me another retro shirt of him.';
const another=await resolveCommerceSearchIntent({...loc,userText:anotherText,recentMessages:history,searchIntent:buildProductSearchIntent(anotherText),jevDecision:primary,
 classifyCommerce:async()=>normalizeCommerceDecision({...confirmedRaw,route:'product_search',knowledgeRequest:{kind:'catalogue_only',evidence:anotherText},productRequirement:{action:'continue',evidence:anotherText,updates:[],suspectedTerm:null},candidateResponse:{action:'confirm',candidateId:'kit',evidence:'Yes, that is Cristiano Ronaldo.'}},{userText:anotherText})});
assert.notEqual(another.candidateConfirmationOnly,true);assert.equal(another.shouldLoadProductContext,true,'a separately requested search keeps the original strong-search action');
console.log('Identity plus an explicit new merchandise search cannot be swallowed by the name-only override.');

const namedUser='Busco una camiseta de Cristiano Ronaldo para niña.';
const rawNameTeam={route:'product_search',confidence:1,searchQuery:'Cristiano Ronaldo kids jersey',replyBoundary:{salesAllowed:true,contactAllowed:true},commerceConstraints:{team:{value:'Cristiano Ronaldo',role:'product_target',evidence:'Cristiano Ronaldo'},edition:null},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:{action:'new',evidence:namedUser,updates:[{field:'requestedKeywords',value:['Cristiano Ronaldo'],identityType:'player',evidence:'Cristiano Ronaldo'}],suspectedTerm:null}};
const playerTyped=normalizeCommerceDecision(rawNameTeam,{userText:namedUser});assert.equal(playerTyped.commerceConstraints.team,null);assert.equal(playerTyped.nameOnlyTeamInference,true);
const clubUser='Busco una camiseta de Deportivo Pereira.';
for(const identityType of ['team','unknown',undefined]){
 const club=normalizeCommerceDecision({...rawNameTeam,commerceConstraints:{edition:null,team:{value:'Deportivo Pereira',role:'product_target',evidence:'Deportivo Pereira'}},productRequirement:{action:'new',evidence:clubUser,updates:[{field:'requestedKeywords',value:['Deportivo Pereira'],identityType,evidence:'Deportivo Pereira'}],suspectedTerm:null}},{userText:clubUser});
 assert.equal(club.commerceConstraints.team.value,'Deportivo Pereira');assert.equal(club.nameOnlyTeamInference,false);
}
const {supportsNameCandidateYears}=await import('../server/product-name-candidate-service.js');
const yearContext=toNameCandidateDifferenceContext(context);assert.equal(supportsNameCandidateYears(yearContext,'Es un kit de 2026.','Es un kit de 2026.'),true);
assert.equal(supportsNameCandidateYears(yearContext,'Es un kit de 2027.','Es un kit de 2026.'),false);
assert.equal(supportsNameCandidateYears(yearContext,'Es un kit de 2026.','Es otro kit.'),false);
console.log('Typed player/team/unknown distinction preserves unlisted clubs; both complete candidate outputs retain the actual source year.');

const falseEdition=normalizeCommerceDecision({...rawNameTeam,commerceConstraints:{team:null,edition:{value:'player',evidence:'Cristiano Ronaldo'}}},{userText:namedUser});
assert.equal(falseEdition.commerceConstraints.edition,null,'a typed player PERSON name is not a player edition');
const realEditionUser=namedUser+' Quiero la versión player.';
const realEdition=normalizeCommerceDecision({...rawNameTeam,commerceConstraints:{team:null,edition:{value:'player',evidence:'versión player'}}},{userText:realEditionUser});
assert.equal(realEdition.commerceConstraints.edition.value,'player','an independently explicit edition is preserved');
const {toNameCandidateUncertaintyContext}=await import('../server/product-candidate-context-service.js');
const {validateNameIdentityAudit}=await import('../server/product-name-candidate-service.js');
assert.equal(safe.unmatchedSearchTerms,undefined,'public guest metadata excludes raw search terms');
assert.deepEqual(toCandidateReviewContext(context).products[0].unmatchedSearchTerms,['cristiano'],'safe server context restores the missing name from the owned user target');
assert.equal(toNameCandidateUncertaintyContext(context).requestedName,'cristiano ronaldo');
assert.ok(buildReplyReviewFormat({productContext:context,evidenceRequired:true}).json_schema.schema.properties.nameIdentityAudit);
const fullNameContext=makeContext([{...safe,name:safe.name.replace('RONALDO','CRISTIANO RONALDO')}]);
assert.equal(toNameCandidateUncertaintyContext(fullNameContext),null,'no missing name means no additional identity audit');
assert.equal(toNameCandidateUncertaintyContext(confirmationContext),null,'reviewed identity assent does not repeat identity uncertainty/question');
assert.equal(validateNameIdentityAudit({displayQuote:'Cristiano Ronaldo',speechQuote:'Cristiano Ronaldo'},'The catalogue name is not confirmed.'),false,'USER-only or invented output quotes fail');
assert.equal(validateNameIdentityAudit({displayQuote:'No puedo confirmar el nombre completo.',speechQuote:'No puedo confirmar el nombre completo.'},'No puedo confirmar el nombre completo.'),true);
console.log('Raw→guest safe→owned candidate projection restores missing name evidence; full-name and confirmed contexts stay unchanged.');
const routedSourceContext=await buildCandidateConfirmationContext({site:{id:'test',slug:'test'},searchIntent:routedAssent,recentMessages:history,userText:assent,characterId:'role',buildCandidateContext:productCandidateContext,
 resolveProduct:async()=>({resolvedFromSource:true,site:{id:'test',slug:'test'},sourceItem:kit})});
assert.equal(routedSourceContext.searchOutcome,'candidate','actual routed confirmation includes referencedProductId; internal source validation must not mistake it for a new search');
const pureName='Yes, this catalogue name is Cristiano Ronaldo. Keep my requirements.';
const pureRouted=await resolveCommerceSearchIntent({...loc,userText:pureName,recentMessages:history,searchIntent:buildProductSearchIntent(pureName),jevDecision:primary,
 classifyCommerce:async()=>normalizeCommerceDecision({...confirmedRaw,knowledgeRequest:{kind:'catalogue_only',evidence:pureName},productRequirement:{action:'continue',evidence:pureName,updates:[],suspectedTerm:null},candidateResponse:{action:'confirm',candidateId:'kit',evidence:'Yes, this catalogue name is Cristiano Ronaldo.'}},{userText:pureName})});
assert.equal(pureRouted.candidateConfirmationOnly,true);assert.equal(pureRouted.searchState,'not_product');
const pureSource=await buildCandidateConfirmationContext({site:{id:'test',slug:'test'},searchIntent:pureRouted,recentMessages:history,userText:pureName,characterId:'role',buildCandidateContext:productCandidateContext,
 resolveProduct:async()=>({resolvedFromSource:true,site:{id:'test',slug:'test'},sourceItem:kit})});
assert.equal(pureSource.searchOutcome,'candidate');assert.equal(pureSource.cardAllowed,false);assert.equal(pureSource.searchIntent.shouldLoadProductContext,false);assert.equal(pureSource.searchIntent.searchState,'not_product','source-only validation never reopens the real routing flags');
console.log('Pure name-only (lexical not_product) confirmation reaches the fresh source without reopening actions.');
const only26={...ordinarySource,sizes:[{label:'26',available:true}]},only28={...ordinarySource,sizes:[{label:'28',available:true}]};
const size28Intent={...ordinary,requestedSizes:['28']};
for(const supplied of [only26,{...only28,sizes:[{label:'28',available:false}]}]){
 const bad=await executeProductSearchDetailed({searchIntent:size28Intent,query:size28Intent.query,fetchProducts:async()=>[supplied]});assert.equal(bad.candidates.length,0,'known unavailable requested size cannot become a name candidate');
}
const sizedGood=await executeProductSearchDetailed({searchIntent:size28Intent,query:size28Intent.query,fetchProducts:async()=>[only28],fetchCandidateDetail:async()=>only28});assert.equal(sizedGood.candidates[0].productId,'ordinary');
const sizedDrift=await executeProductSearchDetailed({searchIntent:size28Intent,query:size28Intent.query,fetchProducts:async()=>[only28],fetchCandidateDetail:async()=>only26});assert.equal(sizedDrift.candidates.length,0,'hydrate cannot change requested size');
assert.equal(hasStableNameCandidateSource(only26,size28Intent,only28),false);assert.equal(hasStableNameCandidateSource(only28,size28Intent,only28),true);
console.log('Ordinary full-name candidate summary, detail hydration and fresh confirmation preserve explicit available sizes.');
const sizedExact=await executeProductSearchDetailed({searchIntent:size28Intent,query:size28Intent.query,fetchProducts:async()=>[{...only26,name:only26.name.replace('RONALDO','CRISTIANO RONALDO')}]});
assert.equal(sizedExact.matches.length,0);assert.equal(sizedExact.candidates.length,0,'a complete name cannot bypass the explicit size check either');
