import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildChatImagePrompt } from '../server/chat-image-provider-service.js';
const source=(await readFile(new URL('../server/chat-image-job-service.js',import.meta.url),'utf8'))
 .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm,'').replace(/^export /gm,'');
const context={character:{id:'fixture',name:'Fixture'},userText:'Show your red football top',
 recentMessages:[],variation:{code:'1-1-1-1-1-1'},imageRequestConstraints:{wantsWear:true}};
const blocked=Object.assign(Error('supplier marked the result blurred'),{code:'IMAGE_PROVIDER_BLURRED',statusCode:502,retryable:false});
function fixture({fail=blocked,status='generating'}={}){
 const events=[],ledger={version:1,state:'sent',messageId:'prior-terminal-message'};
 const asset={status,context:{staleContext:'do not carry stale facts',_terminalReply:ledger},fullPrompt:''};
 const deps={getDbPool:()=>({execute:async(sql,args)=>{
  assert.match(sql,/UPDATE chat_image_assets/);assert.match(sql,/JSON_MERGE_PATCH/,'new prompt context must preserve the terminal ledger independently');
  if(asset.status!=='generating')return[{affectedRows:0}];
  events.push('prompt-record');asset.context={...JSON.parse(args[2]),_terminalReply:asset.context._terminalReply};asset.fullPrompt=args[3];return[{affectedRows:1}];
 }}),buildChatImageGenerationContext:async()=>context,collectChatImageReferenceImages:async()=>[],isRealChatImageProviderConfigured:()=>true,
 buildChatImagePrompt,buildChatImagePromptContextPayload:c=>({userText:c.userText,variation:c.variation}),
 generateRealChatImage:async c=>{events.push('provider');if(fail)throw fail;return{buffer:Buffer.from('fixture'),contentType:'image/png',filename:'fixture.png',prompt:buildChatImagePrompt(c)};},
 saveGeneratedChatImageAsset:async()=>{events.push('save');return{storagePath:'fixture.webp'};}};
 const api=new Function(...Object.keys(deps),`${source}\nreturn {generateAndSaveChatImage,shouldKeepChatImageGeneratingForRetry};`)(...Object.values(deps));
 return{...api,events,asset,ledger};
}
let test=fixture();await assert.rejects(test.generateAndSaveChatImage({assetId:'asset',messageId:'message'}),e=>e===blocked);
assert.equal(test.asset.fullPrompt,buildChatImagePrompt(context),'a provider failure must still retain the exact prompt BEFORE the paid request');
assert.deepEqual(test.events,['prompt-record','provider']);assert.equal(test.asset.context._terminalReply,test.ledger);
assert(!Object.hasOwn(test.asset.context,'staleContext'),'replace old prompt data while retaining only the terminal ledger namespace');
test=fixture({fail:null});await test.generateAndSaveChatImage({assetId:'asset',messageId:'message'});
assert.deepEqual(test.events,['prompt-record','provider','save','prompt-record'],'retain the existing successful metadata write after file save');
assert.equal(test.asset.fullPrompt,buildChatImagePrompt(context));assert.equal(test.asset.context._terminalReply,test.ledger);
for(const status of ['ready','failed']){test=fixture({status});await assert.rejects(test.generateAndSaveChatImage({assetId:'asset',messageId:'message'}),e=>e.retryable===false);assert(!test.events.includes('provider'),'a changed terminal state must prevent a fresh supplier request');}
// Exercise the real job entry catch, not a copied retry condition. Its external
// SQL/locks and provider are replaced before evaluation; no real DB or workers.
const entrySource=source.slice(0,source.indexOf('async function generateAndSaveChatImage'));
for(const [error,retryCount,expected]of [[blocked,0,'failed'],[Object.assign(Error('422'),{statusCode:422}),0,'retry'],
 [Error('network'),0,'retry'],[Error('network'),1,'failed']]){
 const events=[];const deps={CHAT_IMAGE_STATUSES:{READY:'ready',FAILED:'failed'},acquireChatImageJobLock:async()=>async()=>{},
 reconcileReadyImageJob:async()=>({}),assertChatImageJobCanContinue:async()=>{},assertGuestImageGenerationAllowed:async()=>{},recoverStagedChatImage:async()=>null,
 markChatImageGenerating:async()=>{},generateAndSaveChatImage:async()=>{events.push('provider');throw error;},assertImageJobLease:async()=>{},
 shouldKeepChatImageGeneratingForRetry:test.shouldKeepChatImageGeneratingForRetry,
 markChatImageRetrying:async()=>events.push('retry'),markChatImageFailed:async()=>events.push('failed')};
 const run=new Function(...Object.keys(deps),`${entrySource}\nreturn generateChatImageFromJob;`)(...Object.values(deps));
 await assert.rejects(run({id:'job',retryCount,maxRetries:1,payload:{assetId:'asset',messageId:'message'}}),e=>e===error);
 assert.deepEqual(events,['provider',expected]);
}
console.log('image provider-failure prompt-before-request, terminal-ledger/state and real finite job retry checks passed (in-memory boundaries, no DB/models/files generated)');
