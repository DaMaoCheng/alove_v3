import assert from 'node:assert/strict';
import { loadFeedbackConversationHistory, isSubmittedFeedbackFollowup, normalizeSupportFollowup, attachFeedbackSubmissionContext, applyFeedbackSubmissionPrompt } from '../server/chat-feedback-submission-service.js';
import { normalizeCommerceAssistance } from '../server/product-intent-classifier-service.js';
import { resolveChatFeedbackActionCandidate, appendFeedbackFollowupCopy } from '../server/chat-feedback-action-service.js';
const character={id:'mascot_fixture',category_id:'mascot',profile:{language:'Spanish'}};
const text='Ya he rellenado el formulario';
const entry={id:'msg_entry',characterId:character.id,senderType:'character',contentType:'feedback_action',displayOrder:20,sentAt:new Date('2026-10-26T01:00:00Z')};
const current={commerceRoute:'store_policy',commerceTopic:'support',commerceConfidence:.99,replyBoundary:{contactAllowed:true,salesAllowed:false},supportFollowup:{relation:'submitted_followup',evidence:text}};
let calls=[];const db={execute:async(sql,args)=>{calls.push({sql,args});assert(!sql.includes('cs.site_id'), 'chat_sessions has no site_id column');if(args.includes('site_other')||args.includes('guest_other'))return [[]];if(sql.includes('FROM chat_messages'))return [[{id:entry.id,character_id:character.id,display_order:20,sent_at:entry.sentAt}]];if(sql.includes('FROM user_feedback'))return [[{feedback_status:'new',created_at:new Date('2026-10-26T01:01:00Z')}]];throw Error('Unexpected SQL');}};
const history=await loadFeedbackConversationHistory(db,{sessionId:'chat_owned',character,siteId:'site_owned',guestSessionId:'guest_owned',beforeDisplayOrder:40});
assert.equal(history.feedbackSubmission.verified,true);
assert.equal(history.feedbackSubmission.status,'new');
assert(calls[0].sql.includes('guest_session_id = ?')&&calls[0].sql.includes('feedback_owner.site_id = ?')&&calls[0].sql.includes('JOIN guest_sessions feedback_owner ON feedback_owner.id = cs.guest_session_id'));
assert(calls[0].args.includes('site_owned'));
assert(calls[1].sql.includes('site_id = ?')&&calls[1].sql.includes('guest_session_id = ?'));
assert(calls[1].args.includes('guest_owned')&&calls[1].args.includes('site_owned'));
assert(!JSON.stringify(history).includes('user_email'));
const followup=normalizeSupportFollowup(current.supportFollowup,{userText:text,recentMessages:[entry],confidence:.99});
assert.equal(followup.relation,'submitted_followup');
assert.equal(normalizeSupportFollowup({...current.supportFollowup,evidence:'another text'},{userText:text,recentMessages:[entry],confidence:.99}),null);
assert.equal(normalizeSupportFollowup(current.supportFollowup,{userText:text,recentMessages:[],confidence:.99}),null);
const knowledge=attachFeedbackSubmissionContext({items:[],customerServiceIntent:true},history,{searchIntent:current,userText:text});
assert.equal(knowledge.feedbackSubmission.verified,true);
assert.equal(resolveChatFeedbackActionCandidate({character,knowledgeContext:knowledge,searchIntent:current,userText:text}),null);
assert.equal(appendFeedbackFollowupCopy('Gracias.',{character,feedbackAction:null,searchIntent:current}),'Gracias.');
assert(resolveChatFeedbackActionCandidate({character,knowledgeContext:attachFeedbackSubmissionContext({items:[],customerServiceIntent:true},history,{searchIntent:{...current,supportFollowup:{relation:'new_issue',evidence:text}},userText:text}),searchIntent:current,userText:text}));
assert(resolveChatFeedbackActionCandidate({character,knowledgeContext:knowledge,searchIntent:{...current,humanHandoff:{explicitRequest:true,evidence:text}},userText:text}));
const prompt=applyFeedbackSubmissionPrompt({layers:[],systemPrompt:''},knowledge);
assert(prompt.systemPrompt.includes('received')&&prompt.systemPrompt.includes('does not prove'));
const claimed=attachFeedbackSubmissionContext({items:[]},{entries:[entry]},{searchIntent:current,userText:text});
assert.equal(claimed.feedbackSubmission.verified,false);
assert.equal(attachFeedbackSubmissionContext({items:[]},history,{searchIntent:{...current,supportFollowup:null},userText:text}).feedbackSubmission,undefined);
calls=[];assert.equal(await loadFeedbackConversationHistory(db,{sessionId:'chat_owned',character,siteId:'',guestSessionId:'guest_owned',beforeDisplayOrder:40}),null);assert.equal(calls.length,0);
assert.equal((await loadFeedbackConversationHistory(db,{sessionId:'chat_owned',character,siteId:'site_other',guestSessionId:'guest_owned',beforeDisplayOrder:40})),null);
assert.equal((await loadFeedbackConversationHistory(db,{sessionId:'chat_owned',character,siteId:'site_owned',guestSessionId:'guest_other',beforeDisplayOrder:40})),null);
assert.equal((await loadFeedbackConversationHistory(db,{sessionId:'chat_owned',character,siteId:'site_owned',guestSessionId:'guest_owned',userId:'user_other',beforeDisplayOrder:40})),null);
assert.equal(normalizeCommerceAssistance({confidence:.99,supportFollowup:current.supportFollowup},{userText:text,recentMessages:[entry]}).supportFollowup.relation,'submitted_followup');
assert.equal(normalizeCommerceAssistance({confidence:.99,supportFollowup:current.supportFollowup},{userText:text,recentMessages:[]}).supportFollowup,undefined);
const done=attachFeedbackSubmissionContext({items:[]},{entries:[entry],feedbackSubmission:{verified:true,status:'done',source:'owned_feedback_record'}},{searchIntent:current,userText:text});
assert(applyFeedbackSubmissionPrompt({layers:[]},done).systemPrompt.includes('Even status done does not prove'));
calls=[];
await loadFeedbackConversationHistory(db,{sessionId:'chat_owned',character,siteId:'site_owned',userId:'user_owned',beforeDisplayOrder:40});
assert(calls[0].sql.includes('JOIN users feedback_owner ON feedback_owner.id = cs.internal_uid'));
assert(calls[0].sql.includes('feedback_owner.site_id = ?')&&calls[1].sql.includes('cs.internal_uid = ?'));
console.log('feedback submission context self-check passed: scoped metadata, quoted relation, submitted/new/explicit-human boundaries, prompt evidence');

assert(isSubmittedFeedbackFollowup(knowledge,current,text));
assert(!isSubmittedFeedbackFollowup(knowledge,{...current,supportFollowup:{relation:'submitted_followup',evidence:text}},text+' Also check my order.'));
assert(!isSubmittedFeedbackFollowup(knowledge,{...current,humanHandoff:{explicitRequest:true}},text));

assert.equal(normalizeSupportFollowup(current.supportFollowup,{userText:text+'. Another damaged order arrived.',recentMessages:[entry],confidence:.99}),null,'mixed substring is not a whole-turn followup');
assert.equal(attachFeedbackSubmissionContext({items:[]},history,{searchIntent:{...current,commerceRoute:'product_question',needsLiveProductData:true},userText:text}).feedbackSubmission,undefined,'parallel product action retains its normal path');

// A globally submitted feedback record is real even without a delivered chat action.
const noCardDb={execute:async(sql,args)=>{
 if(sql.includes('FROM chat_messages'))return [[]];
 if(sql.includes('FROM user_feedback')){assert(sql.includes('JOIN chat_sessions cs'));assert(sql.includes('JOIN guest_sessions feedback_owner'));assert(sql.includes('cs.character_id = ?'));assert(sql.includes('uf.created_at >= cs.created_at'));if(args.includes('site_other')||args.includes('guest_other'))return [[]];return [[{feedback_status:'new',created_at:new Date('2026-10-26T01:01:00Z')}]];}
 throw Error('Unexpected no-card SQL');}};
const noCard=await loadFeedbackConversationHistory(noCardDb,{sessionId:'chat_owned',character,siteId:'site_owned',guestSessionId:'guest_owned',beforeDisplayOrder:40});
assert.equal(noCard?.feedbackSubmission?.verified,true,'actual saved feedback must survive absent chat action');
assert.equal(noCard.entries.some(row=>row.contentType==='feedback_action'),false);
assert.equal(noCard.entries[0].senderType,'system');assert.equal(noCard.entries[0].contentType,'feedback_submission');
assert(normalizeSupportFollowup(current.supportFollowup,{userText:text,recentMessages:noCard.entries,confidence:.99}));
const fakeEvent=JSON.parse(JSON.stringify(noCard.entries[0]));assert.equal(normalizeSupportFollowup(current.supportFollowup,{userText:text,recentMessages:[fakeEvent],confidence:.99}),null,'serialized/user-created event is not server evidence');
assert.equal(await loadFeedbackConversationHistory(noCardDb,{sessionId:'chat_owned',character,siteId:'site_other',guestSessionId:'guest_owned',beforeDisplayOrder:40}),null);
assert.equal(await loadFeedbackConversationHistory(noCardDb,{sessionId:'chat_owned',character,siteId:'site_owned',guestSessionId:'guest_other',beforeDisplayOrder:40}),null);
const noReceiptDb={execute:async()=>[[]]};
assert.equal(await loadFeedbackConversationHistory(noReceiptDb,{sessionId:'chat_owned',character,siteId:'site_owned',guestSessionId:'guest_owned',beforeDisplayOrder:40}),null);

for(const ageCase of ['before_session','over_30_days']){
 const ages={sessionCreated:new Date('2026-10-20T00:00:00Z'),feedbackCreated:new Date(ageCase==='before_session'?'2026-10-19T00:00:00Z':'2026-08-01T00:00:00Z'),now:new Date('2026-10-26T00:00:00Z')};
 const oldDb={execute:async sql=>{if(sql.includes('FROM chat_messages'))return [[]];assert(sql.includes('uf.created_at >= cs.created_at'));assert(sql.includes('DATE_SUB(NOW(3), INTERVAL 30 DAY)'));const admitted=ages.feedbackCreated>=ages.sessionCreated&&ages.now-ages.feedbackCreated<=30*86400000;return [admitted?[{feedback_status:'new',created_at:ages.feedbackCreated}]:[]];}};
 assert.equal(await loadFeedbackConversationHistory(oldDb,{sessionId:'chat_owned',character,siteId:'site_owned',guestSessionId:'guest_owned',beforeDisplayOrder:40}),null,ageCase+' receipt is not recent current-conversation evidence');
}
