import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeCharacterLanguage, SUPPORTED_CHARACTER_LANGUAGES } from '../shared/language-library.js';
import { applySessionLanguagePreference, upsertPersonaLanguageSetting } from '../server/chat-language-preference-service.js';
import { getChatImageStatusCopy } from '../server/chat-image-copy-service.js';
const generation = await readFile(new URL('../server/chat-image-generation-service.js', import.meta.url),'utf8');
const failure = await readFile(new URL('../server/chat-image-failure-reply-job-service.js', import.meta.url),'utf8');
const extract = (source, name) => { const start=source.indexOf(`export async function ${name}(`)>=0?source.indexOf(`export async function ${name}(`):source.indexOf(`async function ${name}(`); assert(start>=0); return source.slice(start,source.indexOf('\n}\n',start)+3).replace(/^export /,''); };
let checks=0;
for (const {code,label} of SUPPORTED_CHARACTER_LANGUAGES) {
 const writes=[],jobs=[],messages=[];
 const create = new Function('normalizeCharacterLanguage','getChatImageStatusCopy','createId','getNextMessageOrder','insertMessage','isMockChatImageRequest','MEMORY_JOB_TYPES','enqueueMemoryJob','getChatImageMessageById','CHAT_IMAGE_STATUSES',extract(generation,'createChatImagePlaceholder')+';return createChatImagePlaceholder;')(
  normalizeCharacterLanguage,getChatImageStatusCopy,()=> 'asset_fixture',async()=>10,async(_db,message)=>{messages.push(message);return {id:'image_fixture'};},()=>false,{GENERATE_CHAT_IMAGE:'generate_chat_image'},async(job)=>jobs.push(job),async()=>({id:'image_fixture'}),{QUEUED:'queued'});
 const db={execute:async(sql,values)=>{writes.push({sql,values});return [[]];}};
 await create(db,{session:{id:'session_fixture',internal_uid:'user_fixture',preferred_language:'Hungarian',replyLanguageCode:code},character:{id:'character_fixture',name:'Fixture'},userId:'user_fixture',userText:'image plus policy question',trigger:{productReferenceRequired:true,referenceProduct:{id:'product_fixture'},conditions:{wants_clothing:true}},afterDisplayOrder:10});
 assert.equal(messages[0].text,getChatImageStatusCopy({language:code,status:'queued'}));
 assert.equal(jobs.length,1);assert.equal(jobs[0].payload.replyLanguageCode,code);
 assert.deepEqual(jobs[0].payload.requiredProductReference,{id:'product_fixture'});assert.deepEqual(jobs[0].payload.imageConditions,{wants_clothing:true});
 assert.equal(writes.length,1,'metadata must not add session/preference writes');assert.match(writes[0].sql,/INSERT INTO chat_image_assets/);
 const row={id:'character_fixture',character_id:'character_fixture',session_id:'session_fixture',image_asset_id:'asset_fixture',image_status:'failed',image_reply_language_code:code,preferred_language:'Hungarian',profile_json:{defaultLanguageCode:'hu',language:'Hungarian'},persona_prompt:'Existing persona.',image_display_order:11};
 const load = new Function('getDbPool','normalizeCharacterLanguage','parseJsonValue','upsertPersonaLanguageSetting','FAILURE_REPLY_SOURCE_PREFIX',extract(failure,'loadFailureReplyContext')+';return loadFailureReplyContext;')(
  ()=>({execute:async(sql,args)=>{assert.match(sql,/image_job\.job_type = 'generate_chat_image'/);assert.match(sql,/JSON_EXTRACT\(image_job.payload_json, '\$\.assetId'\)/);assert.deepEqual(args,['chat-image-failure:','asset_fixture','image_fixture']);return [[row]];}}),normalizeCharacterLanguage,(v,f)=>typeof v==='object'?v:JSON.parse(v||JSON.stringify(f)),upsertPersonaLanguageSetting,'chat-image-failure:');
 const context=await load('asset_fixture','image_fixture');
 assert.equal(context.languageCode,code);assert.equal(context.preferredLanguage,label);assert.equal(JSON.parse(context.character.profile_json).languageCode,code);assert(context.character.persona_prompt.includes(`Use ${label}`));
 assert.equal(row.preferred_language,'Hungarian','job-scoped metadata never mutates persisted preference');
 row.image_reply_language_code='unsupported';const legacy=await load('asset_fixture','image_fixture');assert.equal(legacy.languageCode,'hu','invalid/missing old metadata preserves session fallback');
 checks+=13;
}
const changes=[];const db={execute:async(sql,args)=>{changes.push({sql,args});return [[]];}};
const character={id:'char',profile_json:{language:'Hungarian',defaultLanguageCode:'hu'}};
for(const scope of ['turn','session']){
 changes.length=0;const session={id:'session',preferred_language:'Hungarian'};
 const language=await applySessionLanguagePreference(db,{character,session,userText:'Reply in English and show a picture',jevDecision:{ok:true,languageDecision:{targetCode:'en',scope,confidence:.95}}});
 assert.equal(language.languageCode,'en');assert.equal(changes.length,scope==='turn'?0:1);
 assert.equal(session.preferred_language,scope==='turn'?'Hungarian':'English');checks+=3;
}
for(const name of ['guest-turn-service.js','guest-reply-service.js','chat-text-message-service.js','chat-voice-message-service.js']){
 const source=await readFile(new URL(`../server/${name}`,import.meta.url),'utf8');
 const call=/const (imageResult|imagePlaceholder) = await maybeCreate(?:Guest)?ChatImagePlaceholder\((?:db|getDbPool\(\)), \{/g;
 for(const match of source.matchAll(call)){
  const before=source.slice(0,match.index);const after=source.slice(match.index,source.indexOf('\n',source.indexOf('});',match.index))+1);
  assert(before.lastIndexOf('applySessionLanguagePreference')>before.lastIndexOf('const intentTurn = await prepareChatIntentTurn'),`${name}: existing JEV precedes language application and image placeholder`);
  assert.match(after,/replyLanguageCode:/);assert.match(after,/character: (languagePreference|imageLanguage)\.character/);checks+=3;
 }
}
assert.match(failure,/languageCode: context\.languageCode, languageLabel: context\.preferredLanguage/,'member failure TTS shares resolved job language');
console.log(`Image turn-language self-check passed (${checks} checks; 43 languages, current-turn scope, cached entry order, product/image metadata preserved; no DB/network/providers)`);

const jobSource = await readFile(new URL('../server/chat-image-job-service.js',import.meta.url),'utf8');
const helperStart = jobSource.indexOf('function imageJobLanguage(');
const helper = jobSource.slice(helperStart,jobSource.indexOf('\n}\n',helperStart)+3);
const jobLanguage = new Function('normalizeCharacterLanguage',helper+';return imageJobLanguage;')(normalizeCharacterLanguage);
for (const {code} of SUPPORTED_CHARACTER_LANGUAGES) {
 assert.equal(jobLanguage({payload:{replyLanguageCode:code}}),code);
 assert.equal(jobLanguage({payload_json:JSON.stringify({replyLanguageCode:code})}),code);
}
for(const bad of [null,{}, {payload:{replyLanguageCode:'invalid'}}, {payload_json:'not JSON'}]) assert.equal(jobLanguage(bad),'');
for(const status of ['GENERATING','READY','FAILED']) assert(jobSource.includes(`getChatImageStatusCopy({ language: imageJobLanguage(job), status: CHAT_IMAGE_STATUSES.${status} })`));
assert(jobSource.includes('persistChatImageFailure(db, { assetId: row.asset_id, messageId: row.message_id, error, job: row })'),'watchdog keeps original queued job language');
console.log('Generating/retry/ready/failure/watchdog status copy uses bounded job-scoped language; legacy and malformed metadata retain fallback');
