import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
if(!process.argv.includes('--real')){console.log('Skipped: --real enables bounded local text-provider verification, no DB/audio/image.');process.exit(0)}
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {configureNetworkProxy}=await import('../server/network-proxy.js');
const {classifyCommerceIntent}=await import('../server/product-intent-classifier-service.js');
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
configureNetworkProxy();
const siteId='local-scope-diagnostic',characterId='local-scope-character';
const previous=process.argv.includes('--selection-only') ? JSON.parse(await readFile(process.env.PRODUCT_SCOPE_PREVIOUS_REPORT,'utf8'))[0].state : null;
const cases=previous ? [['selection','Primero la del Barcelona, por favor.']] : [['multiple','Quiero una camiseta roja del Real Madrid y una azul del Barcelona, una de cada equipo en talla M.'],['alternative','Busco una camiseta del Real Madrid o del Barcelona; solo voy a comprar una.']];
const results=[];
try{
for(const [expected,userText] of cases){
const recentMessages=previous ? [{senderType:'character',productRequestState:previous,text:'Which item first?'}] : [];
const started=Date.now();const decision=await classifyCommerceIntent(userText,{siteId,characterId,recentMessages});
const intent=await resolveCommerceSearchIntent({userText,siteId,characterId,recentMessages,searchIntent:buildProductSearchIntent(userText),enrichAllTurns:true,jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:1},classifyCommerce:async()=>decision});
results.push({expected,elapsedMs:Date.now()-started,route:decision.route,confidence:decision.confidence,productRequest:decision.productRequest,searchQuery:decision.searchQuery,query:intent.query,team:intent.requestedTeam,color:intent.requestedColor,sizes:intent.requestedSizes,pending:intent.productScopePending===true,canQuery:intent.shouldLoadProductContext===true,state:intent.productRequestState});
assert.equal(decision.productRequest?.relation,expected==='selection'?'multiple':expected,'actual semantic classifier must distinguish independent targets from alternatives');
if(expected==='multiple'){assert.equal(intent.productRequestState?.items.length,2);assert.equal(intent.shouldLoadProductContext,false)}
else assert.equal(intent.shouldLoadProductContext,true);
if(expected==='selection'){assert.equal(intent.productRequestState?.selectedIndex,1);assert.equal(intent.requestedTeam,'Barcelona');assert.equal(intent.requestedColor,'blue');assert.deepEqual(intent.requestedSizes,['M']);}
}
console.log('Real commerce semantic check passed (bounded text calls, no DB/audio/image); full page/reply review remains separate.');
}finally{if(process.env.PRODUCT_SCOPE_RUNTIME_REPORT)await writeFile(process.env.PRODUCT_SCOPE_RUNTIME_REPORT,JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
