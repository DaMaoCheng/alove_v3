import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('No external calls');};
const {resolveChatImageStatusContext,getChatImageStatusFallbackCopy,toImageStatusReviewContext}=await import('../server/chat-image-status-context-service.js');
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const context=await resolveChatImageStatusContext({execute:async()=>[[{id:'old-gallery',content_type:'mascot_library_image',display_order:50}]]},{session:{id:'s',guest_session_id:'g',character_id:'c'},character:{id:'c'},userDisplayOrder:90});
assert.equal(context.imageStatus.currentTurn,false);
const out=await enforceReplyBoundary({replyResult:{text:'Unapproved response.'},language:'es',userText:'otra',character:{id:'c',category_id:'mascot'},chatImageContext:context,
 searchIntent:{commerceRoute:'unclear',replyBoundaryReason:'classification_uncertain',replyBoundary:{salesAllowed:false,contactAllowed:false}},
 assess:async()=>({allowed:false,confidence:.99,boundarySupported:false,checkoutProblem:false,imageStatusSupported:true,imageStatusRelevant:true,imageReferenceMatched:true}),recordReview:async()=>{}});
assert(!out.text.startsWith('Foto lista.'),'old ready must never acknowledge another photo delivery');
assert.match(out.text,/anterior/i,'historical completion is explicitly scoped');
assert.equal(getChatImageStatusFallbackCopy({imageStatus:{kind:'library',status:'ready',currentTurn:true}},'es'),'Foto lista.');
for(const reason of ['quota_exhausted','disallowed_request']) {
 const blocked={...context,reason,taskCreated:false,trigger:{hasIntent:true}};
 assert.notEqual(getChatImageStatusFallbackCopy(blocked,'es'),'Foto lista.');
 assert.equal(toImageStatusReviewContext(blocked).currentRequest.reason,reason);
}
console.log('Image delivery scope regression passed');
const {buildImageDecisionLogEvent}=await import('../server/ai-reply-log-service.js');
const event=buildImageDecisionLogEvent({session:{id:'session'},userMessage:{id:'input'},jevDecision:{ok:true,imageIntent:'none',confidence:.91},result:{trigger:{hasIntent:true,allowed:false,intentType:'library_photo',confidence:.89,detectionSource:'classifier'},taskCreated:false,reason:'quota_exhausted'},userText:'PRIVATE',apiKey:'SECRET',url:'https://secret.test/private'});
const log=JSON.parse(event.errorMessage);
assert.equal(log.outcome,'blocked');assert.equal(log.reason,'quota_exhausted');assert.equal(event.requestId,'input');assert.equal(event.sessionId,'session');
assert(!event.errorMessage.includes('PRIVATE'));assert(!event.errorMessage.includes('SECRET'));assert(!event.errorMessage.includes('https'));
for(const result of [{requested:true,taskCreated:true,message:{id:'photo',contentType:'mascot_library_image'}},{contentType:'image_generation',id:'queued-photo'},null]) {
 const e=buildImageDecisionLogEvent({session:{id:'s'},userMessage:{id:'i'},result});
 assert(e.errorMessage.length<=500);assert.equal(JSON.parse(e.errorMessage).messageId,result?.message?.id||result?.id||'');
}
console.log('Finite image-turn diagnostics passed');
for(const classificationOutcome of ['accepted','model_no_intent','low_confidence','grounding_rejected','PRIVATE']) {
 const e=buildImageDecisionLogEvent({session:{id:'s'},userMessage:{id:'i'},result:{trigger:{classificationOutcome,classificationIntent:'library_photo',classificationFailure:'timeout',hasIntent:false,confidence:.8,detectionSource:'classifier'}}});
 const details=JSON.parse(e.errorMessage);
 assert.equal(details.image.classification,classificationOutcome==='PRIVATE'?undefined:classificationOutcome);
 assert(!e.errorMessage.includes('PRIVATE'));assert(e.errorMessage.length<=500);
}
for(const currentImageMessageId of ['', 'new-message']) {
 const missing=await resolveChatImageStatusContext({execute:async()=>[[{id:'old-gallery',content_type:'mascot_library_image',display_order:50}]]},{session:{id:'s',guest_session_id:'g',character_id:'c'},character:{id:'c'},userDisplayOrder:90,currentImageMessageId,directive:{taskCreated:true,libraryDelivered:true}});
 assert.equal(missing.imageStatus.status,'unknown','created task must not fall back to old ready when its row is unavailable');
 assert.equal(missing.imageStatus.currentTurn,true);assert(!getChatImageStatusFallbackCopy(missing,'es').includes('anterior'));
}
assert.equal(getChatImageStatusFallbackCopy({...context,taskCreated:false,reason:'active_generation'},'es'),'Ahora no puedo confirmar el estado de la imagen.');
console.log('Current-row invisibility and active-task precedence passed');
// Only a fully covered, fulfilled image-only request may omit commerce uncertainty.
const fulfilled={taskCreated:true,reason:'image_task_created',imageStatus:{kind:'library',status:'ready',currentTurn:true},trigger:{hasIntent:true,allowed:true,classificationOutcome:'accepted',requestScope:'image_only'}};
async function guarded(chatImageContext,searchExtra={},reviewExtra={},optionsExtra={}) {
 return enforceReplyBoundary({replyResult:{text:'Rejected proposal.'},language:'es',userText:'otra',character:{id:'c',category_id:'mascot'},chatImageContext,
 searchIntent:{commerceRoute:'unclear',replyBoundaryReason:'classification_uncertain',replyBoundary:{salesAllowed:false,contactAllowed:false},...searchExtra},
 assess:async()=>({allowed:false,confidence:.99,boundarySupported:false,checkoutProblem:false,imageStatusSupported:true,imageStatusRelevant:true,imageReferenceMatched:true,...reviewExtra}),recordReview:async()=>{},...optionsExtra});
}
assert.equal((await guarded(fulfilled)).text,'Foto lista.','fulfilled image-only turn must not ask what the already resolved request means');
for(const unsafe of [
 {...fulfilled,trigger:{...fulfilled.trigger,requestScope:'mixed'}},
 {...fulfilled,trigger:{...fulfilled.trigger,requestScope:'unknown'}},
 {...fulfilled,trigger:{...fulfilled.trigger,requestScope:undefined}},
 {...fulfilled,trigger:{...fulfilled.trigger,allowed:false}},
 {...fulfilled,trigger:{...fulfilled.trigger,classificationOutcome:undefined}},
 {...fulfilled,taskCreated:false},
 {...fulfilled,imageStatus:{kind:'library',status:'ready',currentTurn:false}},
 {...fulfilled,imageStatus:{kind:'generated',status:'queued',currentTurn:true}},
 {...fulfilled,imageStatus:{kind:'unknown',status:'unknown',currentTurn:true}},
]) assert.match((await guarded(unsafe)).text,/Aclara/,'uncertain/mixed/not-fulfilled turns keep existing clarification');
assert.match((await guarded(fulfilled,{answerRequired:true,knowledgeScope:'business',commerceRoute:'store_policy',commerceTopic:'support'})).text,/Aclara/,'business support contract cannot be masked by image completion');
assert.match((await guarded(fulfilled,{productScopePending:true})).text,/Aclara/,'pending product scope cannot be masked');
assert.match((await guarded(fulfilled, {}, {}, {factualContext:{required:true,status:"no_result",searched:false}})).text,/Aclara/,"independent factual question must keep clarification");
assert.match((await guarded(fulfilled, {}, {}, {replyResult:{text:(await import("../server/chat-factual-policy.js")).buildFactualUnavailableCopy("es")}})).text,/Aclara/,"factual limitation paragraph review is unchanged");
const mixedContext={...fulfilled,trigger:{...fulfilled.trigger,requestScope:"mixed"}};
const parallel="Puedo ayudarte con esa pregunta también.";
const retained=await guarded(mixedContext, {}, {imageStatusSupported:false,retainedText:parallel,retainedTextAllowed:true,retainedBoundarySupported:true,retainedImageStatusSupported:true}, {replyResult:{text:`Unsupported image claim.\n\n${parallel}`}});
assert(retained.text.includes(parallel),"approved mixed-turn answer must survive image fallback");
assert(retained.text.includes("Foto lista."));assert(retained.text.includes("Aclara"));
console.log('Image-only completion vs mixed/unknown/parallel scope checks passed');
for(const requestScope of ['image_only','mixed','unknown','PRIVATE']) {
 const event=buildImageDecisionLogEvent({session:{id:'s'},userMessage:{id:'i'},result:{trigger:{requestScope}}});
 assert.equal(JSON.parse(event.errorMessage).image.requestScope,requestScope==='PRIVATE'?undefined:requestScope);
 assert(!event.errorMessage.includes('PRIVATE'));assert(event.errorMessage.length<=500);
}
