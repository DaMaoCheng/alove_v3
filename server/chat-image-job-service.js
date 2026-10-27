import { normalizeCharacterLanguage } from "../shared/language-library.js";
import { getDbPool, withTransaction } from "./db.js";
import { assertMemoryJobLease } from "./memory-job-service.js";
import {
  createChatImageDeadlineError,
  getChatImageJobDeadline,
  listExpiredQueuedChatImageJobs,
  waitForChatImageInitialReplyAfterLock,
} from "./chat-image-job-lifecycle-service.js";
import { getChatImageStatusCopy } from "./chat-image-copy-service.js";
import {
  buildChatImageGenerationContext,
  buildChatImagePromptContextPayload,
} from "./chat-image-context-builder.js";
import {
  deleteStoredChatImageAsset,
  findRecoverableChatImageAsset,
  saveGeneratedChatImageAsset,
  saveMockChatImageAsset,
} from "./chat-image-asset-service.js";
import { buildChatImagePrompt, generateRealChatImage, isRealChatImageProviderConfigured } from "./chat-image-provider-service.js";
import { collectChatImageReferenceImages } from "./chat-image-reference-material-service.js";
import { CHAT_IMAGE_STATUSES, recordChatImageUsage, lockChatImageQuota } from "./chat-image-quota-service.js";
import { enqueueChatImageFailureReplyIfNeeded, enqueueChatImageTerminalReplyIfNeeded } from "./chat-image-failure-reply-job-service.js";
import {
  consumeGuestImageEntitlementForAsset,
  releaseGuestImageEntitlementForAsset,
} from "./guest-image-entitlement-service.js";
import {
  consumeGuestImageDailyQuotaForAsset,
  releaseGuestImageDailyQuotaForAsset,
} from "./guest-image-daily-quota-service.js";

export async function generateChatImageFromJob(job = {}) {
  const payload = job.payload || {};
  const messageId = String(payload.messageId || "").trim();
  const assetId = String(payload.assetId || "").trim();
  if (!messageId || !assetId) {
    throw new Error("Chat image job payload is missing messageId or assetId");
  }

  job.reportStage?.("image_asset_lock");
  const releaseLock = await acquireChatImageJobLock(assetId);
  try {
    job.reportStage?.("image_state_reconcile");
    const existing = await reconcileReadyImageJob({ messageId, assetId, job });
    if (existing.missing) throw nonRetryableImageError("Chat image job asset was not found");
    if (existing.failed) return { ok: true, skipped: true, reason: "image_already_failed", status: CHAT_IMAGE_STATUSES.FAILED, messageId, assetId };
    if (existing.ready) {
      await recordReadyChatImageUsage({ messageId, assetId });
      return {
        ok: true,
        handledBy: existing.provider || "chat-image-replay",
        messageId,
        assetId,
        status: CHAT_IMAGE_STATUSES.READY,
      };
    }
    await assertChatImageJobCanContinue(job, { messageId, assetId });
    await assertGuestImageGenerationAllowed({ messageId, assetId });
    const staged = await recoverStagedChatImage({ messageId, assetId });
    if (staged) {
      await markChatImageReady({ messageId, assetId, saved: staged, job });
      await recordReadyChatImageUsage({ messageId, assetId });
      return {
        ok: true,
        handledBy: "chat-image-staged-recovery",
        messageId,
        assetId,
        status: CHAT_IMAGE_STATUSES.READY,
      };
    }
    job.reportStage?.("image_generation_start");
    await markChatImageGenerating({ messageId, assetId }, job);
    const saved = await generateAndSaveChatImage({
      assetId,
      messageId,
      reportStage: job.reportStage,
      phase: payload.phase,
      imageConditions: payload.imageConditions || null,
      productReferenceRequired: payload.productReferenceRequired === true,
      requiredProductReference: payload.requiredProductReference || null,
    });
    await assertChatImageJobCanContinue(job, { messageId, assetId });
    await assertGuestImageGenerationAllowed({ messageId, assetId });
    job.reportStage?.("image_ready_commit");
    await stageChatImageAsset({ messageId, assetId, saved });
    await markChatImageReady({
      messageId,
      assetId,
      saved,
      job,
    });
    await recordReadyChatImageUsage({ messageId, assetId });
    return {
      ok: true,
      handledBy: saved.provider || "chat-image",
      messageId,
      assetId,
      status: CHAT_IMAGE_STATUSES.READY,
    };
  } catch (error) {
    // A fenced attempt must not mutate an asset now owned by a later attempt.
    await assertImageJobLease(job);
    if (error?.retryable !== false && shouldKeepChatImageGeneratingForRetry(job)) {
      await markChatImageRetrying({ messageId, assetId, error }, job).catch((stateError) => {
        console.warn("[aiove] chat image retry state update failed:", {
          messageId,
          assetId,
          error: stateError.message,
        });
      });
    } else {
      await markChatImageFailed({ messageId, assetId, error }, job).catch((stateError) => {
        console.error("[aiove] chat image terminal failure state update failed:", {
          messageId,
          assetId,
          error: stateError.message,
        });
      });
    }
    throw error;
  } finally {
    await releaseLock();
  }
}

async function generateAndSaveChatImage({ assetId, messageId, reportStage = null, phase = "", imageConditions = null, productReferenceRequired = false, requiredProductReference = null }) {
  reportStage?.("image_context");
  const context = await buildChatImageGenerationContext(getDbPool(), { assetId, messageId, imageConditions, productReferenceRequired, requiredProductReference });
  reportStage?.("image_references");
  const requiredReferences = context.imageRequestConstraints?.productReferenceRequired === true
    ? await collectChatImageReferenceImages(context)
    : null;
  if (String(phase || "").trim().toLowerCase() === "mock" || !isRealChatImageProviderConfigured()) {
    const saved = await saveMockChatImageAsset({ assetId });
    await updateChatImagePromptAndProvider({
      assetId,
      messageId,
      provider: "mock",
      context,
      fullPrompt: "",
    });
    return {
      ...saved,
      provider: "chat-image-mock",
    };
  }

  const referenceImages = requiredReferences || await collectChatImageReferenceImages(context);
  // Preserve the exact deterministic request before a provider can reject it.
  // The existing successful write below remains the final prompt metadata.
  await updateChatImagePromptAndProvider({ assetId, messageId, provider: "openai", context,
    fullPrompt: buildChatImagePrompt(context), beforeRequest: true });
  reportStage?.("image_provider");
  const generated = await generateRealChatImage({
    ...context,
    referenceImages,
  });
  reportStage?.("image_file_save");
  const saved = await saveGeneratedChatImageAsset({
    assetId,
    buffer: generated.buffer,
    contentType: generated.contentType,
    uploadFilename: generated.filename,
  });
  await updateChatImagePromptAndProvider({
    assetId,
    messageId,
    provider: "openai",
    context,
    fullPrompt: generated.prompt || "",
  });
  return {
    ...saved,
    provider: "chat-image-openai",
  };
}

function imageJobLanguage(job) {
  try {
    const payload = job?.payload || (typeof job?.payload_json === "string" ? JSON.parse(job.payload_json) : job?.payload_json);
    return normalizeCharacterLanguage(payload?.replyLanguageCode)?.code || "";
  } catch { return ""; }
}

async function markChatImageGenerating({ messageId, assetId }, job = null) {
  const copy = getChatImageStatusCopy({ language: imageJobLanguage(job), status: CHAT_IMAGE_STATUSES.GENERATING });
  await withTransaction(async (db) => {
    if (job?.id) await assertMemoryJobLease(db, job);
    const [result] = await db.execute(
      `UPDATE chat_image_assets
       SET status = 'generating',
           updated_at = NOW(3)
       WHERE id = ? AND message_id = ? AND status IN ('queued', 'generating')`,
      [assetId, messageId]
    );
    if (Number(result.affectedRows || 0) !== 1) throw nonRetryableImageError("Chat image task is already terminal");
    await db.execute(
      `UPDATE chat_messages
       SET delivery_status = 'generating', text_content = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [copy, messageId]
    );
  });
}

async function assertGuestImageGenerationAllowed({ messageId, assetId }) {
  const [rows] = await getDbPool().execute(
    `SELECT a.guest_session_id, a.session_id, a.character_id,
            COALESCE(NULLIF(gcs.chat_session_id, ''),
              CASE WHEN a.character_id = g.mascot_character_id THEN g.chat_session_id END) AS character_chat_session_id,
            COALESCE(NULLIF(gcs.target_chat_session_id, ''),
              CASE WHEN a.character_id = g.mascot_character_id THEN g.target_chat_session_id END) AS character_target_session_id,
            g.session_status, g.expires_at, g.claimed_user_id,
            cs.internal_uid AS chat_owner_uid, cs.guest_session_id AS chat_guest_id,
            cs.character_id AS chat_character_id,
            e.entitlement_status, e.asset_id AS entitlement_asset_id,
            s.site_status, s.guest_chat_enabled
     FROM chat_image_assets a
     LEFT JOIN guest_sessions g ON g.id = a.guest_session_id
     LEFT JOIN guest_character_sessions gcs
       ON gcs.guest_session_id = a.guest_session_id AND gcs.character_id = a.character_id
     LEFT JOIN chat_sessions cs ON cs.id = a.session_id
     LEFT JOIN guest_image_entitlements e ON e.guest_session_id = a.guest_session_id
     LEFT JOIN sites s ON s.id = g.site_id
     WHERE a.id = ?
       AND a.message_id = ?
     LIMIT 1`,
    [assetId, messageId]
  );
  const row = rows[0] || null;
  if (!row) throw nonRetryableImageError("Chat image job asset was not found");
  if (!row.guest_session_id) return;
  const expired = !row.expires_at || new Date(row.expires_at).getTime() <= Date.now();
  const entitlementValid = row.entitlement_status === "reserved"
    && String(row.entitlement_asset_id || "") === String(assetId || "");
  const activeValid = row.session_status === "active"
    && !expired
    && row.site_status === "active"
    && Number(row.guest_chat_enabled || 0) === 1
    && String(row.session_id || "") === String(row.character_chat_session_id || "")
    && String(row.chat_guest_id || "") === String(row.guest_session_id || "")
    && !row.chat_owner_uid
    && String(row.chat_character_id || "") === String(row.character_id || "")
    && entitlementValid;
  const claimedValid = row.session_status === "claimed"
    && Boolean(row.claimed_user_id)
    && String(row.chat_owner_uid || "") === String(row.claimed_user_id || "")
    && String(row.session_id || "") === String(row.character_target_session_id || "")
    && String(row.chat_character_id || "") === String(row.character_id || "")
    && row.site_status === "active"
    && entitlementValid;
  if (!activeValid && !claimedValid) throw nonRetryableImageError("Guest image session is no longer active");
}

async function recoverStagedChatImage({ messageId, assetId }) {
  const [rows] = await getDbPool().execute(
    `SELECT storage_path
     FROM chat_image_assets
     WHERE id = ?
       AND message_id = ?
       AND status IN ('queued', 'generating')
     LIMIT 1`,
    [assetId, messageId]
  );
  if (!rows[0]) return null;
  const saved = await findRecoverableChatImageAsset({
    assetId,
    storagePath: rows[0].storage_path || "",
  });
  if (!saved) return null;
  await stageChatImageAsset({ messageId, assetId, saved });
  return saved;
}

async function stageChatImageAsset({ messageId, assetId, saved }) {
  const [result] = await getDbPool().execute(
    `UPDATE chat_image_assets
     SET storage_path = ?,
         protected_path = ?,
         width = ?,
         height = ?,
         bytes = ?,
         mime_type = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND message_id = ?
       AND status IN ('queued', 'generating')`,
    [
      saved.storagePath,
      saved.protectedPath,
      saved.width,
      saved.height,
      saved.bytes,
      saved.mimeType,
      assetId,
      messageId,
    ]
  );
  if (Number(result.affectedRows || 0) !== 1) {
    throw nonRetryableImageError("Chat image asset disappeared before staging");
  }
}

export async function acquireChatImageJobLock(assetId = "", { timeoutSeconds = 30 } = {}) {
  const connection = await getDbPool().getConnection();
  const lockName = `chat_image_job:${String(assetId || "")}`.slice(0, 64);
  try {
    const [rows] = await connection.execute("SELECT GET_LOCK(?, ?) AS locked", [lockName, Math.max(0, Math.min(30, Number(timeoutSeconds) || 0))]);
    if (Number(rows[0]?.locked || 0) !== 1) {
      throw new Error("Chat image job is already being handled");
    }
  } catch (error) {
    connection.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]);
    } finally {
      connection.release();
    }
  };
}

function nonRetryableImageError(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

async function markChatImageReady({ messageId, assetId, saved, job = null }) {
  try {
    return await commitChatImageReady({ messageId, assetId, saved, job });
  } catch (error) {
    if (!await waitForChatImageInitialReplyAfterLock(getDbPool(), { error, job: job || {}, assetId, messageId,
      assertCanContinue: () => assertChatImageJobCanContinue(job, { messageId, assetId }) })) throw error;
  }
  // The first transaction has rolled back. Reuse the staged file and attempt
  // only this existing atomic commit once; never call the image provider here.
  job?.reportStage?.("image_ready_commit");
  return commitChatImageReady({ messageId, assetId, saved, job });
}

async function commitChatImageReady({ messageId, assetId, saved, job = null }) {
  await withTransaction(async (db) => {
    if (job?.id) await assertMemoryJobLease(db, job);
    const [[owner]] = await db.execute("SELECT internal_uid, guest_session_id, status, created_at FROM chat_image_assets WHERE id = ? AND message_id = ? LIMIT 1", [assetId, messageId]);
    const deadline = owner && getChatImageJobDeadline({ createdAt: owner.created_at, retryCount: job?.retryCount, status: owner.status });
    if (deadline) throw createChatImageDeadlineError(deadline);
    if (owner?.internal_uid && !owner.guest_session_id) await lockChatImageQuota(db, owner.internal_uid);
    const [result] = await db.execute(
      `UPDATE chat_image_assets
       SET status = 'ready',
           storage_path = ?,
           protected_path = ?,
           width = ?,
           height = ?,
           bytes = ?,
           mime_type = ?,
           error_message = NULL,
           completed_at = NOW(3),
           updated_at = NOW(3)
       WHERE id = ?
         AND message_id = ?
         AND status IN ('queued', 'generating')`,
      [
        saved.storagePath,
        saved.protectedPath,
        saved.width,
        saved.height,
        saved.bytes,
        saved.mimeType,
        assetId,
        messageId,
      ]
    );
    if (Number(result.affectedRows || 0) !== 1) {
      throw nonRetryableImageError("Chat image asset disappeared before completion");
    }
    await db.execute(
      `UPDATE chat_messages
       SET delivery_status = 'ready',
           text_content = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [getChatImageStatusCopy({ language: imageJobLanguage(job), status: CHAT_IMAGE_STATUSES.READY }), messageId]
    );
    const entitlement = await consumeGuestImageEntitlementForAsset(db, assetId);
    if (entitlement.guest && !entitlement.consumed) {
      throw new Error("Guest image entitlement could not be consumed");
    }
    const dailyQuota = await consumeGuestImageDailyQuotaForAsset(db, assetId);
    if (dailyQuota.enforced && !dailyQuota.consumed) {
      throw new Error("Guest daily image quota could not be consumed");
    }
    await recordReadyChatImageUsage({ messageId, assetId }, db);
    await enqueueChatImageTerminalReplyIfNeeded(db, { assetId, messageId });
  });
}

async function updateChatImagePromptAndProvider({ assetId, messageId, provider, context, fullPrompt = "", beforeRequest = false }) {
  const contextPayload = buildChatImagePromptContextPayload(context);
  const [result] = await getDbPool().execute(
    `UPDATE chat_image_assets
     SET provider = ?,
         prompt_summary = ?,
         prompt_context_json = JSON_MERGE_PATCH(?,
           JSON_OBJECT('_terminalReply', JSON_EXTRACT(prompt_context_json, '$._terminalReply'))),
         prompt_full_text = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND message_id = ?
       AND ${beforeRequest ? "status = 'generating'" : "status IN ('queued', 'generating')"}`,
    [
      provider,
      safeChatImagePromptSummary(context),
      JSON.stringify(contextPayload),
      fullPrompt,
      assetId,
      messageId,
    ]
  );
  if (beforeRequest && Number(result.affectedRows || 0) !== 1) {
    throw nonRetryableImageError("Chat image asset changed before the provider request");
  }
}

function safeChatImagePromptSummary(context = {}) {
  const code = String(context?.variation?.code || "").trim().replace(/[^0-9-]/g, "").slice(0, 64);
  return code ? `Chat image variation ${code}` : "Chat image generated";
}

async function markChatImageRetrying({ messageId, assetId, error }, job = null) {
  const message = truncateError(error);
  await withTransaction(async (db) => {
    if (job?.id) await assertMemoryJobLease(db, job);
    await db.execute(
      `UPDATE chat_image_assets
       SET status = 'generating',
           error_message = ?,
           updated_at = NOW(3)
       WHERE id = ?
         AND message_id = ?
         AND status IN ('queued', 'generating')`,
      [message, assetId, messageId]
    );
    const [rows] = await db.execute("SELECT status FROM chat_image_assets WHERE id = ? AND message_id = ? LIMIT 1", [assetId, messageId]);
    if (!rows[0] || ![CHAT_IMAGE_STATUSES.QUEUED, CHAT_IMAGE_STATUSES.GENERATING].includes(rows[0].status)) return;
    await db.execute(
      `UPDATE chat_messages
       SET delivery_status = 'generating',
           text_content = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [getChatImageStatusCopy({ language: imageJobLanguage(job), status: CHAT_IMAGE_STATUSES.GENERATING }), messageId]
    );
  });
}

async function markChatImageFailed({ messageId, assetId, error }, job = null) {
  const failure = await withTransaction(async (db) => {
    if (job?.id) await assertMemoryJobLease(db, job);
    return persistChatImageFailure(db, { messageId, assetId, error, job });
  });
  await finishChatImageFailure(failure);
}

// Shared by provider failure, queue expiry and confirmed worker termination.
// The caller may already hold the memory job row; do not start a nested transaction.
async function persistChatImageFailure(db, { messageId, assetId, error, job = null }) {
  const [assetRows] = await db.execute(
    "SELECT status, storage_path, session_id, internal_uid, guest_session_id, character_id FROM chat_image_assets WHERE id = ? AND message_id = ? LIMIT 1 FOR UPDATE",
    [assetId, messageId]
  );
  const asset = assetRows[0];
  if (!asset || asset.status === CHAT_IMAGE_STATUSES.READY) return null;
  if (asset.status !== CHAT_IMAGE_STATUSES.FAILED) {
    await db.execute(
      `UPDATE chat_image_assets
       SET status = 'failed',
           error_message = ?, completed_at = NOW(3), updated_at = NOW(3)
       WHERE id = ? AND message_id = ? AND status IN ('queued', 'generating')`,
      [truncateError(error), assetId, messageId]
    );
    await db.execute(
      `UPDATE chat_messages
       SET delivery_status = 'failed', text_content = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [getChatImageStatusCopy({ language: imageJobLanguage(job), status: CHAT_IMAGE_STATUSES.FAILED }), messageId]
    );
    await releaseGuestImageEntitlementForAsset(db, assetId);
    await releaseGuestImageDailyQuotaForAsset(db, assetId);
  }
  // Failure state, quota release and its natural follow-up are committed together.
  await enqueueChatImageFailureReplyIfNeeded(db, {
    assetId, messageId, sessionId: asset.session_id, userId: asset.internal_uid,
    guestSessionId: asset.guest_session_id, characterId: asset.character_id,
  });
  return { assetId, storagePath: asset.storage_path || "" };
}

async function finishChatImageFailure(failure) {
  if (failure) await deleteStoredChatImageAsset(failure);
}

async function reconcileReadyImageJob({ messageId, assetId, job = null }) {
  return withTransaction(async (db) => {
    if (job?.id) await assertMemoryJobLease(db, job);
    const [rows] = await db.execute(
      `SELECT status, provider
       FROM chat_image_assets
       WHERE id = ?
         AND message_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assetId, messageId]
    );
    const asset = rows[0] || null;
    if (!asset) return { ready: false, missing: true };
    if (asset.status === CHAT_IMAGE_STATUSES.FAILED) return { ready: false, failed: true };
    if (asset.status !== CHAT_IMAGE_STATUSES.READY) return { ready: false, provider: asset.provider || "" };
    const entitlement = await consumeGuestImageEntitlementForAsset(db, assetId);
    if (entitlement.guest && !entitlement.consumed) {
      throw new Error("Ready guest image entitlement could not be reconciled");
    }
    const dailyQuota = await consumeGuestImageDailyQuotaForAsset(db, assetId);
    if (dailyQuota.enforced && !dailyQuota.consumed) {
      throw new Error("Ready guest daily image quota could not be reconciled");
    }
    await enqueueChatImageTerminalReplyIfNeeded(db, { assetId, messageId });
    return { ready: true, provider: asset.provider || "" };
  });
}

async function recordReadyChatImageUsage({ messageId, assetId }, db = null) {
  if (!db) return withTransaction((connection) => recordReadyChatImageUsage({ messageId, assetId }, connection));
  const [rows] = await db.execute(
    `SELECT internal_uid, session_id, character_id, guest_session_id
     FROM chat_image_assets
     WHERE id = ?
       AND message_id = ?
       AND status = 'ready'
     LIMIT 1`,
    [assetId, messageId]
  );
  const asset = rows[0];
  if (!asset) return;
  if (!asset.internal_uid || asset.guest_session_id) return;
  await recordChatImageUsage(db, {
    userId: asset.internal_uid,
    sessionId: asset.session_id,
    characterId: asset.character_id,
    messageId,
    assetId,
  });
}

function shouldKeepChatImageGeneratingForRetry(job = {}) {
  return Number(job.retryCount || 0) < Number(job.maxRetries || 0);
}

function truncateError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.trim().slice(0, 500) || "chat image generation failed";
}

async function assertImageJobLease(job) {
  if (job?.id) await withTransaction((db) => assertMemoryJobLease(db, job));
}

async function assertChatImageJobCanContinue(job, { messageId, assetId }) {
  await assertImageJobLease(job);
  const [[asset]] = await getDbPool().execute(
    "SELECT status, created_at FROM chat_image_assets WHERE id = ? AND message_id = ? LIMIT 1",
    [assetId, messageId]
  );
  if (!asset || ![CHAT_IMAGE_STATUSES.QUEUED, CHAT_IMAGE_STATUSES.GENERATING].includes(asset.status)) {
    throw nonRetryableImageError("Chat image task is already terminal");
  }
  const deadline = getChatImageJobDeadline({ createdAt: asset.created_at, retryCount: job.retryCount, status: asset.status });
  if (deadline) throw createChatImageDeadlineError(deadline);
}

export async function expireQueuedChatImageJobs({ limit = 20, maxRunMs = 2000, now = new Date(), jobId = "" } = {}) {
  const startedAt = Date.now();
  const rows = await listExpiredQueuedChatImageJobs(getDbPool(), { limit, now, jobId });
  const result = { scanned: 0, expired: 0, skipped: 0 };
  for (const row of rows) {
    if (Date.now() - startedAt >= Math.max(1, Number(maxRunMs) || 2000)) break;
    result.scanned += 1;
    let releaseLock;
    try {
      releaseLock = await acquireChatImageJobLock(row.asset_id, { timeoutSeconds: 0 });
    } catch {
      result.skipped += 1;
      continue;
    }
    try {
      const failure = await withTransaction(async (db) => {
        // Asset advisory lock precedes the job row; running owners are never reclaimed here.
        const [[job]] = await db.execute(
          "SELECT job_status, retry_count FROM memory_jobs WHERE id = ? AND job_type = 'generate_chat_image' LIMIT 1 FOR UPDATE",
          [row.id]
        );
        if (job?.job_status !== "queued") return null;
        const [[asset]] = await db.execute(
          "SELECT status, created_at FROM chat_image_assets WHERE id = ? AND message_id = ? LIMIT 1 FOR UPDATE",
          [row.asset_id, row.message_id]
        );
        if (!asset) return null;
        const code = getChatImageJobDeadline({ createdAt: asset.created_at, retryCount: job.retry_count, status: asset.status, now });
        if (!code) return null;
        const error = createChatImageDeadlineError(code);
        const failed = await persistChatImageFailure(db, { assetId: row.asset_id, messageId: row.message_id, error, job: row });
        if (!failed) return null;
        await db.execute(
          `UPDATE memory_jobs SET job_status = 'failed', failed_at = NOW(3),
             last_error = ?, updated_at = NOW(3)
           WHERE id = ? AND job_status = 'queued'`,
          [error.message, row.id]
        );
        return failed;
      });
      if (failure) {
        await finishChatImageFailure(failure);
        result.expired += 1;
      } else result.skipped += 1;
    } finally {
      await releaseLock();
    }
  }
  return result;
}

// Only the supervisor may call this after the executing child has exited.
// It does not own the memory job transition; the supervisor uses the same claim token CAS.
export async function finalizeInterruptedChatImageJob(job = {}, error = createChatImageDeadlineError()) {
  const assetId = String(job.payload?.assetId || "").trim();
  const messageId = String(job.payload?.messageId || "").trim();
  if (!assetId || !messageId) return { skipped: true, reason: "missing_image_identity" };
  const releaseLock = await acquireChatImageJobLock(assetId, { timeoutSeconds: 0 });
  try {
    const existing = await reconcileReadyImageJob({ messageId, assetId, job });
    if (existing.missing) return { status: CHAT_IMAGE_STATUSES.FAILED, ready: false, skipped: true, reason: "image_asset_missing", assetId, messageId };
    if (existing.failed) return { status: CHAT_IMAGE_STATUSES.FAILED, ready: false, skipped: true, assetId, messageId };
    if (existing.ready) {
      await recordReadyChatImageUsage({ messageId, assetId });
      return { status: CHAT_IMAGE_STATUSES.READY, ready: true, assetId, messageId };
    }
    // Reuse the validated staged file if the request remains eligible and within its deadline.
    try {
      await assertChatImageJobCanContinue(job, { messageId, assetId });
      await assertGuestImageGenerationAllowed({ messageId, assetId });
      const staged = await recoverStagedChatImage({ messageId, assetId });
      if (staged) {
        await markChatImageReady({ messageId, assetId, saved: staged, job });
        return { status: CHAT_IMAGE_STATUSES.READY, ready: true, assetId, messageId };
      }
    } catch (stateError) {
      if (stateError.code === "MEMORY_JOB_LEASE_LOST") throw stateError;
    }
    await assertImageJobLease(job);
    await markChatImageFailed({ messageId, assetId, error }, job);
    return { status: CHAT_IMAGE_STATUSES.FAILED, ready: false, assetId, messageId };
  } finally {
    await releaseLock();
  }
}
