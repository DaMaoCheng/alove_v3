import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {requestOpenAiText}=await import('../server/ai-reply-provider-service.js');
const {buildProviderAttemptLogEvent}=await import('../server/ai-reply-log-service.js');
const cfg={id:'venice',apiKey:'fixture-secret',model:'fixture',apiMode:'chat_completions',baseUrl:'https://fixture.example.test'};
const cases=[
 [{error:'The model is currently overloaded. Please try again later.'},{'retry-after':'30'},'model_overloaded'],
 [{error:{code:'RATE_LIMIT_EXCEEDED',message:'Rate limit exceeded'}},{'x-ratelimit-remaining-requests':'0'},'requests_exhausted'],
 [{error:'Rate limit exceeded'},{'x-ratelimit-remaining-tokens':'0'},'tokens_exhausted'],
 [{customMessage:'Too many failed attempts (> 50) resulting in a non-success status code.'},{},'failed_requests'],
 [{error:{code:'UNSUPPORTED_FEATURE_REQUESTS'}},{},'unsupported_features'],
 [{error:'Private user text, password=never-persist'},{'retry-after':'Infinity','x-ratelimit-remaining-requests':'private'},'unknown_429'],
];
let checks=0;
for(const [body,headers,kind] of cases){
 let captured;
 await assert.rejects(()=>requestOpenAiText({messages:[{role:'user',content:'Fixture'}]},{modelConfig:cfg,timeoutMs:100,
  recordProviderCallFn:async event=>{captured=event.error},fetchImpl:async()=>new Response(JSON.stringify(body),{status:429,headers})}),e=>e.statusCode===429&&e.retryable===true);
 assert.equal(captured.providerRateLimit?.kind,kind);checks++;
 const attempt=buildProviderAttemptLogEvent({type:'attempt_failure',modelConfig:cfg,error:captured,nextProvider:'backup',attempt:1});
 assert(attempt.errorMessage.includes('cause='+kind));assert(!attempt.errorMessage.includes('Private')&&!attempt.errorMessage.includes('never-persist')&&!attempt.errorMessage.includes('fixture-secret'));checks++;
}
const protocolAttempt = buildProviderAttemptLogEvent({ type:'attempt_failure',modelConfig:cfg,
 error:{code:'AI_REPLY_PROTOCOL_ERROR',message:'PRIVATE_BODY_WITH_CREDENTIAL'},nextProvider:'backup',attempt:1 });
assert.equal(protocolAttempt.reply.degradationReason,'protocol');
assert(protocolAttempt.errorMessage.includes('reason=protocol') && protocolAttempt.errorMessage.includes('switch_to=backup'));
assert(!protocolAttempt.errorMessage.includes('PRIVATE_BODY') && !protocolAttempt.errorMessage.includes('fixture-secret')); checks++;
console.log(`provider rate-limit diagnostic self-check passed (${checks} cases; actual HTTP error path and safe log formatter, no network/DB)`);
