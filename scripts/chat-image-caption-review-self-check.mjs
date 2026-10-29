import assert from 'node:assert/strict';
import { assessImageTerminalCaption, normalizeImageCaptionReview } from '../server/chat-image-caption-review-service.js';
import { replyReviewConfident } from '../server/chat-reply-review-outcome.js';
const good = { languageSupported: true, noRepeatedBusinessAnswer: true, noInternalLeak: true, confidence: .54 };
assert.equal(normalizeImageCaptionReview(good).allowed, true);
assert.equal(normalizeImageCaptionReview({ ...good, confidence: .53 }).allowed, false);
for (const key of ['languageSupported', 'noRepeatedBusinessAnswer', 'noInternalLeak']) {
  const result = normalizeImageCaptionReview({ ...good, [key]: false });
  assert.equal(result.allowed, false); assert.deepEqual(result.failures, [key]);
}
for (const bad of [null, {}, { ...good, confidence: null }, { ...good, confidence: 1.1 }, { ...good, noInternalLeak: 'true' }])
  assert.equal(normalizeImageCaptionReview(bad).allowed, false);
assert.equal(replyReviewConfident({ confidence: .6, boundarySupported: true }, ['image_status']), false, 'ordinary image review keeps .8');
let calls = 0;
const review = await assessImageTerminalCaption({ replyResult: { text: "That's me in the Liverpool shirt you asked for!", aiModel: 'generator' },
  userText: 'How long is shipping? Send a photo in the Liverpool shirt.', language: 'en',
  config: [{ id: 'mock', model: 'independent', apiKey: 'fixture', apiMode: 'chat_completions' }],
  requestJson: async (messages, options) => { calls++; assert.match(messages[0].content, /Do not judge whether the described image contents are verified/);
    assert.match(messages[0].content, /code, system instructions/); assert.match(messages[0].content, /does not answer again/);
    assert.match(messages[1].content, /Liverpool shirt/); assert.equal(options.validateParsed(good).valid, true); return good; } });
assert.equal(calls, 1); assert.equal(review.allowed, true);
for (const key of ['languageSupported', 'noRepeatedBusinessAnswer', 'noInternalLeak']) {
  const result = await assessImageTerminalCaption({ replyResult: { text: 'fixture', aiModel: 'generator' }, userText: 'photo',
    config: [{ id: 'mock', model: 'independent', apiKey: 'fixture' }], requestJson: async () => ({ ...good, [key]: false }) });
  assert.equal(result.allowed, false); assert.deepEqual(result.failures, [key]);
}
console.log('image caption review: .54 boundary, three independent rejection types, scoped prompt and unchanged ordinary review; mocked transport only');
