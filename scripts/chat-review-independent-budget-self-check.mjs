import assert from 'node:assert/strict';
Object.assign(process.env,{AIOVE_PROVIDER_LOG_WRITE_ENABLED:'false',VENICE_API_KEY:'fixture',OPENAI_API_KEY:'fixture',
 VENICE_BASE_URL:'https://primary.example.test',OPENAI_BASE_URL:'https://backup.example.test',OPENAI_API_MODE:'responses',OPENAI_FALLBACK_MODEL:'third-fixture'});
const {requestAiJsonWithProviderFallback}=await import('../server/ai-json-provider-service.js');
const {recoverReviewedLanguageReply}=await import('../server/chat-reply-language-recovery-service.js');
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++};
const pending=signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('fixture abort')),{once:true}));
let calls=[];
const started=Date.now();
const result=await requestAiJsonWithProviderFallback([{role:'user',content:'Fixture'}],{timeoutMs:70,perProviderTimeout:true,
 recordProviderCallFn:async()=>{},fetchImpl:async (url,{signal})=>{
  check(url.includes('.example.test'),'no external provider may be reached');calls.push(Date.now());
  if(calls.length<3)return pending(signal);
  return new Response(JSON.stringify({output_text:'{"allowed":false}'}));
 }});
check(result.allowed===false&&calls.length===3,'each timed-out provider must leave a complete attempt for the third');
check(calls[2]-calls[1]>=60&&calls[1]-calls[0]>=60,'backup receives full independent budget instead of a divided reserve');
check(Date.now()-started>=130&&Date.now()-started<500,'only the finite three attempts execute');
let now=0,attempts=0;
await requestAiJsonWithProviderFallback([{role:'user',content:'Fixture'}],{timeoutMs:70,perProviderTimeout:true,nowFn:()=>now,recordProviderCallFn:async()=>{},
 fetchImpl:async()=>{attempts++;if(attempts===1){now+=500;return new Response('{"error":"overloaded"}',{status:429})}return new Response('{"output_text":"{\\"allowed\\":true}"}')}});
check(attempts===2,'a 429 and expired former total deadline cannot consume the backup budget');
for(const timeoutMs of [0,-1,NaN,Infinity]){let sent=0;await assert.rejects(()=>requestAiJsonWithProviderFallback([],{timeoutMs,perProviderTimeout:true,fetchImpl:async()=>{sent++;throw Error('unexpected')}}));check(sent===0,'invalid caller budget cannot start any attempt')}
let slowCalls=0;const allStart=Date.now();
await assert.rejects(()=>requestAiJsonWithProviderFallback([{role:'user',content:'Fixture'}],{timeoutMs:35,perProviderTimeout:true,
 recordProviderCallFn:async()=>{},fetchImpl:async(_url,{signal})=>{slowCalls++;return pending(signal)}}),e=>e.code==='AI_REPLY_TIMEOUT');
check(slowCalls===3&&Date.now()-allStart>=90&&Date.now()-allStart<400,'all providers are attempted once and eventually time out without a repeat loop');
let rejectedCalls=0;
const denied=await requestAiJsonWithProviderFallback([{role:'user',content:'Fixture'}],{timeoutMs:70,perProviderTimeout:true,
 recordProviderCallFn:async()=>{},fetchImpl:async()=>{rejectedCalls++;return new Response(JSON.stringify({output_text:JSON.stringify({allowed:false})}))}});
check(!denied.allowed&&rejectedCalls===1,'a valid rejected verdict stops the independent provider chain immediately');
let malformedCalls=0;
await assert.rejects(()=>requestAiJsonWithProviderFallback([{role:'user',content:'Fixture'}],{timeoutMs:70,perProviderTimeout:true,
 recordProviderCallFn:async()=>{},fetchImpl:async()=>{malformedCalls++;return new Response('{"output_text":"{broken}"}')}}),SyntaxError);
check(malformedCalls===1,'review parse failures retain terminal behavior rather than seeking another approval');
for(const perProviderTimeout of [null,1,'true']){let sent=0;await assert.rejects(()=>requestAiJsonWithProviderFallback([],{perProviderTimeout,fetchImpl:async()=>{sent++;throw Error('unexpected')}}));check(!sent,'an invalid policy flag cannot start a provider request')}
const originalNow=Date.now;let clock=1000,repairBudget,reviewOptions;
try{
 Date.now=()=>clock;
 const r=await recoverReviewedLanguageReply({replyResult:{text:'Before.'},repairLanguageReply:async input=>{repairBudget=input.timeoutMs;clock+=14000;return{text:'After.'}},
  reviewCandidate:async(text,options)=>{reviewOptions=options;clock+=25000;return text},recordReview:async()=>{}});
 check(r.recovered&&r.reply.text==='After.','long correction and full review are not rejected by the former shared twelve-second deadline');
 check(repairBudget===15000&&reviewOptions.reviewTimeoutMs===20000&&!Object.hasOwn(reviewOptions,'languageRecoveryDeadline'),'repair and full primary review receive separate finite budgets');
}finally{Date.now=originalNow}
const verdict={allowed:true,confidence:.99,boundarySupported:true,factualSupported:true,languageQualitySupported:true};
const audits=[],reviews=[];let repairs=0;
const reply=await enforceReplyBoundary({replyResult:{text:'Before.',speechText:'Before.',sourceType:'ai',sourceRef:'fixture'},
 searchIntent:{commerceRoute:'chat',replyBoundary:{salesAllowed:false,contactAllowed:false}},character:{category_id:'mascot'},languageQualityRequired:true,
 independentLanguageQualityRequired:true,language:'en',userText:'Just listen.',
 assess:async input=>{reviews.push(input.timeoutMs);return verdict},
 assessLanguageQuality:async input=>{audits.push(input.timeoutMs);return audits.length===1?{reviewStatus:'valid',confidence:.99,languageQualitySupported:false,languageIssues:[{type:'grammar',field:'both',severity:'major',span:'Before'}]}:{reviewStatus:'valid',confidence:.99,languageQualitySupported:true,languageIssues:[]}},
 regenerateReply:async()=>{repairs++;return{text:'After.',speechText:'After.',sourceType:'ai',sourceRef:'fixture'}},recordReview:async()=>{}});
check(reply.text==='After.'&&repairs===1,'one corrected text is approved only by complete original re-review');
check(reviews.length===2&&reviews.every(x=>x===20000)&&audits.length===2&&audits.every(x=>x===20000),'initial and corrected primary/language stages each keep a complete twenty-second budget');
console.log(`independent review budget self-check passed (${checks} checks; actual provider aborts and review/recovery seams, no external network/DB)`);
