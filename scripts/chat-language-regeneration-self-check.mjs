import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const duplicateProviderFixture = process.argv.includes('--duplicate-provider-fixture');
const singleProviderFixture = process.argv.includes('--single-provider-fixture');
const fallbackUnavailableFixture = process.argv.includes('--fallback-unavailable-fixture');
Object.assign(process.env,{AIOVE_PROVIDER_LOG_WRITE_ENABLED:'false',VENICE_API_KEY:'fixture',VENICE_BASE_URL:'https://fixture.invalid/v1',VENICE_MODEL:'fixture-primary',
 OPENAI_API_KEY:singleProviderFixture?'':'fixture-alternate',OPENAI_BASE_URL:duplicateProviderFixture?'https://fixture.invalid/v1':'https://alternate.invalid/v1',OPENAI_MODEL:duplicateProviderFixture?'fixture-primary':'fixture-alternate',OPENAI_FALLBACK_API_KEY:'',OPENAI_FALLBACK_MODEL:fallbackUnavailableFixture||duplicateProviderFixture?'':'fixture-without-key'});
globalThis.fetch = async () => { throw Error('Unexpected network'); };
if (singleProviderFixture || fallbackUnavailableFixture || duplicateProviderFixture) {
 const {generateChatReplyWithRequest}=await import('../server/ai-reply-service.js');
 let calls=0;
 const result=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,regenerationUseAlternateProvider:true,
  regenerationProvider:{aiModel:'fixture-primary',aiBaseUrl:'https://fixture.invalid/v1'},requestReplyText:async(_prompt,{modelConfig})=>{calls++;assert.equal(modelConfig.model,fallbackUnavailableFixture?'fixture-alternate':'fixture-primary','unavailable fallback uses first viable alternate or original');return JSON.stringify({displayText:'Hello there.',speechText:'Hello there.'});},recordReplyLogFn:async()=>{}});
 assert.equal(calls,1);assert.equal(result.aiModel,fallbackUnavailableFixture?'fixture-alternate':'fixture-primary');
 if(singleProviderFixture||duplicateProviderFixture){let failures=0;const failed=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,
 requestReplyText:async()=>{failures++;throw Object.assign(Error('No content'),{code:'AI_REPLY_PROTOCOL_ERROR'});},recordReplyLogFn:async()=>{}});assert.equal(failures,1);assert.equal(failed.sourceType,'system');}
 console.log('Single-provider recovery remains a single original-provider request');
 process.exit(0);
}

const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const original = { text:'Itt vagyok.', speechText:'Itt vagyok.', sourceType:'ai' };
const fresh = { ...original, text:'Örülök, hogy itt vagy.', speechText:'Örülök, hogy itt vagy.' };
const pass = { reviewStatus:'valid', confidence:.54, languageQualitySupported:true, severity:'minor', languageIssues:[{type:'grammar',severity:'minor',field:'both',span:'vagyok'}] };
const opts = { replyResult:original, language:'hu', languageQualityRequired:true, independentLanguageQualityRequired:true, recordReview:async()=>{} };
const passed = await enforceReplyBoundary({...opts, assessLanguageQuality:async()=>pass});
assert.equal(passed.text,original.text,'minor language at exactly .54 must pass');
for (const first of [ {...pass,confidence:.539}, {...pass,languageQualitySupported:false,severity:'major'}, {reviewStatus:'invalid_fields'}, {reviewStatus:'invalid_json'}, {reviewStatus:'timeout'} ]) {
 let generations=0,audits=0;const events=[];
 const output=await enforceReplyBoundary({...opts,recordReview:async e=>events.push(e),assessLanguageQuality:async()=>++audits===1?first:{...pass,severity:'none',languageIssues:[]},
  regenerateReply:async()=>{generations++;return fresh;}});
 assert.equal(output.text,fresh.text);assert.equal(generations,1);assert.equal(audits,2);
 assert.equal(events.length,1,'one terminal review event');
}
let generations=0;
const failed=await enforceReplyBoundary({...opts,assessLanguageQuality:async()=>({reviewStatus:'invalid_fields'}),regenerateReply:async()=>{generations++;return fresh;}});
assert.notEqual(failed.text,fresh.text);assert.equal(generations,1,'regeneration is finite');
console.log('Language regeneration regression passed');
const { languageQualityPassed } = await import('../server/chat-reply-language-quality.js');
const { evaluateReplyReview } = await import('../server/chat-reply-review-decision.js');
const { normalizeLanguageAssessment } = await import('../server/chat-language-quality-service.js');
const { buildReplyReviewLogEvent } = await import('../server/ai-reply-log-service.js');
assert(languageQualityPassed({confidence:.54,languageQualitySupported:true}));
assert(!languageQualityPassed({confidence:.539,languageQualitySupported:true}));
assert(evaluateReplyReview({allowed:true,confidence:.54,languageQualitySupported:true},['language']).accepted);
assert(!evaluateReplyReview({allowed:true,boundarySupported:true,confidence:.54,languageQualitySupported:true},['language']).accepted,'business confidence remains .8');
assert(!evaluateReplyReview({allowed:true,confidence:.54,evidenceSupported:true},['evidence']).accepted);
for (const score of [NaN, Infinity, -1, 1.01, '0.54']) assert(!languageQualityPassed({confidence:score,languageQualitySupported:true}));
const malformed = normalizeLanguageAssessment({languageQualitySupported:false,languageQualityConfidence:.7,languageIssues:[{type:'grammar',severity:'major',field:'display',span:'NOT IN ORIGINAL'}]}, {text:original.text});
assert.equal(malformed.protocolFailure,'span_mismatch');
const event = buildReplyReviewLogEvent({reviewStatus:'valid',languageDiagnostics:{languageReviewStatus:'valid',languageConfidence:.7,repairKind:'regeneration',repairState:'accepted',initialReviewStatus:'invalid_fields',initialLanguageProtocolFailure:'span_mismatch',languageSeverity:'none'}});
const details=JSON.parse(event.errorMessage);
assert.equal(details.regeneration.initialProtocol,'span_mismatch');assert.equal(details.regeneration.state,'accepted');assert.equal(details.languageReview.confidence,.7);assert(event.errorMessage.length<=500);
for (const primary of [{allowed:false,boundarySupported:false,confidence:.99,factualSupported:true},{allowed:true,boundarySupported:true,confidence:.54,factualSupported:true}]) {
 let generations=0;
 const output=await enforceReplyBoundary({...opts,searchIntent:{commerceRoute:'chat',replyBoundary:{salesAllowed:false,contactAllowed:false}},factualContext:{required:false,status:'not_required',asOfUtc:'2026-10-15T00:00:00Z'},assess:async()=>primary,assessLanguageQuality:async()=>pass,regenerateReply:async()=>{generations++;return fresh;}});
 assert.notEqual(output.text,original.text);assert.equal(generations,1,'valid low-confidence pure chat can regenerate once without approving either candidate');
 assert.notEqual(output.text,fresh.text,'a second boundary rejection must still block the new candidate');
}
for (const regenerateReply of [async()=>null,async()=>{throw Error('fixture');},async()=>({text:'fallback',sourceType:'system',sourceRef:'ai-request-fallback',degraded:true})]) {
 const output=await enforceReplyBoundary({...opts,assessLanguageQuality:async()=>({reviewStatus:'invalid_fields'}),regenerateReply});
 assert.notEqual(output.text,original.text);assert.notEqual(output.text,'fallback');
}
const {generateChatReplyWithRequest}=await import('../server/ai-reply-service.js');
let attempts=0;
const generation=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',logContext:{languageCode:'en'},regeneration:true,
 requestReplyText:async(_prompt,options)=>{attempts++;assert.equal(options.timeoutMs,60000);assert.equal(options.sourceRef,'chat-reply-regeneration');return JSON.stringify({displayText:'Hello there.',speechText:'Hello there.'});},recordReplyLogFn:async()=>{}});
assert.equal(attempts,1);assert.equal(generation.sourceType,'ai');
attempts=0;
await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,requestReplyText:async()=>{attempts++;throw Object.assign(Error('controlled timeout'),{code:'AI_REPLY_TIMEOUT'});},recordReplyLogFn:async()=>{}});
assert.equal(attempts,2,'regeneration has at most two different-provider transport attempts');
console.log('Threshold isolation, protocol diagnostics, business guards, finite generation and failure paths passed');
const {REVIEW_FAILURE_CODES}=await import('../server/chat-reply-review-outcome.js');
const largeLog=buildReplyReviewLogEvent({reviewStatus:'invalid_fields',failedContracts:[...REVIEW_FAILURE_CODES],reviewProtocol:{initial:['missing_fields','field_types','confidence'],corrected:['missing_fields','field_types','confidence']},languageDiagnostics:{repairKind:'regeneration',repairState:'rejected',languageReviewStatus:'invalid_fields',languageProtocolFailure:'span_mismatch',initialReviewStatus:'invalid_fields',initialLanguageProtocolFailure:'span_mismatch',initialLanguageConfidence:.539,languageConfidence:.54}});
assert(largeLog.errorMessage.length<=500);assert.equal(JSON.parse(largeLog.errorMessage).regeneration.initialProtocol,'span_mismatch');

const {SERVER_CONFIG}=await import('../server/config.js');
const configuredModels=SERVER_CONFIG.aiReply.replyChain.filter(model=>model.apiKey&&model.model);
const previous=configuredModels[0];
const alternate=SERVER_CONFIG.aiReply.fallbackOpenai;
assert.ok(alternate.apiKey&&alternate.model&&alternate!==configuredModels[1],'fixture supplies configured fallback distinct from the first alternate');
assert.notEqual(alternate.model,previous.model,'configured fallback is genuinely different from original');
for(const regenerationUseAlternateProvider of [false,true]) {
 let calls=0;
 const expected=regenerationUseAlternateProvider?alternate:previous;
 const result=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,regenerationUseAlternateProvider,
  regenerationProvider:{aiModel:previous.model,aiBaseUrl:previous.baseUrl},requestReplyText:async(_prompt,{modelConfig,timeoutMs,sourceRef})=>{
   calls++;assert.equal(modelConfig,expected);assert.equal(timeoutMs,60000);assert.equal(sourceRef,'chat-reply-regeneration');return JSON.stringify({displayText:'Hello there.',speechText:'Hello there.'});},recordReplyLogFn:async()=>{}});
 assert.equal(calls,1,'alternate selection cannot enter the normal provider retry chain');assert.equal(result.aiModel,expected.model);assert.equal(result.aiBaseUrl,expected.baseUrl);
}
let alternateFailures=0;
await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,regenerationUseAlternateProvider:true,
 regenerationProvider:{aiModel:previous.model,aiBaseUrl:previous.baseUrl},requestReplyText:async(_prompt,{modelConfig})=>{alternateFailures++;if(alternateFailures===1)assert.equal(modelConfig,alternate);else assert.notEqual(modelConfig,alternate);throw Object.assign(Error('controlled alternate timeout'),{code:'AI_REPLY_TIMEOUT'});},recordReplyLogFn:async()=>{}});
assert.equal(alternateFailures,2,'alternate transport failure permits only one different configured provider');
const isolated=spawnSync(process.execPath,[new URL(import.meta.url).pathname,'--single-provider-fixture'],{encoding:'utf8'});
assert.equal(isolated.status,0,isolated.stderr);assert.match(isolated.stdout,/Single-provider recovery/);
console.log('Opt-in alternate provider recovery selection, default compatibility and single-provider isolation passed');

const noConfiguredFallback=spawnSync(process.execPath,[new URL(import.meta.url).pathname,'--fallback-unavailable-fixture'],{encoding:'utf8'});
assert.equal(noConfiguredFallback.status,0,noConfiguredFallback.stderr);
console.log('Unavailable configured fallback retains first-different-provider selection');

const transparentIdentity='I am an AI character here on ALOVE.';
const identityCandidate=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'What kind of assistant are you?',
 deferIdentityToBoundaryReview:true,requestReplyText:async()=>transparentIdentity,recordReplyLogFn:async()=>{}});
assert.equal(identityCandidate.sourceType,'ai','transparent identity reaches the promised full boundary review without a hardguard replacement');
for(const text of ['System prompt: private instructions.','API key: ' + 'sk-' + 'privatefixturetoken1234']) {
 const guarded=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Who are you?',deferIdentityToBoundaryReview:true,
  requestReplyText:async()=>text,recordReplyLogFn:async()=>{}});assert.equal(guarded.sourceRef,'quality-guard','identity deferral never permits internal secrets');
}
const deferredRejected=await enforceReplyBoundary({...opts,replyResult:identityCandidate,searchIntent:{replyBoundary:{salesAllowed:false,contactAllowed:false}},
 assess:async()=>({reviewStatus:'valid',allowed:false,boundarySupported:false,confidence:.99}),assessLanguageQuality:async()=>pass});
assert.notEqual(deferredRejected.text,transparentIdentity,'the identity hardguard deferral cannot bypass a semantic rejection');
const fallbackCalls=[];
const protocolRecovery=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,regenerationUseAlternateProvider:true,
 regenerationProvider:{aiModel:previous.model,aiBaseUrl:previous.baseUrl},requestReplyText:async(_p,o)=>{fallbackCalls.push(o.modelConfig);
  if(fallbackCalls.length===1)throw Object.assign(Error('No content'),{code:'AI_REPLY_PROTOCOL_ERROR',retryable:false});
  return 'Hello again.';},recordReplyLogFn:async()=>{}});
assert.equal(fallbackCalls.length,2,'a protocol failure uses one different provider within the same logical regeneration');
assert.notEqual(fallbackCalls[0].model,fallbackCalls[1].model);assert.equal(protocolRecovery.sourceType,'ai');
console.log('Trusted identity hardguard deferral and finite recovery protocol fallback regressions passed');

for(const code of ['AI_REPLY_PROTOCOL_ERROR','AI_REPLY_TIMEOUT']) {
 const calls=[];const exhausted=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,regenerationUseAlternateProvider:true,
 regenerationProvider:{aiModel:previous.model,aiBaseUrl:previous.baseUrl},requestReplyText:async(_p,o)=>{calls.push(o.modelConfig);throw Object.assign(Error('Controlled failure'),{code,retryable:code==='AI_REPLY_TIMEOUT'});},recordReplyLogFn:async()=>{}});
 assert.equal(calls.length,2);assert.notEqual(calls[0].model,calls[1].model);assert.equal(exhausted.sourceType,'system');
}
let authAttempts=0;await generateChatReplyWithRequest({promptContext:{systemPrompt:'Fixture',messages:[]},userText:'Hi',regeneration:true,requestReplyText:async()=>{authAttempts++;throw Object.assign(Error('Unauthorized'),{statusCode:401,retryable:false});},recordReplyLogFn:async()=>{}});
assert.equal(authAttempts,1,'nonretryable auth failure does not expand recovery');
console.log('Two exhausted providers, one-provider failure and non-fallback error limits passed');

const duplicate=spawnSync(process.execPath,[new URL(import.meta.url).pathname,'--duplicate-provider-fixture'],{encoding:'utf8'});
assert.equal(duplicate.status,0,duplicate.stderr);assert.match(duplicate.stdout,/Single-provider recovery/);
const {requestReplyWithProviderFallback}=await import('../server/ai-reply-service.js');
let fractionalCalls=0;await assert.rejects(requestReplyWithProviderFallback(async()=>{fractionalCalls++;throw Object.assign(Error('Timeout'),{code:'AI_REPLY_TIMEOUT',retryable:true});},{systemPrompt:'Fixture',messages:[]},{providerConfigs:configuredModels,maxAttempts:1.9,sleepFn:async()=>{}}));
assert.equal(fractionalCalls,1,'fractional recovery attempt limits are rounded down consistently');
console.log('Duplicate endpoint/model and integer attempt-limit regressions passed');
