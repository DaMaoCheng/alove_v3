import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';globalThis.fetch=async()=>{throw Error('No network');};
const {normalizeLanguageAssessment}=await import('../server/chat-language-quality-service.js');
const {enforceReplyBoundary,assessReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const {inspectAiReplyQuality}=await import('../server/ai-reply-quality-service.js');
const candidate={text:'Bonjours !',speechText:'Bonjours !',sourceType:'ai',voiceMeta:{voiceId:'preserved'}};
const minor={languageQualitySupported:false,languageQualityConfidence:.99,languageIssues:[{type:'spelling',severity:'minor',field:'both',span:'Bonjours'}]};
assert.equal(normalizeLanguageAssessment(minor,candidate).languageQualitySupported,true,'A comprehensible minor typo must not block conversation');
const major={...minor,languageIssues:[{type:'grammar',severity:'major',field:'both',span:'Bonjours'}]};
const bad={...normalizeLanguageAssessment(major,candidate)};assert.equal(bad.languageQualitySupported,false);
for(const issue of [{...major.languageIssues[0],severity:undefined},{...major.languageIssues[0],severity:'unknown'},{type:'wrong_language',severity:'minor',field:'both',span:'Bonjours'},{type:'unverifiable',severity:'minor',field:'both',span:''}]){
 assert.equal(normalizeLanguageAssessment({...minor,languageIssues:[issue]},candidate).reviewStatus,'invalid_fields');
}
assert.equal(normalizeLanguageAssessment({...minor,languageIssues:[]},candidate).languageQualitySupported,false,'An empty defect list must not override an explicit refusal');
const config={apiKey:'fixture',model:'fixture-review',apiMode:'chat_completions'};
const correct='Je préfère marcher.';
for(const text of ['C’est comme ça.','Tu en as.','"Bonjour."'])assert(!inspectAiReplyQuality({text,language:'fr'}).reasons.includes('incomplete_ending'));
assert(inspectAiReplyQuality({text:'It ends because.',language:'en'}).reasons.includes('incomplete_ending'));
assert(inspectAiReplyQuality({text:'It ends "',language:'en'}).reasons.includes('incomplete_ending'));
const pure={replyResult:{text:correct,speechText:correct,sourceType:'ai'},language:'fr',languageQualityRequired:true,independentLanguageQualityRequired:true,recordReview:async()=>{}};
const auditPass={reviewStatus:'valid',confidence:.99,languageQualitySupported:true,languageIssues:[],severity:'none'};
const simple=await enforceReplyBoundary({...pure,assess:async()=>{throw Error('Pure language must not invoke a business reviewer');},assessLanguageQuality:async()=>auditPass});assert.equal(simple.text,correct);
const business={...pure,searchIntent:{commerceRoute:'chat',replyBoundary:{salesAllowed:false,contactAllowed:false}},factualContext:{asOfUtc:'2026-10-12T00:00:00Z',required:false,status:'not_required'}};
const base={allowed:true,boundarySupported:true,confidence:.99,factualSupported:true};
const single=await enforceReplyBoundary({...business,assess:async options=>{assert.equal(options.languageQualityRequired,false);assert.equal(options.independentLanguageReview,true);return{...base,languageQualitySupported:false};},assessLanguageQuality:async()=>auditPass});assert.equal(single.text,correct);
for(const verdict of [{...base,allowed:false},{...base,confidence:.2},{...base,confidence:'0.99'},{...base,factualSupported:false},{...base,factualSupported:undefined},{...base,boundarySupported:false},{reviewStatus:'timeout'},{reviewStatus:'invalid_json'}]){
 const out=await enforceReplyBoundary({...business,assess:async()=>verdict,assessLanguageQuality:async()=>auditPass});assert.notEqual(out.text,correct,'Language pass cannot override business refusal/missing data');
}
for(const primary of [{...base,allowed:false,boundarySupported:false},{...base,confidence:.5},{...base,factualSupported:false}]){
 let generations=0;
 const output=await enforceReplyBoundary({...business,assess:async()=>primary,
  assessLanguageQuality:async()=>({reviewStatus:'invalid_fields',protocolFailure:'span_mismatch'}),
  regenerateReply:async()=>{generations++;return{...pure.replyResult,text:'Unchecked fresh text.'};}});
 assert.equal(generations,0,'A malformed language assessment cannot erase a valid business refusal or low-confidence boundary');
 assert.notEqual(output.text,'Unchecked fresh text.');
}
const retained='Send me your phone number.';
const mixed={text:retained+'\n\nThe image is still generating.',speechText:retained+'\n\nThe image is still generating.',sourceType:'ai'};
const imageReview={allowed:false,boundarySupported:false,confidence:.99,evidenceSupported:true,guidanceSupported:true,
 imageStatusSupported:false,imageStatusRelevant:true,imageReferenceMatched:true,retainedImageStatusSupported:true,retainedText:retained,retainedTextAllowed:true};
for(const approval of [undefined,false,'true',true]){
 const output=await enforceReplyBoundary({...pure,replyResult:mixed,searchIntent:business.searchIntent,
  chatImageContext:{imageStatus:{kind:'generated',status:'failed',currentTurn:true}},character:{category_id:'mascot'},
  assess:async()=>({...imageReview,retainedBoundarySupported:approval}),
  assessLanguageQuality:async()=>({...auditPass,retainedLanguageQualitySupported:true})});
 assert.equal(output.text.includes(retained),approval===true,'A retained language pass requires its own explicit boundary approval');
}
const retainedVerdict=normalizeLanguageAssessment({...minor,retainedLanguageQualitySupported:false},{...candidate,retainedText:candidate.text});
assert.equal(retainedVerdict.retainedLanguageQualitySupported,false,'A whole minor pass never grants retained approval');
let providerBody;const parsed=await assessReplyBoundary({text:correct,languageQualityRequired:false,independentLanguageReview:true,boundaryReviewRequired:true,config,recordLog:async()=>{},fetchImpl:async(_u,o)=>{providerBody=JSON.parse(o.body);return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({allowed:true,confidence:.99,evidenceSupported:true,guidanceSupported:true})}}]})};}});assert.equal(parsed.reviewStatus,'missing_fields','Dedicated mode requires explicit whole-boundary approval');
assert(providerBody.messages.some(m=>m.role==='system'&&m.content.includes('dedicated language reviewer')));
assert.equal(JSON.parse(providerBody.messages.at(-1).content).proposedSpeech,correct,'Dedicated mode must send speech even without a factual/evidence contract');
let clock=10000,primary=0,audits=0;const originalNow=Date.now;Date.now=()=>clock;
try{const output=await enforceReplyBoundary({...business,replyResult:candidate,
 assess:async options=>{primary++;if(primary===2)clock+=1250;return base;},
 assessLanguageQuality:async options=>{audits++;if(audits===1)return bad;assert(options.timeoutMs===20000,'Recovered language review receives its independent complete stage budget');clock+=4000;return auditPass;},
 regenerateReply:async()=>{clock+=2333;return{...candidate,text:'Bonjour !',speechText:'Bonjour !'};}});assert.equal(output.text,'Bonjour !');assert.equal(primary,2);assert.equal(audits,2);
}finally{Date.now=originalNow;}
let expiredRequests=0;
const expired=await enforceReplyBoundary({...business,languageRecoveryDeadline:Date.now()-1,
 assess:async()=>{expiredRequests++;return base;},assessLanguageQuality:async()=>{expiredRequests++;return auditPass;}});
assert.equal(expiredRequests,2,'An obsolete recovery deadline cannot skip either independently budgeted review');assert.equal(expired.text,correct);
const {buildReplyReviewLogEvent}=await import('../server/ai-reply-log-service.js');
const diagnostic=buildReplyReviewLogEvent({reviewStatus:'valid',languageDiagnostics:{primaryReviewStatus:'not_run',languageReviewStatus:'valid',languageSeverity:'minor',repairFailureCode:'no_change',span:'PRIVATE',error:'SECRET'}});
assert.deepEqual(JSON.parse(diagnostic.errorMessage).languageReview,{status:'valid',issues:[],repair:'not_attempted',initialIssues:[],primary:'not_run',severity:'minor',reason:'no_change'});
assert(!diagnostic.errorMessage.includes('PRIVATE')&&!diagnostic.errorMessage.includes('SECRET'));
console.log('Language review policy self-check passed (severity, single judge, speech-only, formatting, locale, business guards and independent budgets; no external requests/DB)');
