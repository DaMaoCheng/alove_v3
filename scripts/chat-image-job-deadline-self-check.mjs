import { normalizeCharacterLanguage } from "../shared/language-library.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Pure contract checks exercise the production functions with controlled SQL/file boundaries.
// No bootstrap, real image provider or model call is permitted here.
const lifecycle = await import("../server/chat-image-job-lifecycle-service.js");
const { getChatImageJobDeadline: deadline } = lifecycle;
const now = new Date("2026-10-19T03:00:00.000Z");
const ago = (ms) => new Date(now.getTime() - ms);
assert.equal(deadline({ createdAt: ago(299999), now }), null);
assert.equal(deadline({ createdAt: ago(300000), now }), "chat_image_queue_deadline");
assert.equal(deadline({ createdAt: ago(300000), status: "generating", now }), null);
assert.equal(deadline({ createdAt: ago(300000), retryCount: 1, now }), null);
assert.equal(deadline({ createdAt: ago(900000), retryCount: 1, status: "generating", now }), "chat_image_request_deadline");
for (const status of ["ready", "failed"]) assert.equal(deadline({ createdAt: ago(99999999), status, now }), null);
assert.equal(deadline({ createdAt: "invalid", now }), null);
assert.equal(deadline({ createdAt: new Date(now.getTime() + 10000), now }), null);
const sqlCalls = [];
await lifecycle.listExpiredQueuedChatImageJobs({ execute: async (...args) => { sqlCalls.push(args); return [[]]; } }, { limit: 999, now });
assert.match(sqlCalls[0][0].sql, /LIMIT 100/);
assert.match(sqlCalls[0][0].sql, /j.job_status = 'queued'/);
assert.equal(sqlCalls[0][0].timeout, 1000);
assert.equal(new Date(sqlCalls[0][1][2]).getTime(), now.getTime() - 900000);

const source = (await readFile(new URL("../server/chat-image-job-service.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, "")
  .replace(/^export /gm, "");
function fixture({ status = "queued", jobStatus = "queued", retryCount = 0, ageMs = 360000, leaseLost = false, staged = null, missing = false } = {}) {
  const asset = { status, storage_path: "", created_at: new Date(Date.now() - ageMs), session_id: "session", character_id: "character" };
  const memory = { job_status: jobStatus, retry_count: retryCount };
  const events = [];
  const db = { execute: async (query, params = []) => {
    const sql = typeof query === "string" ? query : query.sql;
    events.push(sql);
    if (/GET_LOCK/.test(sql)) return [[{ locked: 1 }]];
    if (/RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
    if (/SELECT job_status/.test(sql)) return [[{ ...memory }]];
    if (/SELECT.*FROM chat_image_assets/s.test(sql)) return [missing ? [] : [{ ...asset }]];
    if (/SELECT a.guest_session_id/.test(sql)) return [[{ ...asset }]];
    if (/UPDATE memory_jobs/.test(sql)) { memory.job_status = "failed"; return [{ affectedRows: 1 }]; }
    if (/UPDATE chat_image_assets/.test(sql)) {
      if (/status = 'failed'/.test(sql)) asset.status = "failed";
      if (/status = 'generating'/.test(sql)) asset.status = "generating";
      if (/status = 'ready'/.test(sql)) asset.status = "ready";
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE chat_messages/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  }, getConnection: async () => ({ execute: db.execute, release() {} }) };
  const dependencies = {
    ...lifecycle,
    getDbPool: () => db,
    withTransaction: async (work) => work(db),
    assertMemoryJobLease: async () => {
      if (leaseLost) throw Object.assign(Error("Lease lost"), { code: "MEMORY_JOB_LEASE_LOST", retryable: false });
    },
    normalizeCharacterLanguage,
    getChatImageStatusCopy: ({ status: value }) => value,
    CHAT_IMAGE_STATUSES: { QUEUED: "queued", GENERATING: "generating", READY: "ready", FAILED: "failed" },
    listExpiredQueuedChatImageJobs: async () => [{ id: "job", asset_id: "asset", message_id: "message" }],
    consumeGuestImageEntitlementForAsset: async () => ({ guest: false }),
    consumeGuestImageDailyQuotaForAsset: async () => ({ enforced: false }),
    releaseGuestImageEntitlementForAsset: async () => { events.push("release-entitlement"); },
    releaseGuestImageDailyQuotaForAsset: async () => { events.push("release-reservation"); },
    enqueueChatImageFailureReplyIfNeeded: async () => { events.push("enqueue-failure-reply"); },
    deleteStoredChatImageAsset: async () => { events.push("delete-file"); },
    findRecoverableChatImageAsset: async () => staged,
    lockChatImageQuota: async () => {},
    recordChatImageUsage: async () => {},
  };
  const api = new Function(...Object.keys(dependencies), `${source}\nreturn { generateChatImageFromJob, expireQueuedChatImageJobs, finalizeInterruptedChatImageJob };`)(...Object.values(dependencies));
  return { ...api, events, asset, memory, job: { id: "job", claimToken: "current", retryCount, maxRetries: 1, payload: { assetId: "asset", messageId: "message" } } };
}
let item = fixture();
assert.equal((await item.expireQueuedChatImageJobs()).expired, 1);
assert.equal(item.asset.status, "failed"); assert.equal(item.memory.job_status, "failed");
assert.equal(item.events.filter((x) => x === "release-entitlement").length, 1);
assert.equal(item.events.filter((x) => x === "enqueue-failure-reply").length, 1);
assert.ok(item.events.indexOf("enqueue-failure-reply") < item.events.findIndex((x) => /^UPDATE memory_jobs/.test(x)), "failure follow-up is inserted before the queue transaction commits");
assert.equal((await item.expireQueuedChatImageJobs()).expired, 0, "repeat expiry must not release quota twice");
item = fixture({ jobStatus: "running" });
assert.equal((await item.expireQueuedChatImageJobs()).expired, 0);
assert.equal(item.asset.status, "queued", "watchdog must not steal a running owner");
item = fixture({ status: "ready" });
assert.equal((await item.expireQueuedChatImageJobs()).expired, 0);
assert.equal(item.asset.status, "ready");
item = fixture({ status: "failed", jobStatus: "running" });
assert.equal((await item.generateChatImageFromJob(item.job)).skipped, true);
assert.equal(item.events.some((x) => /^\s*UPDATE/.test(x)), false, "failed asset cannot be resurrected");
item = fixture({ status: "queued", jobStatus: "running", ageMs: 960000 });
await assert.rejects(item.generateChatImageFromJob(item.job), { code: "chat_image_request_deadline" });
assert.equal(item.asset.status, "failed", "overdue request must fail before invoking provider");
item = fixture({ status: "queued", jobStatus: "running", leaseLost: true });
await assert.rejects(item.generateChatImageFromJob(item.job), { code: "MEMORY_JOB_LEASE_LOST" });
assert.equal(item.events.some((x) => /^\s*UPDATE/.test(x)), false, "stale attempt must not change asset");
item = fixture({ missing: true, jobStatus: "running" });
assert.equal((await item.finalizeInterruptedChatImageJob(item.job)).reason, "image_asset_missing", "deleted asset must not leave an un-settleable running job");
item = fixture({ status: "ready", jobStatus: "running" });
assert.equal((await item.finalizeInterruptedChatImageJob(item.job, Error("timeout"))).ready, true);
assert.equal(item.events.includes("release-entitlement"), false, "ready image cannot be downgraded or refunded");
item = fixture({ status: "generating", jobStatus: "running", ageMs: 1000,
  staged: { storagePath: "staged", protectedPath: "protected", width: 10, height: 10, bytes: 10, mimeType: "image/webp" } });
assert.equal((await item.finalizeInterruptedChatImageJob(item.job, Error("timeout"))).ready, true);
assert.equal(item.asset.status, "ready", "confirmed interruption reuses already-saved valid file");
item = fixture({ status: "generating", jobStatus: "running", ageMs: 960000, retryCount: 1 });
assert.equal((await item.finalizeInterruptedChatImageJob(item.job, Error("timeout"))).status, "failed");
assert.equal(item.events.includes("release-reservation"), true);
console.log("chat image queue/request deadline and terminal-state pure guards passed");

if (!process.argv.includes("--database")) process.exit(0);
await checkLocalDatabase();

async function checkLocalDatabase() {
  const { SERVER_CONFIG } = await import("../server/config.js");
  assert.ok(["127.0.0.1", "localhost"].includes(SERVER_CONFIG.db.host));
  assert.equal(Number(SERVER_CONFIG.db.port), 3307);
  const { getDbPool, closeDbPool } = await import("../server/db.js");
  const { createChatImagePlaceholder } = await import("../server/chat-image-generation-service.js");
  const jobs = await import("../server/chat-image-job-service.js");
  const { enqueueChatImageFailureReplyIfNeeded } = await import("../server/chat-image-failure-reply-job-service.js");
  const { saveMockChatImageAsset, deleteStoredChatImageAsset } = await import("../server/chat-image-asset-service.js");
  const suffix = randomUUID().replaceAll("-", "");
  const uid = `deadline_user_${suffix}`;
  const sid = `deadline_chat_${suffix}`;
  const db = getDbPool();
  const files = [];
  try {
    const [[character]] = await db.execute("SELECT id FROM ai_characters WHERE character_status = 'published' LIMIT 1");
    assert.ok(character?.id);
    await db.execute("INSERT INTO users (id, platform_uid, username, email, password_hash, nickname, account_type, account_status) VALUES (?, ?, ?, ?, 'self-check-disabled', 'Image deadline check', 'personal', 'active')", [uid, uid, uid, `${suffix}@image-deadline.invalid`]);
    await db.execute("INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref) VALUES (?, ?, ?, 'Image deadline fixture', 'active', 'self-check', 'image-deadline-self-check')", [sid, uid, character.id]);
    const make = async ({ ageMinutes = 6, retryCount = 0, status = "queued", memoryStatus = "queued" } = {}) => {
      const placeholder = await createChatImagePlaceholder(db, { session: { id: sid }, character: { id: character.id }, userId: uid, userText: "deadline fixture", afterDisplayOrder: 10, sourceType: "self-check", sourceRef: "image-deadline-self-check" });
      const assetId = placeholder.image.id;
      const messageId = placeholder.id;
      await db.execute("UPDATE chat_image_assets SET status = ?, created_at = DATE_SUB(NOW(3), INTERVAL ? MINUTE) WHERE id = ?", [status, ageMinutes, assetId]);
      const [[row]] = await db.execute("SELECT id FROM memory_jobs WHERE session_id = ? AND job_type = 'generate_chat_image' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.assetId')) = ?", [sid, assetId]);
      await db.execute("UPDATE memory_jobs SET job_status = ?, retry_count = ?, claim_token = ?, available_at = DATE_ADD(NOW(3), INTERVAL 1 DAY) WHERE id = ?", [memoryStatus, retryCount, memoryStatus === "running" ? "deadline-fixture" : null, row.id]);
      return { id: row.id, claimToken: "deadline-fixture", retryCount, maxRetries: 1, payload: { assetId, messageId } };
    };
    // An interrupted/rolled-back failure transaction must publish neither state nor follow-up.
    const rolledBack = await make();
    const enqueueInput = { assetId: rolledBack.payload.assetId, messageId: rolledBack.payload.messageId,
      sessionId: sid, userId: uid, characterId: character.id };
    const transaction = await db.getConnection();
    let stableId;
    try {
      await transaction.beginTransaction();
      await transaction.execute("UPDATE chat_image_assets SET status = 'failed' WHERE id = ?", [rolledBack.payload.assetId]);
      stableId = await enqueueChatImageFailureReplyIfNeeded(transaction, enqueueInput);
      await transaction.rollback();
      const [[rolledState]] = await db.execute("SELECT status FROM chat_image_assets WHERE id = ?", [rolledBack.payload.assetId]);
      assert.equal(rolledState.status, "queued");
      const [[rolledJob]] = await db.execute("SELECT COUNT(*) AS total FROM memory_jobs WHERE id = ?", [stableId]);
      assert.equal(Number(rolledJob.total), 0, "rollback cannot leave an orphaned failure reply");
      await transaction.beginTransaction();
      assert.equal(await enqueueChatImageFailureReplyIfNeeded(transaction, enqueueInput), stableId);
      let competitorFinished = false;
      const competitor = enqueueChatImageFailureReplyIfNeeded(db, enqueueInput).finally(() => { competitorFinished = true; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(competitorFinished, false, "stable PK must wait for the uncommitted insert");
      await transaction.commit();
      assert.equal(await competitor, stableId);
      const [[deduped]] = await db.execute("SELECT COUNT(*) AS total FROM memory_jobs WHERE job_type = 'generate_chat_image_failure_reply' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.assetId')) = ?", [rolledBack.payload.assetId]);
      assert.equal(Number(deduped.total), 1, "commit-window race must produce one failure reply job");
      await db.execute("DELETE FROM memory_jobs WHERE id IN (?, ?)", [stableId, rolledBack.id]);
      await db.execute("DELETE FROM chat_messages WHERE id = ?", [rolledBack.payload.messageId]);
    } finally {
      await transaction.rollback();
      transaction.release();
    }
    const first = await make();
    const total = await make({ ageMinutes: 16, retryCount: 1, status: "generating" });
    const active = await make({ memoryStatus: "running" });
    assert.equal((await jobs.expireQueuedChatImageJobs({ jobId: first.id })).expired, 1);
    assert.equal((await jobs.expireQueuedChatImageJobs({ jobId: total.id })).expired, 1);
    assert.equal((await jobs.expireQueuedChatImageJobs({ jobId: active.id })).expired, 0);
    const [[states]] = await db.execute("SELECT (SELECT status FROM chat_image_assets WHERE id = ?) AS first_status, (SELECT status FROM chat_image_assets WHERE id = ?) AS total_status, (SELECT status FROM chat_image_assets WHERE id = ?) AS active_status", [first.payload.assetId, total.payload.assetId, active.payload.assetId]);
    assert.deepEqual(states, { first_status: "failed", total_status: "failed", active_status: "queued" });
    const [[replyCount]] = await db.execute("SELECT COUNT(*) AS total FROM memory_jobs WHERE session_id = ? AND job_type = 'generate_chat_image_failure_reply'", [sid]);
    assert.equal(Number(replyCount.total), 2);
    await jobs.expireQueuedChatImageJobs({ jobId: first.id });
    const [[repeat]] = await db.execute("SELECT COUNT(*) AS total FROM memory_jobs WHERE session_id = ? AND job_type = 'generate_chat_image_failure_reply'", [sid]);
    assert.equal(Number(repeat.total), 2, "expiry failure follow-up is idempotent");
    const interrupted = await make({ ageMinutes: 0, status: "generating", memoryStatus: "running" });
    const saved = await saveMockChatImageAsset({ assetId: interrupted.payload.assetId }); files.push({ assetId: interrupted.payload.assetId, storagePath: saved.storagePath });
    await db.execute("UPDATE chat_image_assets SET storage_path = ? WHERE id = ?", [saved.storagePath, interrupted.payload.assetId]);
    assert.equal((await jobs.finalizeInterruptedChatImageJob(interrupted, Error("controlled confirmed exit"))).ready, true);
    assert.equal((await jobs.finalizeInterruptedChatImageJob(interrupted, Error("repeat confirmed exit"))).ready, true);
    const [[usage]] = await db.execute("SELECT COUNT(*) AS total FROM chat_image_usage WHERE asset_id = ?", [interrupted.payload.assetId]);
    assert.equal(Number(usage.total), 1, "staged replay must not consume member quota twice");
    await db.execute("UPDATE memory_jobs SET claim_token = 'new-owner' WHERE id = ?", [active.id]);
    await assert.rejects(jobs.generateChatImageFromJob(active), { code: "MEMORY_JOB_LEASE_LOST" });
    console.log("chat image local database expiry/failure dedupe/staged replay/lease guards passed (controlled image file, no paid generation)");
  } finally {
    for (const file of files) await deleteStoredChatImageAsset(file);
    await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [sid]);
    await db.execute("DELETE FROM users WHERE id = ?", [uid]);
    await closeDbPool();
  }
}
