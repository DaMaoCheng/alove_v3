import { previewProactivePaidAttempt } from "./proactive-paid-attempt-service.js";
import { SERVER_CONFIG } from "./config.js";
import { getDbPool } from "./db.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "./memory-job-service.js";
import { resolveAccountProactiveDeliveryPlan } from "./proactive-message-delivery-service.js";
import { evaluateProactiveCandidate, groupProactiveCandidatesByUser, PROACTIVE_SCHEDULER_POLICY } from "./proactive-scheduler-policy.js";

const DEFAULT_PRIORITY = 80;

let schedulerTimer = null;
let schedulerActive = false;
let schedulerStopping = false;
let schedulerPromise = null;

export function startProactiveMessageScheduler() {
  if (!SERVER_CONFIG.proactiveScheduler.enabled || schedulerTimer) return;
  schedulerStopping = false;
  schedulerTimer = setInterval(runScheduledProactiveCycle, SERVER_CONFIG.proactiveScheduler.pollMs);
  schedulerTimer.unref?.();
  runScheduledProactiveCycle();
}

// Only scheduler-owned fire-and-forget entrypoints handle their rejection here.
// Explicit callers of runProactiveMessageSchedulerCycle still receive failures.
function runScheduledProactiveCycle() {
  void runProactiveMessageSchedulerCycle().catch((error) => {
    const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
      ? error.code : "SCHEDULER_CYCLE_FAILED";
    console.error("[aiove] proactive scheduler cycle failed:", code);
  });
}

export function stopProactiveMessageScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

export async function stopProactiveMessageSchedulerAndWait() {
  schedulerStopping = true;
  stopProactiveMessageScheduler();
  if (schedulerPromise) {
    await schedulerPromise.catch(() => {});
  }
}

export async function runProactiveMessageSchedulerCycle() {
  if (schedulerStopping || schedulerActive) return;
  schedulerActive = true;
  schedulerPromise = scanAndEnqueueProactiveMessages({
    batchSize: SERVER_CONFIG.proactiveScheduler.batchSize,
  });
  try {
    await schedulerPromise;
  } finally {
    schedulerActive = false;
    schedulerPromise = null;
  }
}

export async function scanAndEnqueueProactiveMessages({ now = new Date(), batchSize = 20 } = {}) {
  const candidates = await listCandidateSessions({
    limit: Math.max(1, Number(batchSize || 20)) * 12,
  });
  const accounts = groupProactiveCandidatesByUser(candidates);
  const enqueued = [];
  const skipped = [];

  for (const account of accounts) {
    if (enqueued.length >= Math.max(1, Number(batchSize || 20))) break;

    if (await hasQueuedOrRunningProactiveJob(account.userId)) {
      skipped.push({ userId: account.userId, reason: "job_already_queued" });
      continue;
    }

    const candidatesWithIdleGate = account.candidates.map((candidate) => ({
      ...candidate,
      idleGate: evaluateProactiveCandidate(candidate, now),
    }));
    const plan = await resolveAccountProactiveDeliveryPlan(getDbPool(), {
      userId: account.userId,
      siteId: account.siteId,
      timeZone: account.timeZone,
      candidates: candidatesWithIdleGate,
      now,
    });
    if (!plan.allowed || !plan.selectedCandidate) {
      skipped.push({ userId: account.userId, reason: plan.reason || "not_allowed" });
      continue;
    }

    const selectedCandidate = plan.selectedCandidate;
    const paidGate = await previewProactivePaidAttempt({
      userId: account.userId, characterId: selectedCandidate.characterId, sessionId: selectedCandidate.sessionId,
    }, { now });
    if (!paidGate.allowed) {
      skipped.push({ userId: account.userId, reason: paidGate.reason });
      continue;
    }
    const idleGate = selectedCandidate.idleGate || {};
    await enqueueMemoryJob({
      userId: account.userId,
      characterId: selectedCandidate.characterId,
      sessionId: selectedCandidate.sessionId,
      jobType: MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE,
      priority: DEFAULT_PRIORITY,
      availableAt: plan.availableAt || now,
      payload: {
        source: "proactive_scheduler",
        reason: plan.deliveryMode === "daily_required" ? "daily_required_check_in" : "inactive_followup",
        minIdleMinutes: idleGate.requiredIdleMinutes || 0,
        maxUnansweredProactive: PROACTIVE_SCHEDULER_POLICY.maxUnansweredProactive,
        quietHours: `${PROACTIVE_SCHEDULER_POLICY.quietStartHour}-${PROACTIVE_SCHEDULER_POLICY.quietEndHour}`,
        ignoreQuietHours: plan.deliveryMode === "daily_required",
        userId: account.userId,
        characterId: selectedCandidate.characterId,
        sessionId: selectedCandidate.sessionId,
        deliveryMode: plan.deliveryMode,
        slotIndex: plan.slotIndex,
        deliveryDate: plan.deliveryDate,
        selectedBy: "account_rotation",
      },
    });
    enqueued.push({
      userId: account.userId,
      characterId: selectedCandidate.characterId,
      sessionId: selectedCandidate.sessionId,
      deliveryMode: plan.deliveryMode,
      slotIndex: plan.slotIndex,
      deliveryDate: plan.deliveryDate,
      availableAt: plan.availableAt || now,
    });
  }

  return {
    ok: true,
    scannedCount: accounts.length,
    enqueuedCount: enqueued.length,
    enqueued,
    skipped,
  };
}

async function listCandidateSessions({ limit }) {
  const [rows] = await getDbPool().execute(
    `SELECT
       ranked.session_id,
       ranked.internal_uid AS user_id,
       ranked.character_id,
       users.site_id,
       characters.category_id,
       COALESCE(NULLIF(sites.time_zone, ''), 'UTC') AS time_zone,
       latest.id AS latest_message_id,
       latest.sender_type AS latest_sender_type,
       latest.source_ref AS latest_source_ref,
       latest.sent_at AS latest_sent_at,
       latest.created_at AS latest_created_at
     FROM (
       SELECT
         sessions.id AS session_id,
         sessions.internal_uid,
         sessions.character_id,
         sessions.last_message_at,
         sessions.updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY sessions.internal_uid, sessions.character_id
           ORDER BY COALESCE(sessions.last_message_at, sessions.updated_at) DESC, sessions.updated_at DESC
         ) AS row_num
       FROM chat_sessions sessions
       WHERE sessions.session_status = 'active'
         AND sessions.source_type = 'user'
     ) ranked
     INNER JOIN users ON users.id = ranked.internal_uid
     INNER JOIN ai_characters characters ON characters.id = ranked.character_id
     INNER JOIN user_character_activations activations
       ON activations.internal_uid = ranked.internal_uid
      AND activations.character_id = ranked.character_id
      AND activations.activation_status = 'active'
     LEFT JOIN sites ON sites.id = users.site_id
     LEFT JOIN (
       SELECT latest_ranked.*
       FROM (
         SELECT
           messages.id,
           messages.session_id,
           messages.sender_type,
           messages.source_ref,
           messages.sent_at,
           messages.created_at,
           ROW_NUMBER() OVER (
             PARTITION BY messages.session_id
             ORDER BY messages.display_order DESC, messages.sent_at DESC, messages.created_at DESC
           ) AS row_num
         FROM chat_messages messages
         WHERE messages.delivery_status = 'sent'
       ) latest_ranked
       WHERE latest_ranked.row_num = 1
     ) latest ON latest.session_id = ranked.session_id
     WHERE ranked.row_num = 1
       AND users.account_status = 'active'
       AND characters.character_status = 'published'
       AND characters.category_id IN ('mascot', 'creator')
       AND (characters.visibility = 'public' OR characters.owner_uid = ranked.internal_uid)
     ORDER BY COALESCE(latest.sent_at, latest.created_at, ranked.last_message_at, ranked.updated_at) ASC
     LIMIT ${Math.max(1, Math.min(400, Number(limit || 20)))}`
  );

  return rows.map((row) => ({
    sessionId: row.session_id,
    userId: row.user_id,
    siteId: row.site_id || "",
    characterId: row.character_id,
    categoryId: row.category_id,
    timeZone: row.time_zone || "UTC",
    latestMessageId: row.latest_message_id,
    latestSenderType: row.latest_sender_type || "",
    latestSourceRef: row.latest_source_ref || "",
    latestAt: row.latest_sent_at || row.latest_created_at || null,
  }));
}

async function hasQueuedOrRunningProactiveJob(userId) {
  const [rows] = await getDbPool().execute(
    `SELECT id
     FROM memory_jobs
     WHERE internal_uid = ?
       AND job_type = ?
       AND job_status IN ('queued', 'running')
     LIMIT 1`,
    [String(userId || "").trim(), MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE]
  );
  return Boolean(rows[0]?.id);
}
