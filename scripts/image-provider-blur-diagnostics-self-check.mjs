import assert from 'node:assert/strict';
Object.assign(process.env, { AIOVE_PROVIDER_LOG_WRITE_ENABLED: 'false', IMAGE_GENERATION_PROVIDER: 'openai',
 IMAGE_GENERATION_API_KEY: 'isolated-image-diagnostic', IMAGE_GENERATION_BASE_URL: 'https://api.venice.ai/api/v1',
 IMAGE_GENERATION_MODEL: 'seedream-v5-lite', IMAGE_GENERATION_EDIT_MODEL: 'seedream-v5-lite-edit' });
const { requestGeneratedImage } = await import('../server/image-generation-provider-service.js');
const { buildProviderCallLogEvent } = await import('../server/ai-reply-log-service.js');
let mode='blur', calls=0;
const originalFetch=globalThis.fetch;
const referenceImages=[{buffer:Buffer.from('isolated-reference'),contentType:'image/png'}];
// Construct an unmistakably fake runtime marker without a credential-shaped literal in source.
const secret=['sk','isolated-value-must-not-be-recorded'].join('-');
try {
 globalThis.fetch=async (_url,options)=>{
  calls++; const body=JSON.parse(options.body); assert.equal(body.model,'seedream-v5-lite-edit');
  assert.equal(body.safe_mode,undefined,'default safe mode must not be disabled or changed');
  if(mode==='network')throw Error('isolated network failure');
  const headers={'content-type':mode==='422'?'application/json':'image/png','x-venice-is-blurred':mode==='blur'?' TrUe ':'false',
   'x-venice-is-content-violation':mode==='blur'?'true':'false','x-request-id':'req_fixture-123',
   authorization:secret,'x-balance':secret,'x-arbitrary':secret};
  return mode==='422'?new Response(JSON.stringify({error:{message:'isolated invalid input'}}),{status:422,headers})
   :new Response(Buffer.from('isolated-image'),{status:200,headers});
 };
 let blocked;try{await requestGeneratedImage('portrait',{referenceImages});}catch(e){blocked=e;}
 assert.equal(blocked?.code,'IMAGE_PROVIDER_BLURRED');assert.equal(blocked.statusCode,502);assert.equal(blocked.retryable,false);
 assert.doesNotMatch(blocked.message,/隐私/,'do not invent the cause behind the supplier flag');
 assert.deepEqual(blocked.imageProviderDiagnostic,{model:'seedream-v5-lite-edit',contentType:'image/png',blurred:true,violation:true,requestId:'req_fixture-123'});
 const event=buildProviderCallLogEvent({provider:'image-generation',model:'seedream-v5-lite-edit',status:'error',error:blocked});
 assert.match(event.errorMessage,/image_blurred/);assert.match(event.errorMessage,/req_fixture-123/);assert(!JSON.stringify(event).includes(secret));
 const poisoned={...blocked,code:'IMAGE_PROVIDER_BLURRED',statusCode:502,imageProviderDiagnostic:{...blocked.imageProviderDiagnostic,
  requestId:secret,authorization:secret,balance:secret,headers:{'x-arbitrary':secret}}};
 assert(!JSON.stringify(buildProviderCallLogEvent({status:'error',error:poisoned})).includes(secret),'diagnostic logging must recheck the whitelist and reject secret-like IDs');
 mode='normal';assert.equal((await requestGeneratedImage('portrait',{referenceImages})).buffer.toString(),'isolated-image');
 mode='422';await assert.rejects(requestGeneratedImage('portrait',{referenceImages}),e=>e.statusCode===422&&e.retryable!==false&&e.code!=='IMAGE_PROVIDER_BLURRED');
 mode='network';await assert.rejects(requestGeneratedImage('portrait',{referenceImages}),e=>e.statusCode===502&&e.retryable!==false&&e.code!=='IMAGE_PROVIDER_BLURRED');
 assert.equal(calls,4,'provider adapter must not introduce an extra retry');
 console.log('supplier image blur typed error/whitelist and unchanged normal/422/network contracts passed (fixture responses only, no network or DB)');
}finally{globalThis.fetch=originalFetch;}
