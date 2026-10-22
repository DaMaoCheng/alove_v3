import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { claimProactivePaidAttempt, finishProactivePaidAttempt, runProactivePaidAttempt, previewProactivePaidAttempt } from '../server/proactive-paid-attempt-service.js';

const HOUR = 3600000;
const start = new Date('2026-01-01T00:00:00Z');
const scope = { userId: 'budget_fixture', characterId: 'character', sessionId: 'session', latestUserMessageId: 'message' };
let payload, writes = 0, calls = 0;
let tail = Promise.resolve();
const db = { execute: async (sql, params) => {
  if (sql.includes('FROM users')) return [[{ id: scope.userId }]];
  if (sql.includes('SELECT payload_json')) return [payload ? [{ payload_json: payload }] : []];
  if (sql.includes('INSERT INTO memory_jobs')) { payload = params[3]; writes++; return [{ affectedRows: 1 }]; }
  if (sql.includes('job_status')) return [[{ id: 'job', job_status: 'completed', claim_token: 'old' }]];
  throw new Error(`Unexpected test SQL: ${sql}`);
} };
const transaction = work => {
  const current = tail.then(() => work(db)); tail = current.catch(() => {}); return current;
};
const options = (hours = 0) => ({ now: new Date(+start + hours * HOUR), transaction });
const reset = () => { payload = undefined; writes = 0; calls = 0; };
const work = async () => { calls++; return { sent: false, reason: 'proactive_quality_grounded_unverified' }; };
reset();
const concurrent = await Promise.all(Array.from({ length: 20 }, () => runProactivePaidAttempt(scope, work, options())));
assert.equal(concurrent.filter(item => item.reason === 'proactive_quality_grounded_unverified').length, 1);
assert.equal(calls, 1, 'duplicate concurrent tasks perform paid work only once');
for (let n = 0; n < 100; n++) await runProactivePaidAttempt(scope, work, options(25));
assert.equal(calls, 1, 'same rejected context remains blocked across days');
assert.equal((await runProactivePaidAttempt({ ...scope, latestUserMessageId: 'new' }, work, options(1))).reason, 'proactive_attempt_cooldown');
assert.equal(calls, 1, 'new user context does not bypass account failure cooldown');
await runProactivePaidAttempt({ ...scope, latestUserMessageId: 'new' }, work, options(6));
assert.equal(calls, 2, 'new context can try after six hours');
reset();
for (let n = 0; n < 4; n++) {
  const claim = await claimProactivePaidAttempt({ ...scope, characterId: `character${n}` }, options(n));
  assert.equal(claim.allowed, true);
  await finishProactivePaidAttempt(scope, claim.token, { sent: true }, options(n));
}
assert.equal((await claimProactivePaidAttempt({ ...scope, sessionId: 'different' }, options(4))).reason, 'proactive_attempt_daily_limit');
assert.equal((await claimProactivePaidAttempt(scope, options(24))).allowed, true, 'rolling 24h expiry restores one attempt');
reset();
await assert.rejects(runProactivePaidAttempt(scope, async () => { throw new Error('transport failure'); }, options()), /transport failure/);
assert.equal((await claimProactivePaidAttempt({ ...scope, latestUserMessageId: 'new' }, options(5))).reason, 'proactive_attempt_cooldown');
reset();
const pending = await claimProactivePaidAttempt(scope, options());
assert.equal((await claimProactivePaidAttempt(scope, options(1))).reason, 'proactive_attempt_cooldown', 'process crash keeps pending budget');
const next = await claimProactivePaidAttempt(scope, options(7));
await finishProactivePaidAttempt(scope, pending.token, { sent: false }, options(7));
await finishProactivePaidAttempt(scope, pending.token, { sent: true }, options(7));
assert.equal(JSON.parse(payload).attempts.find(item => item.token === pending.token).outcome, 'not_sent', 'stale duplicate finish cannot rewrite prior result');
assert.equal(JSON.parse(payload).attempts.find(item => item.token === next.token).outcome, 'pending', 'old token cannot overwrite new attempt');
reset();
await assert.rejects(claimProactivePaidAttempt({ ...scope, job: { id: 'job', claimToken: 'old' } }, options()), { code: 'MEMORY_JOB_LEASE_LOST' });
assert.equal(writes, 0, 'stale worker cannot reserve budget');
await assert.rejects(claimProactivePaidAttempt(scope, { ...options(), now: new Date('invalid') }), /Invalid proactive paid-attempt time/);
const saved = payload;
for (const invalid of [
  { version: 1, attempts: [{ token: 'old', at: 'corrupt-date', context: 'a'.repeat(64), outcome: 'pending' }], blockedContexts: {} },
  { version: 1, attempts: [], blockedContexts: [] },
]) {
  payload = JSON.stringify(invalid);
  await assert.rejects(claimProactivePaidAttempt(scope, options()), /Invalid proactive/);
}
payload = saved;
await runProactivePaidAttempt(scope, work, options());
const beforePreview = writes;
for (let n = 0; n < 100; n++) assert.equal((await previewProactivePaidAttempt(scope, { db, now: start })).allowed, false);
assert.equal(writes, beforePreview, 'preview performs no ledger writes');
payload = '{"version":0}';
await assert.rejects(claimProactivePaidAttempt(scope, options()), /Invalid proactive/);
const source = await readFile(new URL('../server/proactive-message-job-service.js', import.meta.url), 'utf8');
assert.ok(source.indexOf('return runProactivePaidAttempt(') < source.indexOf('await assessProactiveContent('), 'guard precedes every paid state classification in sender');
console.log('Proactive paid-attempt pure checks passed: concurrent dedup, rolling quota, cooldown, rejected context, crash, tokens, stale leases, fail closed.');

if (!process.argv.includes('--database') && !process.argv.includes('--claim-child')) process.exit(0);
const { SERVER_CONFIG } = await import('../server/config.js');
const { getDbPool, closeDbPool } = await import('../server/db-core.js');
assert.ok(['localhost', '127.0.0.1'].includes(SERVER_CONFIG.db.host));
assert.equal(Number(SERVER_CONFIG.db.port), 3307);
if (process.argv.includes('--claim-child')) {
  try {
    const userId = process.argv[process.argv.indexOf('--claim-child') + 1];
    console.log(JSON.stringify(await claimProactivePaidAttempt({ ...scope, userId })));
  } finally { await closeDbPool(); }
} else {
  const userId = `budget_check_${Date.now()}`;
  const pool = getDbPool();
  try {
    await pool.execute(`INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type)
      VALUES (?, ?, 'Budget test', 'not-a-password', ?, 'active', 'personal')`, [userId, userId, `${userId}@example.invalid`]);
    const claimResults = await Promise.allSettled(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [process.argv[1], '--claim-child', userId], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { error += data; });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve(JSON.parse(output.trim().split('\n').at(-1))) : reject(new Error(error)));
    })));
    for (const claim of claimResults) if (claim.status === 'rejected') throw claim.reason;
    const claims = claimResults.map(claim => claim.value);
    assert.equal(claims.filter(claim => claim.allowed).length, 1, 'independent OS processes contend on account row with exactly one winner');
    const restarted = await import(`../server/proactive-paid-attempt-service.js?restart=${Date.now()}`);
    assert.equal((await restarted.claimProactivePaidAttempt({ ...scope, userId })).reason, 'proactive_attempt_cooldown', 'fresh module reads persistent pending reservation');
    await pool.execute("DELETE FROM memory_jobs WHERE internal_uid = ? AND job_type = 'send_proactive_message'", [userId]);
    const [[ledger]] = await pool.execute("SELECT character_id, session_id, job_status FROM memory_jobs WHERE internal_uid = ?", [userId]);
    assert.equal(ledger.character_id, null); assert.equal(ledger.session_id, null); assert.equal(ledger.job_status, 'completed');
    let paidCalls = 0;
    for (let n = 0; n < 20; n++) await runProactivePaidAttempt({ ...scope, userId }, async () => { paidCalls++; return { sent: true }; });
    assert.equal(paidCalls, 0, 'repeated scheduling after executable-job cleanup spends nothing');
    await pool.execute('DELETE FROM memory_jobs WHERE internal_uid = ?', [userId]); // owned fixture only
    const [[character]] = await pool.execute("SELECT id FROM ai_characters WHERE character_status = 'published' AND visibility = 'public' LIMIT 1");
    assert.ok(character?.id);
    const sessionId = `budget_session_${Date.now()}`;
    await pool.execute(`INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, preferred_language)
      VALUES (?, ?, ?, 'Paid budget fixture', 'active', 'user', 'en')`, [sessionId, userId, character.id]);
    for (const [kind, text, order, age] of [['user', 'Hello', 10, 2], ['character', 'Just checking in. I’m here if you’d like to talk.', 20, 1]]) {
      await pool.execute(`INSERT INTO chat_messages (id, session_id, character_id, sender_type, sender_label, content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at)
        VALUES (?, ?, ?, ?, 'Fixture', 'text', ?, ?, 'sent', ?, ?, DATE_SUB(NOW(3), INTERVAL ? SECOND))`,
      [`${sessionId}_${kind}`, sessionId, character.id, kind, text, order, kind === 'user' ? 'user' : 'system', kind === 'user' ? null : 'proactive-nudge', age]);
    }
    const { sendProactiveMessageFromJob } = await import('../server/proactive-message-job-service.js');
    let classifications = 0;
    const classifyContent = async () => { classifications++; return { state: 'unknown' }; };
    const senderScope = { userId, characterId: character.id, sessionId, payload: { deliveryMode: 'daily_required', slotIndex: 1 } };
    assert.equal((await sendProactiveMessageFromJob(senderScope, { classifyContent })).reason, 'proactive_duplicate_history');
    for (let n = 0; n < 10; n++) {
      assert.equal((await sendProactiveMessageFromJob(senderScope, { classifyContent })).reason, 'proactive_attempt_context_rejected');
    }
    assert.equal(classifications, 1, 'real sender repeated no-job calls classify only once; no generated reply/TTS is needed');
    assert.equal((await previewProactivePaidAttempt({ userId, characterId: character.id, sessionId })).reason, 'proactive_attempt_context_rejected');
    console.log('Proactive paid-attempt MySQL checks passed: 8 processes, restart, task cleanup, real sender 11 calls / 1 controlled classification, scheduler preview blocked.');
  } finally {
    await pool.execute('DELETE FROM memory_jobs WHERE internal_uid = ?', [userId]);
    await pool.execute('DELETE FROM chat_message_index WHERE internal_uid = ?', [userId]);
    await pool.execute('DELETE FROM chat_sessions WHERE internal_uid = ?', [userId]);
    await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    await closeDbPool();
  }
}
