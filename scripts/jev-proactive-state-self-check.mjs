import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {assessJevProactiveState}=await import('../server/jev-proactive-state-service.js');
const {classifyProactiveContent}=await import('../server/proactive-content-policy-service.js');
const recentMessages=[{id:'fixture-user',senderType:'user',text:'My parcel is still missing.'}];
let calls=0;
for(const [choice,confidence] of [['unresolved_after_sales',.99],['neutral',.99],['unknown',.99],['shopping',.5]]){
 const result=await classifyProactiveContent({recentMessages,config:[],classifyJevState:async()=>{calls++;return {ok:true,decision:{state:choice,confidence,candidateKind:'care'}};},fetchImpl:async()=>{throw Error('No LLM on a valid JEV decision');}});
 assert.equal(result.state,confidence<.8?'unknown':choice);
}
assert.equal(calls,4);
let llmCalls=0;
const config={id:'fixture',baseUrl:'https://fixture.invalid/v1',apiMode:'chat_completions',apiKey:'fixture-placeholder',model:'fixture-model',timeoutMs:100};
const fetchImpl=async()=>{llmCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({state:'unresolved_after_sales',candidateKind:'care',confidence:.99,quality:{natural:false,grounded:false,novel:false}})}}]}),{status:200,headers:{'content-type':'application/json'}});};
await classifyProactiveContent({recentMessages,config,fetchImpl,classifyJevState:async()=>({ok:false,llmFallbackAllowed:false})});assert.equal(llmCalls,0);
const fallback=await classifyProactiveContent({recentMessages,config,fetchImpl,classifyJevState:async()=>({ok:false,llmFallbackAllowed:true,exhausted:true,attempts:2})});assert.equal(llmCalls,1);assert.equal(fallback.state,'unresolved_after_sales');
const facet=await assessJevProactiveState({context:[],evaluate:async options=>{assert.equal(options.questions.state.type,'choice');return {ok:true,answers:{state:{choice:'shopping',confidence:.99}},llmFallbackAllowed:false};}});assert.equal(facet.decision.state,'shopping');
let reviewed = false;
const candidate = await classifyProactiveContent({recentMessages,candidateText:'Just checking in.',trustedState:{state:'unresolved_after_sales'},config,
 classifyJevState:async()=>{throw Error('Candidate output review must not reclassify user state');},
 fetchImpl:async(_url, options)=>{const body=JSON.parse(options.body);assert(!body.messages[0].content.includes('Read user turns chronologically'));reviewed=true;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({state:'shopping',candidateKind:'care',confidence:.99,quality:{natural:true,grounded:true,novel:true},groundingEvidence:[]})}}]}),{status:200});}});
assert(reviewed);assert.equal(candidate.state,'unresolved_after_sales');
console.log('JEV proactive state: success/uncertainty never LLM; exhausted-only fallback; existing candidate review unchanged (isolated).');
