import assert from 'node:assert/strict';
import * as jobs from '../server/memory-job-service.js';

// Pure checks do not initialize or connect to any database.
assert.equal(typeof jobs.assertMemoryJobLease, 'function', 'lease guard must be exported');
let calls = 0;
const stub = { execute: async (sql, params) => {
  calls++;
  assert.match(sql, /FOR UPDATE/);
  assert.equal(params[0], 'fixture');
  return [[{ id: 'fixture', job_status: 'running', claim_token: 'current' }]];
} };
await jobs.assertMemoryJobLease(stub, { id: 'fixture', claimToken: 'current' });
await assert.rejects(jobs.assertMemoryJobLease(stub, { id: 'fixture', claimToken: 'old' }), { code: 'MEMORY_JOB_LEASE_LOST' });
await assert.rejects(jobs.assertMemoryJobLease(stub, { id: 'fixture' }), { code: 'MEMORY_JOB_LEASE_LOST' });
assert.equal(calls, 3);
await jobs.assertMemoryJobLease({ execute: async () => [[{ id: 'legacy', job_status: 'running', claim_token: null }]] }, { id: 'legacy' });
await assert.rejects(jobs.assertMemoryJobLease({ execute: async () => [[{ id: 'done', job_status: 'completed', claim_token: 'current' }]] }, { id: 'done', claimToken: 'current' }), { code: 'MEMORY_JOB_LEASE_LOST' });
await assert.rejects(jobs.assertMemoryJobLease({ execute: async () => [[]] }, { id: 'absent', claimToken: 'current' }), { code: 'MEMORY_JOB_LEASE_LOST' });
for (const id of ['not-prefixed', 'mem_job_has spaces', 'mem_job_' + 'x'.repeat(57)]) {
  await assert.rejects(jobs.enqueueMemoryJob({ id }, { execute: async () => { throw Error('invalid ID reached SQL'); } }), TypeError);
}
const stableId = 'mem_job_img_fail_' + 'a'.repeat(32);
let stableInsertParams;
assert.equal(await jobs.enqueueMemoryJob({ id: stableId, jobType: jobs.MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE_FAILURE_REPLY }, {
  execute: async (_sql, params) => { stableInsertParams = params; return [{ affectedRows: 1 }]; },
}), stableId);
assert.equal(stableInsertParams[0], stableId);
assert.match(await jobs.enqueueMemoryJob({}, { execute: async () => [{ affectedRows: 1 }] }), /^mem_job_/);
await assert.rejects(jobs.listStaleRunningMemoryJobs({ before: 'invalid' }), TypeError);
await assert.rejects(jobs.listStaleRunningMemoryJobs(), TypeError);
console.log('memory job lease pure guards passed');

if (!process.argv.includes('--database')) process.exit(0);
// Run serially against the already-migrated local database; never run seed/bootstrap.
const { SERVER_CONFIG } = await import('../server/config.js');
const { getDbPool, closeDbPool } = await import('../server/db.js');
assert.ok(['127.0.0.1', 'localhost'].includes(SERVER_CONFIG.db.host));
assert.equal(Number(SERVER_CONFIG.db.port), 3307);
const db = getDbPool();
const type = `lease_fixture_${Date.now()}`;
const ids = [];
async function claimFixture() {
  try { return await jobs.claimNextMemoryJob({ includeTypes: [type] }); }
  catch (error) {
    // Repeatable-read lock races may choose one claimant as a deadlock victim;
    // the runner owns bounded deadlock retry. It must not create a second owner.
    if (error.code === 'ER_LOCK_DEADLOCK') return null;
    throw error;
  }
}
try {
  const firstId = await jobs.enqueueMemoryJob({ jobType: type, maxRetries: 1 }); ids.push(firstId);
  const [first, competitor] = await Promise.all([
    claimFixture(),
    claimFixture(),
  ]);
  const owned = first || competitor;
  assert.ok(owned?.claimToken);
  assert.equal([first, competitor].filter(Boolean).length, 1, 'concurrent claim must have one owner');
  assert.equal(owned.id, firstId);
  assert.equal(await jobs.heartbeatMemoryJob(firstId), false, 'legacy caller cannot heartbeat owned attempt');
  assert.equal(await jobs.completeMemoryJob(firstId, { stale: true }), false);
  assert.equal(await jobs.failMemoryJob(firstId, Error('stale'), { claimToken: 'old' }), false);
  assert.equal(await jobs.heartbeatMemoryJob(firstId, { claimToken: owned.claimToken }), true);
  const [[before]] = await db.execute('SELECT started_at, claimed_at FROM memory_jobs WHERE id = ?', [firstId]);
  assert.equal(await jobs.failMemoryJob(firstId, Error('retry'), { claimToken: owned.claimToken, retryable: true }), true);
  const retry = await jobs.claimNextMemoryJob({ includeTypes: [type] });
  assert.notEqual(retry.claimToken, owned.claimToken);
  assert.equal(await jobs.completeMemoryJob(firstId, null, { claimToken: owned.claimToken }), false);
  assert.equal(await jobs.failMemoryJob(firstId, Error('stale'), { claimToken: owned.claimToken }), false);
  await jobs.assertMemoryJobLease(db, retry, { lock: false });
  assert.equal(await jobs.completeMemoryJob(firstId, { ok: true }, { claimToken: retry.claimToken }), true);
  assert.equal(await jobs.heartbeatMemoryJob(firstId, { claimToken: retry.claimToken }), false);
  const [[after]] = await db.execute('SELECT started_at FROM memory_jobs WHERE id = ?', [firstId]);
  assert.equal(new Date(after.started_at).getTime(), new Date(before.started_at).getTime(), 'initial start must not be heartbeat/retry clock');
  const secondId = await jobs.enqueueMemoryJob({ jobType: type }); ids.push(secondId);
  assert.equal(await jobs.claimNextMemoryJob({ jobId: secondId, includeTypes: [type], excludeTypes: [type] }), null);
  const second = await jobs.claimNextMemoryJob({ jobId: secondId, includeTypes: [type] });
  assert.equal(second.id, secondId);
  await db.execute('UPDATE memory_jobs SET claim_token = NULL WHERE id = ?', [secondId]);
  assert.equal(await jobs.completeMemoryJob(secondId, { legacy: true }), true, 'NULL lease compatibility');
  const recoverId = await jobs.enqueueMemoryJob({ jobType: jobs.MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE, availableAt: new Date(Date.now() + 3_600_000) }); ids.push(recoverId);
  await db.execute("UPDATE memory_jobs SET job_status = 'running', claim_token = 'still-owned', updated_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR) WHERE id = ?", [recoverId]);
  assert.equal(await jobs.recoverStaleChatImageJobs({ jobId: recoverId }), 0, 'generic recovery must never steal token owner');
  await db.execute("UPDATE memory_jobs SET claim_token = NULL, updated_at = NOW(3) WHERE id = ?", [recoverId]);
  assert.equal(await jobs.recoverStaleChatImageJobs({ jobId: recoverId }), 0, 'legacy live heartbeat must be respected');
  await db.execute("UPDATE memory_jobs SET updated_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR) WHERE id = ?", [recoverId]);
  assert.equal(await jobs.recoverStaleChatImageJobs({ jobId: recoverId, availableAt: new Date(Date.now() + 3_600_000) }), 1);
  const stableDbId = `mem_job_lease_fixed_${Date.now()}`;
  await jobs.enqueueMemoryJob({ id: stableDbId, jobType: type }); ids.push(stableDbId);
  await assert.rejects(jobs.enqueueMemoryJob({ id: stableDbId, jobType: type }), { code: 'ER_DUP_ENTRY' });
  const [[stableCount]] = await db.execute('SELECT COUNT(*) AS n FROM memory_jobs WHERE id = ?', [stableDbId]);
  assert.equal(Number(stableCount.n), 1);
  const oldCutoff = new Date(Date.now() - 30 * 60_000);
  await db.execute("UPDATE memory_jobs SET job_status = 'running', claim_token = 'old-owner', updated_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR) WHERE id = ?", [stableDbId]);
  const stale = await jobs.listStaleRunningMemoryJobs({ before: oldCutoff, limit: 100 });
  assert.ok(stale.some((job) => job.id === stableDbId && job.claimToken === 'old-owner'));
  assert.ok(stale.every((job) => job.jobStatus === 'running' && job.claimToken && new Date(job.updatedAt) < oldCutoff));
  assert.ok(stale.every((job, index) => index === 0 || new Date(stale[index - 1].updatedAt) <= new Date(job.updatedAt)));
  console.log('memory job lease local database concurrency/CAS/filter/recovery guards passed');
} finally {
  if (ids.length) await db.execute(`DELETE FROM memory_jobs WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await closeDbPool();
}
