import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { classifyJevIntent, evaluateJevQuestions } = await import('../server/jev-intent-service.js');
const config = { enabled:true, apiKey:'self-check-only', baseUrl:'https://jev.fixture.invalid/v1', model:'fixture', timeoutMs:15 };
const questions = { action:{type:'choice',criteria:{none:'No action',order:'Existing order'}} };
const payload = (choice='order',confidence=.99)=>({answers:{action:{choice,confidence}}});
const response = value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const noLog = async()=>{};
let checks=0;
async function run(label, work){await work();checks++;console.log('PASS '+label);}
await run('retry transport once, return second valid decision',async()=>{
 let calls=0;const logs=[];const r=await evaluateJevQuestions({state:{message:'same user text'},questions,configOverride:config,forceRefresh:true,
  fetchImpl:async()=>++calls===1?new Response('unavailable',{status:503}):response(payload()),recordLog:async x=>logs.push(x.status)});
 assert.equal(calls,2);assert.equal(r.ok,true);assert.equal(r.attempts,2);assert.equal(r.llmFallbackAllowed,false);assert.deepEqual(logs,['error','success']);
});
await run('two protocol failures are exhausted and only then allow fallback',async()=>{
 let calls=0;const r=await evaluateJevQuestions({state:{message:'protocol'},questions,configOverride:config,forceRefresh:true,
  fetchImpl:async()=>{calls++;return response(payload('unknown'));},recordLog:noLog});
 assert.equal(calls,2);assert.equal(r.ok,false);assert.equal(r.fallbackReason,'invalid_response');assert.equal(r.attempts,2);assert.equal(r.exhausted,true);assert.equal(r.llmFallbackAllowed,true);
});
await run('valid low-confidence none is neither retry nor fallback',async()=>{
 let calls=0;const r=await evaluateJevQuestions({state:{message:'ambiguous'},questions,configOverride:config,forceRefresh:true,
  fetchImpl:async()=>{calls++;return response(payload('none',.11));},recordLog:noLog});
 assert.equal(calls,1);assert.equal(r.ok,true);assert.equal(r.answers.action.choice,'none');assert.equal(r.llmFallbackAllowed,false);
});
await run('primary unclear and low confidence remain valid JEV results',async()=>{
 let calls=0;const r=await classifyJevIntent({userText:'uncertain',configOverride:config,forceRefresh:true,fetchImpl:async()=>{calls++;return response({answers:{route:{choice:'unclear',confidence:.1}}});}});
 assert.equal(calls,1);assert.equal(r.ok,true);assert.equal(r.confident,false);assert.equal(r.primaryIntent,'unclear');assert.equal(r.llmFallbackAllowed,false);
});
await run('primary missing or invalid confidence is a retried protocol failure',async()=>{
 for(const answer of [{choice:'daily_chat'},{choice:'daily_chat',confidence:'0.9'},{choice:'invented',confidence:.9}]){
  let calls=0;const r=await classifyJevIntent({userText:'invalid primary '+JSON.stringify(answer),configOverride:config,forceRefresh:true,fetchImpl:async()=>{calls++;return response({answers:{route:answer}});}});
  assert.equal(calls,2);assert.equal(r.ok,false);assert.equal(r.fallbackReason,'invalid_response');assert.equal(r.llmFallbackAllowed,true);
 }
});
await run('each timeout attempt has independent deadline',async()=>{
 let calls=0;const r=await evaluateJevQuestions({state:{message:'timeout'},questions,configOverride:config,forceRefresh:true,recordLog:noLog,
  fetchImpl:async(_u,{signal})=>{calls++;return new Promise((_r,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('abort'),{name:'AbortError'})),{once:true});});}});
 assert.equal(calls,2);assert.equal(r.ok,false);assert.equal(r.fallbackReason,'timeout');assert.equal(r.llmFallbackAllowed,true);
});
await run('concurrent same request shares retry work and successful result cache',async()=>{
 let calls=0,release;const fetchImpl=async()=>{calls++;await new Promise(r=>release=r);return response(payload());};
 const opts={state:{message:'concurrent'},questions,configOverride:config,fetchImpl,recordLog:noLog};
 const first=evaluateJevQuestions(opts),second=evaluateJevQuestions(opts);await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);release();
 const [a,b]=await Promise.all([first,second]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(calls,1);
 a.answers.action.choice='none';b.answers.action.confidence=0;
 assert.equal(b.answers.action.choice,'order');assert.equal(a.answers.action.confidence,.99);
 const cached=await evaluateJevQuestions(opts);assert.equal(cached.cached,true);assert.equal(calls,1);assert.equal(cached.answers.action.choice,'order');assert.equal(cached.answers.action.confidence,.99);
});
await run('failure is not globally cached and later turn gets fresh attempts',async()=>{
 let calls=0;const opts={state:{message:'failed fresh turn'},questions,configOverride:config,recordLog:noLog,fetchImpl:async()=>{calls++;return new Response('',{status:502});}};
 await evaluateJevQuestions(opts);await evaluateJevQuestions(opts);assert.equal(calls,4);
});
await run('different questions, capabilities, transports and config do not cross caches',async()=>{
 let calls=0;const fetchImpl=async(_u,{body})=>{calls++;const req=JSON.parse(body),answers={};for(const key of Object.keys(req.questions))answers[key]={choice:'none',confidence:.9};return response({answers});};
 const opts={state:{message:'cache isolation'},questions,configOverride:config,fetchImpl,recordLog:noLog};
 await evaluateJevQuestions(opts);await evaluateJevQuestions({...opts,state:{...opts.state,capabilities:{canLookupOrder:true}}});
 await evaluateJevQuestions({...opts,questions:{another:questions.action}});await evaluateJevQuestions({...opts,configOverride:{...config,apiKey:'different-fixture-key'}});
 await evaluateJevQuestions({...opts,fetchImpl:async()=>{calls++;return response(payload());}});assert.equal(calls,5);
});
await run('local precondition failures never authorize LLM fallback',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('forbidden');};
 for(const opts of [{configOverride:{...config,apiKey:''},questions},{configOverride:config,questions:{}},{configOverride:config,questions,state:{message:'x'.repeat(160001)}}]){
  const r=await evaluateJevQuestions({state:{message:'invalid'},...opts,fetchImpl,recordLog:noLog});assert.equal(r.ok,false);assert.equal(r.attempts,0);assert.equal(r.llmFallbackAllowed,false);
 }assert.equal(calls,0);
});
await run('full encoded request byte/question limits reject locally without fallback',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('forbidden');};
 for(const opts of [
  {state:{message:'界'.repeat(22000)},questions},
  {state:{message:'ordinary'},questions:Object.fromEntries(Array.from({length:33},(_,i)=>['q'+i,questions.action]))},
  {state:{message:'ordinary'},questions,configOverride:{...config,model:'x'.repeat(65536)}},
 ]){
  const r=await evaluateJevQuestions({configOverride:config,...opts,fetchImpl,recordLog:noLog});
  assert.equal(r.ok,false);assert.equal(r.fallbackReason,'invalid_input');assert.equal(r.attempts,0);assert.equal(r.llmFallbackAllowed,false);
 }assert.equal(calls,0);
 const cyclic={};cyclic.self=cyclic;
 const r=await evaluateJevQuestions({state:cyclic,questions,configOverride:config,fetchImpl,recordLog:noLog});assert.equal(r.attempts,0);assert.equal(r.llmFallbackAllowed,false);
});
await run('logging errors never repeat successful provider work',async()=>{
 let calls=0;const r=await evaluateJevQuestions({state:{message:'log failure'},questions,configOverride:config,forceRefresh:true,
  fetchImpl:async()=>{calls++;return response(payload());},recordLog:async()=>{throw Error('log unavailable');}});
 assert.equal(calls,1);assert.equal(r.ok,true);
});
await run('all domain fields validated, no silent missing choice or nonfinite score',async()=>{
 const definitions={route:questions.action,flag:{type:'noul'},quality:{type:'score'}};
 const valid={answers:{route:{choice:'none',confidence:.01},flag:{noul:.1},quality:{score:2}}};
 const r=await evaluateJevQuestions({state:{message:'domain fields'},questions:definitions,configOverride:config,forceRefresh:true,recordLog:noLog,fetchImpl:async()=>response(valid)});assert.equal(r.ok,true);
 for(const answers of [{...valid.answers,flag:{noul:'0.1'}},{...valid.answers,quality:{score:null}},{route:valid.answers.route}]){
  const r=await evaluateJevQuestions({state:{message:'bad domain fields'},questions:definitions,configOverride:config,forceRefresh:true,recordLog:noLog,fetchImpl:async()=>response({answers})});assert.equal(r.ok,false);assert.equal(r.attempts,2);
 }
});
console.log(`JEV retry/domain contract self-check passed: ${checks} cases; mock transport only, no DB/network/model calls.`);
