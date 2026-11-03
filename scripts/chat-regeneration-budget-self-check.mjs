import assert from 'node:assert/strict';
Object.assign(process.env, { AIOVE_PROVIDER_LOG_WRITE_ENABLED: 'false', VENICE_API_KEY: 'fixture', VENICE_BASE_URL: 'https://fixture.invalid/v1', VENICE_MODEL: 'fixture-primary', OPENAI_API_KEY: 'fixture', OPENAI_BASE_URL: 'https://alternate.invalid/v1', OPENAI_MODEL: 'fixture-alternate', OPENAI_FALLBACK_API_KEY: '', OPENAI_FALLBACK_MODEL: '' });
globalThis.fetch = async () => { throw Error('External requests forbidden'); };
const { generateChatReplyWithRequest } = await import('../server/ai-reply-service.js');
const { SERVER_CONFIG } = await import('../server/config.js');
const base = { promptContext: { systemPrompt: 'Fixture', messages: [] }, userText: 'Hi', recordReplyLogFn: async () => {}, useConfiguredModelFallback: true };
const good = JSON.stringify({ displayText: 'Hello there.', speechText: 'Hello there.' });
for (const budget of [15000, 30000, null, -1, 1, 120001, '30000']) {
 const seen = [], failures = [];
 const reply = await generateChatReplyWithRequest({ ...base, regeneration: true, regenerationTimeoutMs: budget, regenerationRecordDiagnostic: x => failures.push(x), requestReplyText: async (_, o) => { seen.push(o.timeoutMs); return good; } });
 assert.equal(reply.sourceType, 'ai'); assert.deepEqual(failures, []);
 assert.deepEqual(seen, [Number.isSafeInteger(budget) && budget >= 1000 && budget <= 120000 ? budget : SERVER_CONFIG.aiReply.chatTimeouts.generation]);
}
for (const succeedBackup of [true, false]) {
 const seen = [], failures = [];
 const reply = await generateChatReplyWithRequest({ ...base, regeneration: true, regenerationTimeoutMs: 30000, regenerationRecordDiagnostic: x => failures.push(x), requestReplyText: async (_, o) => {
 seen.push([o.modelConfig.model, o.timeoutMs]); if (succeedBackup && seen.length === 2) return good;
 throw Object.assign(Error('Fixture timeout'), { code: 'AI_REPLY_TIMEOUT' });
 } });
 assert.equal(seen.length, 2); assert.notEqual(seen[0][0], seen[1][0]); assert.deepEqual(seen.map(x => x[1]), [30000, 30000]);
 assert.equal(reply.sourceType, succeedBackup ? 'ai' : 'system'); assert.deepEqual(failures, succeedBackup ? [] : ['provider_timeout']);
}
const ordinary = [], diagnostics = [];
await generateChatReplyWithRequest({ ...base, regenerationTimeoutMs: 30000, regenerationRecordDiagnostic: x => diagnostics.push(x), requestReplyText: async (_, o) => { ordinary.push(o.timeoutMs); return good; } });
assert.deepEqual(ordinary, [SERVER_CONFIG.aiReply.chatTimeouts.generation]); assert.deepEqual(diagnostics, []);
console.log('Regeneration budget reaches real request seam; independent backup budgets, terminal-only diagnostics and ordinary defaults passed');
for (const [failure, expected] of [[{ code: 'AI_REPLY_PROTOCOL_ERROR', aiFailureReason: 'empty_ai_reply' }, 'invalid_shape'], [{ statusCode: 503 }, 'provider_error']]) {
 const notes = [];
 await generateChatReplyWithRequest({ ...base, regeneration: true, regenerationTimeoutMs: 15000, regenerationRecordDiagnostic: x => notes.push(x), requestReplyText: async () => { throw Object.assign(Error('Fixture failure'), failure); } });
 assert.deepEqual(notes, [expected]);
}
const ignored = [];
await generateChatReplyWithRequest({ ...base, regenerationRecordDiagnostic: x => ignored.push(x), requestReplyText: async () => { throw Object.assign(Error('Fixture unavailable'), { statusCode: 400 }); } });
assert.deepEqual(ignored, []);
console.log('Protocol/HTTP terminal diagnostics are finite; ordinary failures do not invoke regeneration diagnostics');
