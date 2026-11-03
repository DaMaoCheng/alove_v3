import assert from 'node:assert/strict';
const {enforceReplyBoundary}=await import('../server/chat-reply-boundary-service.js');
const intent={commerceRoute:'chat',knowledgeScope:'business',answerRequired:true,unresolvedUserComplaint:true,replyBoundary:{salesAllowed:false,contactAllowed:false}};
let n=0, repairs=0, feedback;
const result=await enforceReplyBoundary({replyResult:{text:'I will fix this.',speechText:'I will fix this.',sourceType:'ai',sourceRef:'venice-chat-completions'},character:{id:'fixture',category_id:'mascot'},trustedSite:{id:'shop'},searchIntent:intent,knowledgeContext:{ok:true,strategy:'business_no_verified_answer',businessOwner:{siteId:'shop',characterId:'fixture'},items:[]},language:'en',userText:'I will not purchase.',languageQualityRequired:true,independentLanguageQualityRequired:true,config:{apiKey:'x',model:'x'},recordReview:async()=>{},assess:async()=>{n++;return n===1?{allowed:false,confidence:.82,boundarySupported:true,guidanceSupported:false,businessFactsSupported:false,retainedText:'some text',retainedTextAllowed:false,repairIssues:[{kind:'review_reason',span:'I will fix this.',reason:'unsupported promise'}]}:{allowed:true,confidence:.95,boundarySupported:true,guidanceSupported:true,businessFactsSupported:true};},assessLanguageQuality:async()=> n===1?{reviewStatus:'invalid_fields'}:{reviewStatus:'valid',confidence:.99,languageQualitySupported:true},repairGroundedReply:async (x)=>{repairs++;feedback=x.repairFeedback;return {text:'I understand.',speechText:'I understand.',sourceType:'ai'};}});

assert.equal(repairs,1);assert.equal(feedback.issues[0].reason,'unsupported promise');assert.equal(result.text,'I understand.');

assert.equal(n,2,'repaired candidate receives complete primary review');
console.log('owned complaint: independent language protocol failure retains primary reason and triggers one fully reviewed rewrite');

const { appendRepairFeedback } = await import('../server/chat-reply-repair-feedback-service.js');
const originalPrompt = { systemPrompt: 'Original character rules.', messages: [
  { role: 'user', content: 'I ordered 3XL. ' + 'Detail '.repeat(120) },
  { role: 'assistant', content: 'Earlier assistant response.' },
  ...Array.from({ length: 18 }, (_, i) => ({ role: 'user', content: 'Follow-up ' + i })),
  { role: 'user', content: 'Correction: it was 2XL. I will not purchase.' },
] };
let primaryCalls = 0, regenerationCalls = 0;
const unifiedResult = await enforceReplyBoundary({
  replyResult: { text: 'I will fix this.', speechText: 'I will fix this.', sourceType: 'ai' },
  character: { id: 'fixture', category_id: 'mascot' }, trustedSite: { id: 'shop' }, searchIntent: intent,
  knowledgeContext: { ok: true, strategy: 'business_no_verified_answer', businessOwner: { siteId: 'shop', characterId: 'fixture' }, items: [] },
  promptContext: originalPrompt, userText: 'I will not purchase.', language: 'en', languageQualityRequired: true, independentLanguageQualityRequired: true,
  config: { apiKey: 'fixture', model: 'fixture' }, recordReview: async () => {},
  assess: async () => ++primaryCalls === 1
    ? { allowed: false, confidence: .9, boundarySupported: false, guidanceSupported: false, businessFactsSupported: false,
        repairIssues: [{ kind: 'review_reason', span: 'I will fix this.', reason: 'Unsupported promise.' }] }
    : { allowed: true, confidence: .95, boundarySupported: true, guidanceSupported: true, businessFactsSupported: true },
  assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: .99, languageQualitySupported: true }),
  regenerateReply: async (previous, recovery) => {
    regenerationCalls++;
    assert.equal(recovery.timeoutMs, 30000, 'owned complaint budget reaches original callback');
    assert.equal(typeof recovery.recordDiagnostic, 'function');
    const request = appendRepairFeedback(originalPrompt, recovery.repairFeedback);
    assert.equal(request.systemPrompt.startsWith(originalPrompt.systemPrompt), true);
    assert.deepEqual(request.messages.slice(0, -1), originalPrompt.messages.slice(0, -1));
    assert(request.messages.at(-1).content.startsWith(originalPrompt.messages.at(-1).content));
    assert.equal(originalPrompt.messages.at(-1).content.includes('repairFeedback'), false);
    assert.equal(previous.text, 'I will fix this.');
    assert.equal(recovery.repairFeedback.previousReply, previous.text);
    assert.equal(recovery.repairFeedback.issues[0].reason, 'Unsupported promise.');
    return { text: 'I understand.', speechText: 'I understand.', sourceType: 'ai' };
  },
});
assert.equal(regenerationCalls, 1);
assert.equal(primaryCalls, 2);
assert.equal(unifiedResult.text, 'I understand.');
console.log('complaint recovery uses original generator callback once with original draft and reason');
