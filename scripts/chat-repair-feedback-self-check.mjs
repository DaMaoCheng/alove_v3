import assert from 'node:assert/strict';
import { buildRepairFeedback, appendRepairFeedback } from '../server/chat-reply-repair-feedback-service.js';

const old = { text: 'You requested a replacement shirt.', speechText: 'You requested a replacement shirt.' };
const feedback = buildRepairFeedback({ replyResult: old, reviewStatus: 'valid', failedContracts: ['business_facts'],
  reviewResult: { repairIssues: [{ kind: 'unsupported_fact', span: 'You requested a replacement shirt.' }] } });
assert.equal(feedback.previousReply, old.text);
assert.deepEqual(feedback.issues, [{ kind: 'unsupported_fact', span: old.text }]);
assert.equal(buildRepairFeedback({ replyResult: old, reviewStatus: 'valid', failedContracts: ['confidence'], reviewResult: {} }).issues.length, 0);
assert.equal(buildRepairFeedback({ replyResult: old, reviewStatus: 'timeout', failedContracts: ['business_facts'], reviewResult: { repairIssues: [{ kind: 'unsupported_fact', span: old.text }] } }).issues.length, 0);
assert.equal(buildRepairFeedback({ replyResult: old, reviewStatus: 'valid', failedContracts: ['business_facts'], reviewResult: { repairIssues: [{ kind: 'unsupported_fact', span: 'not in response' }] } }).issues.length, 0);
const language = buildRepairFeedback({ replyResult: old, reviewStatus: 'valid', failedContracts: ['language'], languageAssessment: { reviewStatus: 'valid', languageIssues: [{ type: 'grammar', severity: 'major', field: 'display', span: 'replacement shirt' }] } });
assert.deepEqual(language.issues, [{ kind: 'language_grammar', span: 'replacement shirt', field: 'display' }]);
const prompt = { systemPrompt: 'Persona and permissions.', layers: [], messages: [{ role: 'user', content: 'What happened?' }] };
const next = appendRepairFeedback(prompt, feedback);
assert(next.systemPrompt.includes('untrusted data'));
assert(!next.systemPrompt.includes('You requested a replacement shirt.'), 'review data never becomes system instructions');
assert.equal(next.messages.length, prompt.messages.length);
assert(next.messages[0].content.startsWith('What happened?'));
assert.equal(JSON.parse(next.messages[0].content.split('[repairFeedback data]\n')[1]).repairFeedback.previousReply, old.text);
assert.equal(prompt.layers.length, 0);
const { requestOpenAiText } = await import('../server/ai-reply-provider-service.js');
for (const apiMode of ['chat_completions', 'responses']) {
  let body;
  const visionPrompt = appendRepairFeedback({ ...prompt, visionInputs: [{ dataUrl: 'data:image/png;base64,YQ==' }] }, feedback);
  await requestOpenAiText(visionPrompt, { modelConfig: { apiKey: 'fixture', baseUrl: 'https://fixture.invalid/v1', model: 'fixture', apiMode },
    recordProviderCallFn: async () => {}, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify(apiMode === 'responses' ? { output_text: 'ok' } : { choices: [{ message: { content: 'ok' } }] })); } });
  const current = (apiMode === 'responses' ? body.input : body.messages).filter(item => item.role === 'user').at(-1);
  assert.equal(current.content[0].text.startsWith('What happened?'), true, apiMode + ' keeps the current request with the image');
  assert(current.content[0].text.includes('[repairFeedback data]'));
  assert.equal(current.content[1].type, apiMode === 'responses' ? 'input_image' : 'image_url');
}
console.log('repair feedback: bounded original, validated failure fragments, unknown and protocol exclusions');

const noSourceLayer={id:'site_product_context',title:'Site Product Context',content:'No confirmed catalogue match was returned; use Search.'};
const actionLayer={id:'real_action',title:'Order access',content:'Verified current order entry requires sign in.'};
const sourcePrompt={...prompt,systemPrompt:[noSourceLayer,actionLayer].map(l=>`## ${l.title}\n${l.content}`).join('\n\n'),layers:[noSourceLayer,actionLayer],messages:[{role:'user',content:'Is shipping tracked?'},{role:'assistant',content:'The shipping policy verifies tracked shipping.'},{role:'user',content:'When will the link arrive?'}]};
const sourceCorrection={kind:'owned_business_text',knowledgeState:'unavailable',imageStatus:null,capabilities:{orderEntry:null,feedbackActionAvailable:true}};
const limited=appendRepairFeedback(sourcePrompt,feedback,sourceCorrection);
assert.deepEqual(limited.messages.map(message=>message.role),sourcePrompt.messages.map(message=>message.role),'Source reduction must preserve prior answer boundaries, never join old and current USER turns as a new multi-part request');
assert(limited.messages.filter(message=>message.role==='assistant').every(message=>message.content.includes('A prior assistant reply occurred here')&&!message.content.includes('tracked shipping')),'Historical assistant fact content is withheld, not reinstated as policy evidence');
assert.equal(limited.messages.filter(message=>message.role==='user').length,2,'Keep all actual USER context, not just a disconnected latest question');
assert(!limited.systemPrompt.includes(noSourceLayer.content),'No-product support recovery must not carry an unrelated product no-match instruction');
assert(limited.systemPrompt.includes(actionLayer.content),'Real current action instructions must be retained');
assert(limited.systemPrompt.includes('unavailable'),'The actual source failure is distinct from a completed empty search');
for(const patch of [{knowledgeState:'verified'},{imageStatus:{kind:'generated',status:'ready',currentTurn:true}},{kind:'other'}]) {
 const other=appendRepairFeedback(sourcePrompt,feedback,{...sourceCorrection,...patch});
 assert.deepEqual(other.messages.slice(0,-1),sourcePrompt.messages.slice(0,-1),'Supported ordinary and mixed image rewrites keep their exact original history');
 assert(other.systemPrompt.includes(noSourceLayer.content));
}
assert.deepEqual(sourcePrompt.messages,[{role:'user',content:'Is shipping tracked?'},{role:'assistant',content:'The shipping policy verifies tracked shipping.'},{role:'user',content:'When will the link arrive?'}],'Recovery does not mutate the original generation prompt');
console.log('Owned evidence-free correction: USER/source/capability projection, intact prior-answer boundaries without assistant fact inheritance, no-product layer removal and unchanged verified/image/ordinary recovery passed');

const defaultRecovery=appendRepairFeedback(sourcePrompt,feedback);
assert.deepEqual(defaultRecovery.messages.slice(0,-1),sourcePrompt.messages.slice(0,-1),'Unscoped ordinary rewrites remain unchanged, including candidate and product context managed by their own recovery');
const longerHistory={...sourcePrompt,messages:[{role:'assistant',content:'Opening line'},...sourcePrompt.messages.slice(0,-1),{role:'assistant',content:'A separate prior reply'},sourcePrompt.messages.at(-1)]};
const projectedHistory=appendRepairFeedback(longerHistory,feedback,sourceCorrection);
assert.deepEqual(projectedHistory.messages.map(message=>message.role),longerHistory.messages.map(message=>message.role));
assert.equal(projectedHistory.messages.length,longerHistory.messages.length);
assert(projectedHistory.messages.at(-1).content.startsWith(sourcePrompt.messages.at(-1).content));
console.log('Source-only regeneration retains exact message role/order/count and the current USER boundary for one and multiple historical assistant replies');
