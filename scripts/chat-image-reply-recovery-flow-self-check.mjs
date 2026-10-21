import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('Isolated flow must not call providers');};
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const image={taskCreated:true,reason:'image_task_created',imageStatus:{kind:'library',status:'ready',currentTurn:true},trigger:{hasIntent:true,allowed:true,classificationOutcome:'accepted',requestScope:'image_only'},_imageStatusAnchor:{messageId:'current-image',assetId:null,displayOrder:30,kind:'library',scope:{sessionId:'session',characterId:'mascot_test',guestId:'guest_test',ownerId:null,order:20,currentImageMessageId:'current-image'}}};
const languagePass={reviewStatus:'valid',languageQualitySupported:true,retainedLanguageQualitySupported:true,confidence:.97,severity:'none',languageIssues:[]};
const verdict=(allowed)=>({allowed,confidence:.98,boundarySupported:allowed,productScopeSupported:true,retainedProductScopeSupported:true,evidenceSupported:true,guidanceSupported:true,factualSupported:true,imageStatusSupported:true,imageStatusRelevant:true,imageReferenceMatched:true,checkoutProblem:false});
async function run({ secondRejected=false, imageRejected=false, generationError=false, badRefreshAt=0, throwRefresh=false, scope="image_only", language=languagePass, noReader=false, searchOverrides={} }={}) {
 let generation=0,reviews=0,refreshes=0;const events=[];
 const context={...image,trigger:{...image.trigger,requestScope:scope}};
 const reply=await enforceReplyBoundary({replyResult:{sourceType:'ai',text:'Initial rejected proposal.'},character:{id:'mascot_test',category_id:'mascot'},userText:'otra',language:'es',chatImageContext:context,
  searchIntent:{commerceRoute:'unclear',replyBoundaryReason:'classification_uncertain',replyBoundary:{salesAllowed:false,contactAllowed:false},...searchOverrides},
  factualContext:{required:false,asOfUtc:'2026-10-16T07:00:00.000Z'},independentLanguageQualityRequired:true,languageQualityRequired:true,
  assess:async options=>{reviews++;assert.equal(options.imageStatusContext.status,'ready');return {...verdict(reviews>1&&!secondRejected),...(imageRejected&&reviews===1?{boundarySupported:true,imageStatusSupported:false}: {})}},assessLanguageQuality:async()=>language,
  ...(noReader?{}:{refreshImageStatus:async current=>{refreshes++;if(refreshes===badRefreshAt){if(throwRefresh)throw Error('controlled read failure');return{...current,imageStatus:{...current.imageStatus,status:'unknown'}}}return current}}),
  regenerateReply:async(_previous,recovery)=>{generation++;assert.equal(recovery.kind,'image');if(generationError)throw Object.assign(Error('controlled provider timeout'),{code:'AI_REPLY_TIMEOUT'});return{sourceType:'ai',text:'Aquí tienes otra para seguir nuestra charla.'}},recordReview:async e=>events.push(e)});
 return {reply,generation,reviews,refreshes,events};
}
for(const imageRejected of [false,true]) {
 const r=await run({imageRejected});assert.equal(r.generation,1);assert.equal(r.reviews,2);assert.equal(r.refreshes,2);
 assert.equal(r.reply.text,'Aquí tienes otra para seguir nuestra charla.');assert(!r.reply.replyRecoveryState?.guardApplied);
 assert.equal(r.events.at(-1).languageDiagnostics.repairKind,'image');assert.equal(r.events.at(-1).languageDiagnostics.repairState,'accepted');
}
for (const field of ["productRequestState", "productCandidateState"]) {
  const cleared = await run({ searchOverrides: { [field]: { status: "cleared" } } });
  assert.equal(cleared.generation, 1, `${field}: clearing a prior task must restore image text recovery`);
  assert.equal(cleared.reply.text, 'Aquí tienes otra para seguir nuestra charla.');
  for (const status of ["active", "pending", "unknown"]) {
    const blocked = await run({ searchOverrides: { [field]: { status } } });
    assert.equal(blocked.generation, 0, JSON.stringify({field, status, events: blocked.events}));
  }
}
const refused=await run({secondRejected:true});assert.equal(refused.generation,1);assert.equal(refused.reviews,2);assert.equal(refused.reply.text,'Foto lista.');assert.equal(refused.events.at(-1).languageDiagnostics.repairState,'rejected');
const failed=await run({generationError:true});assert.equal(failed.generation,1);assert.equal(failed.reviews,1);assert.equal(failed.refreshes,2);assert.equal(failed.reply.text,'Foto lista.');assert.equal(failed.events.at(-1).languageDiagnostics.repairFailureCode,'provider_timeout');
for(const badRefreshAt of [1,2]) for(const throwRefresh of [false,true]) {
 const r=await run({badRefreshAt,throwRefresh});assert.equal(r.generation,badRefreshAt===1?0:1);assert.equal(r.reviews,1);
 assert(!r.reply.text.startsWith('Foto lista.'));assert(!r.reply.text.includes('seguir nuestra charla'));
 assert.equal(r.events.at(-1).languageDiagnostics.repairFailureCode,'image_state_changed');
}
for(const scope of ['mixed','unknown']) {const r=await run({scope});assert.equal(r.generation,0);assert.equal(r.refreshes,0);}
for(const language of [{...languagePass,confidence:.53},{...languagePass,severity:'major',languageQualitySupported:false}]) {const r=await run({language});assert.equal(r.generation,0);}
assert.equal((await run({noReader:true})).generation,0,'old callers without an injected scoped reader remain unchanged');
const {buildReplyReviewLogEvent}=await import('../server/ai-reply-log-service.js');
for(const r of [await run(),refused,failed,await run({badRefreshAt:1})]) {
 const event=buildReplyReviewLogEvent(r.events.at(-1));const details=JSON.parse(event.errorMessage);
 assert.equal(details.replyRepair.kind,'image');assert.equal(details.replyRepair.attempts,r.generation);
 assert(event.errorMessage.length<=500);assert(!event.errorMessage.includes('Initial rejected'));
}
console.log('Image natural recovery actual boundary flow passed: success, rejection, provider failure, fresh-state loss, mixed/unknown/language guards, finite diagnostics (no image/DB/network actions)');
const {buildReplyReviewMessages}=await import('../server/chat-reply-review-contracts.js');
const without=buildReplyReviewMessages({boundaryReviewRequired:true});
assert(without.some(m=>m.content.includes('this review has NO successful tool result.')),'non-image boundaries must retain the original rule');
const withImage=buildReplyReviewMessages({boundaryReviewRequired:true,imageStatusContext:{kind:'library',status:'ready',currentTurn:true}});
assert(withImage.some(m=>m.content.includes('A personal character photo is not merchandise')),'personal-photo acknowledgements must be distinguished from sales');
assert(!withImage.some(m=>m.content.includes('this review has NO successful tool result.')),'supplied image facts must not contradict the blanket no-tool-result rule');
