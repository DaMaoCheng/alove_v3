import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
process.env.VENICE_API_KEY = 'isolated-appearance-check';
process.env.TYPESAFE_API_KEY = '';
const { classifyChatImageIntent } = await import('../server/chat-image-intent-classifier-service.js');
const { maybeCreateGuestChatImagePlaceholder } = await import('../server/chat-image-generation-service.js');
const prior = 'Imaginemos tu camiseta roja con pantalones blancos.';
const current = 'A ver, pásame tu imagen.';
const context = { recentConversation: [{ role: 'user', kind: 'text', text: prior },
  { role: 'assistant', kind: 'text', text: 'Podría ser un conjunto deportivo.' }] };
const base = { communicativeAction: 'request_visual_output', requestKind: 'character_image', imageSubject: 'character',
  hasIntent: true, allowed: true, confidence: 1, intentType: 'library_photo', requestScope: 'image_only',
  requestEvidence: current, actorEvidence: 'tu', actionEvidence: 'pásame', clothingTarget: 'none',
  explicitGeneration: false, wants_clothing: false, wants_no_clothing: false };
async function classify(parsed, conversationContext = context, userText = current) {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(parsed) } }] }) }; };
  const result = await classifyChatImageIntent(userText, { character: { id: 'mascot_fixture', category_id: 'mascot' },
    jevDecision: { ok: false }, conversationContext });
  assert.equal(calls, 1, 'appearance resolution reuses the same image classifier request');
  return result;
}
const appearance = { previousOutfit: 'clothed', previousEvidence: 'camiseta roja con pantalones blancos',
  relation: 'continue', currentEvidence: 'pásame', target: 'generic' };
const continued = await classify({ ...base, appearanceContext: appearance });
assert.equal(continued.conditions.wants_clothing, true, 'a continued USER outfit cannot silently become an ordinary library photo');
assert.equal(continued.explicitGeneration, true);
assert.equal(continued.clothingTarget, 'generic');
assert.equal(continued.conditions.wants_no_clothing, false);
const uncertain = await classify({ ...base, appearanceContext: { ...appearance, relation: 'uncertain' } });
assert.equal(uncertain.allowed, false, 'uncertain continuation requires clarification before any library/quota action');
assert.equal(uncertain.appearanceClarificationRequired, true);
const noTask = await maybeCreateGuestChatImagePlaceholder({ execute: async () => { throw Error('Clarification must not read gallery or reserve quota'); } }, {
  character: { id: 'mascot_fixture', category_id: 'mascot' }, userText: current, imageDecision: uncertain,
  conversationContext: context, jevDecision: { ok: false }, session: { id: 'session_fixture' }, guest: { id: 'guest_fixture' },
});
assert.equal(noTask.taskCreated, false); assert.equal(noTask.directive.reason, 'appearance_uncertain');
assert.match(noTask.directive.instruction, /clarification/);
const missing = await classify(base);
assert.equal(missing.allowed, false, 'a missing conditional resolution is not permission to discard prior appearance');
const normal = await classify({ ...base, appearanceContext: { previousOutfit: 'none', previousEvidence: '', relation: 'none', currentEvidence: '', target: 'none' } },
  { recentConversation: [{ role: 'user', kind: 'text', text: 'Hola, ¿cómo estás?' }] });
assert.equal(normal.allowed, true); assert.equal(normal.explicitGeneration, false);
const otherText = 'Pásame una foto tuya normal, sin aquel conjunto.';
const different = await classify({ ...base, requestEvidence: otherText, actionEvidence: 'Pásame', actorEvidence: 'tuya',
  appearanceContext: { ...appearance, relation: 'different', currentEvidence: 'sin aquel conjunto' } }, context, otherText);
assert.equal(different.allowed, true); assert.equal(different.conditions.wants_clothing, false);
const forged = await classify({ ...base, appearanceContext: { ...appearance, previousEvidence: 'fabricated outfit' } });
assert.equal(forged.allowed, false, 'assistant/invented outfit evidence cannot grant a continuation');
const delivered = await classify(base, { recentConversation: [...context.recentConversation,
  { role: 'assistant', kind: 'mascot_library_image', text: '' }] });
assert.equal(delivered.allowed, true); assert.equal(delivered.explicitGeneration, false, 'ordinary additional photos do not inherit old clothing');
const status = await classify({ ...base, hasIntent: false, allowed: false, intentType: 'none', requestKind: 'non_image',
  communicativeAction: 'other', appearanceContext: appearance });
assert.equal(status.hasIntent, false, 'prior outfit is never a new image permission');
console.log('image appearance resolution passed: same-call continuation, clarification, normal gallery, changed outfit, invalid evidence, delivery reset, no new permission');
