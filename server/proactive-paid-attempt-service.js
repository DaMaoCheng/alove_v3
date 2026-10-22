import { createHash, randomUUID } from 'node:crypto';
import { getDbPool, withTransaction } from './db-core.js';
import { loadLatestProactiveUserMessageId } from './proactive-content-policy-service.js';
import { assertMemoryJobLease } from './memory-job-service.js';

// A completed, account-scoped ledger is deliberately separate from executable jobs
// and has no session/character foreign key: cleaning a task/session must not reset cost limits.
const LEDGER_TYPE = 'proactive_paid_attempt_budget';
const DAY_MS = 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const digest = value => createHash('sha256').update(value).digest('hex');
const ledgerId = userId => `proactive_budget_${digest(userId).slice(0, 40)}`;
const checkedTime = now => {
  const time = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(time) || time < 0) throw new TypeError('Invalid proactive paid-attempt time');
  return time;
};
const contextId = scope => digest(JSON.stringify([scope.sessionId, scope.characterId, scope.latestUserMessageId || '']));
const semanticRejection = reason => /^proactive_(?:duplicate|quality|content_unverified|after_sales_protected|state_unavailable|policy_rejected)/.test(String(reason || ''));

function parseLedger(value) {
  const ledger = typeof value === 'string' ? JSON.parse(value) : value;
  if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.attempts) || !ledger.blockedContexts || typeof ledger.blockedContexts !== 'object' || Array.isArray(ledger.blockedContexts)
      || !Object.values(ledger.blockedContexts).every(value => value === true)
      || !ledger.attempts.every(attempt => attempt && typeof attempt.token === 'string' && attempt.token
        && typeof attempt.context === 'string' && /^[a-f0-9]{64}$/.test(attempt.context)
        && Number.isFinite(attempt.at) && attempt.at >= 0
        && ['pending', 'sent', 'not_sent'].includes(attempt.outcome)
        && (attempt.finishedAt === undefined || (Number.isFinite(attempt.finishedAt) && attempt.finishedAt >= attempt.at)))) {
    throw new Error('Invalid proactive paid-attempt ledger'); // fail closed; never reset a corrupt budget
  }
  return ledger;
}

async function lockedLedger(db, userId) {
  const [users] = await db.execute('SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [userId]);
  if (!users[0]) throw new Error('Proactive paid-attempt account missing');
  const [rows] = await db.execute('SELECT payload_json FROM memory_jobs WHERE id = ? AND job_type = ? LIMIT 1 FOR UPDATE', [ledgerId(userId), LEDGER_TYPE]);
  return rows[0] ? parseLedger(rows[0].payload_json) : { version: 1, attempts: [], blockedContexts: {} };
}

async function writeLedger(db, userId, ledger) {
  await db.execute(`INSERT INTO memory_jobs
    (id, internal_uid, character_id, session_id, job_type, job_status, completed_at, max_retries, payload_json)
    VALUES (?, ?, NULL, NULL, ?, 'completed', NOW(3), 0, ?)
    ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), updated_at = NOW(3)`,
  [ledgerId(userId), userId, LEDGER_TYPE, JSON.stringify(ledger)]);
}

function inspectBudget(ledger, scope, time) {
  if (ledger.blockedContexts[contextId(scope)]) return { allowed: false, reason: 'proactive_attempt_context_rejected' };
  const recent = ledger.attempts.filter(attempt => time - attempt.at < DAY_MS);
  if (recent.length >= MAX_ATTEMPTS) return { allowed: false, reason: 'proactive_attempt_daily_limit' };
  if (recent.some(attempt => attempt.outcome !== 'sent' && time - (attempt.finishedAt ?? attempt.at) < FAILURE_COOLDOWN_MS)) {
    return { allowed: false, reason: 'proactive_attempt_cooldown' };
  }
  return { allowed: true };
}

// A scheduling hint only. The sender must still claim atomically immediately
// before paid work; a stale preview can never grant spending permission.
export async function previewProactivePaidAttempt(scope, { db = getDbPool(), now = new Date() } = {}) {
  const [rows] = await db.execute('SELECT payload_json FROM memory_jobs WHERE id = ? AND job_type = ? LIMIT 1', [ledgerId(scope.userId), LEDGER_TYPE]);
  if (!rows[0]) return { allowed: true };
  const latestUserMessageId = scope.latestUserMessageId ?? await loadLatestProactiveUserMessageId(db, scope.sessionId);
  return inspectBudget(parseLedger(rows[0].payload_json), { ...scope, latestUserMessageId }, checkedTime(now));
}

export async function claimProactivePaidAttempt(scope, { now = new Date(), transaction = withTransaction } = {}) {
  if (!scope.userId || !scope.sessionId || !scope.characterId) return { allowed: false, reason: 'proactive_attempt_missing_scope' };
  return transaction(async db => {
    const ledger = await lockedLedger(db, scope.userId);
    if (scope.job?.id) await assertMemoryJobLease(db, scope.job, { lock: true });
    const time = checkedTime(now);
    const context = contextId(scope);
    const decision = inspectBudget(ledger, scope, time);
    if (!decision.allowed) return decision;
    ledger.attempts = ledger.attempts.filter(attempt => time - attempt.at < DAY_MS);
    const token = randomUUID();
    // Reserve cost before any external call. Crashes leave this pending reservation
    // counted and cooled down; retries/new jobs cannot turn it into free attempts.
    ledger.attempts.push({ token, at: time, context, outcome: 'pending' });
    await writeLedger(db, scope.userId, ledger);
    return { allowed: true, token };
  });
}

export async function finishProactivePaidAttempt(scope, token, result, { now = new Date(), transaction = withTransaction } = {}) {
  return transaction(async db => {
    const ledger = await lockedLedger(db, scope.userId);
    const attempt = ledger.attempts.find(item => item.token === token);
    if (!attempt || attempt.outcome !== 'pending') return;
    attempt.outcome = result?.sent === true ? 'sent' : 'not_sent';
    attempt.finishedAt = checkedTime(now);
    if (result?.sent !== true && semanticRejection(result?.reason)) ledger.blockedContexts[attempt.context] = true;
    await writeLedger(db, scope.userId, ledger);
  });
}

export async function runProactivePaidAttempt(scope, work, options = {}) {
  const claim = await claimProactivePaidAttempt(scope, options);
  if (!claim.allowed) return { ok: true, sent: false, reason: claim.reason };
  let result;
  try {
    result = await work();
    return result;
  } finally {
    await finishProactivePaidAttempt(scope, claim.token, result, options);
  }
}
