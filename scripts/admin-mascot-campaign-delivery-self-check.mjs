import assert from "node:assert/strict";
import { createAdminMascotCampaignDelivery, getAdminMascotCampaignDelivery, listAdminMascotCampaigns } from "../server/admin-mascot-campaign-service.js";
import { listAdminMascotSettings } from "../server/admin-mascot-query-service.js";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { reconcileFailedMascotCampaignDeliveries, sendMascotCampaignBatchFromJob } from "../server/mascot-campaign-delivery-job-service.js";
import { enqueueMemoryJob, MEMORY_JOB_TYPES } from "../server/memory-job-service.js";
import { createPromotionCampaign, updatePromotionCampaign } from "../server/promotion-campaign-service.js";
import { getDeliveryDateForTimeZone, inspectAccountProactiveDeliveryGate } from "../server/proactive-message-delivery-service.js";

await initializeDatabase();

const suffix = Date.now();
const ids = {
  site: `site_manual_ad_${suffix}`,
  otherSite: `site_manual_ad_other_${suffix}`,
  character: `mascot_manual_ad_${suffix}`,
  userOk: `u_manual_ad_ok_${suffix}`,
  userBlocked: `u_manual_ad_blocked_${suffix}`,
  userRevoked: `u_manual_ad_revoked_${suffix}`,
  userNoSession: `u_manual_ad_no_session_${suffix}`,
  sessionOk: `chat_manual_ad_ok_${suffix}`,
  sessionBlocked: `chat_manual_ad_blocked_${suffix}`,
  sessionRevoked: `chat_manual_ad_revoked_${suffix}`,
};
let campaignId = "";
let expiredCampaignId = "";
let deliveryId = "";
let failedDeliveryId = "";
const extraCampaignIds = [];
const extraDeliveryIds = [];
let fixtureSequence = 0;

try {
  await seed();
  const createdCampaign = await createPromotionCampaign({
    title: "Manual mascot campaign self-check",
    siteId: ids.site,
    roleTarget: "mascot",
    productId: "manual-product-1",
    productTitle: "Manual Campaign Shirt",
    productUrl: "https://example.test/products/manual-shirt",
    productSnapshot: {
      id: "manual-product-1",
      name: "Manual Campaign Shirt",
      url: "https://example.test/products/manual-shirt",
      imageUrl: "https://example.test/manual-shirt.jpg",
      price: "£49.99",
    },
    discountCode: "MANUAL10",
    messageText: "A quick shirt drop from your site guide.",
    keywords: ["shirt"],
    priority: 10,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    sourceRef: `manual-mascot-self-check-${suffix}`,
  });
  campaignId = createdCampaign.item.id;
  const expiredCampaign = await createPromotionCampaign({
    title: "Expired manual mascot campaign",
    siteId: ids.site,
    roleTarget: "mascot",
    productId: "expired-product-1",
    productTitle: "Expired Shirt",
    productUrl: "https://example.test/products/expired-shirt",
    messageText: "This should never send.",
    status: "draft",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2026-02-01T00:00:00.000Z",
    sourceRef: `manual-mascot-expired-self-check-${suffix}`,
  });
  expiredCampaignId = expiredCampaign.item.id;
  await getDbPool().execute(
    "UPDATE promotion_campaigns SET campaign_status = 'active' WHERE id = ?",
    [expiredCampaignId]
  );

  const eligible = await listAdminMascotCampaigns(ids.site);
  assert.deepEqual(eligible.items.map((item) => item.id), [campaignId], "only the active same-site mascot campaign should be listed");
  const crossSite = await listAdminMascotCampaigns(ids.otherSite);
  assert.equal(crossSite.items.length, 0, "another site must not see this campaign");
  const mascotSettings = await listAdminMascotSettings();
  const scopedSite = mascotSettings.sites.find((site) => site.id === ids.site);
  assert.equal(scopedSite?.userCount, 3, "reachable count must exclude active accounts without a mascot activation and user session");
  assert.equal(scopedSite?.sentAdCount, 0, "a site without a successful manual delivery should start at zero sent ads");
  await assert.rejects(
    () => createAdminMascotCampaignDelivery(ids.site, { campaignId: expiredCampaignId }),
    /当前不可用于本站前台投放/,
    "expired campaign must be rejected even when requested directly"
  );

  const started = await createAdminMascotCampaignDelivery(ids.site, { campaignId });
  deliveryId = started.delivery.id;
  assert.equal(started.delivery.status, "sending", "delivery should start in sending state");
  assert.equal(started.delivery.total, 3, "delivery should target all active mascot sessions");

  const unansweredGate = await inspectAccountProactiveDeliveryGate(getDbPool(), {
    userId: ids.userOk,
    timeZone: "Europe/London",
  });
  assert.equal(unansweredGate.allowed, false, "automatic proactive delivery should still block an unanswered prior message");
  assert.equal(unansweredGate.reason, "previous_proactive_unanswered", "the unanswered-only fixture should exercise the automatic reply gate");
  const fullQuotaGate = await inspectAccountProactiveDeliveryGate(getDbPool(), {
    userId: ids.userBlocked,
    timeZone: "Europe/London",
  });
  assert.equal(fullQuotaGate.allowed, false, "automatic proactive delivery should still enforce its daily quota");
  assert.equal(fullQuotaGate.reason, "daily_quota_reached", "the quota-full fixture should exercise the automatic daily limit");

  const duplicate = await createAdminMascotCampaignDelivery(ids.site, { campaignId });
  assert.equal(duplicate.delivery.id, deliveryId, "duplicate click should return the active delivery instead of creating another one");

  await getDbPool().execute(
    "UPDATE user_character_activations SET activation_status = 'disabled' WHERE internal_uid = ? AND character_id = ?",
    [ids.userRevoked, ids.character]
  );

  await getDbPool().execute(
    "DELETE FROM memory_jobs WHERE job_type = 'send_mascot_campaign_batch' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.deliveryId')) = ?",
    [deliveryId]
  );
  await sendMascotCampaignBatchFromJob({ payload: { deliveryId } }, {
    classifyContent: async () => ({ state: "neutral", candidateKind: "shopping", confidence: .99 }),
    generateVoiceAudio: async () => ({
      status: "ready",
      audioUrl: "/uploads/voice/manual-mascot-self-check.mp3",
      audioBytes: 32,
      durationSeconds: 2,
      outputFormat: "mp3_44100_128",
      providerRequestId: `manual-${suffix}`,
    }),
  });

  const completed = await getAdminMascotCampaignDelivery(ids.site, deliveryId);
  assert.equal(completed.delivery.status, "completed", "delivery should complete after all targets are processed");
  assert.equal(completed.delivery.processed, 3, "processed count should equal target count");
  assert.equal(completed.delivery.sent, 2, "manual delivery should send to eligible accounts even when automatic proactive quota is full");
  assert.equal(completed.delivery.failed, 1, "only the no-longer-eligible account should be counted as failed");
  assert.deepEqual(completed.delivery.failureReasons, [
    { code: "target_ineligible", label: "用户已不再符合发送条件", count: 1 },
  ], "delivery status should expose an aggregated public failure reason without user details");
  const settingsAfterSuccess = await listAdminMascotSettings();
  assert.equal(
    settingsAfterSuccess.sites.find((site) => site.id === ids.site)?.sentAdCount,
    1,
    "a completed delivery with at least one success should increment the sent-ad count once"
  );

  const [messages] = await getDbPool().execute(
    `SELECT content_type, source_ref, voice_asset_id
     FROM chat_messages
     WHERE session_id = ? AND source_ref LIKE 'manual-mascot-campaign:%'
     ORDER BY display_order ASC`,
    [ids.sessionOk]
  );
  assert.equal(messages.length, 2, "successful target should receive text and product messages");
  assert.equal(messages[0].content_type, "text", "campaign text should be first");
  assert.ok(messages[0].voice_asset_id, "campaign text should carry the mascot voice asset");
  assert.equal(messages[1].content_type, "product", "campaign product should be second");

  const [blockedMessages] = await getDbPool().execute(
    "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND source_ref LIKE 'manual-mascot-campaign:%'",
    [ids.sessionBlocked]
  );
  assert.equal(Number(blockedMessages[0]?.count || 0), 2, "manual campaign delivery must bypass automatic proactive quota and unanswered-message gating");

  const [manualProactiveRows] = await getDbPool().execute(
    `SELECT COUNT(*) AS count FROM proactive_message_deliveries
     WHERE internal_uid IN (?, ?) AND source_ref LIKE 'manual-mascot-campaign:%'`,
    [ids.userOk, ids.userBlocked]
  );
  assert.equal(Number(manualProactiveRows[0]?.count || 0), 0, "manual campaign delivery must not consume automatic proactive delivery slots");

  const [revokedMessages] = await getDbPool().execute(
    "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND source_ref LIKE 'manual-mascot-campaign:%'",
    [ids.sessionRevoked]
  );
  assert.equal(Number(revokedMessages[0]?.count || 0), 0, "an account that loses mascot activation before processing must not receive campaign messages");

  const [deliveryRows] = await getDbPool().execute(
    `SELECT COUNT(*) AS count FROM promotion_campaign_deliveries
     WHERE campaign_id = ? AND internal_uid = ? AND delivery_status = 'sent'`,
    [campaignId, ids.userOk]
  );
  assert.equal(Number(deliveryRows[0]?.count || 0), 1, "successful target should have one campaign delivery record");

  await sendMascotCampaignBatchFromJob({ payload: { deliveryId } }, {
    classifyContent: async () => ({ state: "neutral", candidateKind: "shopping", confidence: .99 }),
    generateVoiceAudio: async () => { throw new Error("replay should not generate audio"); },
  });
  const [replayedMessages] = await getDbPool().execute(
    "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND source_ref LIKE 'manual-mascot-campaign:%'",
    [ids.sessionOk]
  );
  assert.equal(Number(replayedMessages[0]?.count || 0), 2, "completed job replay must not duplicate messages");

  const repeatedCompleted = await createAdminMascotCampaignDelivery(ids.site, { campaignId });
  extraDeliveryIds.push(repeatedCompleted.delivery.id);
  assert.notEqual(repeatedCompleted.delivery.id, deliveryId, "a completed delivery may start a new task for newly eligible users");
  await deleteCampaignJobs(repeatedCompleted.delivery.id);
  await sendMascotCampaignBatchFromJob({ payload: { deliveryId: repeatedCompleted.delivery.id } }, {
    classifyContent: async () => ({ state: "neutral", candidateKind: "shopping", confidence: .99 }),
    generateVoiceAudio: async () => { throw new Error("campaign dedup should reject before generating audio"); },
  });
  const repeatedCompletedResult = await getAdminMascotCampaignDelivery(ids.site, repeatedCompleted.delivery.id);
  assert.equal(repeatedCompletedResult.delivery.sent, 0, "a repeated completed campaign must not resend to users who already received it");
  assert.equal(repeatedCompletedResult.delivery.failed, 2, "campaign dedup should deterministically close previously delivered targets");
  assert.deepEqual(repeatedCompletedResult.delivery.failureReasons, [
    { code: "already_delivered", label: "该广告已向用户发送过", count: 2 },
  ], "duplicate campaign failures should be grouped into one concise public reason");
  const settingsAfterFailedOnly = await listAdminMascotSettings();
  assert.equal(
    settingsAfterFailedOnly.sites.find((site) => site.id === ids.site)?.sentAdCount,
    1,
    "a completed delivery with zero successes must not increment the sent-ad count"
  );
  const [repeatedMessageRows] = await getDbPool().execute(
    `SELECT COUNT(*) AS count FROM chat_messages
     WHERE session_id IN (?, ?) AND source_ref LIKE 'manual-mascot-campaign:%'`,
    [ids.sessionOk, ids.sessionBlocked]
  );
  assert.equal(Number(repeatedMessageRows[0]?.count || 0), 4, "a second delivery for the same campaign must not duplicate committed messages");

  const recoveryCampaign = await createTestCampaign("reservation recovery");
  extraCampaignIds.push(recoveryCampaign.item.id);
  const recoveryStarted = await createDeliveryFixture(recoveryCampaign.item);
  extraDeliveryIds.push(recoveryStarted.delivery.id);
  await deleteCampaignJobs(recoveryStarted.delivery.id);
  const [recoveryTargets] = await getDbPool().execute(
    "SELECT * FROM mascot_ad_delivery_targets WHERE delivery_id = ? AND internal_uid = ? LIMIT 1",
    [recoveryStarted.delivery.id, ids.userOk]
  );
  const recoveryTarget = recoveryTargets[0];
  const recoveryCampaignDeliveryId = `campaign_${recoveryTarget.id}`.slice(0, 64);
  await getDbPool().execute(
    `INSERT INTO promotion_campaign_deliveries (
       id, campaign_id, internal_uid, character_id, session_id, site_id, delivery_status, match_score, match_reason
     ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', 2000, 'manual_mascot_campaign')`,
    [recoveryCampaignDeliveryId, recoveryCampaign.item.id, ids.userOk, ids.character, ids.sessionOk, ids.site]
  );
  await sendMascotCampaignBatchFromJob({ payload: { deliveryId: recoveryStarted.delivery.id } }, { classifyContent: async () => ({ state: "neutral", candidateKind: "shopping", confidence: .99 }),
    generateVoiceAudio: createVoiceResult });
  const [recoveredTargetRows] = await getDbPool().execute(
    "SELECT target_status, campaign_delivery_id, proactive_delivery_id FROM mascot_ad_delivery_targets WHERE id = ?",
    [recoveryTarget.id]
  );
  assert.equal(recoveredTargetRows[0]?.target_status, "sent", "a crash after the campaign reservation must resume and send the target");
  assert.equal(recoveredTargetRows[0]?.campaign_delivery_id, recoveryCampaignDeliveryId, "recovered target should retain its deterministic campaign reservation");
  assert.equal(recoveredTargetRows[0]?.proactive_delivery_id, null, "manual campaign recovery must not create an automatic proactive reservation");

  const retryCampaign = await createTestCampaign("retryable target");
  extraCampaignIds.push(retryCampaign.item.id);
  const retryStarted = await createDeliveryFixture(retryCampaign.item);
  extraDeliveryIds.push(retryStarted.delivery.id);
  await deleteCampaignJobs(retryStarted.delivery.id);
  let completionAttempts = 0;
  await sendMascotCampaignBatchFromJob({ payload: { deliveryId: retryStarted.delivery.id } }, {
    classifyContent: async () => ({ state: "neutral", candidateKind: "shopping", confidence: .99 }),
    generateVoiceAudio: createVoiceResult,
    afterMessagesCommitted: async ({ target }) => {
      if (target.internal_uid !== ids.userOk) return;
      completionAttempts += 1;
      if (completionAttempts === 1) throw new Error("temporary_completion_failure");
    },
  });
  await deleteCampaignJobs(retryStarted.delivery.id);
  await getDbPool().execute(
    "UPDATE mascot_ad_delivery_targets SET available_at = NOW(3) WHERE delivery_id = ? AND target_status = 'queued'",
    [retryStarted.delivery.id]
  );
  await sendMascotCampaignBatchFromJob({ payload: { deliveryId: retryStarted.delivery.id } }, { classifyContent: async () => ({ state: "neutral", candidateKind: "shopping", confidence: .99 }),
    generateVoiceAudio: createVoiceResult });
  const [retryTargetRows] = await getDbPool().execute(
    "SELECT target_status, retry_count FROM mascot_ad_delivery_targets WHERE delivery_id = ? AND internal_uid = ?",
    [retryStarted.delivery.id, ids.userOk]
  );
  assert.equal(retryTargetRows[0]?.target_status, "sent", "a retryable target failure must return to queued and later send");
  assert.equal(Number(retryTargetRows[0]?.retry_count || 0), 1, "target retry count should persist across jobs");

  const pausedCampaign = await createTestCampaign("immutable snapshot");
  extraCampaignIds.push(pausedCampaign.item.id);
  const pausedStarted = await createDeliveryFixture(pausedCampaign.item);
  extraDeliveryIds.push(pausedStarted.delivery.id);
  await deleteCampaignJobs(pausedStarted.delivery.id);
  const [snapshotRows] = await getDbPool().execute(
    "SELECT campaign_snapshot_json FROM mascot_ad_deliveries WHERE id = ?",
    [pausedStarted.delivery.id]
  );
  const storedSnapshot = typeof snapshotRows[0]?.campaign_snapshot_json === "string"
    ? JSON.parse(snapshotRows[0].campaign_snapshot_json)
    : snapshotRows[0]?.campaign_snapshot_json;
  await updatePromotionCampaign(pausedCampaign.item.id, { status: "paused", messageText: "This changed text must not send." });
  await sendMascotCampaignBatchFromJob({ payload: { deliveryId: pausedStarted.delivery.id } }, { classifyContent: async () => ({ state: "neutral", candidateKind: "shopping", confidence: .99 }),
    generateVoiceAudio: createVoiceResult });
  const pausedCompleted = await getAdminMascotCampaignDelivery(ids.site, pausedStarted.delivery.id);
  assert.equal(pausedCompleted.delivery.sent, 0, "a campaign paused after enqueue must not send any target");
  assert.equal(pausedCompleted.delivery.failed, 2, "all remaining targets should close when campaign scope becomes ineligible");
  assert.notEqual(storedSnapshot?.messageText, "This changed text must not send.", "delivery must preserve the campaign payload captured at enqueue time");

  const terminalFailure = await createDeliveryFixture(createdCampaign.item);
  failedDeliveryId = terminalFailure.delivery.id;
  const sentAdsBeforePartialFailure = (await listAdminMascotSettings()).sites.find((site) => site.id === ids.site)?.sentAdCount || 0;
  await getDbPool().execute(
    "UPDATE mascot_ad_delivery_targets SET target_status = 'sent', completed_at = NOW(3) WHERE delivery_id = ? AND internal_uid = ?",
    [failedDeliveryId, ids.userOk]
  );
  await enqueueMemoryJob({
    jobType: MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH,
    characterId: ids.character,
    payload: { deliveryId: failedDeliveryId },
  });
  await getDbPool().execute(
    `UPDATE memory_jobs
     SET job_status = 'failed', retry_count = max_retries, failed_at = NOW(3)
     WHERE job_type = 'send_mascot_campaign_batch'
       AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.deliveryId')) = ?`,
    [failedDeliveryId]
  );
  await reconcileFailedMascotCampaignDeliveries({ deliveryId: failedDeliveryId });
  const [backgroundFailureRows] = await getDbPool().execute(
    "SELECT delivery_status, active_key FROM mascot_ad_deliveries WHERE id = ?",
    [failedDeliveryId]
  );
  assert.equal(backgroundFailureRows[0]?.delivery_status, "failed", "background reconciliation should close terminal worker failures without an admin GET");
  assert.equal(backgroundFailureRows[0]?.active_key, null, "terminal worker failure should release the active delivery key");
  const reconciledFailure = await getAdminMascotCampaignDelivery(ids.site, failedDeliveryId);
  assert.equal(reconciledFailure.delivery.status, "failed", "terminal worker failure should not leave the UI polling forever");
  assert.equal(reconciledFailure.delivery.sent, 1, "terminal worker failure should preserve targets sent before the job failed");
  assert.equal(reconciledFailure.delivery.failed, 1, "terminal worker failure should close only the remaining targets as failed");
  assert.deepEqual(reconciledFailure.delivery.failureReasons, [
    { code: "delivery_job_failed", label: "后台发送任务异常", count: 1 },
  ], "terminal worker failures should be summarized without exposing internal job details");
  const settingsAfterPartialFailure = await listAdminMascotSettings();
  assert.equal(
    settingsAfterPartialFailure.sites.find((site) => site.id === ids.site)?.sentAdCount,
    sentAdsBeforePartialFailure + 1,
    "a failed terminal delivery with at least one sent target should remain counted after refresh"
  );

  console.log(JSON.stringify({
    ok: true,
    deliveryId,
    total: completed.delivery.total,
    sent: completed.delivery.sent,
    failed: completed.delivery.failed,
  }, null, 2));
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, default_language, currency, time_zone, site_status, is_default, mascot_character_id)
     VALUES (?, 'Manual Ad Site', ?, 'English', 'GBP', 'Europe/London', 'active', 0, ?)`,
    [ids.site, `manual-ad-${suffix}`, ids.character]
  );
  await db.execute(
    `INSERT INTO sites (id, name, slug, default_language, currency, time_zone, site_status, is_default, mascot_character_id)
     VALUES (?, 'Manual Ad Other Site', ?, 'English', 'GBP', 'Europe/London', 'active', 0, 'mascot_template')`,
    [ids.otherSite, `manual-ad-other-${suffix}`]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, site_id, slug, name, opening_line, persona_prompt, speaking_style,
       voice_provider, voice_id, profile_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', ?, ?, 'Manual Mascot', 'Hello', 'Manual self-check', 'Friendly',
       'elevenlabs', 'self-check-voice', JSON_OBJECT('languageCode', 'en'), 'public', 'published', 'self-check', 'manual-mascot-self-check', NOW(3))`,
    [ids.character, ids.site, `manual-mascot-${suffix}`]
  );
  for (const [userId, sessionId] of [[ids.userOk, ids.sessionOk], [ids.userBlocked, ids.sessionBlocked], [ids.userRevoked, ids.sessionRevoked]]) {
    await db.execute(
      `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
       VALUES (?, ?, ?, 'x', ?, 'active', 'personal', ?)`,
      [userId, userId, userId, `${userId}@example.local`, ids.site]
    );
    await db.execute(
      `INSERT INTO user_character_activations (id, internal_uid, character_id, activation_status, source_type)
       VALUES (?, ?, ?, 'active', 'user')`,
      [`activation_${userId}`, userId, ids.character]
    );
    await db.execute(
      `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at)
       VALUES (?, ?, ?, 'manual ad self-check', 'active', 'user', 'manual-ad-self-check', NOW(3))`,
      [sessionId, userId, ids.character]
    );
    await db.execute(
      `INSERT INTO chat_messages (id, session_id, character_id, sender_type, sender_label, content_type,
         text_content, display_order, delivery_status, source_type, source_ref, sent_at)
       VALUES (?, ?, ?, 'user', 'Self-check user', 'text', 'Please show me a new jersey.',
         1, 'sent', 'user', 'manual-ad-self-check', DATE_SUB(NOW(3), INTERVAL 1 HOUR))`,
      [`msg_manual_shopping_${userId}`, sessionId, ids.character]
    );
  }
  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
     VALUES (?, ?, ?, 'x', ?, 'active', 'personal', ?)`,
    [ids.userNoSession, ids.userNoSession, ids.userNoSession, `${ids.userNoSession}@example.local`, ids.site]
  );

  const deliveryDate = getDeliveryDateForTimeZone(new Date(), "Europe/London");
  const unansweredMessageId = `msg_proactive_unanswered_${suffix}`;
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'character', 'Manual Mascot', 'text', 'Earlier automatic message',
       10, 'sent', 'proactive_nudge', 'manual-self-check-unanswered', NOW(3))`,
    [unansweredMessageId, ids.sessionOk, ids.character]
  );
  await db.execute(
    `INSERT INTO proactive_message_deliveries (
       id, internal_uid, site_id, character_id, session_id, message_id, delivery_date,
       delivery_status, source_type, source_ref, slot_index, sent_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', 'proactive_nudge', 'manual-self-check-unanswered', 1, NOW(3))`,
    [`proactive_unanswered_${suffix}`, ids.userOk, ids.site, ids.character, ids.sessionOk, unansweredMessageId, deliveryDate]
  );
  for (const slotIndex of [1, 2]) {
    await db.execute(
      `INSERT INTO proactive_message_deliveries (
         id, internal_uid, site_id, character_id, session_id, delivery_date,
         delivery_status, source_type, source_ref, slot_index, sent_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'sent', 'proactive_nudge', 'manual-self-check-quota', ?, NOW(3))`,
      [`proactive_block_${slotIndex}_${suffix}`, ids.userBlocked, ids.site, ids.character, ids.sessionBlocked, deliveryDate, slotIndex]
    );
  }
}

async function createTestCampaign(label) {
  return createPromotionCampaign({
    title: `Manual mascot ${label} ${suffix}`,
    siteId: ids.site,
    roleTarget: "mascot",
    productId: `manual-${label.replaceAll(" ", "-")}`,
    productTitle: `Manual ${label} Shirt`,
    productUrl: `https://example.test/products/${label.replaceAll(" ", "-")}`,
    productSnapshot: {
      id: `manual-${label.replaceAll(" ", "-")}`,
      name: `Manual ${label} Shirt`,
      url: `https://example.test/products/${label.replaceAll(" ", "-")}`,
      imageUrl: "https://example.test/manual-shirt.jpg",
      price: "£49.99",
    },
    messageText: `Manual ${label} message.`,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    sourceRef: `manual-mascot-${label.replaceAll(" ", "-")}-${suffix}`,
  });
}

async function createDeliveryFixture(campaign) {
  fixtureSequence += 1;
  const deliveryId = `mad_test_${suffix}_${fixtureSequence}`;
  await getDbPool().execute(
    `INSERT INTO mascot_ad_deliveries (
       id, site_id, mascot_character_id, campaign_id, title, delivery_status,
       active_key, campaign_snapshot_json, target_count, sent_count, failed_count, started_at
     ) VALUES (?, ?, ?, ?, ?, 'sending', ?, ?, 2, 0, 0, NOW(3))`,
    [deliveryId, ids.site, ids.character, campaign.id, campaign.title, `${ids.site}:${campaign.id}`, JSON.stringify(campaign)]
  );
  await getDbPool().execute(
    `INSERT INTO mascot_ad_delivery_targets (
       id, delivery_id, internal_uid, session_id, target_status
     ) VALUES
       (?, ?, ?, ?, 'queued'),
       (?, ?, ?, ?, 'queued')`,
    [
      `mad_target_${suffix}_${fixtureSequence}_ok`, deliveryId, ids.userOk, ids.sessionOk,
      `mad_target_${suffix}_${fixtureSequence}_blocked`, deliveryId, ids.userBlocked, ids.sessionBlocked,
    ]
  );
  return {
    delivery: {
      id: deliveryId,
      total: 2,
      sent: 0,
      failed: 0,
      status: "sending",
    },
  };
}

async function deleteCampaignJobs(deliveryId) {
  await getDbPool().execute(
    "DELETE FROM memory_jobs WHERE job_type = 'send_mascot_campaign_batch' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.deliveryId')) = ?",
    [deliveryId]
  );
}

function createVoiceResult() {
  return {
    status: "ready",
    audioUrl: "/uploads/voice/manual-mascot-self-check.mp3",
    audioBytes: 32,
    durationSeconds: 2,
    outputFormat: "mp3_44100_128",
    providerRequestId: `manual-${suffix}`,
  };
}

async function cleanup() {
  const db = getDbPool();
  if (deliveryId) {
    await db.execute("DELETE FROM memory_jobs WHERE job_type = 'send_mascot_campaign_batch' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.deliveryId')) = ?", [deliveryId]).catch(() => {});
    await db.execute("DELETE FROM mascot_ad_deliveries WHERE id = ?", [deliveryId]).catch(() => {});
  }
  if (failedDeliveryId) {
    await db.execute("DELETE FROM memory_jobs WHERE job_type = 'send_mascot_campaign_batch' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.deliveryId')) = ?", [failedDeliveryId]).catch(() => {});
    await db.execute("DELETE FROM mascot_ad_deliveries WHERE id = ?", [failedDeliveryId]).catch(() => {});
  }
  for (const extraDeliveryId of extraDeliveryIds) {
    await deleteCampaignJobs(extraDeliveryId).catch(() => {});
    await db.execute("DELETE FROM mascot_ad_deliveries WHERE id = ?", [extraDeliveryId]).catch(() => {});
  }
  await db.execute("DELETE FROM proactive_message_deliveries WHERE internal_uid IN (?, ?, ?)", [ids.userOk, ids.userBlocked, ids.userRevoked]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaign_deliveries WHERE internal_uid IN (?, ?, ?)", [ids.userOk, ids.userBlocked, ids.userRevoked]).catch(() => {});
  if (campaignId) await db.execute("DELETE FROM promotion_campaigns WHERE id = ?", [campaignId]).catch(() => {});
  if (expiredCampaignId) await db.execute("DELETE FROM promotion_campaigns WHERE id = ?", [expiredCampaignId]).catch(() => {});
  for (const extraCampaignId of extraCampaignIds) {
    await db.execute("DELETE FROM promotion_campaigns WHERE id = ?", [extraCampaignId]).catch(() => {});
  }
  await db.execute("UPDATE chat_messages SET voice_asset_id = NULL WHERE session_id IN (?, ?, ?)", [ids.sessionOk, ids.sessionBlocked, ids.sessionRevoked]).catch(() => {});
  await db.execute("DELETE FROM character_voice_assets WHERE internal_uid IN (?, ?, ?)", [ids.userOk, ids.userBlocked, ids.userRevoked]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (?, ?, ?)", [ids.sessionOk, ids.sessionBlocked, ids.sessionRevoked]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?, ?)", [ids.sessionOk, ids.sessionBlocked, ids.sessionRevoked]).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE internal_uid IN (?, ?, ?)", [ids.userOk, ids.userBlocked, ids.userRevoked]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?, ?, ?)", [ids.userOk, ids.userBlocked, ids.userRevoked, ids.userNoSession]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [ids.character]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id IN (?, ?)", [ids.site, ids.otherSite]).catch(() => {});
}
