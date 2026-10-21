import assert from 'node:assert/strict';
import { applyProductRequestScope, readProductRequestState } from '../server/product-request-scope-service.js';
import { applyProductCandidateState, markProductCandidateDisplayed } from '../server/product-candidate-state-service.js';
import { buildProductSearchIntent } from '../server/product-intent-service.js';
import { productCandidateContext } from '../server/product-search-execution-service.js';
import { toCandidateReviewContext } from '../server/product-candidate-context-service.js';
import { toClientProduct } from '../server/product-response-sanitizer.js';
const loc={siteId:'site',characterId:'role'};
const original='Real Madrid home shirt and Barcelona away shirt; my budget is 29 EUR for each. Contact me at own@example.invalid.';
const items=[{evidence:'Real Madrid home shirt',sharedEvidence:''},{evidence:'Barcelona away shirt',sharedEvidence:''}];
const options={...loc,buildIntent:buildProductSearchIntent};
const initial=applyProductRequestScope({}, {confidence:.99,route:'product_search',productRequest:{relation:'multiple',action:'new',items,selectedIndex:null,selectionEvidence:''}}, {...options,userText:original});
assert.ok(initial.productRequestState.originalUserText?.includes('29 EUR'),'full original USER request survives an omitted sharedEvidence budget');
assert.ok(!initial.productRequestState.originalUserText.includes('own@example.invalid'),'original request context redacts contact emails');
const selectText='The first one.';
const selection={confidence:.99,confident:true,route:'product_search',productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:0,selectionEvidence:selectText},
 productRequirement:{action:'new',evidence:selectText,updates:[],suspectedTerm:null},candidateResponse:{action:'none'}};
const selected=applyProductRequestScope({replyBoundary:{salesAllowed:true}},selection,{...options,userText:selectText,recentMessages:[{senderType:'character',productRequestState:initial.productRequestState}]});
assert.equal(selected.productRequestState.originalUserText,initial.productRequestState.originalUserText);
const intent=applyProductCandidateState({...selected,commerceRoute:'product_search'},selection,{...loc,userText:selectText});
const product={id:'p',name:'Real Madrid Home Shirt',siteId:'site',matchStatus:'candidate',url:'https://site.invalid/p'};
const context={siteId:'site',searchOutcome:'candidate',cardAllowed:true,searchIntent:intent,products:[product],candidateContext:productCandidateContext([product],intent,loc)};
const projected=toCandidateReviewContext(context);
assert.ok(projected.originalRequestContext.text.includes('29 EUR'));
assert.equal(projected.originalRequestContext.selectedIndex,0);
assert.equal(projected.originalRequestContext.selectedItemEvidence,items[0].evidence);
assert.ok(!intent.requestedKeywords.includes('barcelona'),'other item specifics must never become selected search constraints');
assert.equal(toClientProduct({...product,originalRequestContext:projected.originalRequestContext}).originalRequestContext,undefined);
const continuation='Keep helping with the first one.';
const continued=applyProductRequestScope(selected,{...selection,productRequest:{...selection.productRequest,action:'continue',selectionEvidence:continuation}},
 {...options,userText:continuation,recentMessages:[{senderType:'character',productRequestState:selected.productRequestState}]});
assert.equal(continued.productRequestState.originalUserText,initial.productRequestState.originalUserText);
const canceled=applyProductRequestScope(selected,{...selection,productRequest:{relation:'none',action:'cancel',items:[],selectedIndex:null,selectionEvidence:'Cancel it'}},
 {...options,userText:'Cancel it',recentMessages:[{senderType:'character',productRequestState:selected.productRequestState}]});
assert.equal(canceled.productRequestState.originalUserText,undefined);
const replaced=applyProductRequestScope(selected,{confidence:.99,route:'product_search',productRequest:{relation:'multiple',action:'new',items:[{evidence:'Arsenal shirt',sharedEvidence:''},{evidence:'Chelsea shirt',sharedEvidence:''}],selectedIndex:null,selectionEvidence:''}},
 {...options,userText:'Arsenal shirt and Chelsea shirt, no price preference',recentMessages:[{senderType:'character',productRequestState:selected.productRequestState}]});
assert.ok(!replaced.productRequestState.originalUserText.includes('29 EUR'));
assert.equal(readProductRequestState([{senderType:'character',productRequestState:selected.productRequestState}],{...loc,siteId:'other'}),null);
// Same item excerpts with a different original request cannot borrow ownership.
const changedScope={...selected.productRequestState,originalUserText:'Real Madrid home shirt and Barcelona away shirt; budget 999 EUR.'};
const previous={...intent.productCandidateState};
const changed=applyProductCandidateState({...intent,productRequestState:changedScope},{...selection,productRequirement:{...selection.productRequirement,action:'continue'}},
 {...loc,userText:selectText,recentMessages:[{senderType:'character',productCandidateState:previous,productRequestState:selected.productRequestState}]});
assert.notEqual(changed.productCandidateState.ownerEvidence,previous.ownerEvidence);
console.log('original multi-item user context preservation self-check passed (pure; no network/DB/model)');

const { buildCandidateConfirmationContext }=await import('../server/product-candidate-confirmation-service.js');
const { productRequestOwnerEvidence }=await import('../server/product-request-scope-service.js');
const { createHash }=await import('node:crypto');
const displayed=markProductCandidateDisplayed(intent.productCandidateState,product,{approvedReply:'Is this the item you mean?',confirmationRequested:true});
const assent='Yes, that is the item.';
const confirmedIntent={...intent,commerceRoute:'product_question',cardAllowed:false,shouldLoadProductContext:false,needsLiveProductData:false,
 candidateConfirmationOnly:true,confirmedCandidateId:'p',referencedProductId:'p',productCandidateState:{...displayed,proposal:{...displayed.proposal,status:'confirmed',confirmationEvidence:assent}}};
const confirmedContext=await buildCandidateConfirmationContext({site:{id:'site',slug:'site'},characterId:'role',userText:assent,searchIntent:confirmedIntent,
 recentMessages:[{senderType:'character',characterId:'role',contentType:'product',product},
 {senderType:'character',characterId:'role',productRequestState:selected.productRequestState,productCandidateState:displayed}],
 resolveProduct:async()=>({resolvedFromSource:true,site:{id:'site',slug:'site'},sourceItem:product}),buildCandidateContext:productCandidateContext});
assert.ok(toCandidateReviewContext(confirmedContext).originalRequestContext.text.includes('29 EUR'),'source refresh and identity confirmation retain the original budget context');
const legacy={...selected.productRequestState};delete legacy.originalUserText;
assert.equal(productRequestOwnerEvidence(legacy),createHash('sha256').update(JSON.stringify(legacy.items.map(i=>[i.evidence,i.sharedEvidence]))).digest('hex'));
assert.ok(readProductRequestState([{senderType:'character',productRequestState:legacy}],loc),'legacy stored scope remains readable without fabricated original text');
assert.equal(readProductRequestState([{senderType:'character',productRequestState:{...selected.productRequestState,originalUserText:'An unrelated request'}}],loc),null);
console.log('identity-confirmation budget context and legacy ownership compatibility passed');
