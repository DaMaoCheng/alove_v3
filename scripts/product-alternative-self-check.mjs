import assert from 'node:assert/strict';
import { toGuestSafeProductSearchResult } from '../server/guest-product-sanitizer.js';
import { markServerProductOrigins } from '../server/product-source-provenance.js';
import { executeProductSearchDetailed } from '../server/product-search-execution-service.js';
import { buildProductSearchIntent, filterProductsByIntent } from '../server/product-intent-service.js';
import { bindProductAlternativeContext, transferAlternativeSearch, isProductAlternativeContext, toAlternativeReviewContext } from '../server/product-alternative-service.js';
const intent = { commerceRoute:'product_search', shouldLoadProductContext: true, cardAllowed: true, candidateSearchAllowed: true, requestedTeam: 'Barcelona',
  requestedProductType: 'shirt', requestedSeason: '2022', requestedVariant: 'home', query: 'Barcelona home 2022', requestedKeywords: [] };
const product = (id, name) => ({ productId: id, name, url: `https://shop.example/products/${id}`, available: true });
const old = product('old', 'Barcelona 2021/22 Home Jersey');
const next = product('next', 'Barcelona 2022/23 Home Jersey');
const current = product('current', 'Barcelona 2026/27 Home Jersey');
assert.equal(buildProductSearchIntent('Barcelona home jersey 2022').requestedSeason, '2022');
const now = new Date(), startYear = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
const currentSeason = `${startYear}/${String(startYear + 1).slice(-2)}`;
for (const year of [startYear, startYear + 1]) assert.equal(buildProductSearchIntent(`Barcelona home jersey ${year}`).requestedSeason, currentSeason);
assert.equal(buildProductSearchIntent('Barcelona home jersey 2026/27').requestedSeason, '2026/27');
assert.equal(buildProductSearchIntent(`Barcelona home jersey ${startYear + 3}`).requestedSeason, '');
assert.deepEqual(filterProductsByIntent([old,next,current], intent).map(p => p.productId), ['old','next']);
let calls = [];
const exact = await executeProductSearchDetailed({ searchIntent: intent, query: intent.query,
  fetchProducts: async (_url, i) => { calls.push(i.query); return i.query.includes('2021/22') ? [old] : []; } });
assert.equal(exact.matches[0].productId, 'old');
assert.equal(calls.length, 2);
calls = [];
const result = await executeProductSearchDetailed({ searchIntent: intent, query: intent.query,
  fetchProducts: async (_url, i) => { calls.push(i.query); return i.requestedSeason ? [] : [
    ...Array.from({length:6}, (_,index) => product(`set${index}`, 'Barcelona 2026/27 Home Conjunto kit')),
    product('shorts','Barcelona 2026/27 Home Shorts'),product('socks','Barcelona 2026/27 Home Socks'),current,
    product('wrong','Real Madrid 2026/27 Home Jersey'), product('away','Barcelona 2026/27 Away Jersey')]; } });
assert.equal(result.alternatives.length, 1);
assert.equal(result.alternatives[0].productId, 'current');
assert.equal(calls.length, 4);
assert.ok(calls[1].includes('2021/22') && calls[2].includes('2022/23'));
const context = bindProductAlternativeContext({ siteId: 'site_test', searchIntent: intent,
  searchOutcome: 'alternative', products: result.alternatives }, result);
assert.ok(isProductAlternativeContext(context));
assert.equal(toAlternativeReviewContext(context).requestedSeason, '2022');
assert.equal(toAlternativeReviewContext(context).originalSearchOutcome, 'no_match');
assert.ok(!isProductAlternativeContext(JSON.parse(JSON.stringify(context))));
const moved = { ...context, siteId: 'other' };
assert.ok(!isProductAlternativeContext(moved));
context.products[0].name += ' changed';
assert.ok(!isProductAlternativeContext(context));
context.products[0].name = current.name;
const badPrice = transferAlternativeSearch(result, {items: result.alternatives.map(p => ({...p,price:'9999'}))});
assert.ok(!isProductAlternativeContext(bindProductAlternativeContext({siteId:'test',searchIntent:intent,searchOutcome:'alternative',products:badPrice.items},badPrice)));
const publicResult = transferAlternativeSearch(result,markServerProductOrigins({site:{id:'test',siteUrl:'https://shop.example'},items:result.alternatives},result.alternatives));
const safe = toGuestSafeProductSearchResult(publicResult,{includeAttributeEvidence:true});
assert.ok(isProductAlternativeContext(bindProductAlternativeContext({siteId:'test',searchIntent:intent,searchOutcome:'alternative',products:safe.items},publicResult)));
const transported = transferAlternativeSearch(result, { items: result.alternatives.map(p => ({ ...p })) });
assert.ok(isProductAlternativeContext(bindProductAlternativeContext({ siteId:'test', searchIntent:intent,
 searchOutcome:'alternative', products:transported.items }, transported)));
let failedCalls=0;
await assert.rejects(executeProductSearchDetailed({ searchIntent: intent, query: intent.query,
  fetchProducts: async () => { failedCalls++; throw new Error('source failed'); } }), /source failed/);
assert.equal(failedCalls,1);
for (const patch of [{requestedVariants:['home','away']},{confirmedCandidateId:'x'}, {requestedSeason:''}, {explicitSizingProductSearch:true},{productRequestState:{status:'pending',items:[]}},{productRequestState:{status:'selected',items:[{},{}]}},{referencedProductIds:['a','b']}]) {
 let relaxedCalls=0;
 const no = await executeProductSearchDetailed({searchIntent:{...intent,...patch},query:intent.query,
   fetchProducts:async (_url, i)=> {if(!i.requestedSeason) relaxedCalls++; return [];} });
 assert.ok(!no.alternatives?.length);
 if(patch.requestedSeason !== '') assert.equal(relaxedCalls,0);
}
console.log('Product alternatives: season recall, hard filters, bounded true-no-match, proof and exclusions passed.');

for (const name of ["Conjunto Barcelona 2026/27 Primera Equipación", "Barcelona 2026/27 Home Kit", "Barcelona 2026/27 Home Socks", "Barcelona 2026/27 Home Shorts", "Barcelona 2026/27 Home Jersey and Shorts Set", "Conjunto Camiseta Barcelona 2026/27 Primera Equipación"]) {
 const r=await executeProductSearchDetailed({searchIntent:intent,query:intent.query,fetchProducts:async(_url,i)=>i.requestedSeason?[]:[product("bad-kind",name),current]});
 assert.equal(r.alternatives?.[0]?.productId,"current","non-shirt garment must not replace a jersey: "+name);
}
console.log("Alternative explicit garment evidence negatives passed");
let reusedCalls=0;
const reused=await executeProductSearchDetailed({searchIntent:intent,query:intent.query,fetchProducts:async()=>{reusedCalls++;return [current];}});
assert.equal(reused.alternatives?.[0]?.productId,'current');
assert.equal(reusedCalls,3,'reusing a pool must wait for every original recall and avoid extra query');
let partialCalls=0;
await assert.rejects(executeProductSearchDetailed({searchIntent:intent,query:intent.query,fetchProducts:async()=>{partialCalls++;if(partialCalls===3)throw Error('last original recall failed');return [current];}}),/last original recall failed/);
assert.equal(partialCalls,3,'an earlier useful alternative must not conceal a later original-search error');
console.log('Original-pool reuse waits for successful complete original recall; failures never authorize substitutes');

const businessMixed=await executeProductSearchDetailed({searchIntent:{...intent,customerServiceKnowledgeRequest:true,answerRequired:true},query:intent.query,fetchProducts:async()=>[current]});
assert.equal(businessMixed.alternatives?.[0]?.productId,"current","knowledge-purpose hint cannot close an actual authorized product search");
const policyOnly=await executeProductSearchDetailed({searchIntent:{...intent,commerceRoute:"store_policy"},query:intent.query,fetchProducts:async()=>[current]});
assert.equal(policyOnly.alternatives?.length||0,0,"policy route does not authorize automatic substitution");

for(const patch of [{replyBoundary:{salesAllowed:false}}, {searchState:"source_error"}, {searchState:"needs_clarification"}]) {
 const r=await executeProductSearchDetailed({searchIntent:{...intent,...patch},query:intent.query,fetchProducts:async()=>[current]});
 assert.equal(r.alternatives?.length||0,0,"closed action/search state must not permit automatic alternatives");
}
const { isGroundedCommerceRepairEligible, repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
const { markAlternativeSearch } = await import('../server/product-alternative-service.js');
const repairIntent = {...intent,commerceRoute:'product_search',primarySearchVerified:true,replyBoundary:{salesAllowed:true}};
const repairSource = markAlternativeSearch({matches:[],candidates:[],alternatives:[{...current,matchStatus:'alternative'}]},repairIntent,['original']);
const repairContext = bindProductAlternativeContext({siteId:'repair-site',sourceType:'product_api',sourceRef:'site-product-context',cardAllowed:true,
  searchOutcome:'alternative',searchIntent:repairIntent,products:repairSource.alternatives},repairSource);
const repairOptions = {replyResult:{text:'Here is the other jersey.',sourceRef:'provider',aiModel:'fixture'},
 character:{id:'role',category_id:'mascot',site_id:'repair-site'},trustedSite:{id:'repair-site'},searchIntent:repairIntent,productContext:repairContext,
 reviewStatus:'valid',reviewResult:{allowed:false,confidence:.95,boundarySupported:false},failedContracts:['boundary']};
assert.ok(isGroundedCommerceRepairEligible(repairOptions));
const classifierOwnedIntent={...repairIntent,primarySearchVerified:false};
const classifierOwnedSource=markAlternativeSearch({matches:[],candidates:[],alternatives:[{...current,matchStatus:'alternative'}]},classifierOwnedIntent,['original']);
const classifierOwnedContext=bindProductAlternativeContext({...repairContext,searchIntent:classifierOwnedIntent,products:classifierOwnedSource.alternatives},classifierOwnedSource);
assert.ok(isGroundedCommerceRepairEligible({...repairOptions,searchIntent:classifierOwnedIntent,productContext:classifierOwnedContext}),'existing authorized search proof does not require a new confident primary vote');
assert.ok(!isGroundedCommerceRepairEligible({...repairOptions,searchIntent:{...repairIntent,primarySearchBlocked:true}}));
for(const patch of [{groundedRepairAttempted:true},{productContext:JSON.parse(JSON.stringify(repairContext))},
 {searchIntent:{...repairIntent,replyBoundary:{salesAllowed:false}}},{searchIntent:{...repairIntent,requestedSizes:['XL']}},{trustedSite:{id:'other'}},{character:{...repairOptions.character,siteId:'other'}},{character:{...repairOptions.character,site_id:'other'}},{factualContext:{required:true}},{factualContext:{searched:true}},{factualContext:{items:[{id:'fact'}]}},{reviewStatus:'timeout'}]) {
 assert.ok(!isGroundedCommerceRepairEligible({...repairOptions,...patch}));
}
let repairCalls=0;
const repaired = await repairGroundedCommerceReply({...repairOptions,config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},
 requestText:async (request)=>{repairCalls++;assert.match(request.systemPrompt,/apology|apologize/);
 const body=JSON.parse(request.messages[0].content);assert.equal(body.matchedCatalogue.alternative.requestedSeason,'2022');
 return JSON.stringify({displayText:'Sorry, the original search did not find that season. This is the 2026/27 shirt instead.'});},recordLog:async()=>{},recordDiagnostic:async()=>{}});
assert.equal(repairCalls,1);
assert.ok(repaired?.text);
assert.ok(!repaired?.alternativeEvidenceVerified);
console.log('Alternative grounded repair: trusted-only eligibility, one generation and no inherited approval passed.');
