import { CHAT_IMAGE_QUEUE_WAIT_MS, CHAT_IMAGE_REQUEST_MAX_MS } from "./memory-job-policy.js";

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
