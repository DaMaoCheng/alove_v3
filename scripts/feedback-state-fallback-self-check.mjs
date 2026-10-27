import assert from 'node:assert/strict';
import {SUPPORTED_CHARACTER_LANGUAGES} from '../shared/language-library.js';
import {buildFeedbackSubmissionFallback} from '../server/chat-feedback-submission-service.js';
const userText='When will my submitted form be handled?';
const base={userText,languageCode:'es',character:{id:'mascot_fixture'},trustedSite:{id:'site_fixture'},
 knowledgeContext:{ok:true,businessOwner:{siteId:'site_fixture',characterId:'mascot_fixture'},feedbackSubmission:{verified:true,status:'new',source:'owned_feedback_record',relation:'submitted_followup'}},
 searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business',answerRequired:true,replyBoundary:{salesAllowed:false,contactAllowed:true},supportFollowup:{relation:'submitted_followup',evidence:userText}}};
assert.match(buildFeedbackSubmissionFallback(base),/registrado/);
for(const language of SUPPORTED_CHARACTER_LANGUAGES)assert(buildFeedbackSubmissionFallback({...base,languageCode:language.code}),language.code);
for(const patch of [
 {knowledgeContext:{...base.knowledgeContext,feedbackSubmission:{...base.knowledgeContext.feedbackSubmission,verified:false}}},
 {knowledgeContext:{...base.knowledgeContext,items:[{id:'policy',content:'A verified independent policy answer.'}]}},{trustedSite:{id:'other'}},{character:{id:'other'}},{searchIntent:{...base.searchIntent,needsLiveProductData:true}},
 {searchIntent:{...base.searchIntent,humanHandoff:{explicitRequest:true}}},{chatImageContext:{status:'ready'}},
 {factualContext:{required:true}},{guestBenefitContext:{id:'benefit'}},{orderActionCandidate:{kind:'ttmall_order_lookup'}},
 {productContext:{products:[{id:'product'}]}},{languageCode:'zz'},
])assert.equal(buildFeedbackSubmissionFallback({...base,...patch}),'');
assert(buildFeedbackSubmissionFallback({...base,knowledgeContext:{...base.knowledgeContext,feedbackSubmission:{...base.knowledgeContext.feedbackSubmission,status:'done'}}}),'done does not imply resolution');
console.log(`feedback state fallback passed (${SUPPORTED_CHARACTER_LANGUAGES.length} languages, receipt-only and parallel/owner/unknown evidence exclusions; no models/DB)`);
const{enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const unavailable={allowed:false,confidence:0,reviewStatus:'network_error'};
const actual=await enforceReplyBoundary({...base,language:'es',character:{...base.character,category_id:'mascot'},replyResult:{text:'I will arrange a quick reply.',sourceType:'ai'},languageRepairAttempted:true,assess:async()=>unavailable,recordReview:async()=>{}});
assert.equal(actual.text,buildFeedbackSubmissionFallback(base),'the final real boundary uses verified state after review failure, without approving the rejected draft');
assert.notEqual(actual.text,'I will arrange a quick reply.');
assert(actual.degraded);
console.log('real boundary terminal feedback state fallback passed; rejected model approval is not fabricated');
const partial=await enforceReplyBoundary({...base,language:'en',character:{...base.character,category_id:'mascot'},replyResult:{text:'Thanks for letting me know.\n\nSomeone will resolve this today.',sourceType:'ai'},languageRepairAttempted:true,assess:async()=>({reviewStatus:'valid',allowed:false,confidence:1,boundarySupported:true,businessFactsSupported:false,guidanceSupported:true,retainedText:'Thanks for letting me know.',retainedTextAllowed:true,retainedBoundarySupported:true,retainedBusinessFactsSupported:true,retainedGuidanceSupported:true}),recordReview:async()=>{}});
assert(partial.text.includes(buildFeedbackSubmissionFallback({...base,languageCode:'en'})),'safe retained acknowledgement must not reintroduce an unrelated cannot-verify-policy fallback');
