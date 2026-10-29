import assert from 'node:assert/strict';
import {normalizeGuestReplyText} from '../server/guest-chat-output-policy.js';
import {normalizeProductFollowupReply} from '../server/product-followup-sanitizer.js';
import {createHash} from 'node:crypto';
import {findRecentDisplayedProductGroup as group,resolveDisplayedProductReferences as refs,buildDisplayedProductReferenceContext as context} from '../server/product-displayed-reference-service.js';
import {buildChatProductRecommendationContext} from '../server/chat-product-recommendation-service.js';
import {resolveGuestProductRecommendation} from '../server/guest-chat-product-service.js';
import {selectProductsForMessage,buildProductCardDeliveryContext} from '../server/chat-product-reply-service.js';
import {resolveCommerceSearchIntent} from '../server/commerce-routing-service.js';
import {buildProductContextLayer} from '../server/chat-prompt-layers.js';
import {buildReplyReviewMessages} from '../server/chat-reply-review-contracts.js';
import {normalizeCommerceDecision} from '../server/product-intent-classifier-service.js';
import {COMMERCE_INTENT_RESPONSE_FORMAT,validateCommerceIntentShape} from '../server/commerce-intent-response-format.js';
// No initialized DB or external transport: actual producers use only this sites fixture.
globalThis.fetch=async()=>{throw Error('external transport prohibited');};
const site={id:'fixture',slug:'fixture',name:'Fixture',currency:'USD',product_api_url:'https://fixture.invalid/products'};
const location={siteId:site.id,siteSlug:site.slug,characterId:'mascot_fixture'};
const home={id:'h',name:'Manchester United Home Jersey 2026/27',siteId:site.id,siteSlug:site.slug,priceNow:'30',stock:'5',available:true,sizes:['M'],livePriceFetchedAt:'2026-10-01T00:00:00.000Z'};
const away={...home,id:'a',name:'Manchester United Away Jersey 2025/26'};
const card=p=>({senderType:'character',characterId:location.characterId,sessionId:'one',contentType:'product',product:p});
const messages=[{senderType:'user',text:'Show home and away jerseys'},card(home),card(away),{senderType:'character',text:'Here they are.'},{senderType:'user',text:'What seasons are these?'}];
const base={commerceRoute:'product_question',commerceTopic:'other',needsLiveProductData:false,referencedProductIds:['h','a'],shouldLoadProductContext:false,cardAllowed:false,replyBoundary:{salesAllowed:true},requestedVariants:['home','away']};
const args={site,characterId:location.characterId,searchIntent:base,recentMessages:messages};
let checks=0;const check=(actual,why)=>{assert(actual,why);checks++;};
check(group(messages,location).length===2,'only actual same-response group retained');
check(refs(['h'],messages,location).length===1,'one reference does not expand to whole group');
for(const ids of [[],['h','a','x'],['h','h'],['x'],[1]])check(refs(ids,messages,location)===null,'invalid identity arrays fail closed');
for(const patch of [{siteId:'other'},{siteSlug:'other'},{characterId:'other'}])check(group(messages,{...location,...patch}).length===0,'cross-scope identity rejected');
check(refs(['h','a'],[card(home),{senderType:'user',text:'another'},card(away)],location)===null,'separate turns cannot form a group');
check(group([card(home),{...card(away),sessionId:'two'}],location).length===0,'cross-session group rejected');
check(group([card({...home,matchStatus:'candidate'})],location).length===0,'unconfirmed candidate cannot become matched snapshot');
check(group([{...card(home),deliveryStatus:'failed'}],location).length===0,'failed card is not displayed evidence');
for(const key of ['productRequestState','productCandidateState']) {
 const blockedRows=[...messages,{senderType:'character',[key]:{version:1,status:'cleared',siteId:site.id,characterId:location.characterId}}];
 check(group(blockedRows,location).length===0,'newer persisted clearing boundary invalidates old cards');
 check(context({...args,recentMessages:blockedRows})===null,'shared producer reference cannot cross persisted clear boundary');
 const changedRows=[...messages,{senderType:'character',[key]:{version:1,status:'active',targetEvidence:'New target',siteId:site.id,characterId:location.characterId}}];
 check(group(changedRows,location).length===0,'newer target owner boundary invalidates old card group');
}
const read=context(args);
check(read.snapshotOnly&&read.products.length===2&&buildProductCardDeliveryContext(read).count===0,'static facts carry both identities without emitting cards');
check(buildProductCardDeliveryContext(read).unfulfilledVariants.length===0,'read-only zero cards do not mean known snapshot targets are unverified');
const readReview=JSON.parse(buildReplyReviewMessages({productContext:read,boundaryReviewRequired:true,businessFactsRequired:true}).at(-1).content);
check(readReview.productCardDelivery.count===0&&readReview.productCardDelivery.unfulfilledVariants.length===0&&readReview.evidence.catalogueProducts.length===2,'readonly review keeps both facts and no spurious missing target');
check(buildProductContextLayer({id:location.characterId,categoryId:'mascot'},read,'What seasons?').content.includes('individual seasons distinct'),'read-only generation directly answers each snapshot season');
check(read.products.every(p=>!p.priceNow&&!p.stock&&p.available===null&&!p.sizes.length),'static snapshot hides live price stock options');
const resend={...base,commerceRoute:'product_search',needsLiveProductData:true,shouldLoadProductContext:true,cardAllowed:true};
const send=context({...args,searchIntent:resend});
check(selectProductsForMessage(send).length===2,'authorized resend retains exact pair');
const noVariants={...send,searchIntent:{...send.searchIntent,requestedVariants:[],requestedVariant:''}};
check(selectProductsForMessage(noVariants).length===2,'explicit two-identity resend does not require repeated variant words');
const originalCaption='The Manchester United Home Long Sleeve Football Jersey 2026/27 Red is shown again.';
const subtitleProduct={...selectProductsForMessage(noVariants)[0],subtitle:'Manchester United home and away football jersey'};
const ordinaryCaption=normalizeProductFollowupReply({text:originalCaption,product:subtitleProduct});
check(ordinaryCaption.displayText==='This one fits the moment nicely.','captured descriptor-caption mismatch reproduces original generic replacement');
const guestCaption=normalizeGuestReplyText({text:originalCaption,product:subtitleProduct,productRequested:true,productCardShown:true,productSearchIntent:noVariants.searchIntent,productContextSourceRef:noVariants.sourceRef,userText:'Show both again'});
check(guestCaption===originalCaption,'guest verified snapshot resend preserves original contextual caption for review');
const memberCaption=normalizeProductFollowupReply({text:originalCaption,product:subtitleProduct,preserveAnswer:noVariants.sourceRef==='displayed-product-reference'&&noVariants.snapshotOnly===true});
check(memberCaption.displayText===originalCaption,'member same preserveAnswer path keeps complete caption instead of mechanical fallback');
const cleanedCaption=normalizeGuestReplyText({text:originalCaption+' https://fixture.invalid/product {"price":"30"}',product:subtitleProduct,productRequested:true,productCardShown:true,productSearchIntent:noVariants.searchIntent,productContextSourceRef:noVariants.sourceRef,userText:'Show both again'});
check(!cleanedCaption.includes('https://')&&!cleanedCaption.includes('{'),'preserving snapshot caption retains original URL and JSON cleanup');

check(buildProductCardDeliveryContext(noVariants).count===2,'generation review and final selection share exact identity resend count');
check(selectProductsForMessage({...noVariants,searchIntent:{...noVariants.searchIntent,referencedProductIds:['a','h']}}).map(p=>p.id).join(',')==='a,h','explicit identity order controls resend instead of pool order');
for(const ids of [['h','h'],['h','x'],['h','a','x'],[]])check(selectProductsForMessage({...noVariants,searchIntent:{...noVariants.searchIntent,referencedProductIds:ids}}).length===0,'malformed snapshot resend identities fail closed');
for(const products of [null,undefined,{},'invalid',[null],[home,null],[3],[[]]])check(selectProductsForMessage({...noVariants,products}).length===0,'invalid snapshot product container retains original defensive no-card behavior');
check(selectProductsForMessage({...noVariants,snapshotOnly:false}).length===0,'source label alone cannot acquire group resend');
check(selectProductsForMessage({...noVariants,searchIntent:{...noVariants.searchIntent,cardAllowed:false}}).length===0,'explicit group cannot bypass current card permission');
check(selectProductsForMessage({...noVariants,suppressedProductKeys:['fixture:id:h']}).map(p=>p.id).join(',')==='a','original suppression remains before identity delivery');
check(selectProductsForMessage({...noVariants,products:[{...home,canonicalEdition:'fan'},{...away,canonicalEdition:'fan'}],searchIntent:{...noVariants.searchIntent,requestedEdition:'player'}}).length===0,'original edition filter remains before identity delivery');
check(buildProductContextLayer({id:location.characterId,categoryId:'mascot'},send,'Show both again').content.includes('not fresh price'),'resend generation distinguishes old live facts');
check(buildReplyReviewMessages({productContext:send,boundaryReviewRequired:true}).some(m=>m.content.includes('not a fresh price')),'independent review gets same snapshot restriction');
check(selectProductsForMessage(send).every(p=>p.livePriceFetchedAt===home.livePriceFetchedAt),'resend cannot redate old live-price verification');
for(const patch of [{shouldLoadProductContext:false},{cardAllowed:false},{replyBoundary:{salesAllowed:false}},{nonShoppingReason:'order'},{scopeUnverified:true},{unresolvedProductReference:true},{candidateConfirmationOnly:true},{productScopePending:true},{productRequirementAction:'new'},{productRequirementAction:'cancel'},{productRequestState:{status:'selected'}},{productCandidateState:{status:'active'}}])check(context({...args,searchIntent:{...resend,...patch}})===null,'reference cannot establish or bypass action/scope/candidate authority');
check(context({...args,searchIntent:{...base,needsLiveProductData:true}})===null,'price and options still require original live resolution');
check(context({...args,searchIntent:{...resend,requestedSeason:'2026/27'}})===null,'new hard requirement cannot reuse incompatible away');
const db={execute:async sql=>{if(/FROM sites/.test(sql))return [[site]];throw Error(`unexpected SQL: ${sql}`);}};
for(const intent of [base,resend]){
 const account=await buildChatProductRecommendationContext(db,{character:{id:location.characterId,category_id:'mascot',site_id:site.id},userText:'Show both pictures again',recentMessages:messages,precomputedSearchIntent:intent,fetchProducts:async()=>{throw Error('no search');}});
 const guest=await resolveGuestProductRecommendation(db,{guest:{site_id:site.id,mascot_character_id:location.characterId},userText:'Show both pictures again',recentMessages:messages,precomputedSearchIntent:intent,searchProducts:async()=>{throw Error('no search');}});
 check(account?.sourceRef==='displayed-product-reference'&&account.products.length===2,'member actual producer uses explicit group before legacy single shortcut');
 check(guest.context?.sourceRef==='displayed-product-reference'&&guest.context.products.length===2,'guest actual producer uses same reference contract');
 check(buildProductCardDeliveryContext(account).count===(intent===resend?2:0),'producer facts and actual card plan agree');
}
const decision={confident:true,confidence:.99,route:'product_question',topic:'other',needsLiveProductData:false,referencedProductIds:['h','a'],replyBoundary:{salesAllowed:true,contactAllowed:true},productRequest:{relation:'none',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:{action:'continue',evidence:'these',priorTargetEvidence:'',updates:[]},candidateResponse:{action:'none',evidence:''}};
const routed=await resolveCommerceSearchIntent({userText:'What season are these?',recentMessages:messages,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>decision,enrichAllTurns:true});
check(routed.referencedProductIds.length===2&&!routed.cardAllowed,'routing retains explicit immutable references without action grant');
for(const patch of [{productRequest:{...decision.productRequest,relation:'single'}},{productRequest:{...decision.productRequest,relation:'multiple'}},{productRequirement:{...decision.productRequirement,action:'new'}},{referencedProductIds:['h','x']},{productRequest:{...decision.productRequest,action:'cancel'}}]){
 const bad=await resolveCommerceSearchIntent({userText:'What season are these?',recentMessages:messages,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>({...decision,...patch}),enrichAllTurns:true});
 check(!bad.referencedProductIds?.length&&!bad.cardAllowed,'new/cancel/foreign reference cannot be carried by routing');
}
for(const flags of [{explicitTrigger:true},{searchIntent:{...base,nonShoppingReason:'order'}}]) {
 const early=await resolveCommerceSearchIntent({userText:'Hello',searchIntent:base,...flags,classifyCommerce:async()=>{throw Error('early gate must retain original no-classifier path');}});
 check(!early.referencedProductIds.length&&early.cardAllowed===false,'direct original early return clears carried group IDs without changing action permission');
}
const stale=await resolveCommerceSearchIntent({userText:'Hi',recentMessages:[],searchIntent:{...base},siteId:site.id,characterId:location.characterId,classifyCommerce:async()=>({confident:false,confidence:.2,route:'chat'}),enrichAllTurns:true});
check(!stale.referencedProductIds?.length,'uncertain current classifier cannot inherit previous reference array');
const reshowRouted=await resolveCommerceSearchIntent({userText:'Show both again',recentMessages:messages,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>({...decision,route:'product_search'}),jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1},enrichAllTurns:true});
check(reshowRouted.cardAllowed&&reshowRouted.referencedProductIds.length===2,'existing references plus independently authorized current reshow retain exact group');
check(context({...args,searchIntent:reshowRouted})?.products.length===2,'resolved reshow is consumed by same shared producer without privilege repair');
const tracked={version:1,status:'active',siteId:site.id,characterId:location.characterId,owner:'single',targetEvidence:'Show home and away jerseys',requestedConditionEvidence:['Show home and away jerseys'],requirements:{requestedTeam:'Manchester United',requestedVariants:['home','away']},suspectedTerm:null,proposal:null};
const trackedRows=[...messages.slice(0,3),{senderType:'character',productCandidateState:tracked},messages.at(-1)];
const trackedRoute=await resolveCommerceSearchIntent({userText:'What season are these?',recentMessages:trackedRows,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>({...decision,productRequirement:{action:'none',evidence:'',updates:[],suspectedTerm:null},productRequirementAction:'none',candidateDecisionRequired:true}),enrichAllTurns:true});
check(trackedRoute.productCandidateState?.status==='active'&&Boolean(context({...args,recentMessages:trackedRows,searchIntent:trackedRoute})),'matched target tracking without candidate proposal remains readable');
for(const method of ['member','guest']){
 const config={userText:'What season are these?',recentMessages:trackedRows,precomputedSearchIntent:trackedRoute};
 const result=method==='member'?await buildChatProductRecommendationContext(db,{...config,character:{id:location.characterId,category_id:'mascot',site_id:site.id}}):(await resolveGuestProductRecommendation(db,{...config,guest:{site_id:site.id,mascot_character_id:location.characterId}})).context;
 check(result?.products.length===2&&buildProductCardDeliveryContext(result).count===0,'actual '+method+' producer keeps matched active target without creating cards');
}
const appendedRows=[...trackedRows,{senderType:'character',productCandidateState:trackedRoute.productCandidateState},{senderType:'user',text:'Show both again'}];
check(group(appendedRows,location).length===2,'static reference preserves original matched target for the following turn');
const actualThird=await resolveCommerceSearchIntent({userText:'Show both again',recentMessages:appendedRows,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>({...decision,route:'product_search',productRequirement:{action:'none',evidence:'',updates:[],suspectedTerm:null},productRequirementAction:'none',candidateDecisionRequired:true}),jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1},enrichAllTurns:true});
check(context({...args,recentMessages:appendedRows,searchIntent:actualThird})?.products.length===2,'following independently authorized resend still consumes preserved matched target');
for(const patch of [{owner:'selected'},{proposal:{status:'displayed',candidateId:'h',name:home.name,reply:'This one?'}},{targetEvidence:'Different new target'}])check(context({...args,recentMessages:trackedRows,searchIntent:{...trackedRoute,productCandidateState:{...trackedRoute.productCandidateState,...patch}}})===null,'candidate proposal selected/new owner cannot borrow matched group');
const primaryBlocked=await resolveCommerceSearchIntent({userText:'Show both again',recentMessages:messages,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>({...decision,route:'product_search'}),jevDecision:{ok:true,confident:true,primaryIntent:'daily_chat',productIntent:'none',productAction:0},enrichAllTurns:true});
check(!primaryBlocked.cardAllowed&&!primaryBlocked.referencedProductIds?.length,'reference array cannot override primary JEV action denial');
const clear=await resolveCommerceSearchIntent({userText:'Remove the team requirement',recentMessages:messages,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>({...decision,productRequirement:{...decision.productRequirement,updates:[{field:'requestedTeam',value:'',evidence:'Remove the team requirement'}]}}),enrichAllTurns:true});
check(!clear.referencedProductIds?.length&&!clear.cardAllowed,'explicit requirement removal cannot retain old group');
const scopeItems=[{evidence:'Manchester United jersey',sharedEvidence:'',text:'Manchester United jersey'},{evidence:'Barcelona jersey',sharedEvidence:'',text:'Barcelona jersey'}];
for(const ownerCase of ['selected','pending','proposal']){
 const scope={version:1,status:ownerCase==='selected'?'selected':'pending',siteId:site.id,characterId:location.characterId,items:scopeItems,selectedIndex:ownerCase==='selected'?0:null,clarificationCount:0};
 const state=ownerCase==='selected'?{...tracked,owner:'selected',selectedIndex:0,ownerEvidence:createHash('sha256').update(JSON.stringify(scopeItems.map(item=>[item.evidence,item.sharedEvidence]))).digest('hex')}:ownerCase==='proposal'?{...tracked,proposal:{status:'displayed',candidateId:'h',name:home.name,reply:'This one?'}}:tracked;
 const protectedRows=[{senderType:'user',text:'old target'},card(home),{senderType:'character',productCandidateState:state,...(ownerCase==='proposal'?{}:{productRequestState:scope})}];
 const protectedRoute=await resolveCommerceSearchIntent({userText:'What season is this?',recentMessages:protectedRows,searchIntent:{},siteId:site.id,siteSlug:site.slug,characterId:location.characterId,classifyCommerce:async()=>({...decision,referencedProductIds:['h'],productRequirement:{action:'none',evidence:'',updates:[]},productRequirementAction:'none'}),enrichAllTurns:true});
 check(!protectedRoute.referencedProductIds?.length&&!protectedRoute.cardAllowed,'pre-transition '+ownerCase+' scope cannot be erased into group reference authority');
 for(const method of ['member','guest']){
  const config={userText:'What season is this?',recentMessages:protectedRows,precomputedSearchIntent:protectedRoute};
  const result=method==='member'?await buildChatProductRecommendationContext(db,{...config,character:{id:location.characterId,category_id:'mascot',site_id:site.id}}):(await resolveGuestProductRecommendation(db,{...config,guest:{site_id:site.id,mascot_character_id:location.characterId}})).context;
  check(result?.sourceRef!=='displayed-product-reference'&&buildProductCardDeliveryContext(result)?.count!==1,'actual '+method+' producer does not expose protected '+ownerCase+' through array shortcut');
 }
}
const norm=normalizeCommerceDecision({...decision,referencedProductIds:['h','h']},{userText:'these'});
check(norm.referencedProductIds.length===0,'normalizer rejects duplicate reference IDs');
const sample=s=>s.anyOf?sample(s.anyOf[0]):s.enum?s.enum[0]:s.type==='object'?Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,sample(v)])):s.type==='array'?Array.from({length:s.minItems||0},()=>sample(s.items)):s.type==='string'?'':s.type==='boolean'?false:s.type==='null'?null:s.minimum??0;
const shape=sample(COMMERCE_INTENT_RESPONSE_FORMAT.json_schema.schema);
check(validateCommerceIntentShape(shape),'current formal shape valid');
const {referencedProductIds:ignored,...legacy}=shape;
check(validateCommerceIntentShape(legacy),'legacy missing-array contract remains compatible');
for(const invalid of [['h','a','x'],[3],['x'.repeat(161)]])check(!validateCommerceIntentShape({...shape,referencedProductIds:invalid}),'wire shape bounds references');
console.log(`displayed product reference self-check passed: ${checks} checks; injected sites only, no DB/network/models`);
