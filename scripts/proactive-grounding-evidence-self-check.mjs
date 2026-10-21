import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { classifyProactiveContent, PROACTIVE_CONTENT_REVIEW_TIMEOUT_MS } = await import('../server/proactive-content-policy-service.js');
const { getMemoryJobExecutionBudgetMs } = await import('../server/memory-job-policy.js');
assert.equal(PROACTIVE_CONTENT_REVIEW_TIMEOUT_MS, 20000, 'proactive policy gets the existing full independent review window');
assert(getMemoryJobExecutionBudgetMs({ jobType: 'send_proactive_message' }) > 3 * PROACTIVE_CONTENT_REVIEW_TIMEOUT_MS, 'outer job budget must accommodate initial and both candidate reviews');
const { buildReviewedProactiveCandidate } = await import('../server/proactive-message-job-service.js');
const config = { apiKey: 'isolated', baseUrl: 'https://proactive-evidence.invalid', model: 'fixture' };
const recentMessages = [
  { id: 'u1', senderType: 'user', text: 'Find a gift shirt', sentAt: '2026-10-05 10:00:00' },
  { id: 'a1', senderType: 'character', text: 'A Delphine Wespines shirt would be ideal.', sentAt: '2026-10-05 10:01:00' },
  { id: 'u2', senderType: 'user', text: 'I like Xanthea FC.', sentAt: '2026-10-19 09:00:00' },
];
const good = { state: 'shopping', candidateKind: 'shopping', confidence: .99, quality: { natural: true, grounded: true, novel: true } };
async function assess(candidateText, result, extra = {}) {
  return classifyProactiveContent({ recentMessages, candidateText, config, ...extra,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), { headers: { 'content-type': 'application/json' } }),
  });
}
const missing = await assess('Try a Delphine Wespines shirt.', good);
assert.equal(missing.quality.grounded, false, 'candidate approval without evidence protocol must fail closed');
assert.equal(missing.groundingFailure, 'missing_evidence');
const unsupported = await assess('Try a Delphine Wespines shirt.', { ...good, groundingEvidence: [{ candidateQuote: 'Delphine Wespines', sourceMessageId: 'u1', sourceQuote: 'Delphine Wespines' }] });
assert.equal(unsupported.quality.grounded, false, 'general gift request is not proof of an invented specific name');
assert.equal(unsupported.groundingFailure, 'source_mismatch');
const assistant = await assess('Try a Delphine Wespines shirt.', { ...good, groundingEvidence: [{ candidateQuote: 'Delphine Wespines', sourceMessageId: 'a1', sourceQuote: 'Delphine Wespines' }] });
assert.equal(assistant.quality.grounded, false, 'assistant suggestion cannot establish factual source');
const supplied = await assess('You mentioned Xanthea FC. What style would suit the gift?', { ...good, groundingEvidence: [{ candidateQuote: 'Xanthea FC', sourceMessageId: 'u2', sourceQuote: 'Xanthea FC' }] });
assert.equal(supplied.quality.grounded, true, 'an unfamiliar user-supplied entity is allowed as a historical reference, not verified catalogue stock');
const fakeCandidate = await assess('What style would suit the gift?', { ...good, groundingEvidence: [{ candidateQuote: 'Xanthea FC', sourceMessageId: 'u2', sourceQuote: 'Xanthea FC' }] });
assert.equal(fakeCandidate.groundingFailure, 'candidate_mismatch');
assert.equal((await assess('What style would suit the gift?', { ...good, groundingEvidence: [] })).quality.grounded, true, 'general preference question needs no fabricated evidence');
assert.equal((await assess('My favourite part of football is the atmosphere.', { ...good, candidateKind: 'care', groundingEvidence: [] })).quality.grounded, true, 'ordinary character preference remains allowed');
assert.equal((await assess('', good)).state, 'shopping', 'initial state review does not require candidate evidence');
for (const groundingEvidence of [{}, Array(9).fill({}), [{ candidateQuote: 'x'.repeat(241), sourceMessageId: 'u2', sourceQuote: 'Xanthea FC' }]]) {
  assert.equal((await assess('hello', { ...good, groundingEvidence })).quality.grounded, false, 'malformed or oversized evidence must not approve candidate');
}
assert.equal((await assess('x'.repeat(1001), { ...good, groundingEvidence: [] })).quality.grounded, false, 'unreviewed candidate tail must not bypass the bounded audit input');
const oldPlan = await assess('Your party is happening today.', { ...good, quality: { ...good.quality, grounded: false }, groundingEvidence: [] });
assert.equal(oldPlan.quality.grounded, false, 'evidence structure never overrules a semantic stale-plan rejection');
const malformed = await assess('How is your josera?', { ...good, quality: { ...good.quality, natural: false }, groundingEvidence: [] });
assert.equal(malformed.quality.natural, false, 'source evidence never overrides malformed-language rejection');
let generations = 0;
const rewritten = await buildReviewedProactiveCandidate({ character: {}, recentMessages, state: { state: 'shopping' },
  generateReply: async () => ({ text: ++generations === 1 ? 'Try a Delphine Wespines shirt.' : 'What style would suit the gift?' }),
  classifyContent: async ({ candidateText }) => assess(candidateText, generations === 1 ? good : { ...good, groundingEvidence: [] }),
});
assert.ok(rewritten.allowed && generations === 2, 'missing/invalid evidence triggers existing regeneration once, not reapproval loop');
const logs = [], decisions = [];
await assess('Try a Delphine Wespines shirt.', good, { logContext: { requestId: 'job_fixture', sessionId: 'session_fixture', userId: 'user_fixture', characterId: 'character_fixture' },
  recordProviderCallFn: async (event) => logs.push(event), recordDecisionLogFn: async (event) => decisions.push(event) });
assert.ok(logs.length && logs.every((event) => event.requestId === 'job_fixture' && event.sessionId === 'session_fixture'));
assert.equal(decisions.length, 1);
assert.match(decisions[0].errorMessage, /missing_evidence/);
assert.doesNotMatch(JSON.stringify(decisions), /Delphine|Find a gift|Xanthea/);
const unavailableLogs = [];
await classifyProactiveContent({ recentMessages, candidateText: 'hello', config,
  logContext: { requestId: 'job_fixture', sessionId: 'session_fixture' },
  fetchImpl: async () => { throw Object.assign(Error('PRIVATE upstream credential-looking raw text'), { code: 'AI_REPLY_TIMEOUT' }); },
  recordProviderCallFn: async () => {}, recordDecisionLogFn: async (event) => unavailableLogs.push(event),
});
assert.equal(unavailableLogs.length, 1);
assert.match(unavailableLogs[0].errorMessage, /stage=candidate; failure=timeout/);
assert.doesNotMatch(JSON.stringify(unavailableLogs), /PRIVATE|credential-looking/);
console.log('proactive grounding evidence self-check passed (isolated transport, no database/model calls)');
