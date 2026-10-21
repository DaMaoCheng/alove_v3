import { MEMORY_JOB_TYPES, enqueueMemoryJobIfIdle } from "./memory-job-service.js";
export async function enqueueDefaultMemoryMaintenanceJobs() {
  await enqueueMemoryJobIfIdle({
    jobType: MEMORY_JOB_TYPES.CLEANUP_MESSAGES,
    priority: 40,
    payload: { source: "runner_start" },
  }).catch((error) => {
    console.warn("[aiove] enqueue cleanup messages job failed:", error.message);
  });
  await enqueueMemoryJobIfIdle({
    jobType: MEMORY_JOB_TYPES.CLEANUP_MEMORIES,
    priority: 50,
    payload: { source: "runner_start" },
  }).catch((error) => {
    console.warn("[aiove] enqueue cleanup memories job failed:", error.message);
  });
  await enqueueMemoryJobIfIdle({
    jobType: MEMORY_JOB_TYPES.CLEANUP_SUMMARIES,
    priority: 60,
    payload: { source: "runner_start" },
  }).catch((error) => {
    console.warn("[aiove] enqueue cleanup summaries job failed:", error.message);
  });
}

export async function enqueuePeriodicMemoryMaintenanceJobs() {
  await enqueueMemoryJobIfIdle({
    jobType: MEMORY_JOB_TYPES.CLEANUP_MESSAGES,
    priority: 40,
    payload: { source: "runner_periodic" },
  }).catch((error) => {
    console.warn("[aiove] enqueue periodic cleanup messages job failed:", error.message);
  });
  await enqueueMemoryJobIfIdle({
    jobType: MEMORY_JOB_TYPES.CLEANUP_MEMORIES,
    priority: 50,
    payload: { source: "runner_periodic" },
  }).catch((error) => {
    console.warn("[aiove] enqueue periodic cleanup job failed:", error.message);
  });
}
