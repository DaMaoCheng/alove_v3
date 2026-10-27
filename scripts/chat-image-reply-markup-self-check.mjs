import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const { cleanCurrentImageReplyMarkup } = await import('../server/chat-image-status-context-service.js');
const imageContext = { imageStatus: { kind: 'library', status: 'ready', currentTurn: true },
  _imageStatusAnchor: { messageId: 'image_fixture', assetId: null, scope: { sessionId: 'session_fixture', characterId: 'mascot_fixture', guestId: 'guest_fixture', order: 10 } } };
async function run(text, context, userText = 'Send your normal photo.') {
  return enforceReplyBoundary({ replyResult: { text, displayText: text, speechText: text, sourceType: 'ai' },
    character: { id: 'mascot_fixture' }, userText, chatImageContext: context, requireIdentityReview: true,
    searchIntent: { replyBoundary: { salesAllowed: true, contactAllowed: true } },
    recordReview: async () => {}, assess: async () => ({ reviewStatus: 'valid', allowed: true, confidence: 1,
      boundarySupported: true, imageStatusSupported: true, evidenceSupported: true, guidanceSupported: true }) });
}
const source = 'Aquí me tienes. ¿Qué te parece? {image:fictional_file}';
const clean = await run(source, imageContext);
assert.equal(clean.text, 'Aquí me tienes. ¿Qué te parece?', 'actual image-boundary entry must not publish synthetic image-control markup');
assert.equal(clean.speechText, clean.text);
const control = (await run(source, null)).text;
assert.match(control, /\{image:.*fictional_file\}/, 'ordinary text/code without a current real image is unchanged');
assert.match((await run(source, imageContext, 'Explain {image:example} and send a photo.')).text, /\{image:\s*fictional_file\}/, 'user-requested syntax remains literal');
assert.equal(cleanCurrentImageReplyMarkup({ text: source }, imageContext, 'Explain {image:example}').text, source);
const historical = { ...imageContext, imageStatus: { ...imageContext.imageStatus, currentTurn: false } };
assert.match((await run(source, historical)).text, /\{image:\s*fictional_file\}/, 'historical media cannot authorize unrelated text cleanup');
const mixed = await run('Puedes canjear puntos en tu centro personal. {image:fake}', imageContext);
assert.equal(mixed.text, 'Puedes canjear puntos en tu centro personal.', 'retain the independent mixed answer');
console.log('image reply markup: real boundary entry, display/speech, plain text/code, historical media and mixed-answer preservation passed');
