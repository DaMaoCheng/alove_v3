import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('No external calls in language clarification self-check')};
const {enforceReplyBoundary,assessReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const {assessIndependentLanguageQuality}=await import('../server/chat-language-quality-service.js');
const {canReviewLanguageClarification,reviewedLanguageClarification,reviewedLanguageClarificationPurpose,resolveReviewedReplyVoiceLanguage,withLanguageClarificationRecovery,languageClarificationRecoveryProof}=await import('../server/chat-language-clarification-policy.js');
const {buildReplyReviewFormat}=await import('../server/chat-reply-review-contracts.js');
const {applySessionLanguagePreference,upsertPersonaLanguageSetting}=await import('../server/chat-language-preference-service.js');
const {buildQuestions}=await import('../server/jev-intent-service.js');
const config={apiKey:'fixture-only',model:'fixture-only',baseUrl:'https://fixture.invalid/v1',apiMode:'chat_completions'};
const input='No speak spanish';
const candidate='No problem. Which language would you prefer?';
const marker={purposeSupported:true,supported:true,targetCode:'en',evidence:input};
const vote={allowed:true,confidence:.99,boundarySupported:true,factualSupported:true,evidenceSupported:true,guidanceSupported:true,
 businessFactsSupported:true,productScopeSupported:true,candidateConfirmationSupported:true,imageStatusSupported:true,guestBenefitSupported:true};
const clock={required:false,status:'not_required',asOfUtc:'2026-10-20T00:00:00Z',searched:false,items:[]};
const base={requireIdentityReview:true,independentLanguageQualityRequired:true,languageQualityRequired:true,
 character:{id:'language-fixture',name:'Fixture'},userText:input,language:'es',factualContext:clock,
 searchIntent:{commerceRoute:'chat',knowledgeScope:'general',shouldLoadProductContext:false,cardAllowed:false},
 replyResult:{text:candidate,displayText:candidate,speechText:candidate,sourceType:'ai',voiceMeta:{languageCode:'es',languageLabel:'Spanish',voiceId:'same-voice',model:'same-model'}},
 recordReview:async()=>{}};
let checks=0;
const check=(ok,why)=>{assert(ok,why);checks++};
async function run({primary={...vote,languageClarification:marker},qualityPass=true,patch={},expectedTarget='en',expectedEligible=true,expectedProof=expectedTarget==='en'}={}){
 let primaryCalls=0,languageCalls=0;
 const output=await enforceReplyBoundary({...base,...patch,
  assess:options=>assessReplyBoundary({...options,config,recordLog:async()=>{},fetchImpl:async(_url,request)=>{
   primaryCalls++;const body=JSON.parse(request.body);const packet=JSON.parse(body.messages.at(-1).content);
   check(Boolean(packet.languageClarificationEligible)===expectedEligible,'only qualified pure turns receive the exception review');
   check(Boolean(body.response_format.json_schema.schema.properties.languageClarification)===expectedEligible,'schema matches server qualification');
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(primary)}}]}),{headers:{'content-type':'application/json'}});
  }}),
  assessLanguageQuality:options=>assessIndependentLanguageQuality({...options,config,recordLog:async()=>{},fetchImpl:async(_url,request)=>{
   languageCalls++;const body=JSON.parse(request.body);const packet=JSON.parse(body.messages.at(-1).content);
   check(packet.activeLanguage===expectedTarget,'language target changes only after complete primary acceptance and evidence');
   check(Boolean(packet.languageClarification)===expectedProof,'exception proof reaches independent semantic relevance check');
   if(expectedProof)check(body.messages[0].content.includes('Independently recheck its relevance'),'second reviewer must independently check preference-only relevance');
   const result={languageQualitySupported:qualityPass,retainedLanguageQualitySupported:false,languageQualityConfidence:qualityPass?.54:.99,
    languageIssues:qualityPass?[]:[{type:'unverifiable',field:'both',severity:'major',span:''}]};
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{headers:{'content-type':'application/json'}});
  }}),
 });
 check(primaryCalls===1&&languageCalls===1,'one original primary and one original language review; no added model call');
 return output;
}
const accepted=await run();
check(accepted.text===candidate&&accepted.speechText===candidate,'both original candidate channels survive complete approval');
check(accepted.voiceMeta.languageCode==='en'&&accepted.voiceMeta.languageLabel==='English','only accepted message voice language follows approved target');
check(accepted.voiceMeta.voiceId==='same-voice'&&accepted.voiceMeta.model==='same-model','speaker and model remain unchanged');
check(base.replyResult.voiceMeta.languageCode==='es','original metadata is not mutated');
const exactThreshold=await run({primary:{...vote,confidence:.8,languageClarification:marker}});
check(exactThreshold.voiceMeta.languageCode==='en','primary .8 and independent language .54 remain distinct thresholds');
for(const primary of [
 {...vote}, {...vote,confidence:.799,languageClarification:marker}, {...vote,allowed:false,languageClarification:marker},
 {...vote,boundarySupported:false,languageClarification:marker},{...vote,factualSupported:false,languageClarification:marker},
 {...vote,languageClarification:{...marker,targetCode:'xx'}},{...vote,languageClarification:{...marker,evidence:'An old assistant statement'}},
 {...vote,languageClarification:{...marker,evidence:''}},{...vote,languageClarification:{...marker,supported:'true'}},
]){
 const rejected=await run({primary,qualityPass:false,expectedTarget:'es'});
 check(rejected.text!==candidate,'missing, weak, rejected or malformed primary evidence cannot release the English candidate');
 check(rejected.voiceMeta?.languageCode!=='en','failed exception cannot change voice language');
}
const irrelevant=await run({qualityPass:false});
check(irrelevant.text!==candidate&&irrelevant.voiceMeta?.languageCode!=='en','independent semantic relevance rejection cannot be bypassed by primary approval');
const normalText='¡Hola! Me alegra verte.';
const ordinary=await run({primary:{...vote,languageClarification:{purposeSupported:false,supported:false,targetCode:'',evidence:''}},expectedTarget:'es',
 patch:{userText:'Hi',replyResult:{...base.replyResult,text:normalText,displayText:normalText,speechText:normalText}}});
check(ordinary.text===normalText&&ordinary.voiceMeta.languageCode==='es','ordinary foreign input retains normal configured-language review');
const huInput='Nem értem ezt a nyelvet.';
const huText='Melyik nyelven szeretnél beszélgetni?';
const hu=await run({primary:{...vote,languageClarification:{purposeSupported:true,supported:true,targetCode:'hu',evidence:huInput}},expectedTarget:'hu',expectedProof:true,
 patch:{userText:huInput,replyResult:{...base.replyResult,text:huText,speechText:huText}}});
check(hu.voiceMeta.languageCode==='hu','supported target handling is language-independent, not an English exception');
const frenchText='Bien sûr, voici ma réponse.';
const explicit=await run({primary:{...vote,languageClarification:{purposeSupported:false,supported:false,targetCode:'',evidence:''}},expectedTarget:'fr',expectedProof:false,
 patch:{userText:'Reply in French.',language:'fr',replyResult:{...base.replyResult,text:frenchText,speechText:frenchText,voiceMeta:{...base.replyResult.voiceMeta,languageCode:'fr',languageLabel:'French'}}}});
check(explicit.text===frenchText&&explicit.voiceMeta.languageCode==='fr','explicit resolved language answers directly without a clarification override');
const explicitRejected=await run({primary:{...vote,languageClarification:{...marker,evidence:'Reply in French.'}},qualityPass:false,
 patch:{userText:'Reply in French.',language:'fr',replyResult:{...base.replyResult,voiceMeta:{...base.replyResult.voiceMeta,languageCode:'fr'}}}});
check(explicitRejected.text!==candidate&&explicitRejected.voiceMeta?.languageCode!=='en','independent relevance rejects an exception to an explicit target even if primary is wrong');
const injected=await run({primary:{...vote},qualityPass:false,expectedTarget:'es',expectedProof:false,
 patch:{replyResult:{...base.replyResult,languageClarification:marker}}});
check(injected.text!==candidate,'reply metadata cannot inject its own language approval');
const eligibleOptions={...base,boundaryReviewRequired:true,dedicatedLanguageReview:true};
check(canReviewLanguageClarification(eligibleOptions),'pure chat can offer a semantic review, never preapprove a barrier');
for(const patch of [
 {searchIntent:{...base.searchIntent,commerceRoute:'store_policy',knowledgeScope:'business'}},
 {searchIntent:{...base.searchIntent,commerceRoute:'product_search',cardAllowed:true}},
 {searchIntent:{...base.searchIntent,scopeUnverified:true}},{searchIntent:{...base.searchIntent,productScopePending:true}},
 {searchIntent:{...base.searchIntent,productRequestState:{status:'pending'}}},
 {searchIntent:{...base.searchIntent,productRequestState:{status:'selected'}}},
 {searchIntent:{...base.searchIntent,productCandidateState:{status:'active'}}},
 {productContext:{products:[{id:'product',name:'shirt'}]}},{knowledgeContext:{items:[{id:'policy'}]}},
 {knowledgeContext:{customerServiceIntent:true}},{orderActionCandidate:{}},{feedbackActionCandidate:{}},{chatImageContext:{}},
 {guestBenefitContext:{}},{checkoutContext:{}},{factualContext:{...clock,required:true}},
 {replyResult:{...base.replyResult,discountOfferReply:true}},{replyResult:{...base.replyResult,sourceRef:'ai-request-fallback'}},
 {boundaryReviewRequired:false},{dedicatedLanguageReview:false},
])check(!canReviewLanguageClarification({...eligibleOptions,...patch}),'mixed, scoped, factual or unreviewed turn cannot acquire the exception');
const contextless=reviewedLanguageClarification({...vote,languageClarification:marker},{eligible:false,primaryAccepted:true,userText:input});
check(contextless===null,'a model field cannot self-enable qualification');
check(!buildReplyReviewFormat({independentLanguageReview:true}).json_schema.schema.properties.languageClarification,'unqualified calls retain their original schema');
const session={id:'session-fixture',preferred_language:'Spanish'};
let writes=0;
const preference=await applySessionLanguagePreference({execute:async()=>{writes++;throw Error('No preference DB write allowed');}},
 {character:{id:'language-fixture',profile_json:'{"language":"Spanish"}'},session,userText:input,jevDecision:{ok:true,languageDecision:null}});
check(writes===0&&session.preferred_language==='Spanish'&&preference.languageCode==='es','message exception never writes session or activation language');
const following=await run({primary:{...vote,languageClarification:{purposeSupported:false,supported:false,targetCode:'',evidence:''}},expectedTarget:'es',
 patch:{userText:'Hola',language:preference.languageCode,replyResult:{...base.replyResult,text:normalText,speechText:normalText}}});
check(following.voiceMeta.languageCode==='es','next turn starts with configured preference, not previous message exception');
check(!buildQuestions().reply_language.instructions.includes('communication barrier')&&buildQuestions().reply_language.criteria.en==='Explicitly requests the assistant output in English.','JEV remains original explicit-only; no added state/questions/threshold relaxation');
// Execute the actual guest final voice metadata expression with a pure identity
// guestVoiceMeta seam, so persistence cannot silently overwrite the approved target.
const guestSource=await readFile(new URL('../server/guest-reply-service.js',import.meta.url),'utf8');
const voiceStart=guestSource.indexOf('    const replyVoice = await reserveAiReplyVoiceAssetForDb(db, {');
const voiceEnd=guestSource.indexOf('      deterministic: true,',voiceStart);
check(voiceStart>=0&&voiceEnd>voiceStart,'actual guest reserve voice block is present');
const metaExpression=guestSource.slice(voiceStart,voiceEnd).match(/voiceMeta: (guestVoiceMeta\([\s\S]*\}\)),\s*$/)?.[1];
check(Boolean(metaExpression),'extract actual guest voice metadata expression');
function guestPersistedMeta(reply) {
 return vm.runInNewContext(metaExpression,{reply,languagePreference:preference,promptCharacter:{},voiceModelMode:'fixture',
  resolveReviewedReplyVoiceLanguage,guestVoiceMeta:(_character,_mode,meta)=>meta});
}
const finalAccepted=guestPersistedMeta(accepted);
check(finalAccepted.languageCode==='en'&&finalAccepted.languageLabel==='English','actual guest final persistence retains the whole-approved message target');
check(finalAccepted.voiceId==='same-voice'&&finalAccepted.model==='same-model','actual guest composition preserves speaker/model metadata');
for(const fakeReply of [base.replyResult,{...accepted},JSON.parse(JSON.stringify(accepted)),
 {...base.replyResult,voiceMeta:{...base.replyResult.voiceMeta,languageCode:'en',languageLabel:'English'},languageClarification:marker},
 {...base.replyResult,verifiedLanguageTarget:'en',reviewedVoiceLanguage:'en'}]) {
 check(guestPersistedMeta(fakeReply).languageCode==='es','model metadata, serialized or cloned replies cannot forge server-only provenance');
}
check(guestPersistedMeta(following).languageCode==='es','actual following guest turn returns to session preference');
check(guestPersistedMeta(irrelevant).languageCode==='es','rejected whole-output review cannot override guest voice language');
const originalGuidance="Language guidance: Use Spanish as the configured output language. Do not change output language just because the user's message is written in another language. Change language only when the user explicitly asks you to reply, speak, or write in a specific language.";
const migrated=upsertPersonaLanguageSetting(`Existing persona.\n\n${originalGuidance}`,'English');
const repeated=upsertPersonaLanguageSetting(migrated,'Spanish');
check(migrated.startsWith('Existing persona.')&&repeated.startsWith('Existing persona.'),'language guidance migration preserves original persona');
check((migrated.match(/Language guidance:/g)||[]).length===1&&(repeated.match(/Language guidance:/g)||[]).length===1,'old and new canonical guidance are each deduplicated');
check(repeated.includes('Use Spanish as the configured output language')&&!repeated.includes('Use English as the configured output language'),'repeat application replaces the previous target');
check(repeated.includes('Do not change output language just because')&&repeated.includes('after complete review; it never changes this configured language'),'ordinary foreign input remains configured; only reviewed current-turn clarification is exempt');
const {buildReplyPurposeRecoveryPrompt}=await import('../server/chat-reply-purpose-service.js');
const recoveryPrompt=buildReplyPurposeRecoveryPrompt({systemPrompt:'Original global rules',layers:[]},{kind:'purpose',purpose:'conversation',failedContracts:['language']});
check(recoveryPrompt.systemPrompt.includes('same narrowly bounded current-turn language-preference clarification exception')&&recoveryPrompt.systemPrompt.includes('complete review of the fresh candidate'),'ordinary recovery respects the same exception without waiving fresh review');
// Reproduce the actual page failure class: a valid primary barrier verdict,
// an independent protocol rejection, then exactly one fresh candidate. The
// primary proof guides generation but never approves the new complete output.
async function recoverBarrier({freshPrimary={...vote,languageClarification:marker},freshLanguagePass=true,
 freshText=candidate,initialProof=true,initialPrimary=null,initialLanguage=null,extraPatch={}}={}) {
 let primaryCalls=0,languageCalls=0,generations=0;const emitted=[];
 const output=await enforceReplyBoundary({...base,
  replyResult:{...base.replyResult,text:'Podemos hablar en otro idioma.',speechText:'Podemos hablar en otro idioma.'},...extraPatch,
  assess:async()=>{primaryCalls++;return primaryCalls===1?(initialPrimary||{...vote,...(initialProof?{languageClarification:marker}:{})}):freshPrimary},
  assessLanguageQuality:async options=>{languageCalls++;
   if(languageCalls===1)return initialLanguage||{reviewStatus:'invalid_fields',protocolFailure:'span_mismatch'};
   check(options.retainedText==='', 'trusted preference recovery never treats an incomplete retained fragment as fulfillment');
   return {reviewStatus:'valid',confidence:.99,languageQualitySupported:freshLanguagePass,retainedLanguageQualitySupported:true,
    languageIssues:freshLanguagePass?[]:[{type:'wrong_language',field:'both',severity:'major',span:freshText}],severity:freshLanguagePass?'none':'major'};
  },
  regenerateReply:async(_previous,recovery)=>{
   generations++;
   const proof=languageClarificationRecoveryProof(recovery,input);
   check(Boolean(proof)===initialProof,'only validated server primary proof reaches current generation purpose');
   if(initialProof){
    const prompt=buildReplyPurposeRecoveryPrompt({systemPrompt:'Original rules',layers:[]},recovery);
    check(prompt.systemPrompt.includes('Generate this one fresh candidate in en: only a question asking which language'),'fresh generation receives usable target and bounded preference question');
    check(prompt.systemPrompt.includes('pass the original independent reviews anew'),'generation purpose never replaces final review');
    check(languageClarificationRecoveryProof({...recovery})===null&&languageClarificationRecoveryProof(JSON.parse(JSON.stringify(recovery)))===null,'copied or serialized recovery JSON cannot carry server provenance');
    check(languageClarificationRecoveryProof(recovery,'Different user question')===null,'recovery proof remains bound to current user evidence');
   }
   return {...base.replyResult,text:freshText,displayText:freshText,speechText:freshText};
  },
  recordReview:async event=>emitted.push(event),
 });
 check(primaryCalls===2&&languageCalls===2&&generations===1,`original two complete reviews with one fresh generation, no additional calls (${primaryCalls}/${languageCalls}/${generations}; ${JSON.stringify(emitted)})`);
 return output;
}
const recoveredBarrier=await recoverBarrier();
check(recoveredBarrier.text===candidate&&guestPersistedMeta(recoveredBarrier).languageCode==='en','only newly whole-approved recovered preference question receives target voice');
const fragment='Understood.';
const rejectedFragment=await recoverBarrier({freshPrimary:{...vote,allowed:false,boundarySupported:false,
 languageClarification:{purposeSupported:false,supported:false,targetCode:'',evidence:''},retainedText:fragment,retainedTextAllowed:true,retainedBoundarySupported:true},freshText:fragment});
check(rejectedFragment.text!==fragment&&rejectedFragment.partialAnswerRetained!==true,'a retained acknowledgment cannot replace the required preference question');
for(const freshPrimary of [{...vote}, {...vote,languageClarification:{...marker,targetCode:'hu'}},
 {...vote,confidence:.799,languageClarification:marker}]) {
 const failed=await recoverBarrier({freshPrimary});
 check(failed.text!==candidate&&guestPersistedMeta(failed).languageCode==='es','fresh missing/mismatched/low primary proof never inherits first verdict approval');
}
const freshWrong=await recoverBarrier({freshLanguagePass:false});
check(freshWrong.text!==candidate&&guestPersistedMeta(freshWrong).languageCode==='es','independent fresh rejection still blocks after trusted generation purpose');
const tooLong=await recoverBarrier({freshText:'A'.repeat(401)});
check(tooLong.text!=='A'.repeat(401),'new out-of-scope candidate cannot evade required purpose by losing eligibility');
const plainPacket={kind:'purpose',purpose:'conversation',failedContracts:['language'],languageClarification:marker};
check(languageClarificationRecoveryProof(withLanguageClarificationRecovery(plainPacket,marker))===null,'arbitrary model-shaped primary JSON cannot create a recovery purpose');
check(!buildReplyPurposeRecoveryPrompt({systemPrompt:'Original rules',layers:[]},plainPacket).systemPrompt.includes('Generate this one fresh candidate in en:'),'ordinary recovery JSON gets no target override');
const {LANGUAGE_CLARIFICATION_REVIEW_CONTRACT,LANGUAGE_CLARIFICATION_QUALITY_CONTRACT,LANGUAGE_CLARIFICATION_SCHEMA}=await import('../server/chat-language-clarification-policy.js');
const {buildGlobalReplyPolicyLayer}=await import('../server/chat-global-reply-policy.js');
const globalPolicy=buildGlobalReplyPolicyLayer({}).content;
for(const contract of [LANGUAGE_CLARIFICATION_REVIEW_CONTRACT,LANGUAGE_CLARIFICATION_QUALITY_CONTRACT,globalPolicy]) {
 check(contract.includes('configured response language is not understandable')&&contract.includes('rejected'),'same current-language inability/rejection meaning across all three canonical contracts');
 check(contract.includes('non-native fragments')&&contract.includes('omitted subjects'),'non-native ellipsis is assessed semantically, without examples or wordlists');
 check(contract.includes('question is required')&&contract.includes('acknowledgement is optional'),'preference question required, not an acknowledgment template');
 check(contract.includes('some other language')&&contract.includes('ordinary foreign')&&contract.includes('third-person'),'other-language rejection, ordinary foreign input and reported/hypothetical speech remain insufficient');
}
const terse=await run({patch:{replyResult:{...base.replyResult,text:'Would you prefer English?',speechText:'Would you prefer English?'}}});
check(terse.text==='Would you prefer English?'&&guestPersistedMeta(terse).languageCode==='en','a fully double-approved preference question needs no prefixed acknowledgment');
for(const userText of ['I do not understand the configured response language.','I reject using the configured language for this conversation.']) {
 const positive=await run({primary:{...vote,languageClarification:{...marker,evidence:userText}},patch:{userText}});
 check(positive.text===candidate,'current language inability/rejection can be considered only after the same two original reviews');
}
for(const userText of ['I reject a different language.','They said they cannot understand this language.','Imagine someone does not understand this language.','A greeting in another language.','Please reply in French.']) {
 const negative=await run({primary:{...vote,languageClarification:{purposeSupported:false,supported:false,targetCode:'',evidence:''}},expectedTarget:'es',expectedProof:false,
  patch:{userText,replyResult:{...base.replyResult,text:normalText,speechText:normalText}}});
 check(negative.voiceMeta.languageCode==='es','other-language/quote/hypothetical/foreign/explicit-target cases cannot acquire an unapproved exception');
}
const userPurposeOnly={...vote,allowed:false,boundarySupported:false,languageClarification:{...marker,supported:false}};
const correctedWrongCandidate=await recoverBarrier({initialPrimary:userPurposeOnly,
 initialLanguage:{reviewStatus:'valid',confidence:.95,languageQualitySupported:true,languageIssues:[]}});
check(correctedWrongCandidate.text===candidate&&guestPersistedMeta(correctedWrongCandidate).languageCode==='en','a rejected wrong-language/extra-answer candidate no longer blocks its independently proven USER purpose from guiding one fresh output');
const generalReference={ok:true,customerServiceIntent:false,source:'local',strategy:'general_relevant_reference',items:[{id:'general-background',category:'football',content:'Unrelated background text'}]};
check(canReviewLanguageClarification({...eligibleOptions,knowledgeContext:generalReference}),'general-only references may offer a user-purpose review, never prove a request');
const correctedWithGeneral=await recoverBarrier({initialPrimary:userPurposeOnly,extraPatch:{knowledgeContext:generalReference}});
check(correctedWithGeneral.text===candidate,'irrelevant general background does not lock a proven pure language purpose out of one fresh reviewed question');
for(const knowledgeContext of [
 {...generalReference,customerServiceIntent:true},{...generalReference,source:'brave_web'},
 {...generalReference,items:[{category:'customer_service',content:'Store policy'}]},
 {...generalReference,customerServiceIntent:undefined},
])check(!canReviewLanguageClarification({...eligibleOptions,knowledgeContext}),'business/customer service/brave/unknown provenance references cannot acquire the purpose review');
for(const patch of [
 {languageClarification:{...marker,purposeSupported:false}},
 {languageClarification:{supported:true,targetCode:'en',evidence:input}},
 {languageClarification:{...marker,purposeSupported:'true'}},
 {languageClarification:{...marker,supported:undefined}},
 {confidence:.799},{languageClarification:{...marker,evidence:'old unrelated evidence'}},
])check(reviewedLanguageClarificationPurpose({...vote,...patch},{eligible:true,primaryReviewValid:true,userText:input})===null,'missing/malformed/low/unsupported purpose cannot guide fresh generation');
check(reviewedLanguageClarificationPurpose(userPurposeOnly,{eligible:true,primaryReviewValid:false,userText:input})===null,'protocol failure cannot create a USER purpose even with plausible model fields');
check(reviewedLanguageClarification(userPurposeOnly,{eligible:true,primaryAccepted:true,userText:input})===null,'purpose true with candidate false never grants output or voice approval');
for(const freshPrimary of [
 {...vote,languageClarification:{...marker,purposeSupported:false}},
 {...vote,languageClarification:{supported:true,targetCode:'en',evidence:input}},
]) {
 const rejected=await recoverBarrier({initialPrimary:userPurposeOnly,freshPrimary});
 check(rejected.text!==candidate&&guestPersistedMeta(rejected).languageCode==='es','fresh candidate must independently reprove USER purpose as well as completion before release');
}
check(LANGUAGE_CLARIFICATION_REVIEW_CONTRACT.includes('independently of the candidate')&&LANGUAGE_CLARIFICATION_REVIEW_CONTRACT.includes('concurrent substantive question'),'single existing primary call separates USER purpose from candidate support and excludes mixed requests');
check(LANGUAGE_CLARIFICATION_SCHEMA.required.includes('purposeSupported'),'USER-purpose field is required in the same bounded schema');
for(const patch of [{allowed:undefined},{boundarySupported:'true'}])check(reviewedLanguageClarificationPurpose({...vote,languageClarification:marker,...patch},{eligible:true,primaryReviewValid:true,userText:input})===null,'missing or malformed primary core votes cannot create a trusted purpose');
const inconsistentOld=await recoverBarrier({initialPrimary:{...vote,languageClarification:{...marker,supported:false}},
 initialLanguage:{reviewStatus:'valid',confidence:.95,languageQualitySupported:true,languageIssues:[]}});
check(inconsistentOld.text===candidate,'USER purpose with candidate=false cannot leak through an inconsistent allowed=true or original-language pass');
// Exact initial-retention regression independently red against the frozen
// before-source: a retained acknowledgment must not masquerade as fulfillment
// when the single fresh generation is unavailable.
let unavailableFreshCalls=0;
const initialRetained=await enforceReplyBoundary({...base,
 replyResult:{text:'Entendido.\n\nThis jersey was invented in 1492.',speechText:'Entendido. This jersey was invented in 1492.',sourceType:'ai'},
 assess:async()=>({...vote,allowed:false,factualSupported:false,retainedBoundarySupported:true,retainedFactualSupported:true,
  retainedText:'Entendido.',retainedTextAllowed:true,languageClarification:{...marker,supported:false}}),
 assessLanguageQuality:async()=>({reviewStatus:'valid',confidence:.99,languageQualitySupported:false,
  retainedLanguageQualitySupported:true,languageIssues:[{type:'wrong_language',field:'both',severity:'major',span:'This jersey'}],severity:'major'}),
 regenerateReply:async()=>{unavailableFreshCalls++;return null;},recordReview:async()=>{},
});
check(unavailableFreshCalls===1,'a failed initial bounded purpose gets at most one fresh generation even when unavailable');
check(initialRetained.text!=='Entendido.'&&initialRetained.partialAnswerRetained!==true,'approved retained acknowledgment cannot replace the complete preference question after fresh failure');
check(!initialRetained.text.includes('invented in 1492')&&guestPersistedMeta(initialRetained).languageCode==='es','unverified original claim and language override do not leak on failed recovery');
console.log(`language clarification self-check passed: ${checks} checks; actual primary/independent parsers and full boundary wiring, injected transport only, no DB/network`);
