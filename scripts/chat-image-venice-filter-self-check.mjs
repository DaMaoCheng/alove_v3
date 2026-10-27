import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
if(!process.env.SELF_CHECK_IMAGE_FILTER_CASE){
  for(const mode of ['false','default','true','off','typo','other-provider']){
    const result=spawnSync(process.execPath,[process.argv[1]],{encoding:'utf8',env:{...process.env,SELF_CHECK_IMAGE_FILTER_CASE:mode}});
    assert.equal(result.status,0,`${mode}: ${result.stdout}${result.stderr}`);
  }
  console.log('Chat Venice filter: explicit opt-out, default/invalid safe, single/multi edit, generation moderation, unchanged other callers/providers, blur still blocked; no DB/network.');
  process.exit(0);
}
const mode=process.env.SELF_CHECK_IMAGE_FILTER_CASE;
Object.assign(process.env,{AIOVE_PROVIDER_LOG_WRITE_ENABLED:'false',CHAT_IMAGE_VENICE_SAFE_MODE:mode==='default'?'':mode,
 IMAGE_GENERATION_PROVIDER:'openai',IMAGE_GENERATION_API_KEY:'isolated-filter-key',
 IMAGE_GENERATION_BASE_URL:mode==='other-provider'?'https://other-provider.invalid/v1':'https://api.venice.ai/api/v1',
 IMAGE_GENERATION_MODEL:'seedream-v5-lite',IMAGE_GENERATION_EDIT_MODEL:'seedream-v5-lite-edit'});
const {SERVER_CONFIG}=await import('../server/config.js');
const {requestGeneratedImage}=await import('../server/image-generation-provider-service.js');
const {generateRealChatImage}=await import('../server/chat-image-provider-service.js');
const expected=!['false','off'].includes(mode),venice=mode!=='other-provider';
assert.equal(SERVER_CONFIG.imageGeneration.chatVeniceSafeMode,expected);
const originalFetch=globalThis.fetch,calls=[],references=[{buffer:Buffer.from('fixture-reference'),contentType:'image/png'}];let blur=false;
try{
 globalThis.fetch=async (url,options)=>{const form=options.body instanceof FormData;const body=form?Object.fromEntries(options.body):JSON.parse(options.body);calls.push({url:String(url),body});
  if(venice&&String(url).includes('/image/'))return new Response(Buffer.from('fixture-image'),{headers:{'content-type':'image/png','x-venice-is-blurred':String(blur)}});
  return new Response(JSON.stringify({data:[{b64_json:Buffer.from('fixture-image').toString('base64')}]}),{headers:{'content-type':'application/json','x-venice-is-blurred':String(blur)}});
 };
 await generateRealChatImage({character:{id:'fixture',name:'Fixture adult character'},userText:'A normal photo',referenceImages:references});
 assert.equal(calls.at(-1).body.safe_mode,venice?expected:undefined,'chat config must reach actual single-edit request only for Venice');
 await generateRealChatImage({character:{id:'fixture'},referenceImages:[...references,...references]});
 assert.equal(calls.at(-1).body.safe_mode,venice?expected:undefined);
 if(venice)assert.equal(calls.at(-1).body.modelId,'seedream-v5-lite-edit');
 await requestGeneratedImage('unrelated avatar caller',{referenceImages:references});
 assert.equal(calls.at(-1).body.safe_mode,undefined,'existing non-chat callers retain provider default');
 await requestGeneratedImage('no references',{veniceSafeMode:false});
 assert.equal(calls.at(-1).body.moderation,venice?'low':undefined);assert.equal(calls.at(-1).body.safe_mode,undefined);
 await requestGeneratedImage('no references',{veniceSafeMode:true});assert.equal(calls.at(-1).body.moderation,venice?'auto':undefined);
 await requestGeneratedImage('old generic generation caller');assert.equal(calls.at(-1).body.moderation,undefined);
 if(venice){blur=true;const n=calls.length;await assert.rejects(requestGeneratedImage('explicit supplier blur',{referenceImages:references,veniceSafeMode:false}),e=>e.code==='IMAGE_PROVIDER_BLURRED'&&e.retryable===false);assert.equal(calls.length,n+1,'do not retry or admit a supplier-flagged image');await assert.rejects(requestGeneratedImage('flagged text generation',{veniceSafeMode:false}),e=>e.code==='IMAGE_PROVIDER_BLURRED'&&e.retryable===false);assert.equal(calls.length,n+2);}
}finally{globalThis.fetch=originalFetch;}
