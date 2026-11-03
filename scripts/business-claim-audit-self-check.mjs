import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {buildReplyReviewFormat}=await import('../server/chat-reply-review-contracts.js');
const {assessReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const options={text:'Coverage applies.',speechText:'Coverage applies.',businessFactsRequired:true,knowledgeContext:{items:[{id:'policy',content:'Coverage may apply under the selected option.'}]},config:{apiKey:'fixture',model:'fixture',baseUrl:'https://fixture.invalid',apiMode:'chat_completions'},recordLog:async()=>{}};
assert.ok(buildReplyReviewFormat(options).json_schema.schema.required.includes('businessClaimAudit'),'policy claims require per-unit evidence audit in same request');
const {buildBusinessClaimContext,validateBusinessClaimAudit}=await import('../server/business-claim-audit-service.js');
const context=buildBusinessClaimContext(options);let count=0;
const auditSchema=buildReplyReviewFormat(options).json_schema.schema.properties.businessClaimAudit;
const nativeConfidence=buildReplyReviewFormat(options).json_schema.schema.properties.confidence;
assert.deepEqual(nativeConfidence,{type:'number'},'provider-native number bounds are unsupported; local validation still enforces [0,1]');
assert.equal(auditSchema.minItems,1);assert.equal(auditSchema.maxItems,undefined);
assert(auditSchema.description.includes(`Exactly ${context.units.length} entries`));
assert.equal(auditSchema.items.properties.referenceIds.maxItems,undefined);
assert(auditSchema.items.properties.referenceIds.description.includes('At most 6 distinct'));
const ok=context.units.map(u=>({unitId:u.id,factual:true,referenceIds:[context.references[0].id],supported:true,sourceAllowsException:true,replyPreservesException:true}));
const test=(entries,valid,accepted)=>{const result=validateBusinessClaimAudit(entries,context);assert.equal(result.valid,valid);assert.equal(result.accepted,accepted);count++};
test(ok,true,true);test(ok.map(x=>({...x,replyPreservesException:false})),true,false);test([],false,false);test([...ok,ok[0]],false,false);test(ok.map(x=>({...x,referenceIds:['invented']})),false,false);test(ok.map(x=>({...x,referenceIds:[]})),false,false);test(ok.map(x=>({...x,supported:false})),true,false);
assert.equal(buildBusinessClaimContext({...options,businessFactsRequired:false}),null);count++;
const fetchImpl=raw=>async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({allowed:true,confidence:1,boundarySupported:true,businessFactsSupported:true,...raw})}}]}));
const r=await assessReplyBoundary({...options,fetchImpl:fetchImpl({businessClaimAudit:ok.map(x=>({...x,replyPreservesException:false}))})});assert.equal(r.allowed,false);assert.equal(r.businessFactsSupported,false);count++;
assert.deepEqual(r.repairIssues, [{ kind: 'missing_condition', span: 'Coverage applies.' }], 'validated failing unit is retained for correction');
const explained = await assessReplyBoundary({ ...options, fetchImpl: fetchImpl({ allowed: false, businessFactsSupported: false,
  businessClaimAudit: ok.map(x => ({ ...x, supported: false, referenceIds: [] })), reviewIssueSpan: 'Coverage applies.', reviewIssueReason: 'The policy only says coverage may apply.' }) });
assert(explained.repairIssues.some(issue => issue.kind === 'review_reason' && issue.span === 'Coverage applies.' && issue.reason === 'The policy only says coverage may apply.'));
const malformedExplanation = await assessReplyBoundary({ ...options, fetchImpl: fetchImpl({ allowed: false, businessFactsSupported: false,
  businessClaimAudit: ok.map(x => ({ ...x, supported: false, referenceIds: [] })), reviewIssueSpan: 'not in response', reviewIssueReason: 'invented' }) });
assert.equal(malformedExplanation.reviewStatus, 'valid');
assert(!malformedExplanation.repairIssues.some(issue => issue.kind === 'review_reason'), 'invented quote is discarded without changing rejection');
const boundaryOnlyReason = await assessReplyBoundary({ ...options, fetchImpl: fetchImpl({ allowed: false, confidence: .9,
  businessClaimAudit: ok, reviewIssueSpan: 'Coverage applies.', reviewIssueReason: 'The answer overstates the policy.' }) });
assert(boundaryOnlyReason.repairIssues.some(issue => issue.kind === 'review_reason'), 'whole-response rejection with a concrete span keeps its reason');
const scoreOnly = await assessReplyBoundary({ ...options, fetchImpl: fetchImpl({ allowed: false, confidence: .4,
  businessClaimAudit: ok, reviewIssueSpan: 'Coverage applies.', reviewIssueReason: 'Made-up reason.' }) });
assert(!scoreOnly.repairIssues?.some(issue => issue.kind === 'review_reason'), 'score-only uncertainty does not manufacture a content defect');
const missing=await assessReplyBoundary({...options,fetchImpl:fetchImpl({})});assert.notEqual(missing.reviewStatus,'valid');assert.equal(missing.allowed,false);count++;
const decimal=buildBusinessClaimContext({...options,text:'Costs $15.99 unless a surcharge applies.',knowledgeContext:{items:[{id:'p',content:'Costs $15.99 unless a surcharge applies. See https://example.com/policy for terms.'}]}});
assert.equal(decimal.references[0].text,'Costs $15.99 unless a surcharge applies.');assert(decimal.references[1].text.includes('https://example.com/policy'));count+=2;
console.log(`business claim audit self-check passed (${count} checks; same-call schema, coverage, source identity and contradictory approval; no external network)`);
const {SERVER_CONFIG}=await import('../server/config.js');
if(SERVER_CONFIG.aiReply.venice.apiKey){
 let observedModel;
 await assessReplyBoundary({...options,config:null,fetchImpl:async (_url,request)=>{observedModel=JSON.parse(request.body).model;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({allowed:true,confidence:1,boundarySupported:true,businessFactsSupported:true,businessClaimAudit:ok})}}]}))}});
 assert.equal(observedModel,SERVER_CONFIG.aiReply.replyChain.find(provider => provider.apiKey && provider.model).model,'policy review uses the existing configured primary, no extra call');
}
const {independentJsonProviderChain,independentReviewerConfig}=await import('../server/ai-independent-review-config.js');
const primaryFixture={id:'openai',apiKey:'fixture',model:'primary',baseUrl:'https://shared.invalid',apiMode:'responses'};
const fallbackFixture={...primaryFixture,id:'deepseek',model:'backup',requestBodyExtras:{max_tokens:10,max_output_tokens:20}};
const reasoningFixture={venice:{apiKey:''},openai:primaryFixture,fallbackOpenai:fallbackFixture,replyChain:[primaryFixture,fallbackFixture]};
const selected=independentJsonProviderChain(reasoningFixture);
assert.equal(selected.length,2,'ordinary review retains the existing primary and backup order');
assert.equal(selected[0].model,'primary');
const selectedBackup=selected[1];
assert.equal(selectedBackup.id,'deepseek');assert.equal(selectedBackup.requestBodyExtras.max_output_tokens,3000);
assert(!('max_tokens' in selectedBackup.requestBodyExtras));
assert.equal(fallbackFixture.requestBodyExtras.max_output_tokens,20,'local reasoning budget must not mutate global provider');
assert.equal(independentReviewerConfig('primary',reasoningFixture).model,'backup');
console.log('independent reasoning config checks passed (existing models, attribution, no duplicate, responses budget, no mutation)');

// Native schema decoding and local validation describe the same bounded audit.
const providers=[{...options.config,id:'venice'}, {...options.config,id:'deepseek',model:'fixture-backup'}];
const good={allowed:true,confidence:1,boundarySupported:true,businessFactsSupported:true,businessClaimAudit:ok};
let calls=0;
const assessSequence=async(sequence)=>{
 calls=0;
 return assessReplyBoundary({...options,config:providers,fetchImpl:async()=>{
  const raw=sequence[Math.min(calls++,sequence.length-1)];
  return new Response(JSON.stringify({choices:[{message:{content:typeof raw==='string'?raw:JSON.stringify(raw)}}]}));
 }});
};
for(const [patch,reason] of [
 [{businessClaimAudit:[]},'claim_count'],
 [{businessClaimAudit:ok.map(x=>({...x,unitId:'invented'}))},'claim_units'],
 [{businessClaimAudit:ok.map(x=>({...x,supported:'true'}))},'claim_fields'],
 [{businessClaimAudit:ok.map(x=>({...x,referenceIds:['invented']}))},'claim_references'],
 [{businessClaimAudit:ok.map(x=>({...x,referenceIds:[]}))},'claim_consistency'],
 [{businessFactsSupported:'true'},'field_types'], [{confidence:2},'confidence'],
]) {
 const result=await assessSequence([{...good,...patch},good]);
 assert.equal(calls,2,'only a malformed protocol may reach the existing backup');
 assert.equal(result.reviewStatus,'valid');assert.deepEqual(result.protocolFailures,[reason]);
}
const parsedBackup=await assessSequence(['{broken',good]);
assert.equal(calls,2);assert.equal(parsedBackup.reviewStatus,'valid');assert.deepEqual(parsedBackup.protocolFailures,['invalid_json']);
for(const rejected of [
 {...good,allowed:false,businessFactsSupported:false,businessClaimAudit:ok.map(x=>({...x,supported:false,referenceIds:[]}))},
 {...good,allowed:false,businessFactsSupported:false,businessClaimAudit:ok.map(x=>({...x,replyPreservesException:false}))},
 {...good,confidence:.7,allowed:false},
]) {
 const result=await assessSequence([rejected,good]);
 assert.equal(calls,1,'valid semantic refusal or low-confidence vote is terminal, never retry for approval');
 assert.equal(result.reviewStatus,'valid');assert.deepEqual(result.protocolFailures,[]);
}
const exhausted=await assessSequence([{...good,businessClaimAudit:[]}]);
assert.equal(calls,2);assert.equal(exhausted.reviewStatus,'invalid_fields');assert.equal(exhausted.allowed,false);
assert.deepEqual(exhausted.protocolFailures,['claim_count','claim_count']);
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const {buildReplyReviewLogEvent}=await import('../server/ai-reply-log-service.js');
const {buildLanguageQualityFallbackReply}=await import('../server/chat-reply-language-quality.js');
let terminal;
const guarded=await enforceReplyBoundary({replyResult:{text:'The parcel cleared customs.'},character:{category_id:'mascot'},
 searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business',commerceTopic:'support',answerRequired:true},
 knowledgeContext:options.knowledgeContext,language:'en',assess:async()=>exhausted,recordReview:async event=>{terminal=event}});
assert.equal(guarded.text,buildLanguageQualityFallbackReply('en'),'protocol failure must not claim policy or channel is unverifiable');
assert.deepEqual(terminal.reviewProtocol,{initial:['claim_count','claim_count']});
const logged=JSON.parse(buildReplyReviewLogEvent(terminal).errorMessage);
assert.deepEqual(logged.protocol,{initial:['claim_count','claim_count']});
const unsafe=buildReplyReviewLogEvent({reviewStatus:'invalid_fields',reviewProtocol:{initial:['secret-body','claim_units'],corrected:['claim_references']}});
assert(!unsafe.errorMessage.includes('secret-body'));assert.deepEqual(JSON.parse(unsafe.errorMessage).protocol,{initial:['claim_units'],corrected:['claim_references']});
const maxLog=buildReplyReviewLogEvent({reviewStatus:'invalid_fields',failedContracts:['boundary','language','factual','evidence','guidance','business_facts','product_scope','candidate_confirmation','image_status','guest_benefit','factual_limitation','confidence'],
 reviewProtocol:{initial:Array(3).fill('claim_consistency'),corrected:Array(3).fill('claim_references')},languageDiagnostics:{repairKind:'grounded',repairState:'rejected',primaryReviewStatus:'invalid_fields'}});
assert(maxLog.errorMessage.length<=500,'stage diagnostics remain bounded valid JSON');JSON.parse(maxLog.errorMessage);
console.log('review protocol regression passed (bounded schema, finite reasons, existing backup only for malformed output, semantic refusal terminal, no policy denial on protocol failure, stage logs private and bounded)');
let correctedEvent;
await enforceReplyBoundary({replyResult:{text:'A proposed answer.'},character:{category_id:'mascot'},
 searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business',commerceTopic:'support',answerRequired:true},
 knowledgeContext:options.knowledgeContext,language:'en',languageRepairAttempted:true,
 languageRepairDiagnostics:{reviewProtocol:{initial:['field_types']}},assess:async()=>exhausted,
 recordReview:async event=>{correctedEvent=event}});
assert.deepEqual(correctedEvent.reviewProtocol,{initial:['field_types'],corrected:['claim_count','claim_count']},'the corrected review keeps separate initial and corrected protocol provenance');
console.log('initial/corrected protocol stage handoff passed');
const {buildReplyReviewMessages}=await import('../server/chat-reply-review-contracts.js');
const conceptOptions={...options,text:'A quoted status usually describes a stage, not confirmation of your actual parcel.',
 speechText:'A quoted status usually describes a stage, not confirmation of your actual parcel.',
 searchIntent:{commerceRoute:'chat',knowledgeScope:'general',commerceTopic:'delivery',answerRequired:true},
 knowledgeContext:{items:[{id:'general',content:'General shipping background only.'}]}};
assert.equal(buildBusinessClaimContext(conceptOptions),null,'generic background is not policy audit evidence');
const conceptContext=buildBusinessClaimContext({...conceptOptions,searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business'}});
const conceptAudit=conceptContext.units.map(u=>({unitId:u.id,factual:false,referenceIds:[],supported:true,sourceAllowsException:false,replyPreservesException:true}));
assert(validateBusinessClaimAudit(conceptAudit,conceptContext).accepted,'background concepts need no site-policy quote but remain fully covered');
const conceptMessages=buildReplyReviewMessages(conceptOptions);
assert(conceptMessages.some(m=>m.content.includes('actual destination country')&&m.content.includes('quoted status')),'same existing review rejects inventing concrete shipment facts from a quoted status');
assert(buildReplyReviewMessages({...conceptOptions,searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business'}}).some(m=>m.content.includes('actual shipment claim or store policy must remain factual=true')),'mixed policy retains explicit actual shipment and store policy audit requirements');
console.log('general concept vs actual store/order audit contract regression passed');
const mixedContext=buildBusinessClaimContext({...conceptOptions,searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business'},
 text:'A quoted status usually describes a stage. Our store guarantees next-day delivery.',
 speechText:'A quoted status usually describes a stage. Our store guarantees next-day delivery.'});
const mixedAudit=mixedContext.units.map((u,i)=>({unitId:u.id,factual:i>0,referenceIds:[],supported:i===0,sourceAllowsException:false,replyPreservesException:i===0}));
assert.equal(mixedContext.units.length,2);assert.equal(validateBusinessClaimAudit(mixedAudit,mixedContext).accepted,false,
 'allowing a general definition cannot approve an unsupported concurrent store policy assertion');
if(SERVER_CONFIG.aiReply.venice.apiKey){
 let observedGenericModel,genericModelCalls=0;
 const genericAssessment=await assessReplyBoundary({...conceptOptions,knowledgeContext:{items:[]},config:null,
 fetchImpl:async(_url,request)=>{observedGenericModel=JSON.parse(request.body).model;genericModelCalls++;
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({allowed:true,confidence:1,boundarySupported:true,businessFactsSupported:true})}}]}));}});
 assert.equal(observedGenericModel,SERVER_CONFIG.aiReply.replyChain.find(provider => provider.apiKey && provider.model).model,'a no-KB general explanation uses the existing configured primary in the same assessment');
 assert.equal(genericModelCalls,1);assert.equal(genericAssessment.reviewStatus,'valid');
}
console.log('mixed general/policy strictness and same-call independent reviewer regression passed');

const multiSchema=buildReplyReviewFormat({...options,text:'First clause. Second clause.',speechText:'First clause. Second clause.'}).json_schema.schema.properties.businessClaimAudit;
assert.equal(multiSchema.minItems,1);assert.equal(multiSchema.maxItems,undefined);assert(multiSchema.description.includes('Exactly 2 entries'));
const twoContext=buildBusinessClaimContext({...options,text:'First clause. Second clause.',speechText:'First clause. Second clause.'});
const twoVotes=twoContext.units.map(u=>({unitId:u.id,factual:false,referenceIds:[],supported:true,sourceAllowsException:false,replyPreservesException:true}));
assert(validateBusinessClaimAudit(twoVotes,twoContext).accepted);
for(const bad of [twoVotes.slice(0,1),[...twoVotes,twoVotes[0]],[twoVotes[0],twoVotes[0]]])assert.equal(validateBusinessClaimAudit(bad,twoContext).valid,false,'exact coverage and distinct units remain strict locally despite native provider limits');
const manyReferences={...context,references:Array.from({length:7},(_,i)=>({id:'r'+i,text:'Unrelated template text.'}))};
assert.equal(validateBusinessClaimAudit(ok.map(x=>({...x,referenceIds:manyReferences.references.map(r=>r.id)})),manyReferences).reason,'claim_references','local reference limit remains six');
console.log('Claude native-array subset compatibility passed; local exact coverage, unit identity and six-reference limit remain strict');

const largeBackground={items:Array.from({length:3},(_,k)=>({id:'football'+k,content:Array.from({length:60},(_,i)=>`Quote ${k}-${i} is general football background.`).join(' ')}))};
const largeGeneral={...conceptOptions,knowledgeContext:largeBackground};
assert.equal(buildBusinessClaimContext(largeGeneral),null);
assert.equal(buildReplyReviewFormat(largeGeneral).json_schema.schema.properties.businessClaimAudit,undefined,'general background cannot suppress its whole-reply review by overflowing the policy audit');
const largeBusiness={...largeGeneral,searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business'}};
assert.equal(buildBusinessClaimContext(largeBusiness).bounded,false,'real business and mixed policy evidence keeps the original over-budget fail-closed bound');
let sentForLargeBusiness=0;
const blockedLargeBusiness=await assessReplyBoundary({...largeBusiness,fetchImpl:async()=>{sentForLargeBusiness++;throw Error('must fail closed before model');}});
assert.equal(blockedLargeBusiness.reviewStatus,'unavailable');assert.equal(sentForLargeBusiness,0);
for(const [text,supported] of [['Your package has cleared customs in the U.S.',false],['This term usually describes arrival in the destination country, without confirming customs clearance or a delivery date.',true]]){
 let calls=0;
 const result=await assessReplyBoundary({...largeGeneral,text,speechText:text,fetchImpl:async(_url,request)=>{
 calls++;const body=JSON.parse(request.body);assert(body.messages.some(m=>m.content.includes('actual destination country')));
 assert.equal(body.response_format.json_schema.schema.properties.businessClaimAudit,undefined);
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({allowed:supported,confidence:1,boundarySupported:true,businessFactsSupported:supported})}}]}));}});
 assert.equal(calls,1);assert.equal(result.reviewStatus,'valid');assert.equal(result.allowed,supported);
}
console.log('large unrelated general-reference regression passed: general keeps whole factual review; actual business/mixed policy audit remains bounded and fail closed');

for (const state of ['skipped','failed','accepted','rejected']) {
 const reason = state === 'skipped' ? 'ineligible' : state === 'failed' ? 'recovery_failed' : 'reviewed';
 const evt=buildReplyReviewLogEvent({reviewStatus:'valid',failedContracts:['confidence','business_facts','guidance','boundary','language'],guardApplied:true,complaintRepair:{state,reason}, languageDiagnostics:{repairKind:'grounded',repairState:'rejected',languageIssueTypes:['grammar','coherence','spelling'],initialLanguageIssueTypes:['grammar','coherence'],initialFailedContracts:['confidence','business_facts','guidance','boundary','language']},reviewProtocol:{initial:['claim_consistency','claim_references'],corrected:['claim_consistency','claim_references']}});
 assert(evt.errorMessage.length<=500);assert.deepEqual(JSON.parse(evt.errorMessage).complaintRepair,{state,reason});
}
assert.equal(JSON.parse(buildReplyReviewLogEvent({complaintRepair:{state:'private text',reason:'private text'}}).errorMessage).complaintRepair,undefined);
console.log('complaint repair diagnostic finite values and log bounds passed');
const complaintAuditOptions = { businessFactsRequired: true, text: 'You reported the size was small.', speechText: 'You reported the size was small.',
  complaintUserReports: ['My 3XL was too small.', ...Array.from({ length: 22 }, (_, i) => `follow-up ${i}`), 'x'.repeat(1800) + ' tail fact', 'I meant 2XL.'],
  userText: 'I meant 2XL.', recentUserMessages: ['My 3XL was too small.', ...Array.from({ length: 5 }, (_, i) => `follow-up ${i}`)],
  searchIntent: { commerceRoute: 'store_policy', knowledgeScope: 'business', unresolvedUserComplaint: true },
  knowledgeContext: { ok: true, customerServiceIntent: true, items: [], businessOwner: { siteId: 'shop', characterId: 'mascot' } },
  catalogueOwner: { trustedSite: { id: 'shop' }, character: { id: 'mascot' } } };
const complaintAuditContext = buildBusinessClaimContext(complaintAuditOptions);
assert(complaintAuditContext.references.some(r => r.kind === 'user_report' && r.text.includes('3XL')));
assert.equal(complaintAuditContext.references.filter(r => r.kind === 'user_report').at(-1).text, 'I meant 2XL.');
assert.equal(complaintAuditContext.references.filter(r => r.kind === 'user_report').length, 25);
assert(complaintAuditContext.references.some(r => r.text.endsWith(' tail fact')));
assert.equal(complaintAuditContext.bounded, true);
const ordinaryAuditContext = buildBusinessClaimContext({ ...complaintAuditOptions, searchIntent: { ...complaintAuditOptions.searchIntent, unresolvedUserComplaint: false } });
assert(!ordinaryAuditContext.references.some(r => r.kind === 'user_report' && r.text.includes('3XL')));
for (const [bad,expected] of [
 [ok.map(x=>({...x,referenceIds:[]})), 'supported factual unit had no reference IDs'],
 [ok.map(x=>({...x,factual:false,referenceIds:[context.references[0].id]})), 'nonfactual unit had reference IDs'],
]) {
 const requests=[];const result=await assessReplyBoundary({...options,config:providers,fetchImpl:async (_url,req)=>{
  requests.push(JSON.parse(req.body));const val=requests.length===1?{...good,businessClaimAudit:bad}:good;
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(val)}}]}));}});
 assert.equal(requests.length,2);assert.equal(result.reviewStatus,'valid');
 assert(!JSON.stringify(requests[0]).includes(expected));assert(JSON.stringify(requests[1]).includes(expected));
}
console.log('protocol correction scoped to existing fallback provider and preserves complete review');
