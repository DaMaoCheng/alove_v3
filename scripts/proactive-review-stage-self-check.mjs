import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {classifyProactiveContent,assessProactiveContent,inspectProactiveCandidateQuality,resolveProactiveCandidate}=await import('../server/proactive-content-policy-service.js');
const config={apiKey:'isolated-fixture',baseUrl:'https://fixture.invalid/v1',model:'fixture-reviewer',apiMode:'chat_completions'};
const recentMessages=[{id:'real-fixture-user',senderType:'user',text:'How are you?',sentAt:'2026-10-20T01:00:00.000Z'}];
let calls=0,checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
const review=async({candidateText='',reply,expectedStage,context=recentMessages})=>{
 let observed;
 const decision=await classifyProactiveContent({
  recentMessages:context,candidateText,language:'en',config,recordProviderCallFn:async()=>{},recordDecisionLogFn:async()=>{},
  fetchImpl:async(_url,options)=>{
   calls++;observed=JSON.parse(options.body);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(reply)}}]})};
  },
 });
 // Assert after the request: the production fail-closed catch must not swallow
 // an assertion inside a fake transport and disguise a wiring failure as a vote.
 const packet=JSON.parse(observed.messages[1].content),system=observed.messages[0].content;
 check(packet.reviewStage===expectedStage,'actual request explicitly labels the current state/candidate stage');
 check(packet.proposedProactiveMessage===candidateText,'stage labeling does not rewrite user or candidate text');
 check(system.includes(expectedStage),'system contract receives the same derived stage');
 check(system.includes('proposed proactive message cannot establish shopping intent'),'candidate never establishes shopping state');
 if(expectedStage==='state_classification')check(system.includes('confidence concerns only the USER conversation-state classification')&&system.includes('Do not lower state confidence'),'empty candidate quality is not a state-confidence penalty');
 else check(system.includes('confidence concerns your assessment of the actual proposed candidate')&&system.includes('whether approving or rejecting it'),'candidate confidence measures verdict certainty, including a justified rejection');
 return decision;
};
const stateReply={state:'neutral',candidateKind:'care',confidence:.95,quality:{natural:false,grounded:false,novel:false}};
const state=await review({reply:stateReply,expectedStage:'state_classification'});
check(state.state==='neutral'&&state.confidence===.95,'confident USER state survives required but nonapplicable false candidate votes');
check(!inspectProactiveCandidateQuality({decision:state}).allowed,'an initial state assessment never becomes candidate approval');
const whitespace=await review({candidateText:'   ',reply:stateReply,expectedStage:'state_classification'});
check(whitespace.state==='neutral','whitespace-only input still has no candidate to assess');
const passing={state:'neutral',candidateKind:'care',confidence:.95,quality:{natural:true,grounded:true,novel:true},groundingEvidence:[]};
const positive=await review({candidateText:'How has your day been?',reply:passing,expectedStage:'candidate_review'});
check(inspectProactiveCandidateQuality({decision:positive}).allowed,'ordinary fully verified candidate keeps its original approval');
for(const key of ['natural','grounded','novel']){
 const rejected=await review({candidateText:key==='natural'?'foo malformed-privateword':'How has your day been?',reply:{...passing,quality:{...passing.quality,[key]:false}},expectedStage:'candidate_review'});
 check(!inspectProactiveCandidateQuality({decision:rejected}).allowed,`a certain ${key} rejection cannot be overwritten by the stage label`);
}
const missingEvidence={...passing};delete missingEvidence.groundingEvidence;
const missing=await review({candidateText:'Your package arrived today.',reply:missingEvidence,expectedStage:'candidate_review'});
check(!inspectProactiveCandidateQuality({decision:missing}).allowed&&missing.groundingFailure==='missing_evidence','candidate stage retains deterministic evidence validation');
const uncertain=await review({candidateText:'How has your day been?',reply:{...passing,confidence:.79},expectedStage:'candidate_review'});
check(uncertain.state==='unknown'&&!inspectProactiveCandidateQuality({decision:uncertain}).allowed,'original .8 confidence threshold remains unchanged');
const afterSales=await review({candidateText:'Browse another shirt?',reply:{...passing,state:'unresolved_after_sales',candidateKind:'shopping'},expectedStage:'candidate_review',context:[{...recentMessages[0],text:'My order has not arrived.'}]});
check(resolveProactiveCandidate({text:'Browse another shirt?',decision:afterSales,recentMessages,language:'en'}).replaced,'a candidate review cannot release the existing no-sales state');
const truncated=await assessProactiveContent(async()=>state,{recentMessages,contextTruncated:true});
check(truncated.state==='unknown','truncated neutral classification retains the original conservative boundary');
check(calls===9,'stage clarity adds no extra model call or retry');
console.log(`proactive review stage self-check passed: ${checks} checks; 9 injected transport responses, no DB/initialization/network/model calls`);
