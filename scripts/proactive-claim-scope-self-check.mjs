import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {PROACTIVE_GROUNDING_CONTRACT,classifyProactiveContent,inspectProactiveCandidateQuality,resolveProactiveCandidate}=await import('../server/proactive-content-policy-service.js');
const {buildReviewedProactiveCandidate}=await import('../server/proactive-message-job-service.js');
const recentMessages=[{id:'user_fixture',senderType:'user',text:'Hello!',sentAt:'2026-10-20T01:00:00.000Z'}];
const config={apiKey:'isolated-fixture',model:'fixture-reviewer',baseUrl:'https://fixture.invalid/v1',apiMode:'chat_completions'};
const neutral={state:'neutral',candidateKind:'care',confidence:.95,quality:{natural:true,grounded:true,novel:true},groundingEvidence:[]};
let checks=0,requests=0;
const check=(ok,message)=>{assert(ok,message);checks++;};
check(PROACTIVE_GROUNDING_CONTRACT.includes('Grounding evaluates factual assertions and presuppositions'),'shared contract distinguishes factual claims/presuppositions from merely introducing a topic');
check(PROACTIVE_GROUNDING_CONTRACT.includes('empty groundingEvidence array is valid')&&PROACTIVE_GROUNDING_CONTRACT.includes('not automatic approval'),'claim-free evidence is valid without becoming an automatic pass');
async function review(text,reply){
 let body;
 const decision=await classifyProactiveContent({recentMessages,candidateText:text,language:'en',config,recordProviderCallFn:async()=>{},recordDecisionLogFn:async()=>{},
  fetchImpl:async(_url,options)=>{requests++;body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(reply)}}]})};}});
 check(body.messages[0].content.includes(PROACTIVE_GROUNDING_CONTRACT),'actual audit receives the same complete shared grounding principle');
 const shape=body.messages[0].content.slice(body.messages[0].content.indexOf('Return JSON '),body.messages[0].content.indexOf('For a proposed candidate'));
 check(shape.includes('groundingEvidence:')&&['candidateQuote','sourceMessageId','sourceQuote'].every(key=>shape.includes(key)),'formal response shape includes the existing required evidence array and record fields');
 check(body.messages[0].content.includes('catalogue availability claims')&&body.messages[0].content.includes('same invitation'),'catalogue evidence and semantic novelty restrictions remain present');
 return decision;
}
const positive=await review('Would you like to chat?',neutral);
check(inspectProactiveCandidateQuality({decision:positive}).allowed,'an actually approved claim-free question with [] remains approved');
for(const key of ['natural','grounded','novel']){
 const rejected=await review('A candidate under review.',{...neutral,quality:{...neutral.quality,[key]:false}});
 check(!inspectProactiveCandidateQuality({decision:rejected}).allowed,`empty citations never override a ${key} rejection`);
}
const unsupported=await review('The shop has your preferred kit waiting.',{...neutral,quality:{...neutral.quality,grounded:false}});
check(!inspectProactiveCandidateQuality({decision:unsupported}).allowed,'an unsupported availability assertion remains rejected despite []');
const presupposed=await review('How are preparations for your event today?',{...neutral,quality:{...neutral.quality,grounded:false}});
check(!inspectProactiveCandidateQuality({decision:presupposed}).allowed,'a question with an unsupported personal/event presupposition remains rejected');
const missing={...neutral};delete missing.groundingEvidence;
const invalid=await review('Would you like to chat?',missing);
check(invalid.groundingFailure==='missing_evidence'&&!inspectProactiveCandidateQuality({decision:invalid}).allowed,'required evidence protocol is not removed for generic questions');
const afterSales=await review('Would you like to browse another shirt?',{...neutral,state:'unresolved_after_sales',candidateKind:'shopping'});
check(resolveProactiveCandidate({text:'Would you like to browse another shirt?',decision:afterSales,recentMessages}).replaced,'claim-free shopping text still cannot override the original after-sales state');
let generations=0,audits=0;
const built=await buildReviewedProactiveCandidate({character:{id:'mascot_fixture'},recentMessages,state:{state:'neutral'},language:'en',proactiveHistory:[],
 generateReply:async({promptContext})=>{generations++;check(promptContext.systemPrompt.includes(PROACTIVE_GROUNDING_CONTRACT),'actual generation receives the complete same shared principle');return {text:generations===1?'Would you like to chat?':'What do you enjoy about football?'};},
 classifyContent:async({candidateText})=>{audits++;return review(candidateText,{...neutral,quality:{...neutral.quality,novel:audits>1}});}});
check(built.allowed&&generations===2&&audits===2,'first novelty rejection still uses the original bounded regeneration, not reapproval');
check(requests===10,'principle clarification adds no review calls');
console.log(`proactive claim scope self-check passed: ${checks} checks; isolated generator/transport responses, no DB/network/models`);
