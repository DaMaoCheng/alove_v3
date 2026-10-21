import assert from 'node:assert/strict';
import { executeProductSearch, executeProductSearchDetailed, productCandidateContext } from '../server/product-search-execution-service.js';
import { buildProductSearchIntent } from '../server/product-intent-service.js';
import { normalizeProductFollowupReply } from '../server/product-followup-sanitizer.js';
import { selectProductsForMessage } from '../server/chat-product-reply-service.js';
import { enforceReplyBoundary } from '../server/chat-reply-boundary-service.js';
const intent = { ...buildProductSearchIntent('Real Madrid away jersey 2026/27'), requestedPrinting: 'none', requestedFeatures: ['short_sleeve'], candidateSearchAllowed: true, cardAllowed: true, commerceRoute: 'product_search', requestedKeywords: ['fun'], shouldLoadProductContext: true, searchState: 'ready_to_search' };
const item = (id, fields = {}) => ({ id, productId:id, name:'Real Madrid Away Soccer Fan Jersey 2026/27', url:`https://store.example/${id}`, available:true, features:['Real Madrid','Away','2026/27'], attributeEvidence:{edition:'fan',printing:'none',sleeve:'unknown',giveaway:true}, ...fields });
const rows = [item('one'), item('long', {name:'Real Madrid Away Long Sleeve Jersey 2026/27',attributeEvidence:{edition:'fan',printing:'none',sleeve:'long_sleeve'}}), item('printed', {attributeEvidence:{edition:'fan',printing:'printed',sleeve:'unknown'}}), item('wrong', {name:'Barcelona Away Fan Jersey 2026/27',features:['Barcelona','Away','2026/27']})];
let calls = [];
const options = { productApiUrl:'ttmall://store.example', query:'Real Madrid away Soccer Fun Jersey 2026/27', searchIntent:intent, fetchProducts:async(_url,search)=>{calls.push(search.query);return rows;}, classifyEditions:null };
const result = await executeProductSearchDetailed(options);
assert.deepEqual(result.matches, []);
assert.deepEqual(result.candidates.map(p=>p.id), ['one']);
assert.deepEqual(result.candidates[0].candidateUnknownFields,['sleeve']);
assert.equal(calls.length,3); assert.equal(calls[0],options.query);
assert.deepEqual(await executeProductSearch({...options,searchIntent:{...intent,candidateSearchAllowed:false}}),[]);
for (const change of [{shouldLoadProductContext:false},{cardAllowed:false},{productScopePending:true},{scopeUnverified:true},{nonShoppingReason:'order'},{searchState:'clarification_exhausted'}]) {
  calls=[]; assert.deepEqual(await executeProductSearchDetailed({...options,searchIntent:{...intent,...change}}),{matches:[],candidates:[]}); assert.equal(calls.length,0);
}
const rejected=await executeProductSearchDetailed({...options,searchIntent:{...intent,rejectedCandidateId:'one'}});assert.equal(rejected.candidates.length,0);
const confirmed=await executeProductSearchDetailed({...options,searchIntent:{...intent,confirmedCandidateId:'one'}});assert.equal(confirmed.candidates[0].candidateUnknownFields[0],'sleeve');
const knownConfirmed = await executeProductSearchDetailed({ ...options,
 searchIntent: { ...intent, requestedKeywords: [], confirmedCandidateId: 'one' },
 fetchProducts: async () => [item('one', { attributeEvidence: { edition: 'fan', printing: 'none', sleeve: 'short_sleeve', giveaway: false } })] });
assert.equal(knownConfirmed.matches.length, 0, 'known attributes cannot bypass identity-confirmation evidence review');
assert.equal(knownConfirmed.candidates[0].id, 'one');
const context={siteId:'site',siteSlug:'store',searchIntent:intent,searchOutcome:'candidate',products:result.candidates,candidateContext:productCandidateContext(result.candidates,intent)};
assert.equal(selectProductsForMessage(context)[0].matchStatus,'candidate');
const caption=normalizeProductFollowupReply({text:'He encontrado una candidata. ¿Es esta la que buscas?',product:result.candidates[0],preserveAnswer:true}); assert.match(caption.displayText,/¿Es esta/);
const approved={allowed:true,confidence:.99,boundarySupported:true,evidenceSupported:true,candidateConfirmationSupported:true};
const reply={text:'¿Es esta la que buscas? Las condiciones de la actividad y la manga siguen pendientes.',speechText:'¿Es esta la que buscas? Las condiciones de la actividad y la manga siguen pendientes.',sourceType:'ai'};
const passed=await enforceReplyBoundary({replyResult:reply,searchIntent:intent,productContext:context,assess:async()=>approved,recordReview:async()=>{}});
assert.equal(passed.candidateConfirmationVerified,true);assert.equal(passed.candidateEvidenceVerified,true);
for (const verdict of [{...approved,candidateConfirmationSupported:false},{...approved,candidateConfirmationSupported:undefined},{allowed:false,confidence:0,reviewStatus:'timeout'}]) {
 const denied=await enforceReplyBoundary({replyResult:reply,searchIntent:intent,productContext:context,assess:async()=>verdict,recordReview:async()=>{}});assert.equal(denied.candidateConfirmationVerified,false);assert.equal(denied.candidateEvidenceVerified,false);
}
assert.equal(productCandidateContext(result.candidates,{confirmedCandidateId:'one'}).requiresConfirmation,false);
await assert.rejects(()=>executeProductSearchDetailed({...options,fetchProducts:async()=>{throw new Error('source outage');}}),/source outage/);
const numbered = item('five', {name:'Real Madrid Away BELLINGHAM #5 Jersey 2026/27',attributeEvidence:{edition:'fan',printing:'printed',sleeve:'short_sleeve',giveaway:false}});
const printRequirement={...intent,requestedPrinting:'printed',requestedPrintNumber:'7',customizationRequest:'jersey',requestedKeywords:['7'],confirmedCandidateId:'five'};
const printResult=await executeProductSearchDetailed({...options,searchIntent:printRequirement,fetchProducts:async()=>[numbered]});
assert.equal(printResult.matches.length,0,'entity confirmation cannot erase a different print number');
assert.equal(printResult.candidates.length,0,'custom-print conditions retain their original strict path');
const matchingPrinted = await executeProductSearchDetailed({ ...options, searchIntent: { ...printRequirement, confirmedCandidateId: 'seven' },
 fetchProducts: async () => [item('seven', { name: 'Real Madrid Away BELLINGHAM #7 Jersey 2026/27',
 attributeEvidence: { edition: 'fan', printing: 'printed', printNumber: '7', sleeve: 'short_sleeve', giveaway: false } })] });
assert.equal(matchingPrinted.matches.length, 0, 'strict printed matches must still review identity assent');
assert.equal(matchingPrinted.candidates[0].id, 'seven');
const unknownTermResult=await executeProductSearchDetailed({...options,searchIntent:{...intent,requestedFeatures:[],requestedKeywords:['cotton'],confirmedCandidateId:'one'},fetchProducts:async()=>[item('one',{attributeEvidence:{edition:'fan',printing:'none',sleeve:'short_sleeve',giveaway:false}})]});
assert.equal(unknownTermResult.matches.length,0,'confirmed entity does not clear every unverified catalogue term');
console.log('product candidate search self-check passed (isolated source/review; no model, DB or network calls)');
