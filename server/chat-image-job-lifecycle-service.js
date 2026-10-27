import { CHAT_IMAGE_QUEUE_WAIT_MS, CHAT_IMAGE_REQUEST_MAX_MS, getMemoryJobExecutionBudgetMs } from "./memory-job-policy.js";

import { parseJsonValue } from "./chat-message-payload-utils.js";

// Deadlines use the immutable request creation time, never retry/heartbeat timestamps.
export const CHAT_IMAGE_FIRST_QUEUE_DEADLINE_MS = CHAT_IMAGE_QUEUE_WAIT_MS;
export const CHAT_IMAGE_REQUEST_DEADLINE_MS = CHAT_IMAGE_REQUEST_MAX_MS;

export function getChatImageJobDeadline({ createdAt, retryCount = 0, status = "queued", now = new Date() } = {}) {
  if (status === "ready" || status === "failed") return null;
  const created = new Date(createdAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(current)) return null;
  const ageMs = Math.max(0, current - created);
  if (ageMs >= CHAT_IMAGE_REQUEST_DEADLINE_MS) return "chat_image_request_deadline";
  if (Number(retryCount || 0) === 0 && status === "queued" && ageMs >= CHAT_IMAGE_FIRST_QUEUE_DEADLINE_MS) {
    return "chat_image_queue_deadline";
  }
  return null;
}

export function createChatImageDeadlineError(code = "chat_image_request_deadline") {
  const error = new Error(code === "chat_image_queue_deadline"
    ? "Chat image expired before generation started"
    : "Chat image request exceeded its total deadline");
  error.code = code;
  error.retryable = false;
  return error;
}

export async function listExpiredQueuedChatImageJobs(db, { limit = 20, now = new Date(), jobId = "" } = {}) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const totalCutoff = new Date(new Date(now).getTime() - CHAT_IMAGE_REQUEST_DEADLINE_MS);
  const queueCutoff = new Date(new Date(now).getTime() - CHAT_IMAGE_FIRST_QUEUE_DEADLINE_MS);
  const [rows] = await db.execute({
    sql: `SELECT j.id, j.retry_count, j.payload_json, a.id AS asset_id, a.message_id,
                 a.status AS asset_status, a.created_at AS asset_created_at
          FROM memory_jobs j
          INNER JOIN chat_image_assets a
            ON a.id = JSON_UNQUOTE(JSON_EXTRACT(j.payload_json, '$.assetId'))
           AND a.message_id = JSON_UNQUOTE(JSON_EXTRACT(j.payload_json, '$.messageId'))
          WHERE j.job_type = 'generate_chat_image' AND j.job_status = 'queued'
            AND (? = '' OR j.id = ?)
            AND a.status IN ('queued', 'generating')
            AND (a.created_at <= ? OR (j.retry_count = 0 AND a.status = 'queued' AND a.created_at <= ?))
          ORDER BY j.created_at ASC LIMIT ${boundedLimit}`,
    timeout: 1000,
  }, [String(jobId || "").trim(), String(jobId || "").trim(), totalCutoff, queueCutoff]);
  return rows;
}

// Only after a ready transaction has rolled back on a lock wait. A successful
// normal completion never waits for an initial reply. Reads must be autocommit:
// a REPEATABLE READ snapshot cannot observe the original reply's later commit.
export async function waitForChatImageInitialReplyAfterLock(db, { error, job = {}, assetId, messageId,
  assertCanContinue, now = () => new Date(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (error?.code !== "ER_LOCK_WAIT_TIMEOUT" || job.jobType !== "generate_chat_image"
    || !job.id || !job.claimToken || !job.userId || job.payload?.guestSessionId
    || job.payload?.terminalReplyVersion !== 1 || typeof assertCanContinue !== "function") return false;
  if (job.payload?.assetId !== assetId || job.payload?.messageId !== messageId) return false;
  const started = new Date(job.claimedAt || job.startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  const attemptDeadline = started + getMemoryJobExecutionBudgetMs({ jobType: job.jobType });
  let reported = false;
  while (true) {
    const [[asset]] = await db.execute(
      `SELECT a.internal_uid, a.guest_session_id, a.session_id, a.character_id, a.status, a.created_at, a.prompt_context_json,
              s.internal_uid AS session_internal_uid, s.guest_session_id AS session_guest_id
       FROM chat_image_assets a
       INNER JOIN chat_sessions s ON s.id = a.session_id AND s.character_id = a.character_id
       WHERE a.id = ? AND a.message_id = ? LIMIT 1`, [assetId, messageId]);
    if (!asset || asset.internal_uid !== job.userId || asset.guest_session_id
      || asset.session_internal_uid !== job.userId || asset.session_guest_id
      || asset.session_id !== job.sessionId || asset.character_id !== job.characterId
      || !["queued", "generating"].includes(asset.status) || !Number.isFinite(new Date(asset.created_at).getTime())) return false;
    const state = parseJsonValue(asset.prompt_context_json, {})?._terminalReply;
    // New jobs carry version 1 before the original reply commits. Its ledger
    // is then still invisible here; requiring coordinated now would skip the
    // exact lock race. A committed contradictory/legacy ledger is not eligible.
    if (state != null && (state.version !== 1 || state.coordinated !== true)) return false;
    const current = now();
    const deadline = getChatImageJobDeadline({ createdAt: asset.created_at, retryCount: job.retryCount, status: asset.status, now: current });
    if (deadline) throw createChatImageDeadlineError(deadline);
    if (new Date(current).getTime() >= attemptDeadline) {
      throw Object.assign(new Error("Memory job execution deadline exceeded"), { code: "MEMORY_JOB_TIMEOUT", retryable: false });
    }
    await assertCanContinue();
    if (state?.initialReply?.messageId) return true;
    if (!reported) { job.reportStage?.("image_initial_reply_wait"); reported = true; }
    await wait(Math.min(500, attemptDeadline - new Date(current).getTime(),
      new Date(asset.created_at).getTime() + CHAT_IMAGE_REQUEST_DEADLINE_MS - new Date(current).getTime()));
  }
}
