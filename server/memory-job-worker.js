import { getDbPool, closeDbPool } from './db-core.js';
import { acquireDedicatedDbAdvisoryLock } from './db-advisory-lock-service.js';
import { configureNetworkProxy } from './network-proxy.js';
import { MEMORY_JOB_TYPES, claimNextMemoryJob, completeMemoryJob, failMemoryJob,
  heartbeatMemoryJob, assertMemoryJobLease, listStaleRunningMemoryJobs, recoverStaleChatImageJobs,
  recoverStaleClaimedGuestContextJobs, recoverStaleMascotCampaignJobs } from './memory-job-service.js';
import { executeMemoryJob } from './memory-job-executor-service.js';
import { enqueueDefaultMemoryMaintenanceJobs, enqueuePeriodicMemoryMaintenanceJobs } from './memory-job-maintenance-service.js';
import { expireQueuedChatImageJobs, finalizeInterruptedChatImageJob } from './chat-image-job-service.js';
import { reconcileInterruptedProactiveJob } from './proactive-message-job-service.js';
import { reconcileFailedMascotCampaignDeliveries } from './mascot-campaign-delivery-job-service.js';
import { memoryJobClaimFilter, canRetryInterruptedMemoryJob, MEMORY_JOB_HEARTBEAT_MS, MEMORY_JOB_STALE_MS } from './memory-job-policy.js';

const CLAIM_RETRY_DELAYS_MS = Object.freeze([100, 250, 500]);
const stage = value => { if (process.connected) process.send({ type: 'stage', stage: value }); };
const send = message => new Promise(resolve => { if (process.connected) process.send(message, () => resolve()); else resolve(); });

// This is an execution entrypoint, never imported by the web app. A disconnected
// parent cannot leave a worker or its subprocesses delivering customer messages.
process.once('disconnect', () => {
  if (process.platform !== 'win32') {
    try { process.kill(-process.pid, 'SIGKILL'); } catch {}
  }
  process.exit(1);
});

process.once('message', async input => {
  configureNetworkProxy();
  try {
    const result = await perform(input || {});
    await send({ type: 'result', ok: true, result });
    await closeAndExit(0);
  } catch (error) {
    await send({ type: 'result', ok: false, error: {
      code: error?.code || 'MEMORY_WORKER_ERROR', message: String(error?.message || 'Memory worker failed').slice(0, 500), retryable: error?.retryable === true,
    } });
    await closeAndExit(1);
  }
});

async function closeAndExit(code) {
  const fallback = setTimeout(() => process.exit(code), 1000);
  try { await closeDbPool(); } finally { clearTimeout(fallback); process.exit(code); }
}

async function perform({ operation, lane, job, jobId } = {}) {
  if (operation === 'runNext') return runNext(lane, jobId);
  if (operation === 'settle') return settleStoppedJob(job);
  if (operation === 'expireImages') { stage('image_expiry'); return { expiredImages: await expireQueuedChatImageJobs({ limit: 10, maxRunMs: 2000 }) }; }
  if (operation === 'watchdog') {
    stage('watchdog');
    // Legacy recovery remains conservative (NULL execution token only). Live
    // token workers are reconciled only after their execution lock is released.
    await recoverStaleChatImageJobs();
    await recoverStaleClaimedGuestContextJobs();
    await recoverStaleMascotCampaignJobs();
    const candidates = await listStaleRunningMemoryJobs({ before: new Date(Date.now() - MEMORY_JOB_STALE_MS), limit: 10 });
    const recovered = [];
    for (const current of candidates) {
      if (!current.claimToken || Date.now() - new Date(current.updatedAt).getTime() < MEMORY_JOB_STALE_MS) continue;
      recovered.push(await settleStoppedJob(current));
    }
    await reconcileFailedMascotCampaignDeliveries();
    return { recovered: recovered.length };
  }
  if (operation === 'startupMaintenance') { await enqueueDefaultMemoryMaintenanceJobs(); return { ok: true }; }
  if (operation === 'periodicMaintenance') { await enqueuePeriodicMemoryMaintenanceJobs(); return { ok: true }; }
  throw new Error('Unsupported memory worker operation');
}

async function claimNextMemoryJobWithRetry(lane, jobId) {
  for (let attempt = 0; attempt <= CLAIM_RETRY_DELAYS_MS.length; attempt++) {
    try { return await claimNextMemoryJob({ ...memoryJobClaimFilter(lane), ...(jobId ? { jobId } : {}) }); }
    catch (error) {
      if (!isDeadlockError(error)) throw error;
      if (attempt >= CLAIM_RETRY_DELAYS_MS.length) {
        console.warn('[aiove] memory job claim skipped after deadlock retries'); return null;
      }
      await sleep(CLAIM_RETRY_DELAYS_MS[attempt]);
    }
  }
  return null;
}
function isDeadlockError(error) { return error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213 || error?.sqlState === '40001'; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runNext(lane, jobId) {
  const job = await claimNextMemoryJobWithRetry(lane, jobId);
  if (!job) return { worked: false };
  await send({ type: 'claimed', job });
  const release = await acquireDedicatedDbAdvisoryLock(`memory-job-execution:${job.id}`, 0);
  let heartbeatBusy = false;
  const timer = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      if (!await heartbeatMemoryJob(job.id, { claimToken: job.claimToken })) process.kill(process.pid, 'SIGTERM');
    } catch { stage('heartbeat_error'); }
    finally { heartbeatBusy = false; }
  }, MEMORY_JOB_HEARTBEAT_MS);
  try {
    await assertMemoryJobLease(getDbPool(), job, { lock: false });
    job.reportStage = stage;
    stage('executing');
    try {
      const result = await executeMemoryJob(job);
      stage('committing_job');
      if (!await completeMemoryJob(job.id, result || { ok: true }, { claimToken: job.claimToken })) {
        throw Object.assign(new Error('Memory execution lease changed before completion'), { code: 'MEMORY_JOB_LEASE_LOST', retryable: false });
      }
      return { worked: true, completed: true };
    } catch (error) {
      await failMemoryJob(job.id, error, { claimToken: job.claimToken,
        retryable: job.jobType !== MEMORY_JOB_TYPES.NOOP && error?.retryable !== false, delayMs: 2000 });
      if (job.jobType === MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH) await reconcileFailedMascotCampaignDeliveries({ deliveryId: job.payload?.deliveryId });
      return { worked: true, failed: true, code: error?.code || 'MEMORY_JOB_FAILED' };
    }
  } finally { clearInterval(timer); await release(); }
}

async function settleStoppedJob(job) {
  if (!job?.id || !job?.claimToken) return { skipped: 'no_execution_token' };
  let release;
  try { release = await acquireDedicatedDbAdvisoryLock(`memory-job-execution:${job.id}`, 0); }
  catch (error) { if (error.statusCode === 429) return { skipped: 'worker_still_active' }; throw error; }
  try {
    try { await assertMemoryJobLease(getDbPool(), job, { lock: false }); }
    catch (error) { if (error.code === 'MEMORY_JOB_LEASE_LOST') return { skipped: 'lease_changed' }; throw error; }
    const error = Object.assign(new Error('Task execution was interrupted; previous worker has exited'), { code: 'MEMORY_JOB_INTERRUPTED', retryable: false });
    let committed = null;
    if (job.jobType === MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE) {
      const result = await finalizeInterruptedChatImageJob(job, error);
      if (result.ready) committed = { ok: true, recovered: true, status: 'ready' };
    } else if (job.jobType === MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE) {
      const result = await reconcileInterruptedProactiveJob(job);
      if (result.sent) committed = { ok: true, recovered: true, sent: true, messageId: result.messageId };
    }
    if (committed) await completeMemoryJob(job.id, committed, { claimToken: job.claimToken });
    else await failMemoryJob(job.id, error, { claimToken: job.claimToken, retryable: canRetryInterruptedMemoryJob(job), delayMs: 2000 });
    if (job.jobType === MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH) await reconcileFailedMascotCampaignDeliveries({ deliveryId: job.payload?.deliveryId });
    return { settled: true, alreadyCommitted: Boolean(committed) };
  } finally { await release(); }
}
