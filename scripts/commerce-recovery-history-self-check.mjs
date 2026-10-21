import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { buildCommerceConversationContext, classifyCommerceIntent } = await import('../server/product-intent-classifier-service.js');
import { buildUnansweredUserQuestionContext, normalizeUnansweredUserQuestion } from '../server/chat-reply-recovery-state.js';

const text = 'No puedo verificar esa solicitud. Puedo mostrarte el formulario de soporte.';
const recovery = { version: 1, kind: 'review', reviewStatus: 'timeout', failedContracts: ['candidate_confirmation'], guardApplied: true };
const history = [
  { senderType: 'user', text, replyRecoveryState: recovery },
  { senderType: 'character', text, replyRecoveryState: recovery },
  { sender_type: 'character', text_content: text },
  { senderType: 'character', text, replyRecoveryState: { ...recovery, guardApplied: false } },
  { senderType: 'character', text: 'La camiseta tiene manga larga. ¿Es esta?', product: { productId: 'actual', name: 'Actual Catalogue Shirt' } },
];
const before = JSON.stringify(history);
const context = buildCommerceConversationContext(history);
assert.equal(context[1].text, '', 'server-marked degraded assistant output must not enter commerce as ordinary semantic history');
assert.deepEqual(context[1].degradedReply, { kind: 'review', reviewStatus: 'timeout' });
assert.equal(context[0].role, 'user');
assert.equal(context[0].text, text, 'the same user words remain actual user intent, regardless of a supplied marker');
assert.equal(context[0].degradedReply, undefined);
assert.equal(context[2].text, text, 'unmarked assistant text must never be classified as a failure by wording');
assert.equal(context[3].text, text, 'invalid server markers do not erase ordinary text');
assert.equal(context[4].text, 'La camiseta tiene manga larga. ¿Es esta?');
assert.deepEqual(context[4].productCard, { id: 'actual', name: 'Actual Catalogue Shirt' });
assert.equal(JSON.stringify(history), before, 'original history and its private user requirements remain unchanged');
const oldCard = { senderType: 'character', product: { id: 'old', name: 'An Actual Older Card' } };
const clipped = buildCommerceConversationContext([oldCard, ...Array.from({ length: 8 }, (_, index) => ({ senderType: 'user', text: String(index) }))]);
assert.equal(clipped.length, 7, 'the existing bounded last-card reference remains available');
assert.equal(clipped[0].productCard.id, 'old');
const originalQuestion = { senderType: 'user', text: 'Why are these two styles priced differently?', characterId: 'character-fixture' };
const failedAnswer = { senderType: 'character', text: 'Rejected assistant explanation', replyRecoveryState: recovery, characterId: 'character-fixture' };
assert.deepEqual(buildUnansweredUserQuestionContext([originalQuestion, failedAnswer], { characterId: 'character-fixture' }), { text: originalQuestion.text });
assert.equal(buildUnansweredUserQuestionContext([originalQuestion, failedAnswer], { characterId: 'other-character' }), null);
for (const rows of [[], [originalQuestion], [originalQuestion, { ...failedAnswer, replyRecoveryState: null }],
  [failedAnswer, originalQuestion], [originalQuestion, failedAnswer, { senderType: 'user', text: 'new topic' }],
  [originalQuestion, failedAnswer, { senderType: 'character', text: 'ordinary successful answer' }],
  [{ ...originalQuestion, text: 'x'.repeat(1201) }, failedAnswer],
  [originalQuestion, { ...failedAnswer, contentType: 'product' }],
  [originalQuestion, { ...failedAnswer, senderType: 'user' }]]) assert.equal(buildUnansweredUserQuestionContext(rows), null);
assert.deepEqual(normalizeUnansweredUserQuestion({ text: ' current user evidence ', salesAllowed: true, productId: 'invented', assistant: text }), { text: 'current user evidence' });
for (const value of [null, [], { text: '' }, { text: 123 }, { text: 'x'.repeat(1201) }]) assert.equal(normalizeUnansweredUserQuestion(value), null);
for (const [currentText, rows, expectedQuestion, route] of [
  ['Please answer my question', [originalQuestion, failedAnswer], originalQuestion.text, 'store_policy'],
  ['Forget shopping. Let us talk about music.', [originalQuestion, failedAnswer], originalQuestion.text, 'chat'],
  ['How is the weather?', [originalQuestion, { ...failedAnswer, replyRecoveryState: null }], null, 'chat'],
]) {
  const decision = await classifyCommerceIntent(currentText, { recentMessages: rows, characterId: 'character-fixture',
    config: { apiKey: 'fixture', baseUrl: 'https://fixture.invalid', model: 'fixture' }, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body), packet = JSON.parse(body.messages[1].content);
      assert.equal(packet.latestMessage, currentText, 'current user input remains the authoritative classification target');
      assert.equal(body.messages.at(-1).content, currentText, 'all commerce turns isolate the authoritative current message from history');
      assert.deepEqual(packet.unansweredUserQuestion, expectedQuestion ? { text: expectedQuestion } : null);
      assert.match(body.messages[0].content, /A new topic, refusal or cancellation in the current message takes precedence/);
      assert.match(body.messages[0].content, /Comparing two prices or items is productRequest relation comparison, never multiple independent purchases/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ route, topic: 'price', confidence: .95,
        knowledgeScope: 'business', knowledgeQuery: route === 'store_policy' ? originalQuestion.text : '', needsLiveProductData: false,
        replyBoundary: { salesAllowed: false, contactAllowed: true }, productRequest: { relation: 'none', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
      }) } }] }) };
    } });
  assert.equal(decision.route, route);
  assert.equal(decision.needsLiveProductData, false, 'historical context never opens product lookup');
  assert.equal(decision.replyBoundary.salesAllowed, false, 'historical question never grants sales permission');
}
console.log('commerce recovery history self-check passed: provenance-only degraded projection, user/ordinary assistant/card history preserved; no model/DB/network calls');
