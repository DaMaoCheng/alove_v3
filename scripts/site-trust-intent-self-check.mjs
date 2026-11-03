import assert from 'node:assert/strict';
import { resolveCommerceSearchIntent } from '../server/commerce-routing-service.js';
const text='Is this a real website';
const primary={ok:true,primaryIntent:'daily_chat',orderIntent:'none',productIntent:'none',productAction:0};
const decision={confident:true,boundaryVerified:true,route:'chat',topic:'authenticity',confidence:.7,answerRequired:true,declaredLiveProductData:false,needsLiveProductData:false,knowledgeScope:'general',knowledgeQuery:text,knowledgeRequest:{kind:'site_trust_only',evidence:text},replyBoundary:{salesAllowed:false,contactAllowed:true},productRequest:{relation:'none',action:'suspend',items:[]},productRequirement:{action:'none',evidence:'',updates:[]}};
async function run(d=decision,jevDecision=primary){return resolveCommerceSearchIntent({userText:text,recentMessages:[],siteId:'s',characterId:'c',searchIntent:{},jevDecision,classifyCommerce:async()=>d,enrichAllTurns:true});}
assert.equal((await run()).siteTrustOnly,true);
for(const d of [{...decision,knowledgeRequest:null},{...decision,knowledgeRequest:{kind:'site_trust_only',evidence:'website'}},{...decision,route:'product_question'},{...decision,declaredLiveProductData:true},{...decision,referencedProductId:'p'},{...decision,answerRequired:false}])assert.equal((await run(d)).siteTrustOnly||false,false);
for(const primaryIntent of ['order_lookup','product_request','new_image','try_on']) assert.equal((await run(decision,{...primary,primaryIntent})).siteTrustOnly||false,false);
console.log('site trust: exact current evidence, no mixed or other action, safe absent-field default');
