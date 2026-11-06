import assert from 'node:assert/strict';
import {buildBusinessClaimContext,validateBusinessClaimAudit} from '../server/business-claim-audit-service.js';
import {resolveTrustedCurrentProductSizing} from '../server/product-sizing-context-service.js';
const site={id:'shop',slug:'shop',site_url:'https://fixture.invalid'};
const character={id:'guide',category_id:'mascot',site_id:'shop'};
const card={id:'p',productId:'p',siteId:'shop',siteSlug:'shop',name:'A kids shirt',url:'https://fixture.invalid/p',sizes:[{label:'28'}]};
const chart={title:'Product chart',unit:'',columns:['Size','Length','Chest'],rows:[['28','62-6','89-94']]};
let reads=0;
const product=await resolveTrustedCurrentProductSizing({site,product:card,resolveProduct:async()=>{reads++;return{resolvedFromSource:true,site,sourceItem:{...card,sizeChartResolved:true,sizeChart:chart,sizes:[{label:'28',available:true}]}}}});
assert.equal(reads,1);
const base={businessFactsRequired:true,sizingRequired:true,text:'The chart lists 62-6 for length.',userText:'What does the size chart say for 28?',catalogueOwner:{character,trustedSite:site},
 searchIntent:{commerceRoute:'product_question',commerceTopic:'sizing',knowledgeScope:'business',answerRequired:true,policyKnowledgeRequest:{source:'jev',required:false},replyBoundary:{salesAllowed:true,contactAllowed:true}},
 knowledgeContext:{ok:true,strategy:'not_requested',customerServiceIntent:false,items:[]},
 productContext:{siteId:'shop',siteSlug:'shop',sourceType:'product_api',sourceRef:'current-product-sizing-context',searchOutcome:'matched',cardAllowed:false,products:[],sizingProduct:product}};
const audit=buildBusinessClaimContext(base);
const ref=audit?.references.find(r=>r.kind==='catalogue');
assert(ref,'Strictly source-resolved current-product sizing needs its own catalogue audit reference');
assert(ref.text.includes('62-6')&&ref.text.includes('89-94'),'Projected source values remain literal, bounded and unit-unknown');
const row={unitId:'u0',roles:['catalogue'],factual:true,referenceIds:[ref.id],supported:true,sourceAllowsException:false,replyPreservesException:false};
assert(validateBusinessClaimAudit([row],audit).accepted);
for(const patch of [
 {sizingRequired:false},
 {catalogueOwner:{character,trustedSite:{...site,id:'foreign'}}},
 {productContext:{...base.productContext,sourceErrorCode:'timeout'}},
 {productContext:{...base.productContext,sourceRef:'unknown'}},
 {productContext:{...base.productContext,sizingProduct:{...card,sizeChartResolved:true,sizeChart:chart}}},
 {productContext:{...base.productContext,sizingProduct:JSON.parse(JSON.stringify(product))}},
 {productContext:{...base.productContext,sizingProduct:{...product,sizeChart:{...chart,unit:'cm'}}}},
 {productContext:{...base.productContext,sizingProduct:{...product,siteId:'foreign'}}},
]) assert(!buildBusinessClaimContext({...base,...patch})?.references.some(r=>r.kind==='catalogue'),'Only verified same-site immutable source may authorize sizing facts');
assert(!validateBusinessClaimAudit([{...row,roles:['store_policy']}],audit).accepted,'A product chart never proves store policy');
assert(!validateBusinessClaimAudit([{...row,roles:['live_order_state']}],audit).accepted,'A chart cannot support actual order facts');
assert(!validateBusinessClaimAudit([{...row,supported:false}],audit).accepted,'Source projection cannot override semantic rejection');
console.log('Sizing catalogue authority: strict resolver/source/owner/proof, literal raw values and role separation passed');
for(const patch of [
 {productContext:{...base.productContext,sizingProduct:{...product,name:'A different item'}}},
 {productContext:{...base.productContext,sizingProduct:{...product,id:'other',productId:'other'}}},
 {productContext:{...base.productContext,sizingProduct:{...product,sizes:[{label:'28',available:false}]}}},
 {productContext:{...base.productContext,siteSlug:'foreign'}},
 {searchIntent:{...base.searchIntent,referencedProductId:'other'}},
 {catalogueOwner:{character:{...character,id:''},trustedSite:site}},
]) assert(!buildBusinessClaimContext({...base,...patch})?.references.some(r=>r.id==='z0'),'Post-source identity, label and request-reference mutations fail closed');
const noSource=await resolveTrustedCurrentProductSizing({site,product:{...card,sizeChartResolved:true,sizeChart:chart},resolveProduct:async()=>({resolvedFromSource:false,site,sourceItem:{...card,sizeChartResolved:true,sizeChart:chart}})});
assert(!noSource.sizeChartResolved,'A claimed historical resolved flag cannot bypass actual source failure');
const foreignSource=await resolveTrustedCurrentProductSizing({site,product:card,resolveProduct:async()=>({resolvedFromSource:true,site,sourceItem:{...card,siteId:'foreign',sizeChartResolved:true,sizeChart:chart}})});
assert(!foreignSource.sizeChartResolved,'Conflicting source-item site cannot borrow the wrapper site');
const noTable=await resolveTrustedCurrentProductSizing({site,product:card,resolveProduct:async()=>({resolvedFromSource:true,site,sourceItem:{...card,sizeChartResolved:true,sizeChart:null}})});
assert(buildBusinessClaimContext({...base,productContext:{...base.productContext,sizingProduct:noTable}}).references.some(r=>r.id==='z0'),'Verified exact lookup without a table still supplies a bounded no-table fact, never inferred measurements');
