import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const{resolvePrimaryChatIntent}=await import('../server/resolve-primary-chat-intent-service.js');
const{buildQuestions}=await import('../server/jev-intent-service.js');
const{createChatIntentTurn}=await import('../server/chat-intent-turn-service.js');
const unavailable={ok:false,source:'jev_unavailable',fallbackReason:'timeout',attempts:2,exhausted:true,llmFallbackAllowed:true};
const fullAnswers=(route='web_search')=>({answers:Object.fromEntries(Object.entries(buildQuestions()).map(([key,q])=>[key,q.type==='choice'
 ? {choice:key==='route'?route:key==='reply_language'?'hu':key==='reply_language_scope'?'turn':key==='web_search'?'yes':['order_request_kind','order_evidence_source'].includes(key)?'none':'no',confidence:.99}
 : {noul:key==='web_search'?.99:.01}]))});
let checks=0;
for(const primary of [
 {ok:true,primaryIntent:'unclear',confidence:.1,confident:false},
 {ok:true,primaryIntent:'daily_chat',confidence:.99,confident:true},
 {...unavailable,attempts:1,exhausted:false,llmFallbackAllowed:false},
 {...unavailable,attempts:0,exhausted:false,llmFallbackAllowed:false,fallbackReason:'missing_api_key'},
]){let calls=0;const r=await resolvePrimaryChatIntent({userText:'ordinary',classifyJev:async()=>primary,requestJson:async()=>{calls++;throw Error('forbidden');}});assert.equal(r,primary);assert.equal(calls,0);checks++;}
let calls=0;let received;
const r=await resolvePrimaryChatIntent({userText:'Please answer in Hungarian: latest public result?',capabilities:{canSearchWeb:true},
 classifyJev:async()=>unavailable,requestJson:async(messages,opts)=>{calls++;received=opts;assert.equal(opts.validateParsed(fullAnswers()).valid,true);return fullAnswers();}});
assert.equal(calls,1);assert.equal(received.sourceRef,'jev-primary-fallback');assert.equal(received.timeoutMs,10000);assert.equal(received.perProviderTimeout,true);
assert.equal(r.ok,true);assert.equal(r.source,'llm_fallback');assert.equal(r.model,null);assert.equal(r.routingSource,'llm_fallback');assert.equal(r.jevFailure.exhausted,true);assert.equal(r.jevFailure.attempts,2);
assert.equal(r.primaryIntent,'web_search');assert.equal(r.webSearchIntent,true);assert.equal(r.languageDecision.targetCode,'hu');assert.equal(r.languageDecision.scope,'turn');checks++;
for(const mutated of [
 x=>delete x.answers.reply_language,
 x=>delete x.answers.order_request_kind,
 x=>x.answers.order_evidence_source.choice='prior0',
 x=>x.answers.route.choice='invented',
 x=>x.answers.web_search.choice='invalid',
 x=>x.answers.route.confidence=NaN,
]){const bad=fullAnswers();mutated(bad);const out=await resolvePrimaryChatIntent({userText:'bad fallback',classifyJev:async()=>unavailable,
 requestJson:async(_messages,opts)=>{assert.equal(opts.validateParsed(bad).valid,false);return bad;}});assert.equal(out.ok,false);assert.equal(out.primaryFallbackStatus,'invalid_output');checks++;}
const failed=await resolvePrimaryChatIntent({userText:'failed fallback',classifyJev:async()=>unavailable,requestJson:async()=>{throw Error('offline');}});
assert.equal(failed.ok,false);assert.equal(failed.primaryFallbackStatus,'unavailable');checks++;
for (const [label,userText,history,kind,evidence,expected] of [
 ['ordinary shipping','How long does shipping take?',[], 'none','none','none'],
 ['existing order','Where is my order?',[], 'existing','current','lookup'],
 ['mixed explicit','How long is shipping and where is my order?',[], 'existing','current','lookup'],
 ['same repeated user message','Where is my order?',[{role:'user',kind:'text',text:'Where is my order?'}], 'existing','prior0','lookup'],
 ['different prior user message','Where is my order?',[{role:'user',kind:'text',text:'My order shipped.'}], 'existing','prior0','none'],
 ['user followup','Where is it now?',[{role:'user',kind:'text',text:'My order has not arrived.'}], 'continuation','prior0','lookup'],
 ['assistant suggestion only','Where is it now?',[{role:'assistant',kind:'text',text:'Do you want to check an order?'}], 'continuation','none','none'],
]) {
 const ctx={recentConversation:history};
 const out=await resolvePrimaryChatIntent({userText,conversationContext:ctx,capabilities:{canLookupOrder:true},classifyJev:async()=>unavailable,
  requestJson:async(messages,opts)=>{const q=JSON.parse(messages[1].content).questions;const a=fullAnswers('daily_chat');
   a.answers.order_request_kind={choice:kind,confidence:.1};a.answers.order_evidence_source={choice:evidence,confidence:.1};
   assert.equal(Object.hasOwn(q.order_evidence_source.criteria,evidence),true,label);assert.equal(opts.validateParsed(a).valid,true,label);return a;}});
 assert.equal(out.ok,true,label);assert.equal(out.orderIntent,expected,label);checks++;
}
let primaryCalls=0,modelCalls=0;const classify=options=>resolvePrimaryChatIntent({...options,classifyJev:async()=>{primaryCalls++;return unavailable;},
 requestJson:async()=>{modelCalls++;return fullAnswers('daily_chat');}});
const turn=createChatIntentTurn({classify});const options={userText:'same turn',capabilities:{canSearchWeb:true}};
const [first,second]=await Promise.all([turn.classify(options),turn.classify({...options})]);assert.equal(primaryCalls,1);assert.equal(modelCalls,1);assert.equal(first,second);assert.equal(Object.isFrozen(first),true);checks++;
console.log(`Primary JEV fallback checks passed: ${checks} cases, real turn memo/normalizer and mocked upstream; no external calls or DB writes.`);
