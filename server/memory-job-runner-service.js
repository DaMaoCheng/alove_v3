import { SERVER_CONFIG } from './config.js';
import { createMemoryJobProcess } from './memory-job-process-service.js';

const MAINTENANCE_ENQUEUE_INTERVAL_MS = 60 * 60 * 1000;
const STALE_IMAGE_JOB_RECOVERY_INTERVAL_MS = 30 * 1000;
export function createMemoryJobRunner({ runProcess = createMemoryJobProcess, config = SERVER_CONFIG.memoryRunner, onEvent = event => console.info("[aiove] memory job stage", JSON.stringify(event)) } = {}) {
  const lanes = new Map();
  const controls = new Map();
  let runnerTimer = null;
  let watchdogTimer = null;
  let maintenanceEnqueueTimer = null;
  let runnerStopping = false;

  // Runtime never accepts a worker path or timeout from a customer request.
  function launch(input) {
    return runProcess({ ...input, onEvent });
  }

  function startMemoryJobRunner() {
    if (!config.enabled || runnerTimer) return;
    runnerStopping = false;
    void runControl('startupMaintenance');
    void runControl('watchdog');
    void runControl('expireImages');
    maintenanceEnqueueTimer = setInterval(() => void enqueuePeriodicMemoryMaintenanceJobs(), MAINTENANCE_ENQUEUE_INTERVAL_MS);
    maintenanceEnqueueTimer.unref?.();
    watchdogTimer = setInterval(() => { void runControl('watchdog'); void runControl('expireImages'); }, STALE_IMAGE_JOB_RECOVERY_INTERVAL_MS);
    watchdogTimer.unref?.();
    runnerTimer = setInterval(() => void runMemoryJobBatch(), config.pollMs);
    runnerTimer.unref?.();
    void runMemoryJobBatch();
  }

  function stopMemoryJobRunner() {
    runnerStopping = true;
    clearInterval(runnerTimer); clearInterval(watchdogTimer); clearInterval(maintenanceEnqueueTimer);
    runnerTimer = null; watchdogTimer = null; maintenanceEnqueueTimer = null;
    for (const lane of lanes.values()) lane.worker?.stop();
    for (const control of controls.values()) control.worker?.stop();
  }

  async function stopMemoryJobRunnerAndWait() {
    stopMemoryJobRunner();
    await Promise.allSettled([...lanes.values(), ...controls.values()].map(item => item.promise));
  }

  async function runMemoryJobBatch() {
    if (runnerStopping) return;
    await Promise.all([runLane('image'), runLane('background')]);
  }

  async function runLane(name) {
    if (lanes.has(name) || runnerStopping) return;
    const state = { worker: null, promise: null };
    lanes.set(name, state);
    state.promise = (async () => {
      for (let index = 0; index < config.batchSize && !runnerStopping; index++) {
        state.worker = launch({ operation: 'runNext', lane: name });
        try {
          const result = await state.worker.promise;
          if (!result.worked) break;
        } catch (error) {
          console.warn('[aiove] memory job batch skipped', JSON.stringify({ lane: name, code: error.code || 'MEMORY_WORKER_ERROR', stage: error.stage || 'unknown' }));
          // The process supervisor rejects only AFTER exit. Settlement therefore
          // cannot race a still-running executor; it is itself bounded/isolated.
          if (error.job) {
            state.worker = launch({ operation: 'settle', job: error.job });
            try { await state.worker.promise; } catch (settleError) {
              console.warn('[aiove] interrupted memory job settlement deferred', settleError.code || 'MEMORY_SETTLEMENT_ERROR');
            }
          }
          break;
        }
      }
    })();
    try { await state.promise; } finally { lanes.delete(name); }
  }

  async function runControl(operation) {
    if (controls.has(operation) || runnerStopping) return;
    const state = { worker: launch({ operation }), promise: null };
    controls.set(operation, state);
    state.promise = state.worker.promise.catch(error => console.warn('[aiove] memory control deferred', JSON.stringify({ operation, code: error.code || 'MEMORY_CONTROL_ERROR' })));
    try { await state.promise; } finally { controls.delete(operation); }
  }

  function enqueuePeriodicMemoryMaintenanceJobs() { return runControl('periodicMaintenance'); }

  return { startMemoryJobRunner, stopMemoryJobRunner, stopMemoryJobRunnerAndWait, runMemoryJobBatch };
}
const defaultRunner = createMemoryJobRunner();
export function startMemoryJobRunner() { return defaultRunner.startMemoryJobRunner(); }
export function stopMemoryJobRunner() { return defaultRunner.stopMemoryJobRunner(); }
export function stopMemoryJobRunnerAndWait() { return defaultRunner.stopMemoryJobRunnerAndWait(); }
export function runMemoryJobBatch() { return defaultRunner.runMemoryJobBatch(); }
