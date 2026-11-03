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
