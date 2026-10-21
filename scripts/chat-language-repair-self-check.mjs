import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
globalThis.fetch=async()=>{throw new Error('Network forbidden');};
const text='Sajnálom, ez fájros.';
const candidate={text,displayText:text,speechText:text,sourceType:'ai',sourceRef:'venice-chat-completions',voiceMeta:{voiceId:'preserved'}};
const bad={allowed:false,confidence:.99,languageQualitySupported:false,languageQualityConfidence:.99,languageIssues:[{type:'spelling',field:'both',severity:'major',span:'fájros'}]};
let repairs=0,reviews=0;
const out=await enforceReplyBoundary({replyResult:candidate,language:'hu',factualContext:{required:false,status:'not_required',asOfUtc:'2026-10-12T00:00:00Z'},languageQualityRequired:true,recordReview:async()=>{},
 independentLanguageQualityRequired:true, assessLanguageQuality:async()=>reviews===1?{...bad,reviewStatus:'valid'}:{reviewStatus:'valid',confidence:.99,languageQualitySupported:true,languageIssues:[]},
 regenerateReply:async()=>{repairs++;return{...candidate,text:'Sajnálom, ez fájdalmas.',displayText:'Sajnálom, ez fájdalmas.',speechText:'Sajnálom, ez fájdalmas.'};},
 assess:async()=>{reviews++;return{allowed:true,boundarySupported:true,factualSupported:true,confidence:.99};}});
assert.equal(out.text,'Sajnálom, ez fájdalmas.','A valid language-only rejection should be repaired then re-reviewed');
assert.equal(repairs,1);assert.equal(reviews,2);assert.equal(out.voiceMeta.voiceId,'preserved');
console.log('language repair regression passed');
const {normalizeLanguageAssessment}=await import('../server/chat-language-quality-service.js');
const {buildReplyReviewLogEvent}=await import('../server/ai-reply-log-service.js');
let checks=4;
const acceptedVerdict={allowed:true,confidence:.99,languageQualitySupported:true,boundarySupported:true,factualSupported:true};
const qualityPass={reviewStatus:'valid',confidence:.99,languageQualitySupported:true,languageIssues:[]};
const qualityFail={...bad,reviewStatus:'valid'};
async function run({primary=acceptedVerdict,audit=qualityFail,options={},secondPrimary=acceptedVerdict,secondAudit=qualityPass,repair=null}={}){
 let repairCalls=0,reviewCalls=0,auditCalls=0;const events=[];
 const output=await enforceReplyBoundary({replyResult:candidate,language:'hu',factualContext:{required:false,status:'not_required',asOfUtc:'2026-10-12T00:00:00Z'},languageQualityRequired:true,independentLanguageQualityRequired:true,
  recordReview:async event=>events.push(event),
  assess:async()=>++reviewCalls===1?primary:secondPrimary,
  assessLanguageQuality:async()=>++auditCalls===1?audit:secondAudit,
  regenerateReply:async()=>{repairCalls++;return repair;},...options});
 return {output,repairCalls,reviewCalls,auditCalls,events};
}
const fixed={...candidate,text:'Sajnálom, ez fájdalmas.',displayText:'Sajnálom, ez fájdalmas.',speechText:'Sajnálom, ez fájdalmas.'};
for(const [name,scenario] of Object.entries({
 'joint boundary refusal':{primary:{...acceptedVerdict,allowed:false}},
 'joint mixed boundary language refusal':{primary:{...bad,boundarySupported:false,factualSupported:true}},
 'factual rejection':{primary:{...acceptedVerdict,allowed:false,factualSupported:false}},
})){
 const r=await run({...scenario,repair:fixed});assert.equal(r.repairCalls,0,name+' remains a terminal business refusal');checks++;
}
for(const [name,scenario] of Object.entries({
 'missing whole boundary approval':{primary:{...bad,factualSupported:true}},
 'unverifiable quality':{audit:{...qualityFail,languageIssues:[{type:'unverifiable',field:'both',span:''}]}},
 'weak quality confidence':{audit:{...qualityFail,confidence:.2}},
 'independent timeout':{audit:{reviewStatus:'timeout'}},
 'independent missing fields':{audit:{reviewStatus:'missing_fields'}},
 'joint invalid JSON':{primary:{reviewStatus:'invalid_json'}},
 'sales boundary':{options:{searchIntent:{replyBoundary:{salesAllowed:false}},character:{category_id:'mascot'}}},
 'current image':{options:{chatImageContext:{imageStatus:{kind:'generated',status:'failed',currentTurn:true}}}},
})){
 const r=await run({...scenario,repair:fixed});assert.equal(r.repairCalls,1,name+' can regenerate once without repeating any action');checks++;
}
const normal=await run({audit:qualityPass,repair:fixed});assert.equal(normal.output,candidate);assert.equal(normal.reviewCalls,1);assert.equal(normal.auditCalls,1);assert.equal(normal.repairCalls,0);checks+=4;
const rescued=await run({repair:fixed});assert.equal(rescued.output.text,fixed.text);assert.equal(rescued.reviewCalls,2);assert.equal(rescued.auditCalls,2);assert.equal(rescued.repairCalls,1);assert.equal(rescued.events.length,1);assert.equal(rescued.events[0].languageDiagnostics.repairState,'accepted');checks+=6;
const storefrontChat={searchIntent:{commerceRoute:'chat',replyBoundary:{salesAllowed:false,contactAllowed:false}},character:{category_id:'mascot'}};
const storefrontRescued=await run({options:storefrontChat,repair:fixed});assert.equal(storefrontRescued.output.text,fixed.text);assert.equal(storefrontRescued.repairCalls,1);assert.equal(storefrontRescued.reviewCalls,2);checks+=3;
for(const primary of [{...acceptedVerdict,boundarySupported:false},{...acceptedVerdict,boundarySupported:undefined}]){
 const r=await run({primary,options:storefrontChat,repair:fixed});assert.equal(r.repairCalls,1,'Pure chat may generate one fresh candidate; the unchanged boundary is fully re-reviewed');checks++;
}
const storefrontRefused=await run({options:storefrontChat,repair:fixed,secondPrimary:{...acceptedVerdict,allowed:false,boundarySupported:false}});assert.notEqual(storefrontRefused.output.text,fixed.text);assert.equal(storefrontRefused.repairCalls,1);checks+=2;
for(const boundarySupported of [false,undefined]){
 const r=await run({options:storefrontChat,repair:fixed,secondPrimary:{...acceptedVerdict,allowed:true,boundarySupported}});
 assert.notEqual(r.output.text,fixed.text);assert.equal(r.events[0].languageDiagnostics.repairState,'rejected');
 if(boundarySupported===false){assert(r.events[0].failedContracts.includes('boundary'));checks++;}checks+=2;
}
for(const scenario of [{secondPrimary:{...acceptedVerdict,allowed:false,factualSupported:false}},{secondAudit:qualityFail},{secondPrimary:{reviewStatus:'timeout'}}]){
 const r=await run({...scenario,repair:fixed});assert.notEqual(r.output.text,fixed.text);assert.equal(r.repairCalls,1);assert.equal(r.events.length,1);assert.equal(r.events[0].languageDiagnostics.repairState,'rejected');checks+=4;
}
const textInput={text,speechText:text};
for(const result of [null,{}, {...bad,languageQualityConfidence:'0.99'}, {...bad,languageIssues:[{type:'spelling',field:'both',span:'not in original'}]}, {...bad,languageIssues:[{type:'injected',field:'both',severity:'major',span:'fájros'}]}, {...bad,languageIssues:Array(5).fill(bad.languageIssues[0])}]){
 assert.notEqual(normalizeLanguageAssessment(result,textInput).reviewStatus,'valid');checks++;
}
const contradict=normalizeLanguageAssessment({...bad,languageQualitySupported:true},textInput);assert.equal(contradict.languageQualitySupported,false);checks++;
assert.equal(normalizeLanguageAssessment({languageQualitySupported:true,languageQualityConfidence:.9,languageIssues:[]},{...textInput,retainedText:text}).reviewStatus,'missing_fields');checks++;
const fixture={apiKey:'fixture',model:'fixture',id:'fixture',timeoutMs:20000};
const log=buildReplyReviewLogEvent({logContext:{requestId:'input',sessionId:'session'},reviewStatus:'valid',languageDiagnostics:{languageReviewStatus:'valid',languageIssueTypes:['spelling','SECRET'],initialLanguageIssueTypes:['morphology'],repairState:'accepted',span:'PRIVATE'}});
assert(!log.errorMessage.includes('SECRET'));assert(!log.errorMessage.includes('PRIVATE'));assert.equal(JSON.parse(log.errorMessage).languageReview.repair,'accepted');assert(log.errorMessage.length<=500);checks+=4;
console.log(`chat language repair self-check passed (${checks} assertions)`);
// An independent whole pass cannot approve an unchecked retained paragraph.
const paragraph='Card payment is supported.';const mixed=paragraph+'\n\nThe image is still generating.';
const imageOptions={replyResult:{text:mixed,speechText:mixed,sourceType:'ai'},language:'en',languageQualityRequired:true,independentLanguageQualityRequired:true,
 chatImageContext:{imageStatus:{kind:'generated',status:'failed',currentTurn:true}},character:{category_id:'mascot'},recordReview:async()=>{},
 assess:async()=>({allowed:false,confidence:.99,evidenceSupported:true,guidanceSupported:true,imageStatusSupported:false,imageStatusRelevant:true,imageReferenceMatched:true,boundarySupported:true,retainedBoundarySupported:true,retainedImageStatusSupported:true,
 languageQualitySupported:true,retainedLanguageQualitySupported:true,retainedText:paragraph,retainedTextAllowed:true})};
for(const retainedPassed of [false,true]){
 let seen;
 const r=await enforceReplyBoundary({...imageOptions,assessLanguageQuality:async options=>{seen=options;return{...qualityPass,retainedLanguageQualitySupported:retainedPassed};},regenerateReply:async()=>{throw new Error('Image paths cannot repair');}});
 assert.equal(seen.retainedText,paragraph);assert.equal(r.text.includes(paragraph),retainedPassed);checks+=2;
}
const {assessIndependentLanguageQuality}=await import('../server/chat-language-quality-service.js');
let body,transportCalls=0;
const viaTransport=await assessIndependentLanguageQuality({text,speechText:text,language:'hu',userText:'Csak beszélgetünk.',config:fixture,recordLog:async()=>{},
 fetchImpl:async(_url,options)=>{transportCalls++;body=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({...bad,languageQualityConfidence:.99})}}]})};}});
assert.equal(viaTransport.reviewStatus,'valid');assert.equal(viaTransport.languageQualitySupported,false);assert.equal(transportCalls,1);
assert(!body.messages[0].content.includes('fájros'));assert.match(body.messages[0].content,/Translated target-language text/);checks+=5;
assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
assert.equal(body.response_format.json_schema.schema.required.length,4);assert.equal(fixture.requestBodyExtras,undefined);checks+=4;
const {requestAiJsonWithProviderFallback}=await import('../server/ai-json-provider-service.js');
await requestAiJsonWithProviderFallback([{role:'user',content:'fixture'}],{config:fixture,recordProviderCallFn:async()=>{},
 fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{message:{content:'{}'}}]})};}});
assert.equal(body.response_format.type,'json_object');checks++;
console.log(`complete independent-language/repair regression passed (${checks} assertions)`);
