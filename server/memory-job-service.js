import { getDbPool, withTransaction } from "./db.js";
import { createId } from "./security.js";

export const MEMORY_JOB_TYPES = Object.freeze({
  NOOP: "noop",
  CLEANUP_MESSAGES: "cleanup_messages",
  CLEANUP_SUMMARIES: "cleanup_summaries",
  CLEANUP_MEMORIES: "cleanup_memories",
  REBUILD_DAILY_SUMMARY: "rebuild_daily_summary",
  REBUILD_WEEKLY_SUMMARY: "rebuild_weekly_summary",
  REBUILD_MONTHLY_SUMMARY: "rebuild_monthly_summary",
  EXTRACT_USER_MEMORY: "extract_user_memory",
  SEND_PROACTIVE_MESSAGE: "send_proactive_message",
  SEND_MASCOT_CAMPAIGN_BATCH: "send_mascot_campaign_batch",
  GENERATE_CHAT_IMAGE: "generate_chat_image",
  GENERATE_CHAT_IMAGE_FAILURE_REPLY: "generate_chat_image_failure_reply",
  BACKFILL_CLAIMED_GUEST_CONTEXT: "backfill_claimed_guest_context",
});

export const MEMORY_JOB_STATUSES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

export async function enqueueMemoryJob(input = {}, executor = getDbPool()) {
  const job = normalizeJobInput(input);
  await executor.execute(
    `INSERT INTO memory_jobs (
       id, internal_uid, character_id, session_id, job_type, job_status, priority,
       available_at, retry_count, max_retries, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.userId,
      job.characterId,
      job.sessionId,
      job.jobType,
      MEMORY_JOB_STATUSES.QUEUED,
      job.priority,
      job.availableAt,
      0,
      job.maxRetries,
      job.payloadJson,
    ]
  );
  return job.id;
}

export async function enqueueMemoryJobIfIdle(input = {}) {
  const jobType = String(input.jobType || MEMORY_JOB_TYPES.NOOP).trim() || MEMORY_JOB_TYPES.NOOP;
  const [rows] = await getDbPool().execute(
    `SELECT id
     FROM memory_jobs
     WHERE job_type = ?
       AND job_status IN ('queued', 'running')
     ORDER BY created_at DESC
     LIMIT 1`,
    [jobType]
  );
  if (rows[0]?.id) return String(rows[0].id);
  return enqueueMemoryJob(input);
}

export async function claimNextMemoryJob({ includeTypes = [], excludeTypes = [], jobId = "" } = {}) {
  const scopedJobId = String(jobId || "").trim();
  const included = normalizeJobTypes(includeTypes);
  const excluded = normalizeJobTypes(excludeTypes);
  const typeClauses = [
    ...(scopedJobId ? ["AND id = ?"] : []),
    ...(included.length ? [`AND job_type IN (${included.map(() => "?").join(", ")})`] : []),
    ...(excluded.length ? [`AND job_type NOT IN (${excluded.map(() => "?").join(", ")})`] : []),
  ].join("\n         ");
  return withTransaction(async (db) => {
    const [rows] = await db.execute(
      `SELECT id
       FROM memory_jobs
       WHERE job_status = 'queued'
         AND available_at <= NOW(3)
         ${typeClauses}
       ORDER BY priority ASC, available_at ASC, created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [...(scopedJobId ? [scopedJobId] : []), ...included, ...excluded]
    );
    const jobId = String(rows[0]?.id || "").trim();
    if (!jobId) return null;

    const claimToken = createId("job_claim");
    await db.execute(
      `UPDATE memory_jobs
       SET job_status = 'running',
           started_at = COALESCE(started_at, NOW(3)),
           claimed_at = NOW(3),
           claim_token = ?,
           failed_at = NULL,
           last_error = NULL,
           updated_at = NOW(3)
       WHERE id = ?`,
      [claimToken, jobId]
    );

    const [claimedRows] = await db.execute("SELECT * FROM memory_jobs WHERE id = ? LIMIT 1", [jobId]);
    return mapJobRow(claimedRows[0] || null);
  });
}

export async function recoverStaleChatImageJobs({
  staleAfterMs = 5 * 60 * 1000,
  now = new Date(),
  availableAt = new Date(),
  jobId = "",
} = {}) {
  const cutoff = new Date(new Date(now).getTime() - Math.max(60_000, Number(staleAfterMs || 0)));
  const normalizedJobId = String(jobId || "").trim();
  const [result] = await getDbPool().execute(
    `UPDATE memory_jobs
     SET job_status = 'queued',
         available_at = ?,
         claimed_at = NULL,
         last_error = 'Recovered stale chat image job after process interruption',
         updated_at = NOW(3)
     WHERE job_type IN (?, ?)
       AND job_status = 'running'
       AND claim_token IS NULL
       AND updated_at < ?
       AND (? = '' OR id = ?)`,
    [availableAt, MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE, MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE_FAILURE_REPLY, cutoff, normalizedJobId, normalizedJobId]
  );
  return Number(result.affectedRows || 0);
}

export async function recoverStaleClaimedGuestContextJobs({
  staleAfterMs = 5 * 60 * 1000,
  now = new Date(),
  availableAt = new Date(),
  jobId = "",
} = {}) {
  const cutoff = new Date(new Date(now).getTime() - Math.max(60_000, Number(staleAfterMs || 0)));
  const normalizedJobId = String(jobId || "").trim();
  const [result] = await getDbPool().execute(
    `UPDATE memory_jobs
     SET job_status = 'queued',
         available_at = ?,
         claimed_at = NULL,
         last_error = 'Recovered stale claimed guest context job after process interruption',
         updated_at = NOW(3)
     WHERE job_type = ?
       AND job_status = 'running'
       AND claim_token IS NULL
       AND updated_at < ?
       AND (? = '' OR id = ?)`,
    [availableAt, MEMORY_JOB_TYPES.BACKFILL_CLAIMED_GUEST_CONTEXT, cutoff, normalizedJobId, normalizedJobId]
  );
  return Number(result.affectedRows || 0);
}

export async function recoverStaleMascotCampaignJobs({
  staleAfterMs = 10 * 60 * 1000,
  now = new Date(),
  availableAt = new Date(),
  jobId = "",
} = {}) {
  const cutoff = new Date(new Date(now).getTime() - Math.max(60_000, Number(staleAfterMs || 0)));
  const normalizedJobId = String(jobId || "").trim();
  const [result] = await getDbPool().execute(
    `UPDATE memory_jobs
     SET job_status = 'queued', available_at = ?, claimed_at = NULL,
         last_error = 'Recovered stale mascot campaign job after process interruption',
         updated_at = NOW(3)
     WHERE job_type = ? AND job_status = 'running'
       AND claim_token IS NULL AND updated_at < ?
       AND (? = '' OR id = ?)`,
    [availableAt, MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH, cutoff, normalizedJobId, normalizedJobId]
  );
  return Number(result.affectedRows || 0);
}

export async function heartbeatMemoryJob(jobId, { claimToken = null } = {}) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) return false;
  const [result] = await getDbPool().execute(
    `UPDATE memory_jobs
     SET updated_at = NOW(3)
     WHERE id = ?
       AND job_status = 'running'
       AND claim_token <=> ?`,
    [normalizedJobId, normalizeNullableId(claimToken)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function completeMemoryJob(jobId, result = null, { claimToken = null } = {}) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) return false;
  const [updated] = await getDbPool().execute(
    `UPDATE memory_jobs
     SET job_status = 'completed',
         completed_at = NOW(3),
         result_json = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND job_status = 'running'
       AND claim_token <=> ?`,
    [result ? JSON.stringify(result) : null, normalizedJobId, normalizeNullableId(claimToken)]
  );
  return Number(updated.affectedRows || 0) === 1;
}

export async function failMemoryJob(jobId, error, { claimToken = null, retryable = true, delayMs = 0 } = {}) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) return false;

  return withTransaction(async (db) => {
    const [rows] = await db.execute("SELECT id, retry_count, max_retries FROM memory_jobs WHERE id = ? AND job_status = 'running' AND claim_token <=> ? LIMIT 1 FOR UPDATE", [normalizedJobId, normalizeNullableId(claimToken)]);
    const row = rows[0] || null;
    if (!row) return false;

    const retryCount = Number(row.retry_count || 0);
    const maxRetries = Number(row.max_retries || 0);
    const shouldRetry = retryable && retryCount < maxRetries;
    const nextStatus = shouldRetry ? MEMORY_JOB_STATUSES.QUEUED : MEMORY_JOB_STATUSES.FAILED;
    const nextRetryCount = shouldRetry ? retryCount + 1 : retryCount;

    await db.execute(
      `UPDATE memory_jobs
       SET job_status = ?,
           retry_count = ?,
           failed_at = NOW(3),
           available_at = ?,
           last_error = ?,
           claim_token = NULL,
           claimed_at = NULL,
           updated_at = NOW(3)
       WHERE id = ?
         AND job_status = 'running'
         AND claim_token <=> ?`,
      [
        nextStatus,
        nextRetryCount,
        shouldRetry ? new Date(Date.now() + Math.max(0, Number(delayMs || 0))) : new Date(),
        truncateErrorMessage(error),
        normalizedJobId,
        normalizeNullableId(claimToken),
      ]
    );
    return true;
  });
}

export async function listMemoryJobs({ status = "", limit = 20 } = {}) {
  const params = [];
  let whereClause = "";
  if (String(status || "").trim()) {
    whereClause = "WHERE job_status = ?";
    params.push(String(status || "").trim());
  }
  const [rows] = await getDbPool().execute(
    `SELECT *
     FROM memory_jobs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${Math.max(1, Math.min(100, Number(limit || 20)))}`,
    params
  );
  return rows.map(mapJobRow);
}

// Recovery scans oldest heartbeat first; a page of newest jobs can starve an
// orphan forever. The caller still must acquire/check the execution lock.
export async function listStaleRunningMemoryJobs({ before, limit = 20 } = {}) {
  const cutoff = new Date(before);
  if (before == null || !Number.isFinite(cutoff.getTime())) throw new TypeError("Invalid memory job recovery cutoff");
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const [rows] = await getDbPool().execute(
    `SELECT * FROM memory_jobs
     WHERE job_status = 'running'
       AND claim_token IS NOT NULL
       AND updated_at < ?
     ORDER BY updated_at ASC, id ASC
     LIMIT ${safeLimit}`,
    [cutoff]
  );
  return rows.map(mapJobRow);
}

function normalizeJobInput(input = {}) {
  const explicitId = input.id == null ? "" : String(input.id).trim();
  if (explicitId && !/^mem_job_[A-Za-z0-9_-]{1,56}$/.test(explicitId)) {
    throw new TypeError("Invalid explicit memory job ID");
  }
  return {
    id: explicitId || createId("mem_job"),
    userId: normalizeNullableId(input.userId || input.internalUid),
    characterId: normalizeNullableId(input.characterId),
    sessionId: normalizeNullableId(input.sessionId),
    jobType: String(input.jobType || MEMORY_JOB_TYPES.NOOP).trim() || MEMORY_JOB_TYPES.NOOP,
    priority: Math.max(1, Math.min(9999, Number(input.priority || 100))),
    maxRetries: Math.max(0, Math.min(10, Number(input.maxRetries ?? 3))),
    availableAt: input.availableAt || new Date(),
    payloadJson: input.payload ? JSON.stringify(input.payload) : null,
  };
}

function normalizeNullableId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function mapJobRow(row = null) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.internal_uid || "",
    characterId: row.character_id || "",
    sessionId: row.session_id || "",
    jobType: row.job_type || "",
    jobStatus: row.job_status || "",
    priority: Number(row.priority || 0),
    retryCount: Number(row.retry_count || 0),
    maxRetries: Number(row.max_retries || 0),
    availableAt: row.available_at,
    startedAt: row.started_at,
    claimedAt: row.claimed_at,
    claimToken: row.claim_token || "",
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    lastError: row.last_error || "",
    payload: parseJsonValue(row.payload_json, null),
    result: parseJsonValue(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function truncateErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.trim().slice(0, 2000) || "unknown memory job error";
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Call inside the business send transaction, before side effects, so claim changes
// and message/delivery commit cannot race. Legacy NULL claims remain compatible.
export async function assertMemoryJobLease(db, job = {}, { lock = true } = {}) {
  const jobId = String(job.id || "").trim();
  const [rows] = await db.execute(
    `SELECT id, job_status, claim_token FROM memory_jobs WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [jobId]
  );
  const row = rows[0];
  if (!row || row.job_status !== MEMORY_JOB_STATUSES.RUNNING
      || normalizeNullableId(row.claim_token) !== normalizeNullableId(job.claimToken)) {
    const error = new Error("Memory job execution lease is no longer active");
    error.code = "MEMORY_JOB_LEASE_LOST";
    error.retryable = false;
    throw error;
  }
  return true;
}

function normalizeJobTypes(types) {
  if (!Array.isArray(types)) throw new TypeError("Memory job types must be an array");
  return [...new Set(types.map((value) => String(value || "").trim()).filter(Boolean))];
}
