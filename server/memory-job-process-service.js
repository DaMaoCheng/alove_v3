import { fork } from 'node:child_process';
import { getMemoryJobExecutionBudgetMs, MEMORY_JOB_CONTROL_TIMEOUT_MS } from './memory-job-policy.js';

const DEFAULT_WORKER = new URL('./memory-job-worker.js', import.meta.url);

// Resolve only after exit. A timeout never leaves the old executor writing while
// the caller settles/retries the job. workerUrl/budgets are local test seams only.
export function createMemoryJobProcess({ operation, lane, job, jobId, workerUrl = DEFAULT_WORKER,
  controlTimeoutMs = MEMORY_JOB_CONTROL_TIMEOUT_MS, budgetForJob = getMemoryJobExecutionBudgetMs,
  killGraceMs = 1000, onEvent = () => {}, forkImpl = fork } = {}) {
  let child, deadline, killTimer, terminal, stopped, claimedJob = job, lastStage = 'starting';
  const startedAt = Date.now();
  const makeError = (code, message) => Object.assign(new Error(message), {
    code, retryable: false, job: claimedJob, stage: lastStage,
  });
  const emit = (event, extra = {}) => {
    try { onEvent({ event, jobId: claimedJob?.id || '', jobType: claimedJob?.jobType || '', stage: lastStage, elapsedMs: Date.now() - startedAt, ...extra }); } catch {}
  };
  const signalGroup = signal => {
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') emit('signal_error', { code: error.code }); }
  };
  const stop = (code = 'MEMORY_JOB_STOPPED') => {
    if (stopped) return;
    stopped = makeError(code, code === 'MEMORY_JOB_TIMEOUT' ? 'Memory job execution deadline exceeded' : 'Memory job worker stopped');
    emit('stopping', { code });
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
  };
  const arm = ms => { clearTimeout(deadline); deadline = setTimeout(() => stop('MEMORY_JOB_TIMEOUT'), Math.max(1, ms)); };
  const promise = new Promise((resolve, reject) => {
    try {
      child = forkImpl(workerUrl, [], { detached: process.platform !== 'win32', execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    } catch (error) { reject(error); return; }
    arm(controlTimeoutMs);
    child.on('message', message => {
      if (!message || typeof message !== 'object' || stopped) return;
      if (message.type === 'claimed' && message.job?.id) {
        claimedJob = message.job;
        lastStage = 'claimed';
        arm(budgetForJob(claimedJob));
        emit('claimed');
      } else if (message.type === 'stage' && /^[a-z_]{1,48}$/.test(message.stage || '')) {
        lastStage = message.stage; emit('stage');
      } else if (message.type === 'result') terminal = message;
    });
    child.once('error', error => { terminal = { ok: false, error: { code: error.code || 'MEMORY_WORKER_ERROR', message: error.message } }; });
    child.once('close', (code, signal) => {
      clearTimeout(deadline); clearTimeout(killTimer);
      // Also stop descendants after the main worker exits during cancellation.
      if (stopped) signalGroup('SIGKILL');
      emit('exited', { code: stopped?.code || terminal?.error?.code || '', exitCode: code, signal });
      if (stopped) { reject(stopped); return; }
      if (terminal?.ok === true && code === 0) { resolve({ ...terminal.result, claimedJob }); return; }
      const error = makeError(terminal?.error?.code || 'MEMORY_WORKER_EXIT', terminal?.error?.message || 'Memory worker exited without a result');
      error.retryable = terminal?.error?.retryable === true;
      reject(error);
    });
    child.send({ operation, lane, job, jobId }, error => { if (error) stop('MEMORY_WORKER_IPC_ERROR'); });
  });
  return { promise, stop };
}
