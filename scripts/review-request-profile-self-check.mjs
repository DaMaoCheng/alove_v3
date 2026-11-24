import assert from 'node:assert/strict';
import { resolveReviewRequestProfile } from '../server/config.js';
import { applyReviewRequestProfile, independentJsonProviderChain, independentLanguageReviewerChain, independentReviewerConfig } from '../server/ai-independent-review-config.js';
const profile = resolveReviewRequestProfile(JSON.stringify({ model: 'verified-reviewer', reasoningEffort: 'low', maxOutputTokens: 6000 }));
const provider = { id: 'fixture', apiKey: 'fixture', model: 'verified-reviewer', apiMode: 'chat_completions',
  baseUrl: 'https://profile.example.test/v1',
  reviewRequestProfile: profile, requestBodyExtras: { max_tokens: 3000, custom: 'preserved' } };
const snapshot = structuredClone(provider);
const reviewed = applyReviewRequestProfile(provider);
assert.equal(reviewed.requestBodyExtras.reasoning_effort, 'low');
assert.equal(reviewed.requestBodyExtras.max_tokens, 6000);
assert.equal(reviewed.requestBodyExtras.custom, 'preserved');
assert.deepEqual(provider, snapshot, 'a review profile must never mutate the generator config');
assert.deepEqual(applyReviewRequestProfile(reviewed), reviewed, 'profile application is idempotent');
const unrelated = { ...provider, model: 'different-model' };
assert.equal(applyReviewRequestProfile(unrelated), unrelated, 'changing models cannot inherit an unverified profile');
assert.equal(applyReviewRequestProfile({ ...provider, reviewRequestProfile: null }).requestBodyExtras.reasoning_effort, undefined);
assert.equal(applyReviewRequestProfile(null), null);
const venice = { ...provider, id: 'venice', requestBodyExtras: { venice_parameters: { include_venice_system_prompt: false }, max_tokens: 3000 } };
const veniceReview = applyReviewRequestProfile(venice);
assert.equal(veniceReview.requestBodyExtras.venice_parameters.disable_thinking, true);
assert.equal(veniceReview.requestBodyExtras.venice_parameters.include_venice_system_prompt, false);
assert.equal(venice.requestBodyExtras.venice_parameters.disable_thinking, undefined);
assert.equal(applyReviewRequestProfile({ ...venice, apiMode: 'responses' }).requestBodyExtras.venice_parameters.disable_thinking, undefined);
assert.deepEqual(applyReviewRequestProfile(veniceReview), veniceReview);
const responses = applyReviewRequestProfile({ ...provider, apiMode: 'responses', reasoningEffort: 'high' });
assert.equal(responses.reasoningEffort, 'low');
assert.equal(responses.requestBodyExtras.max_output_tokens, 6000);
assert.equal(responses.requestBodyExtras.max_tokens, undefined);
const aiReply = { replyChain: [provider, { ...provider, model: 'other-generator' }] };
const routing = independentJsonProviderChain(aiReply);
assert.equal(routing[0].requestBodyExtras.reasoning_effort, undefined, 'legacy intent fallback must remain unchanged');
assert.equal(routing[0].requestBodyExtras.max_tokens, 3000);
assert.equal(independentLanguageReviewerChain('other-generator', aiReply)[0].requestBodyExtras.max_tokens, 6000);
assert.equal(independentReviewerConfig('other-generator', aiReply).requestBodyExtras.reasoning_effort, 'low');
assert.equal(resolveReviewRequestProfile(''), null);
for (const value of ['{', 'null', '[]', '{}', '{"model":"x","reasoningEffort":"invalid"}',
  '{"model":"x","maxOutputTokens":1000000}', '{"model":"x","maxOutputTokens":"6000"}',
  '{"model":"x","apiKey":"private-fixture"}', '{"model":"x","maxOutputTokens":6000.5}']) {
  assert.throws(() => resolveReviewRequestProfile(value), error => !error.message.includes('private-fixture'));
}
const { requestOpenAiText } = await import('../server/ai-reply-provider-service.js');
const sent = [];
for (const config of [provider, reviewed, responses]) await requestOpenAiText({ systemPrompt: 'fixture', messages: [] }, {
  modelConfig: config, recordProviderCallFn: async () => {}, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).hostname, 'profile.example.test');
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify(config.apiMode === 'responses' ? { output_text: '{}' }
      : { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
  },
});
assert.equal(sent[0].reasoning_effort, undefined, 'normal generation sends no new reasoning override');
assert.equal(sent[0].max_tokens, 3000);
assert.equal(sent[1].reasoning_effort, 'low', 'review effort reaches the real chat-completions adapter');
assert.equal(sent[1].max_tokens, 6000);
assert.equal(sent[2].reasoning.effort, 'low');
assert.equal(sent[2].max_output_tokens, 6000);
console.log('Review request profiles passed: model binding, reviewer-only selection, generator/intent isolation, real adapter request fields, invalid-config privacy (mock transport; no network/DB).');
const { requestAiJsonWithProviderFallback } = await import('../server/ai-json-provider-service.js');
const structuredRequests = [];
for (const [config, disableProviderThinking] of [[venice, true], [venice, false], [provider, true]]) {
  await requestAiJsonWithProviderFallback([{ role: 'user', content: 'fixture' }], {
    config: [config], disableProviderThinking, recordProviderCallFn: async () => {},
    fetchImpl: async (_url, options) => {
      structuredRequests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }));
    },
  });
}
assert.equal(structuredRequests[0].venice_parameters.disable_thinking, true);
assert.equal(structuredRequests[0].venice_parameters.include_venice_system_prompt, false);
assert.equal(structuredRequests[1].venice_parameters.disable_thinking, undefined);
assert.equal(structuredRequests[2].venice_parameters, undefined);
console.log('Structured knowledge thinking opt-in preserves other providers and default consumers.');
let visualBody;
await requestAiJsonWithProviderFallback([{ role: 'user', content: 'Inspect the supplied fixture.' }], {
  config: [provider], visionInputs: [{ dataUrl: 'data:image/png;base64,aGVsbG8=' }],
  recordProviderCallFn: async () => {}, fetchImpl: async (_url, options) => {
    visualBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }));
  },
});
assert(visualBody.messages.at(-1).content.some(part => part.type === 'image_url'), 'existing visual transport carries the actual image in the same JSON review call');
console.log('JSON review visual input reaches the existing provider adapter in the same call.');
