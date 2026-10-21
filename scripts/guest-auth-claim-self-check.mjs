import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeDbPool, getDbPool, withTransaction } from "../server/db.js";
import { loginUser, registerUser } from "../server/auth-service.js";
import { acquireGuestReplyLockForToken } from "../server/guest-chat-service.js";
import { maybeCreateGuestChatImagePlaceholder } from "../server/chat-image-generation-service.js";
import { generateChatImageFromJob } from "../server/chat-image-job-service.js";
import { claimGuestSessionForUser } from "../server/guest-auth-claim-service.js";
import { insertMessage } from "../server/chat-message-store.js";
import { requireChatAttachmentAccess, requireChatImageAccess, requireGuestChatAttachmentAccess, requireGuestChatImageAccess, requireGuestVoiceAccess } from "../server/protected-upload-routes.js";
import { createToken, hashSecret, hashSessionToken } from "../server/security.js";
import { extractFileName } from "../server/protected-upload-url-service.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY, CHAT_IMAGE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { resolveElevenLabsTtsConfig } from "../server/elevenlabs-tts-service.js";
import { cleanupExpiredGuestSessions } from "../server/guest-session-cleanup-service.js";
import { rebuildSummaryFromJob } from "../server/memory-summary-job-service.js";
import { findOrCreateUserSession } from "../server/chat-session-service.js";
import { backfillClaimedGuestContextFromJob } from "../server/guest-claim-context-job-service.js";
import { backfillChatMessageIndexForSession } from "../server/chat-message-index-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";
import {
  claimNextMemoryJob,
  completeMemoryJob,
  recoverStaleClaimedGuestContextJobs,
} from "../server/memory-job-service.js";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest claim self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const password = `GuestClaim#${randomUUID()}`;
const createdGuestIds = new Set();
const createdSessionIds = new Set();
const createdMemoryJobIds = new Set();
const createdUserIds = new Set();
const createdEmails = new Set();
const createdFiles = new Set();
const createdAttachmentFiles = new Set();
const createdVoiceFiles = new Set();
const createdVoiceAssetIds = new Set();
const guestClaimSource = readFileSync("server/guest-auth-claim-service.js", "utf8");

assert.doesNotMatch(guestClaimSource, /backfillClaimedGuestContextFromJob|backfillChatMessageIndexForSession/, "guest claim must enqueue context backfill instead of synchronously building indexes");

try {
  const [[fkk]] = await db.execute(
    `SELECT s.id, s.slug, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk'
     LIMIT 1`
  );
  const [[gg]] = await db.execute(
    `SELECT id, slug
     FROM sites
     WHERE id <> ? AND site_status = 'active'
     ORDER BY is_default DESC, updated_at DESC
     LIMIT 1`,
    [fkk.id]
  );
  assert.ok(fkk?.id && fkk?.character_id && gg?.id, "two active sites and the FKK mascot are required");
  const [[character]] = await db.execute(
    `SELECT id, name, opening_line, persona_prompt, speaking_style, role_title, short_bio, site_id, category_id
     FROM ai_characters
     WHERE id = ?
     LIMIT 1`,
    [fkk.character_id]
  );

  const registrationGuest = fixture("registration");
  await createGuest(registrationGuest, fkk, character, { withProduct: true, withImage: true });
  const registrationMedia = await createGuestClaimMedia(registrationGuest, fkk, character, "registration");
  const registrationCallId = `call_claim-${suffix}`.slice(0, 64);
  await db.execute(
    `INSERT INTO guest_call_sessions (
       id, guest_session_id, site_id, character_id, network_hash, lease_token, call_status,
       duration_milliseconds, turn_count, started_at, last_accounted_at, ended_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, 'claim-check', 'active', 0, 2, DATE_SUB(NOW(3), INTERVAL 2 HOUR), DATE_SUB(NOW(3), INTERVAL 2 HOUR), NULL, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [registrationCallId, registrationGuest.guestId, fkk.id, character.id, "b".repeat(64)]
  );
  await db.execute("UPDATE guest_sessions SET active_call_id = ? WHERE id = ?", [registrationCallId, registrationGuest.guestId]);
  const registrationEmail = `guest-claim-register-${suffix}@example.com`;
  createdEmails.add(registrationEmail);
  await insertRegistrationCode(registrationEmail, "654321");
  const registration = await registerUser({
    email: registrationEmail,
    nickname: "Guest Claim Registration",
    password,
    confirmPassword: password,
    verificationCode: "654321",
    siteSlug: fkk.slug,
    locale: "en",
  }, { guestToken: registrationGuest.token });
  createdUserIds.add(registration.userId);
  assert.equal(registration.guestClaim?.status, "claimed");
  assert.equal(registration.guestClaimInternal?.targetSessionId, registrationGuest.sessionId);
  assert.equal("guestSessionId" in registration.guestClaim, false, "auth response must not expose guest ids");
  assert.equal("targetSessionId" in registration.guestClaim, false, "auth response must not expose chat session ids");
  assert.equal("clearGuestCookie" in registration.guestClaim, false, "auth response must not expose cookie-control internals");
  const [[transferredSession]] = await db.execute(
    "SELECT internal_uid, guest_session_id, source_type, source_ref FROM chat_sessions WHERE id = ?",
    [registrationGuest.sessionId]
  );
  assert.deepEqual(
    {
      owner: transferredSession.internal_uid,
      guest: transferredSession.guest_session_id,
      sourceType: transferredSession.source_type,
      sourceRef: transferredSession.source_ref,
    },
    {
      owner: registration.userId,
      guest: registrationGuest.guestId,
      sourceType: "user",
      sourceRef: "guest-claim",
    }
  );
  const [[claimedCall]] = await db.execute(
    "SELECT claimed_user_id, target_chat_session_id, duration_milliseconds, turn_count FROM guest_call_sessions WHERE id = ?",
    [registrationCallId]
  );
  assert.equal(claimedCall.claimed_user_id, registration.userId);
  assert.equal(claimedCall.target_chat_session_id, registrationGuest.sessionId);
  assert.ok(Number(claimedCall.duration_milliseconds) >= 2 * 60 * 60 * 1000, "claim should retain audit duration without enforcing a time allowance");
  assert.equal(Number(claimedCall.turn_count), 2);
  const imageJob = await loadImageJob(registrationGuest.sessionId);
  const imageResult = await generateChatImageFromJob(imageJob);
  assert.equal(imageResult.status, "ready", "an in-flight guest image should complete after claim");
  assert.equal(await completeMemoryJob(imageJob.id, imageResult, { claimToken: imageJob.claimToken }), true,
    "the directly executed image fixture must finalize its owned job lease");
  const [[claimedImage]] = await db.execute(
    `SELECT a.storage_path, a.protected_path, a.status, e.entitlement_status,
            (SELECT COUNT(*) FROM chat_image_usage u WHERE u.asset_id = a.id) AS formal_usage
     FROM chat_image_assets a
     JOIN guest_image_entitlements e ON e.asset_id = a.id
     WHERE a.guest_session_id = ?`,
    [registrationGuest.guestId]
  );
  assert.deepEqual(
    { status: claimedImage.status, entitlement: claimedImage.entitlement_status, formalUsage: Number(claimedImage.formal_usage) },
    { status: "ready", entitlement: "consumed", formalUsage: 0 }
  );
  const claimedFileName = extractFileName(claimedImage.protected_path || claimedImage.storage_path);
  createdFiles.add(claimedFileName);
  await requireChatImageAccess({ id: registration.userId }, claimedFileName);
  await assert.rejects(
    () => requireGuestChatImageAccess(registrationGuest.token, claimedFileName),
    (error) => Number(error?.statusCode || 0) === 401,
    "claimed guest cookie must no longer read the image"
  );
  await assertClaimedMediaAccess({ fixtureValue: registrationGuest, media: registrationMedia, userId: registration.userId, targetSessionId: registrationGuest.sessionId });
  const [[registrationPayloads]] = await db.execute(
    `SELECT
       SUM(content_type = 'product') AS products,
       SUM(content_type = 'image_generation') AS images
     FROM chat_messages
     WHERE session_id = ?`,
    [registrationGuest.sessionId]
  );
  assert.deepEqual(
    { products: Number(registrationPayloads.products), images: Number(registrationPayloads.images) },
    { products: 1, images: 1 },
    "product cards and image placeholders should remain in the claimed history"
  );
  const [[registrationContext]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM chat_message_index WHERE internal_uid = ?) AS indexes,
       (SELECT COUNT(*) FROM memory_jobs WHERE internal_uid = ? AND job_type = 'backfill_claimed_guest_context') AS claim_context_jobs,
       (SELECT COUNT(*) FROM memory_jobs WHERE internal_uid = ? AND job_type IN ('extract_user_memory','send_proactive_message')) AS forbidden_jobs`,
    [registration.userId, registration.userId, registration.userId]
  );
  assert.ok(Number(registrationContext.indexes) >= 0, "the local runner may complete an already-enqueued context job before this runtime snapshot");
  assert.equal(Number(registrationContext.claim_context_jobs), 1, "claim should enqueue one asynchronous context job");
  assert.equal(Number(registrationContext.forbidden_jobs), 0);
  const [[claimContextJobRow]] = await db.execute(
    `SELECT id, job_type, internal_uid, character_id, session_id, payload_json
     FROM memory_jobs
     WHERE internal_uid = ?
       AND job_type = 'backfill_claimed_guest_context'
     LIMIT 1`,
    [registration.userId]
  );
  assert.ok(claimContextJobRow);
  createdMemoryJobIds.add(claimContextJobRow.id);
  await db.execute(
    `UPDATE memory_jobs
     SET job_status = 'running', claim_token = NULL, started_at = NULL, updated_at = DATE_SUB(NOW(3), INTERVAL 10 MINUTE)
     WHERE id = ?`,
    [claimContextJobRow.id]
  );
  assert.equal(
    await recoverStaleClaimedGuestContextJobs({ jobId: claimContextJobRow.id }),
    1,
    "a stale claimed guest context job should return to the queue"
  );
  const [[recoveredClaimContextJob]] = await db.execute(
    "SELECT job_status, started_at FROM memory_jobs WHERE id = ?",
    [claimContextJobRow.id]
  );
  assert.deepEqual(
    { status: recoveredClaimContextJob.job_status, startedAt: recoveredClaimContextJob.started_at },
    { status: "queued", startedAt: null }
  );
  await db.execute("UPDATE memory_jobs SET available_at = NOW(3) WHERE id = ?", [claimContextJobRow.id]);
  const claimContextJob = await claimNextMemoryJob({ jobId: claimContextJobRow.id });
  assert.ok(claimContextJob?.claimToken, "recovered backfill fixture must claim its own job");
  await backfillClaimedGuestContextFromJob(claimContextJob);
  assert.equal(await completeMemoryJob(claimContextJob.id, { ok: true, source: "self-check" }, { claimToken: claimContextJob.claimToken }), true);
  const [[completedClaimContextJob]] = await db.execute(
    "SELECT job_status FROM memory_jobs WHERE id = ?",
    [claimContextJobRow.id]
  );
  assert.equal(completedClaimContextJob.job_status, "completed");
  const [indexedContentTypes] = await db.execute(
    `SELECT DISTINCT m.content_type
     FROM chat_message_index i
     JOIN chat_messages m ON m.id = i.message_id
     WHERE i.internal_uid = ?`,
    [registration.userId]
  );
  assert.deepEqual(indexedContentTypes.map((row) => row.content_type), ["text"], "claim backfill must index text messages only");
  const [summaryJobRows] = await db.execute(
    `SELECT id, job_type, internal_uid, character_id, session_id, payload_json
     FROM memory_jobs
     WHERE internal_uid = ?
       AND job_type IN ('rebuild_daily_summary','rebuild_weekly_summary','rebuild_monthly_summary')`,
    [registration.userId]
  );
  assert.equal(summaryJobRows.length, 3);
  for (const row of summaryJobRows) {
    const payload = typeof row.payload_json === "object" ? row.payload_json : JSON.parse(row.payload_json);
    assert.equal(payload.textOnly, true, "claim summary jobs must carry the text-only boundary");
  }
  const dailySummaryJob = summaryJobRows.find((row) => row.job_type === "rebuild_daily_summary");
  const dailyPayload = typeof dailySummaryJob.payload_json === "object" ? dailySummaryJob.payload_json : JSON.parse(dailySummaryJob.payload_json);
  await rebuildSummaryFromJob({
    id: dailySummaryJob.id,
    jobType: dailySummaryJob.job_type,
    userId: dailySummaryJob.internal_uid,
    characterId: dailySummaryJob.character_id,
    sessionId: dailySummaryJob.session_id,
    payload: dailyPayload,
  });
  const [summaryLinkedTypes] = await db.execute(
    `SELECT DISTINCT m.content_type
     FROM conversation_summary_links l
     JOIN conversation_summaries s ON s.id = l.summary_id
     JOIN chat_messages m ON m.id = l.source_message_id
     WHERE s.internal_uid = ?
       AND l.source_session_id = ?`,
    [registration.userId, registrationGuest.sessionId]
  );
  assert.deepEqual(summaryLinkedTypes.map((row) => row.content_type), ["text"], "claim summaries must link text messages only");
  await backfillChatMessageIndexForSession(db, {
    sessionId: registrationGuest.sessionId,
    userId: registration.userId,
    characterId: character.id,
    limit: 240,
  });
  const [laterIndexedContentTypes] = await db.execute(
    `SELECT DISTINCT m.content_type
     FROM chat_message_index i
     JOIN chat_messages m ON m.id = i.message_id
     WHERE i.internal_uid = ?`,
    [registration.userId]
  );
  assert.deepEqual(
    laterIndexedContentTypes.map((row) => row.content_type),
    ["text"],
    "later formal backfills must permanently exclude claimed guest product and image messages"
  );
  await rebuildSummaryFromJob({
    id: dailySummaryJob.id,
    jobType: dailySummaryJob.job_type,
    userId: dailySummaryJob.internal_uid,
    characterId: dailySummaryJob.character_id,
    sessionId: dailySummaryJob.session_id,
    payload: { ...dailyPayload, textOnly: false },
  });
  const [laterSummaryLinkedTypes] = await db.execute(
    `SELECT DISTINCT m.content_type
     FROM conversation_summary_links l
     JOIN conversation_summaries s ON s.id = l.summary_id
     JOIN chat_messages m ON m.id = l.source_message_id
     WHERE s.internal_uid = ?
       AND l.source_session_id = ?`,
    [registration.userId, registrationGuest.sessionId]
  );
  assert.deepEqual(
    laterSummaryLinkedTypes.map((row) => row.content_type),
    ["text"],
    "later formal summaries must permanently exclude claimed guest product and image messages"
  );

  const loginUserFixture = await createUser("login", fkk.id);
  const existingSessionId = id("chat_existing");
  createdSessionIds.add(existingSessionId);
  await createFormalSession(existingSessionId, loginUserFixture.id, character.id, "2026-01-01 10:00:00.000");
  const loginGuest = fixture("login_merge");
  await createGuest(loginGuest, fkk, character, {
    sentAt: "2026-01-01 09:00:00.000",
    sameTimestampMessages: true,
    reverseLexicalIds: true,
  });
  const loginMedia = await createGuestClaimMedia(loginGuest, fkk, character, "merge");
  const releaseGuestReplyLock = await acquireGuestReplyLockForToken(loginGuest.token);
  let loginSettled = false;
  const loginPromise = loginUser(
    { email: loginUserFixture.email, password, remember: true },
    { guestToken: loginGuest.token }
  ).finally(() => {
    loginSettled = true;
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  assert.equal(loginSettled, false, "claim should wait for an in-flight guest AI reply lock");
  await releaseGuestReplyLock();
  const login = await loginPromise;
  assert.equal(login.guestClaim?.status, "claimed");
  assert.equal(login.guestClaimInternal?.targetSessionId, existingSessionId);
  const [[oldGuestSessionCount]] = await db.execute("SELECT COUNT(*) AS count FROM chat_sessions WHERE id = ?", [loginGuest.sessionId]);
  assert.equal(Number(oldGuestSessionCount.count), 0, "merged guest session shell should be removed");
  const [mergedMessages] = await db.execute(
    "SELECT id, display_order, sent_at FROM chat_messages WHERE session_id = ? ORDER BY display_order ASC",
    [existingSessionId]
  );
  assert.ok(mergedMessages.length >= 3);
  for (let index = 1; index < mergedMessages.length; index += 1) {
    assert.ok(Number(mergedMessages[index].display_order) > Number(mergedMessages[index - 1].display_order));
    assert.ok(new Date(mergedMessages[index].sent_at).getTime() >= new Date(mergedMessages[index - 1].sent_at).getTime());
  }
  const [mergedCausalMessages] = await db.execute(
    "SELECT text_content FROM chat_messages WHERE session_id = ? AND text_content IN ('guest claim text','guest claim reply') ORDER BY display_order ASC",
    [existingSessionId]
  );
  assert.deepEqual(
    mergedCausalMessages.map((row) => row.text_content),
    ["guest claim text", "guest claim reply"],
    "same-millisecond merge must preserve the original user-before-reply causal order"
  );
  const idempotentLogin = await loginUser({ email: loginUserFixture.email, password, remember: true }, { guestToken: loginGuest.token });
  assert.equal(idempotentLogin.guestClaim?.idempotent, true);
  const [[mergedCountAfterRetry]] = await db.execute("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?", [existingSessionId]);
  assert.equal(Number(mergedCountAfterRetry.count), mergedMessages.length, "idempotent login must not duplicate merged messages");
  await assertClaimedMediaAccess({ fixtureValue: loginGuest, media: loginMedia, userId: loginUserFixture.id, targetSessionId: existingSessionId });
  await db.execute("UPDATE guest_sessions SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id IN (?, ?)", [registrationGuest.guestId, loginGuest.guestId]);
  await cleanupExpiredGuestSessions({ now: new Date(), limit: 100 });
  for (const media of [registrationMedia, loginMedia]) {
    await stat(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, media.attachmentFileName));
    await stat(resolve(resolveElevenLabsTtsConfig().outputDir, media.voiceFileName));
  }

  const conflictUser = await createUser("conflict", fkk.id);
  const claimedByAnother = await withTransaction((tx) => claimGuestSessionForUser(tx, { guestToken: loginGuest.token, userId: conflictUser.id }));
  assert.equal(claimedByAnother.status, "already_claimed");
  assert.equal(claimedByAnother.clearGuestCookie, true);

  const crossSiteUser = await createUser("cross_site", gg.id);
  const crossSiteGuest = fixture("cross_site");
  await createGuest(crossSiteGuest, fkk, character);
  const mismatch = await loginUser({ email: crossSiteUser.email, password, remember: true }, { guestToken: crossSiteGuest.token });
  assert.equal(mismatch.guestClaim?.status, "site_mismatch");
  const [[crossSiteState]] = await db.execute(
    "SELECT session_status, claimed_user_id FROM guest_sessions WHERE id = ?",
    [crossSiteGuest.guestId]
  );
  assert.deepEqual({ status: crossSiteState.session_status, userId: crossSiteState.claimed_user_id }, { status: "active", userId: null });

  const strictMismatchGuest = fixture("strict_mismatch");
  await createGuest(strictMismatchGuest, fkk, character);
  const strictMismatchEmail = `guest-claim-mismatch-${suffix}@example.com`;
  createdEmails.add(strictMismatchEmail);
  await insertRegistrationCode(strictMismatchEmail, "123456");
  await assert.rejects(
    () => registerUser({
      email: strictMismatchEmail,
      nickname: "Mismatch",
      password,
      confirmPassword: password,
      verificationCode: "123456",
      siteSlug: gg.slug,
    }, { guestToken: strictMismatchGuest.token }),
    (error) => Number(error?.statusCode || 0) === 409
  );
  const [[rolledBackRegistration]] = await db.execute("SELECT COUNT(*) AS count FROM users WHERE email = ?", [strictMismatchEmail]);
  assert.equal(Number(rolledBackRegistration.count), 0, "site-mismatched registration should roll back user creation");

  const concurrentUser = await createUser("concurrent", fkk.id);
  const concurrentGuest = fixture("concurrent");
  await createGuest(concurrentGuest, fkk, character);
  const concurrentClaims = await Promise.all([
    withTransaction((tx) => claimGuestSessionForUser(tx, { guestToken: concurrentGuest.token, userId: concurrentUser.id })),
    withTransaction((tx) => claimGuestSessionForUser(tx, { guestToken: concurrentGuest.token, userId: concurrentUser.id })),
  ]);
  assert.deepEqual(concurrentClaims.map((item) => item.status), ["claimed", "claimed"]);
  assert.equal(concurrentClaims.filter((item) => item.idempotent).length, 1);

  const rollbackUser = await createUser("rollback", fkk.id);
  const rollbackGuest = fixture("rollback");
  await createGuest(rollbackGuest, fkk, character);
  await assert.rejects(
    () => withTransaction(async (tx) => {
      await claimGuestSessionForUser(tx, { guestToken: rollbackGuest.token, userId: rollbackUser.id });
      throw new Error("forced claim rollback");
    }),
    /forced claim rollback/
  );
  const [[rollbackState]] = await db.execute(
    `SELECT g.session_status, g.claimed_user_id, s.internal_uid
     FROM guest_sessions g
     JOIN chat_sessions s ON s.id = g.chat_session_id
     WHERE g.id = ?`,
    [rollbackGuest.guestId]
  );
  assert.deepEqual(
    { status: rollbackState.session_status, claimedUserId: rollbackState.claimed_user_id, owner: rollbackState.internal_uid },
    { status: "active", claimedUserId: null, owner: null }
  );

  const sessionRaceUser = await createUser("session_race", fkk.id);
  const sessionRaceGuest = fixture("session_race");
  await createGuest(sessionRaceGuest, fkk, character);
  const formalConnection = await db.getConnection();
  try {
    await formalConnection.beginTransaction();
    const formalSession = await findOrCreateUserSession(formalConnection, {
      character,
      userId: sessionRaceUser.id,
    });
    const claimPromise = withTransaction((tx) => claimGuestSessionForUser(tx, {
      guestToken: sessionRaceGuest.token,
      userId: sessionRaceUser.id,
    }));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    await formalConnection.commit();
    const racedClaim = await claimPromise;
    assert.equal(racedClaim.targetSessionId, formalSession.id);
  } finally {
    await formalConnection.rollback().catch(() => {});
    formalConnection.release();
  }
  const [[activeSessionCount]] = await db.execute(
    `SELECT COUNT(*) AS count
     FROM chat_sessions
     WHERE internal_uid = ?
       AND character_id = ?
       AND source_type = 'user'
       AND session_status = 'active'`,
    [sessionRaceUser.id, character.id]
  );
  assert.equal(Number(activeSessionCount.count), 1, "claim and formal session creation must converge on one active session");

  console.log("guest auth claim self-check passed");
} finally {
  const [paths] = await db.execute(
    `SELECT storage_path, protected_path
     FROM chat_image_assets
     WHERE guest_session_id IN (${[...createdGuestIds].map(() => "?").join(",") || "NULL"})`,
    [...createdGuestIds]
  ).catch(() => [[]]);
  for (const row of paths) {
    const fileName = extractFileName(row.protected_path || row.storage_path);
    if (fileName) createdFiles.add(fileName);
  }
  // Delete jobs before their owner/session rows: FK SET NULL otherwise removes
  // the ownership columns used by the older broad fixture cleanup below.
  if (createdMemoryJobIds.size) {
    const ownedIds = [...createdMemoryJobIds];
    await db.execute(`DELETE FROM memory_jobs WHERE id IN (${ownedIds.map(() => "?").join(",")})`, ownedIds);
    const [[remaining]] = await db.execute(`SELECT COUNT(*) AS count FROM memory_jobs WHERE id IN (${ownedIds.map(() => "?").join(",")})`, ownedIds);
    assert.equal(Number(remaining.count), 0, "fixture-owned jobs must be removed before session/user cleanup");
  }
  for (const sessionId of createdSessionIds) {
    await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [sessionId]);
  }
  for (const userId of createdUserIds) {
    await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM oauth_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  }
  for (const guestId of createdGuestIds) {
    const [[guest]] = await db.execute("SELECT chat_session_id, target_chat_session_id FROM guest_sessions WHERE id = ?", [guestId]).catch(() => [[null]]);
    for (const sessionId of [guest?.chat_session_id, guest?.target_chat_session_id].filter(Boolean)) {
      await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [sessionId]).catch(() => {});
      await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
    }
    await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_call_sessions WHERE guest_session_id = ?", [guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_chat_attachments WHERE guest_session_id = ?", [guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guestId]).catch(() => {});
  }
  for (const sessionId of createdSessionIds) {
    await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  }
  for (const email of createdEmails) {
    await db.execute("DELETE FROM email_verification_codes WHERE email = ?", [email]).catch(() => {});
    await db.execute("DELETE FROM users WHERE email = ?", [email]).catch(() => {});
  }
  for (const fileName of createdFiles) {
    await unlink(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName)).catch(() => {});
  }
  for (const voiceAssetId of createdVoiceAssetIds) {
    await db.execute("DELETE FROM character_voice_assets WHERE id = ?", [voiceAssetId]).catch(() => {});
  }
  for (const fileName of createdAttachmentFiles) {
    await unlink(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fileName)).catch(() => {});
  }
  for (const fileName of createdVoiceFiles) {
    await unlink(resolve(resolveElevenLabsTtsConfig().outputDir, fileName)).catch(() => {});
  }
  await closeDbPool();
}

function fixture(label) {
  return {
    guestId: id(`guest_${label}`),
    sessionId: id(`chat_${label}`),
    token: createToken(),
  };
}

function id(prefix) {
  return `${prefix}_${suffix}`.slice(0, 64);
}

async function createUser(label, siteId) {
  const user = {
    id: id(`u_${label}`),
    email: `guest-claim-${label}-${suffix}@example.com`,
  };
  createdUserIds.add(user.id);
  createdEmails.add(user.email);
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, ?, ?, NOW(3), 'email', 'personal', ?, 'active', NOW(3))`,
    [user.id, user.email, user.email, hashSecret(password), label, user.email, siteId]
  );
  return user;
}

async function createGuestClaimMedia(fixtureValue, site, character, label) {
  const attachmentFileName = `claim-${label}-${suffix}.txt`.slice(0, 160);
  const voiceFileName = `claim-${label}-${suffix}.mp3`.slice(0, 160);
  const attachmentId = id(`guest_attachment_${label}`);
  const voiceAssetId = id(`voice_claim_${label}`);
  createdVoiceAssetIds.add(voiceAssetId);
  await mkdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { recursive: true });
  await writeFile(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, attachmentFileName), Buffer.from(`claim attachment ${label}`));
  createdAttachmentFiles.add(attachmentFileName);
  const attachmentMessage = await insertMessage(db, {
    sessionId: fixtureValue.sessionId,
    guestSessionId: fixtureValue.guestId,
    characterId: null,
    senderType: "user",
    senderLabel: "You",
    contentType: "attachment",
    text: `${label}.txt`,
    product: {
      kind: "document",
      name: `${label}.txt`,
      storedName: attachmentFileName,
      url: `/api/uploads/chat/${attachmentFileName}`,
      mimeType: "text/plain",
      size: 24,
    },
    displayOrder: 70,
    sourceType: "guest",
    sourceRef: "guest-attachment",
  });
  await db.execute(
    `INSERT INTO guest_chat_attachments (
       id, guest_session_id, site_id, character_id, network_hash, client_upload_id,
       stored_name, attachment_json, asset_status, request_key, message_id, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'attached', ?, ?, DATE_ADD(NOW(3), INTERVAL 14 DAY))`,
    [
      attachmentId,
      fixtureValue.guestId,
      site.id,
      character.id,
      "d".repeat(64),
      `claim-${label}-${suffix}`.slice(0, 128),
      attachmentFileName,
      JSON.stringify({ kind: "document", name: `${label}.txt`, storedName: attachmentFileName, url: `/api/uploads/chat/${attachmentFileName}`, mimeType: "text/plain", size: 24 }),
      `claim-${label}`,
      attachmentMessage.id,
    ]
  );

  const voiceConfig = resolveElevenLabsTtsConfig();
  await mkdir(voiceConfig.outputDir, { recursive: true });
  await writeFile(resolve(voiceConfig.outputDir, voiceFileName), Buffer.from(`claim voice ${label}`));
  createdVoiceFiles.add(voiceFileName);
  const voiceMessage = await insertMessage(db, {
    sessionId: fixtureValue.sessionId,
    guestSessionId: fixtureValue.guestId,
    characterId: character.id,
    senderType: "character",
    senderLabel: character.name,
    contentType: "text",
    text: `Claim voice ${label}`,
    displayOrder: 80,
    sourceType: "ai",
    sourceRef: `guest-claim-voice:${label}`,
  });
  await db.execute(
    `INSERT INTO character_voice_assets (
       id, character_id, asset_type, title, transcript, provider, voice_id, model,
       language_code, language_label, audio_url, audio_bytes, character_count,
       estimated_credits, output_format, message_id, waveform_json, asset_status, source_type, source_ref
     ) VALUES (?, ?, 'ai_reply', 'Claim voice', ?, 'elevenlabs', 'self-check', 'eleven_v3',
       'en', 'English', ?, 16, 16, 16, 'mp3', ?, JSON_ARRAY(), 'ready', 'ai', 'guest-claim-self-check')`,
    [voiceAssetId, character.id, `Claim voice ${label}`, `/api/uploads/voice/ai/${voiceFileName}`, voiceMessage.id]
  );
  await db.execute("UPDATE chat_messages SET voice_asset_id = ? WHERE id = ?", [voiceAssetId, voiceMessage.id]);
  return { attachmentFileName, voiceFileName, voiceAssetId };
}

async function assertClaimedMediaAccess({ fixtureValue, media, userId, targetSessionId }) {
  await requireChatAttachmentAccess({ id: userId }, media.attachmentFileName);
  await assert.rejects(
    () => requireGuestChatAttachmentAccess(fixtureValue.token, media.attachmentFileName),
    (error) => Number(error?.statusCode || 0) === 401,
    "claimed guest cookie must no longer read the attachment"
  );
  const [[voiceOwner]] = await db.execute(
    `SELECT session.internal_uid, message.session_id
     FROM character_voice_assets voice
     INNER JOIN chat_messages message ON message.voice_asset_id = voice.id
     INNER JOIN chat_sessions session ON session.id = message.session_id
     WHERE voice.id = ?`,
    [media.voiceAssetId]
  );
  assert.deepEqual(
    { userId: voiceOwner.internal_uid, sessionId: voiceOwner.session_id },
    { userId, sessionId: targetSessionId },
    "ready guest AI voice should follow the claimed target session owner"
  );
  await assert.rejects(
    () => requireGuestVoiceAccess(fixtureValue.token, {
      fileName: media.voiceFileName,
      publicUrl: `/uploads/voice/ai/${media.voiceFileName}`,
      protectedUrl: `/api/uploads/voice/ai/${media.voiceFileName}`,
    }),
    (error) => Number(error?.statusCode || 0) === 401,
    "claimed guest cookie must no longer read the AI voice"
  );
}

async function createGuest(fixtureValue, site, character, {
  withProduct = false,
  withImage = false,
  sentAt = null,
  sameTimestampMessages = false,
  reverseLexicalIds = false,
} = {}) {
  createdGuestIds.add(fixtureValue.guestId);
  createdSessionIds.add(fixtureValue.sessionId);
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [fixtureValue.guestId, hashSessionToken(fixtureValue.token), site.id, character.id, fixtureValue.sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Guest claim self-check', 'active', 'guest', 'guest-claim-self-check', NOW(3))`,
    [fixtureValue.sessionId, fixtureValue.guestId, character.id]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [fixtureValue.guestId]);
  const baseSentAt = sentAt || new Date();
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type,
       text_content, client_message_id, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, NULL, 'user', 'You', 'text', 'guest claim text', ?, 10, 'sent', 'guest', 'guest-claim-self-check', ?)`,
    [reverseLexicalIds ? id("zz_guest_user") : uniqueId("msg_guest_user"), fixtureValue.sessionId, `client-${fixtureValue.guestId}`.slice(0, 128), baseSentAt]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type,
       text_content, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'character', ?, 'text', 'guest claim reply', 20, 'sent', 'guest', 'guest-claim-self-check', ?)`,
    [
      reverseLexicalIds ? id("aa_guest_reply") : uniqueId("msg_guest_reply"),
      fixtureValue.sessionId,
      character.id,
      character.name,
      sameTimestampMessages ? baseSentAt : new Date(new Date(baseSentAt).getTime() + 1000),
    ]
  );
  if (withProduct) {
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, sender_label, content_type,
         text_content, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
       ) VALUES (?, ?, ?, 'character', ?, 'product', 'Guest Product', ?, 30, 'sent', 'product_api', ?, DATE_ADD(?, INTERVAL 2 SECOND))`,
      [
        uniqueId("msg_guest_product"),
        fixtureValue.sessionId,
        character.id,
        character.name,
        JSON.stringify({ id: "guest-product", name: "Guest Product", url: "https://footballkituk.com/products/guest-product" }),
        `guest-product:${fixtureValue.guestId}`,
        baseSentAt,
      ]
    );
  }
  if (withImage) {
    await withTransaction(async (tx) => {
      const userMessage = await insertMessage(tx, {
        sessionId: fixtureValue.sessionId,
        characterId: null,
        senderType: "user",
        senderLabel: "You",
        contentType: "text",
        text: "Take a selfie #mock-image",
        displayOrder: 40,
        sourceType: "guest",
        sourceRef: "guest-claim-image",
      });
      const result = await maybeCreateGuestChatImagePlaceholder(tx, {
        guest: { id: fixtureValue.guestId },
        session: { id: fixtureValue.sessionId, guest_session_id: fixtureValue.guestId, character_id: character.id },
        character,
        userText: "Take a selfie #mock-image",
        userMessage,
        requestKey: `image-${fixtureValue.guestId}`.slice(0, 128),
      });
      assert.equal(result.taskCreated, true);
      await tx.execute(
        "UPDATE memory_jobs SET available_at = DATE_ADD(NOW(3), INTERVAL 1 HOUR) WHERE session_id = ? AND job_type = 'generate_chat_image'",
        [fixtureValue.sessionId]
      );
      const [fixtureJobs] = await tx.execute("SELECT id FROM memory_jobs WHERE session_id = ?", [fixtureValue.sessionId]);
      for (const job of fixtureJobs) createdMemoryJobIds.add(job.id);
    });
  }
}

async function createFormalSession(sessionId, userId, characterId, sentAt) {
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status,
       source_type, source_ref, last_message_at
     ) VALUES (?, ?, ?, 'Existing formal session', 'active', 'user', 'user-chat', ?)`,
    [sessionId, userId, characterId, sentAt]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type,
       text_content, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'character', 'Formal', 'text', 'existing formal text', 10, 'sent', 'user', 'user-chat', ?)`,
    [uniqueId("msg_formal"), sessionId, characterId, sentAt]
  );
}

async function insertRegistrationCode(email, code) {
  await db.execute(
    `INSERT INTO email_verification_codes (email, scene, code_hash, provider, expires_at)
     VALUES (?, 'register', ?, 'self-check', DATE_ADD(NOW(3), INTERVAL 10 MINUTE))`,
    [email, hashSecret(code)]
  );
}

async function loadImageJob(sessionId) {
  const [[row]] = await db.execute(
    `SELECT id, retry_count, max_retries, payload_json
     FROM memory_jobs
     WHERE session_id = ? AND job_type = 'generate_chat_image'
     ORDER BY created_at ASC
     LIMIT 1`,
    [sessionId]
  );
  assert.ok(row);
  createdMemoryJobIds.add(row.id);
  await db.execute("UPDATE memory_jobs SET available_at = NOW(3) WHERE id = ?", [row.id]);
  const claimed = await claimNextMemoryJob({ jobId: row.id });
  assert.ok(claimed?.claimToken, "claimed guest image fixture must obtain an execution lease");
  return claimed;
}

function uniqueId(prefix) {
  return `${prefix}_${randomUUID()}`.slice(0, 64);
}
