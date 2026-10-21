import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeDbPool, getDbPool, withTransaction } from "../server/db.js";
import { insertMessage } from "../server/chat-message-store.js";
import { maybeCreateGuestChatImagePlaceholder } from "../server/chat-image-generation-service.js";
import { generateChatImageFromJob } from "../server/chat-image-job-service.js";
import {
  getChatImageStorageName,
  getChatImageTemporaryStorageName,
  saveMockChatImageAsset,
} from "../server/chat-image-asset-service.js";
import { releaseGuestImageEntitlementForAsset } from "../server/guest-image-entitlement-service.js";
import { releaseGuestImageDailyQuotaForAsset } from "../server/guest-image-daily-quota-service.js";
import { claimNextMemoryJob, recoverStaleChatImageJobs } from "../server/memory-job-service.js";
import { requireGuestChatImageAccess } from "../server/protected-upload-routes.js";
import { createToken, hashSessionToken } from "../server/security.js";
import { extractFileName } from "../server/protected-upload-url-service.js";
import { CHAT_IMAGE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

const jobSource = readFileSync("server/chat-image-job-service.js", "utf8");
const memoryJobSource = readFileSync("server/memory-job-service.js", "utf8");
const memoryRunnerSource = readFileSync("server/memory-job-runner-service.js", "utf8");
const pollerSource = readFileSync("src/app/chat-image-status-poller.js", "utf8");
const guestTextSource = readFileSync("src/app/chat-text-actions.js", "utf8");
const librarySource = readFileSync("server/mascot-greeting-image-service.js", "utf8");
assert.match(jobSource, /consumeGuestImageEntitlementForAsset/, "ready guest images should consume the guest entitlement");
assert.match(jobSource, /releaseGuestImageEntitlementForAsset/, "final guest image failures should release the entitlement");
assert.match(jobSource, /consumeGuestImageDailyQuotaForAsset/, "ready guest images should consume the daily network quota");
assert.match(jobSource, /releaseGuestImageDailyQuotaForAsset/, "final guest image failures should release the daily network quota");
assert.match(jobSource, /reconcileReadyImageJob/, "ready job replay should reconcile instead of regenerating");
assert.match(memoryJobSource, /recoverStaleChatImageJobs/, "stale running image jobs should be recoverable after a process interruption");
assert.match(memoryRunnerSource, /STALE_IMAGE_JOB_RECOVERY_INTERVAL_MS/, "the memory runner should periodically recover stale image jobs after restart");
assert.match(pollerSource, /getGuestChatSession/, "guest image polling should reload guest history instead of formal chat history");
assert.match(pollerSource, /30 \* 60 \* 1000/, "image polling should cover fixed image deadline and bounded natural failure reply");
assert.match(guestTextSource, /scheduleChatImageStatusPoll/, "a guest image placeholder should start the existing image poller");
assert.match(librarySource, /content_type IN \('mascot_greeting_image', 'mascot_library_image'\)/, "library image delivery should distinguish greeting and library message types");
assert.match(librarySource, /NOT EXISTS/, "library image delivery should skip images already sent in the session");

await assertLocalMutatingSelfCheckEnvironment({ label: "guest image generation self-check" });
const db = getDbPool();
const suffix = randomUUID();
const owner = fixtureIds("owner", suffix);
const other = fixtureIds("other", suffix);
const dailyPeer = fixtureIds("daily_peer", suffix);
const dailyPeerTwo = fixtureIds("daily_peer_two", suffix);
const dailyPeerThree = fixtureIds("daily_peer_three", suffix);
const dailyPeerFour = fixtureIds("daily_peer_four", suffix);
const concurrent = fixtureIds("concurrent", suffix);
const staged = fixtureIds("staged", suffix);
const invalid = fixtureIds("invalid", suffix);
const stale = fixtureIds("stale", suffix);
const readyReserved = fixtureIds("ready_reserved", suffix);
const temporary = fixtureIds("temporary", suffix);
const corrupt = fixtureIds("corrupt", suffix);
const secondary = fixtureIds("secondary", suffix);
const mismapped = fixtureIds("mismapped", suffix);
const claimedSecondary = fixtureIds("claimed_secondary", suffix);
const claimedWrongOwner = fixtureIds("claimed_wrong_owner", suffix);
const unmappedSecondary = fixtureIds("unmapped_secondary", suffix);
const claimUserId = `user_img_claim_${suffix.replaceAll("-", "")}`;
const fixtures = [secondary, mismapped, claimedSecondary, claimedWrongOwner, unmappedSecondary, owner, other, dailyPeer, dailyPeerTwo, dailyPeerThree, dailyPeerFour, concurrent, staged, invalid, stale, readyReserved, temporary, corrupt];
const createdFiles = new Set();
let previousGuestFlag = 0;

try {
  const [[site]] = await db.execute(
    `SELECT s.id, s.guest_chat_enabled,
            COALESCE(ms.character_id, s.mascot_character_id) AS mascot_character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk'
     LIMIT 1`
  );
  assert.ok(site?.id && site?.mascot_character_id, "FKK site and mascot are required for the guest image check");
  previousGuestFlag = Number(site.guest_chat_enabled || 0);
  await db.execute("UPDATE sites SET guest_chat_enabled = 1 WHERE id = ?", [site.id]);
  for (const fixture of fixtures) fixture.siteId = site.id;
  const [[character]] = await db.execute(
    `SELECT id, name, opening_line, persona_prompt, speaking_style, role_title, short_bio, site_id, category_id
     FROM ai_characters
     WHERE id = ?
     LIMIT 1`,
    [site.mascot_character_id]
  );

  await createGuestFixture({ ...owner, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...other, siteId: site.id, characterId: character.id });
  dailyPeer.networkHash = owner.networkHash;
  await createGuestFixture({ ...dailyPeer, siteId: site.id, characterId: character.id });
  dailyPeerTwo.networkHash = owner.networkHash;
  await createGuestFixture({ ...dailyPeerTwo, siteId: site.id, characterId: character.id });
  dailyPeerThree.networkHash = owner.networkHash;
  await createGuestFixture({ ...dailyPeerThree, siteId: site.id, characterId: character.id });
  dailyPeerFour.networkHash = owner.networkHash;
  await createGuestFixture({ ...dailyPeerFour, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...concurrent, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...staged, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...invalid, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...stale, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...readyReserved, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...temporary, siteId: site.id, characterId: character.id });
  await createGuestFixture({ ...corrupt, siteId: site.id, characterId: character.id });

  const [guestIndexes] = await db.execute("SHOW INDEX FROM chat_image_assets WHERE Key_name = 'idx_chat_image_assets_guest_status'");
  assert.equal(guestIndexes.length, 2, "guest image ownership lookups should use the guest/status composite index");

  const first = await createImageRequest({ fixture: owner, character, requestKey: "owner-first", displayOrder: 10 });
  assert.equal(first.taskCreated, true, JSON.stringify(first));
  assert.equal(first.message?.image?.status, "queued");
  const job = await loadImageJob(owner.sessionId);
  const result = await generateChatImageFromJob(job);
  assert.equal(result.status, "ready");

  const [[ready]] = await db.execute(
    `SELECT e.entitlement_status, e.asset_id, a.status, a.storage_path, a.protected_path,
            (SELECT COUNT(*) FROM chat_image_usage WHERE asset_id = a.id) AS formal_usage_count
     FROM guest_image_entitlements e
     JOIN chat_image_assets a ON a.id = e.asset_id
     WHERE e.guest_session_id = ?`,
    [owner.guestId]
  );
  assert.equal(ready.entitlement_status, "consumed");
  assert.equal(ready.status, "ready");
  assert.equal(Number(ready.formal_usage_count), 0, "guest ready images must not consume formal-user image quota");
  const readyFileName = extractFileName(ready.protected_path || ready.storage_path);
  assert.ok(readyFileName);
  createdFiles.add(readyFileName);

  const replay = await generateChatImageFromJob(job);
  assert.equal(replay.status, "ready");
  const [[ownerAssetCount]] = await db.execute("SELECT COUNT(*) AS count FROM chat_image_assets WHERE guest_session_id = ?", [owner.guestId]);
  assert.equal(Number(ownerAssetCount.count), 1, "replaying a ready job must not create another image asset");

  await requireGuestChatImageAccess(owner.token, readyFileName);
  await assert.rejects(() => requireGuestChatImageAccess(other.token, readyFileName), (error) => Number(error?.statusCode || 0) === 403);
  await assert.rejects(() => requireGuestChatImageAccess("invalid-token", readyFileName), (error) => Number(error?.statusCode || 0) === 401);

  const second = await createImageRequest({ fixture: owner, character, requestKey: "owner-second", displayOrder: 40 });
  assert.equal(second.taskCreated, false);
  assert.equal(second.reason, "quota_exhausted");
  const [[afterSecondCount]] = await db.execute("SELECT COUNT(*) AS count FROM chat_image_assets WHERE guest_session_id = ?", [owner.guestId]);
  assert.equal(Number(afterSecondCount.count), 1, "a consumed guest entitlement must reject a second image asset");

  for (const [fixture, requestKey] of [[dailyPeer, "daily-peer"], [dailyPeerTwo, "daily-peer-two"]]) {
    const request = await createImageRequest({ fixture, character, requestKey, displayOrder: 10 });
    assert.equal(request.taskCreated, true, "the remaining two guests on one network should receive image slots");
    const readyResult = await generateChatImageFromJob(await loadImageJob(fixture.sessionId));
    assert.equal(readyResult.status, "ready");
  }
  const thirdPeerRequest = await createImageRequest({ fixture: dailyPeerThree, character, requestKey: "daily-peer-three", displayOrder: 10 });
  assert.equal(thirdPeerRequest.taskCreated, false, "the fourth guest on one network must be blocked within five hours");
  assert.equal(thirdPeerRequest.reason, "quota_exhausted");
  const [[dailyPeerAssetCount]] = await db.execute("SELECT COUNT(*) AS count FROM chat_image_assets WHERE guest_session_id = ?", [dailyPeerThree.guestId]);
  assert.equal(Number(dailyPeerAssetCount.count), 0, "network exhaustion must not create a placeholder");

  const failed = await createImageRequest({ fixture: other, character, requestKey: "other-failed", displayOrder: 10 });
  const failedAssetId = failed.message.image.id;
  await withTransaction(async (tx) => {
    await tx.execute("UPDATE chat_image_assets SET status = 'failed' WHERE id = ?", [failedAssetId]);
    await releaseGuestImageEntitlementForAsset(tx, failedAssetId);
    await releaseGuestImageDailyQuotaForAsset(tx, failedAssetId);
  });
  const [[released]] = await db.execute("SELECT entitlement_status, asset_id, request_key FROM guest_image_entitlements WHERE guest_session_id = ?", [other.guestId]);
  assert.deepEqual({ status: released.entitlement_status, assetId: released.asset_id, requestKey: released.request_key }, { status: "available", assetId: null, requestKey: null });
  const retry = await createImageRequest({ fixture: other, character, requestKey: "other-retry", displayOrder: 40 });
  assert.equal(retry.taskCreated, true, "a final failed guest image should restore the one successful-image opportunity");
  const retryJob = await loadImageJob(other.sessionId, { latest: true });
  const duplicateResults = await Promise.all([
    generateChatImageFromJob(retryJob),
    generateChatImageFromJob(retryJob),
  ]);
  assert.deepEqual(duplicateResults.map((item) => item.status), ["ready", "ready"], "duplicate workers should converge on one ready image");
  const [[otherReady]] = await db.execute(
    `SELECT COUNT(*) AS asset_count,
            SUM(status = 'ready') AS ready_count,
            COUNT(DISTINCT storage_path) AS file_count
     FROM chat_image_assets
     WHERE guest_session_id = ?`,
    [other.guestId]
  );
  assert.deepEqual(
    { assets: Number(otherReady.asset_count), ready: Number(otherReady.ready_count), files: Number(otherReady.file_count) },
    { assets: 2, ready: 1, files: 1 },
    "duplicate workers must not create another asset or file"
  );

  await db.execute("UPDATE guest_image_entitlements SET consumed_at = DATE_SUB(NOW(3), INTERVAL 1 DAY) WHERE guest_session_id = ?", [owner.guestId]);
  await db.execute("DELETE FROM guest_image_network_quota_reservations WHERE site_id = ? AND network_hash = ?", [site.id, owner.networkHash]);
  await db.execute("DELETE FROM guest_image_network_quota_windows WHERE site_id = ? AND network_hash = ?", [site.id, owner.networkHash]);
  const nextDay = await createImageRequest({ fixture: owner, character, requestKey: "owner-next-day", displayOrder: 70 });
  assert.equal(nextDay.taskCreated, true, "the same guest may generate one new image on the next day");
  await withTransaction(async (tx) => {
    await tx.execute("UPDATE chat_image_assets SET status = 'failed' WHERE id = ?", [nextDay.message.image.id]);
    await releaseGuestImageEntitlementForAsset(tx, nextDay.message.image.id);
    await releaseGuestImageDailyQuotaForAsset(tx, nextDay.message.image.id);
  });

  const concurrentResults = await Promise.all([
    createImageRequest({ fixture: concurrent, character, requestKey: "concurrent-a", displayOrder: 10 }),
    createImageRequest({ fixture: concurrent, character, requestKey: "concurrent-b", displayOrder: 20 }),
  ]);
  assert.equal(concurrentResults.filter((item) => item.taskCreated).length, 1, "concurrent guest image requests should reserve only one task");
  assert.equal(concurrentResults.filter((item) => item.reason === "active_generation").length, 1);
  const [[concurrentCount]] = await db.execute("SELECT COUNT(*) AS count FROM chat_image_assets WHERE guest_session_id = ?", [concurrent.guestId]);
  assert.equal(Number(concurrentCount.count), 1);

  const stagedRequest = await createImageRequest({ fixture: staged, character, requestKey: "staged-recovery", displayOrder: 10 });
  const stagedAssetId = stagedRequest.message.image.id;
  const stagedSaved = await saveMockChatImageAsset({ assetId: stagedAssetId });
  createdFiles.add(stagedSaved.storagePath);
  await db.execute(
    `UPDATE chat_image_assets
     SET status = 'generating', storage_path = ?, protected_path = ?, width = ?, height = ?, bytes = ?, mime_type = ?
     WHERE id = ?`,
    [stagedSaved.storagePath, stagedSaved.protectedPath, stagedSaved.width, stagedSaved.height, stagedSaved.bytes, stagedSaved.mimeType, stagedAssetId]
  );
  const stagedPath = resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, stagedSaved.storagePath);
  const stagedBefore = await stat(stagedPath);
  const stagedResult = await generateChatImageFromJob(await loadImageJob(staged.sessionId));
  const stagedAfter = await stat(stagedPath);
  assert.equal(stagedResult.handledBy, "chat-image-staged-recovery");
  assert.equal(stagedAfter.ino, stagedBefore.ino, "staged recovery should reuse the existing file instead of replacing it");
  const [[stagedEntitlement]] = await db.execute("SELECT entitlement_status FROM guest_image_entitlements WHERE guest_session_id = ?", [staged.guestId]);
  assert.equal(stagedEntitlement.entitlement_status, "consumed");

  const temporaryRequest = await createImageRequest({ fixture: temporary, character, requestKey: "temporary-recovery", displayOrder: 10 });
  const temporaryAssetId = temporaryRequest.message.image.id;
  const temporarySaved = await saveMockChatImageAsset({ assetId: temporaryAssetId });
  const temporaryFinalPath = resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, temporarySaved.storagePath);
  const temporaryName = getChatImageTemporaryStorageName(temporaryAssetId);
  const temporaryPath = resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, temporaryName);
  await rename(temporaryFinalPath, temporaryPath);
  createdFiles.add(temporarySaved.storagePath);
  createdFiles.add(temporaryName);
  const temporaryResult = await generateChatImageFromJob(await loadImageJob(temporary.sessionId));
  assert.equal(temporaryResult.handledBy, "chat-image-staged-recovery");
  await stat(temporaryFinalPath);
  await assert.rejects(() => stat(temporaryPath), (error) => error?.code === "ENOENT");

  const corruptRequest = await createImageRequest({ fixture: corrupt, character, requestKey: "corrupt-temporary", displayOrder: 10 });
  const corruptAssetId = corruptRequest.message.image.id;
  const corruptTemporaryName = getChatImageTemporaryStorageName(corruptAssetId);
  const corruptTemporaryPath = resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, corruptTemporaryName);
  await writeFile(corruptTemporaryPath, Buffer.from("partial-webp"));
  createdFiles.add(corruptTemporaryName);
  createdFiles.add(getChatImageStorageName(corruptAssetId));
  const corruptResult = await generateChatImageFromJob(await loadImageJob(corrupt.sessionId));
  assert.equal(corruptResult.status, "ready", "a corrupt temporary file should be discarded and regenerated");
  await stat(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, getChatImageStorageName(corruptAssetId)));
  await assert.rejects(() => stat(corruptTemporaryPath), (error) => error?.code === "ENOENT");

  const readyReservedRequest = await createImageRequest({ fixture: readyReserved, character, requestKey: "ready-reserved", displayOrder: 10 });
  const readyReservedAssetId = readyReservedRequest.message.image.id;
  const readyReservedSaved = await saveMockChatImageAsset({ assetId: readyReservedAssetId });
  createdFiles.add(readyReservedSaved.storagePath);
  await db.execute(
    `UPDATE chat_image_assets
     SET status = 'ready', storage_path = ?, protected_path = ?, width = ?, height = ?, bytes = ?, mime_type = ?, completed_at = NOW(3)
     WHERE id = ?`,
    [readyReservedSaved.storagePath, readyReservedSaved.protectedPath, readyReservedSaved.width, readyReservedSaved.height, readyReservedSaved.bytes, readyReservedSaved.mimeType, readyReservedAssetId]
  );
  await generateChatImageFromJob(await loadImageJob(readyReserved.sessionId));
  const [[reconciledEntitlement]] = await db.execute("SELECT entitlement_status FROM guest_image_entitlements WHERE guest_session_id = ?", [readyReserved.guestId]);
  assert.equal(reconciledEntitlement.entitlement_status, "consumed", "ready replay should reconcile a reserved entitlement");

  const staleRequest = await createImageRequest({ fixture: stale, character, requestKey: "stale-recovery", displayOrder: 10 });
  assert.equal(staleRequest.taskCreated, true);
  const staleJob = await loadImageJob(stale.sessionId, { claim: false });
  await db.execute(
    "UPDATE memory_jobs SET job_status = 'running', claim_token = NULL, started_at = DATE_SUB(NOW(3), INTERVAL 10 MINUTE), updated_at = DATE_SUB(NOW(3), INTERVAL 10 MINUTE) WHERE id = ?",
    [staleJob.id]
  );
  const recoveredCount = await recoverStaleChatImageJobs({
    staleAfterMs: 60_000,
    now: new Date(),
    availableAt: new Date(Date.now() + 60 * 60 * 1000),
    jobId: staleJob.id,
  });
  assert.equal(recoveredCount, 1, "one stale running image job should be recovered");
  const [[recoveredJobRow]] = await db.execute("SELECT job_status FROM memory_jobs WHERE id = ?", [staleJob.id]);
  assert.equal(recoveredJobRow.job_status, "queued");
  await generateChatImageFromJob(await loadImageJob(stale.sessionId));
  const [[staleReady]] = await db.execute(
    `SELECT a.status, e.entitlement_status
     FROM chat_image_assets a
     JOIN guest_image_entitlements e ON e.asset_id = a.id
     WHERE a.id = ?`,
    [staleRequest.message.image.id]
  );
  assert.deepEqual({ asset: staleReady.status, entitlement: staleReady.entitlement_status }, { asset: "ready", entitlement: "consumed" });

  const invalidRequest = await createImageRequest({ fixture: invalid, character, requestKey: "invalid-worker", displayOrder: 10 });
  await db.execute("UPDATE guest_sessions SET session_status = 'revoked' WHERE id = ?", [invalid.guestId]);
  await assert.rejects(
    async () => generateChatImageFromJob(await loadImageJob(invalid.sessionId)),
    (error) => error?.retryable === false && /no longer active/i.test(error.message)
  );
  const [[invalidState]] = await db.execute(
    `SELECT a.status, e.entitlement_status
     FROM chat_image_assets a
     JOIN guest_image_entitlements e ON e.guest_session_id = a.guest_session_id
     WHERE a.id = ?`,
    [invalidRequest.message.image.id]
  );
  assert.deepEqual({ asset: invalidState.status, entitlement: invalidState.entitlement_status }, { asset: "failed", entitlement: "available" });
  await assert.rejects(
    () => stat(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, getChatImageStorageName(invalidRequest.message.image.id))),
    (error) => error?.code === "ENOENT",
    "an invalidated guest must not reach image storage"
  );

  // One guest identity has a primary mascot and independent secondary-character chats.
  const [[secondCharacter]] = await db.execute("SELECT id, name, opening_line, persona_prompt, speaking_style, role_title, short_bio, site_id, category_id FROM ai_characters WHERE character_status = 'published' AND id <> ? LIMIT 1", [character.id]);
  assert.ok(secondCharacter?.id, "a second published character is required for mapping ownership checks");
  for (const fixture of [secondary, mismapped, claimedSecondary, claimedWrongOwner, unmappedSecondary]) {
    await createGuestFixture({ ...fixture, siteId: site.id, characterId: secondCharacter.id, baseCharacterId: character.id });
    fixture.primarySessionId = `${fixture.sessionId.slice(0, 54)}_primary`;
    await db.execute("INSERT INTO chat_sessions (id, guest_session_id, character_id, session_title, session_status, source_type, source_ref) VALUES (?, ?, ?, 'Primary guest mapping fixture', 'active', 'guest', 'guest-image-self-check')", [fixture.primarySessionId, fixture.guestId, character.id]);
    await db.execute("UPDATE guest_sessions SET chat_session_id = ? WHERE id = ?", [fixture.primarySessionId, fixture.guestId]);
    if (fixture !== unmappedSecondary) await db.execute("INSERT INTO guest_character_sessions (guest_session_id, character_id, chat_session_id) VALUES (?, ?, ?)", [fixture.guestId, secondCharacter.id, fixture === mismapped ? owner.sessionId : fixture.sessionId]);
  }
  const secondaryRequest = await createImageRequest({ fixture: secondary, character: secondCharacter, requestKey: "secondary", displayOrder: 10 });
  assert.equal((await generateChatImageFromJob(await loadImageJob(secondary.sessionId))).status, "ready", "a secondary mapped character must generate without matching the root mascot");
  const mismatchRequest = await createImageRequest({ fixture: mismapped, character: secondCharacter, requestKey: "mismapped", displayOrder: 10 });
  await assert.rejects(generateChatImageFromJob(await loadImageJob(mismapped.sessionId)), /Guest image session is no longer active/, "mapping to another guest chat cannot authorize generation");
  assert.equal((await db.execute("SELECT status FROM chat_image_assets WHERE id = ?", [mismatchRequest.message.image.id]))[0][0].status, "failed");
  await createImageRequest({ fixture: unmappedSecondary, character: secondCharacter, requestKey: "unmapped-secondary", displayOrder: 10 });
  await assert.rejects(generateChatImageFromJob(await loadImageJob(unmappedSecondary.sessionId)), /Guest image session is no longer active/, "a secondary character without an authoritative mapping cannot fall back to the primary root chat");
  await db.execute("INSERT INTO users (id, platform_uid, username, password_hash, email, account_type, account_status, site_id) VALUES (?, ?, ?, 'disabled-self-check', ?, 'personal', 'active', ?)", [claimUserId, claimUserId, claimUserId, `${claimUserId}@example.test`, site.id]);
  for (const fixture of [claimedSecondary, claimedWrongOwner]) {
    await createImageRequest({ fixture, character: secondCharacter, requestKey: "claimed-secondary", displayOrder: 10 });
    await db.execute("UPDATE guest_sessions SET session_status = 'claimed', claimed_user_id = ?, target_chat_session_id = ? WHERE id = ?", [claimUserId, fixture.primarySessionId, fixture.guestId]);
    await db.execute("UPDATE guest_character_sessions SET target_chat_session_id = ? WHERE guest_session_id = ? AND character_id = ?", [fixture.sessionId, fixture.guestId, secondCharacter.id]);
    if (fixture === claimedSecondary) await db.execute("UPDATE chat_sessions SET internal_uid = ? WHERE id = ?", [claimUserId, fixture.sessionId]);
  }
  assert.equal((await generateChatImageFromJob(await loadImageJob(claimedSecondary.sessionId))).status, "ready", "a claimed secondary image must use that character's target and owner, not the primary target");
  await assert.rejects(generateChatImageFromJob(await loadImageJob(claimedWrongOwner.sessionId)), /Guest image session is no longer active/, "a mapped claimed target without the claiming owner must be rejected");
  console.log("guest image generation self-check passed (primary legacy, secondary, invalid mapping and claimed secondary ownership)");
} finally {
  for (const fixture of fixtures) {
    const [paths] = await db.execute("SELECT storage_path, protected_path FROM chat_image_assets WHERE guest_session_id = ?", [fixture.guestId]).catch(() => [[]]);
    for (const row of paths) {
      const fileName = extractFileName(row.protected_path || row.storage_path);
      if (fileName) createdFiles.add(fileName);
    }
  }
  for (const fixture of fixtures) {
    await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [fixture.sessionId]).catch(() => {});
    await db.execute("DELETE FROM guest_image_network_quota_reservations WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_image_network_quota_windows WHERE site_id = ? AND network_hash = ?", [fixture.siteId, fixture.networkHash]).catch(() => {});
    await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
    await db.execute("DELETE FROM chat_sessions WHERE id = ?", [fixture.sessionId]).catch(() => {});
    if (fixture.primarySessionId) await db.execute("DELETE FROM chat_sessions WHERE id = ?", [fixture.primarySessionId]).catch(() => {});
    await db.execute("DELETE FROM guest_sessions WHERE id = ?", [fixture.guestId]).catch(() => {});
  }
  await db.execute("DELETE FROM users WHERE id = ?", [claimUserId]).catch(() => {});
  await db.execute("UPDATE sites SET guest_chat_enabled = ? WHERE slug = 'footballkituk'", [previousGuestFlag]).catch(() => {});
  for (const fileName of createdFiles) {
    await unlink(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName)).catch(() => {});
  }
  const guestIds = fixtures.map((fixture) => fixture.guestId);
  const sessionIds = fixtures.flatMap((fixture) => [fixture.sessionId, fixture.primarySessionId].filter(Boolean));
  const [[remainingGuests]] = await db.execute(`SELECT COUNT(*) AS total FROM guest_sessions WHERE id IN (${guestIds.map(() => "?").join(",")})`, guestIds);
  const [[remainingSessions]] = await db.execute(`SELECT COUNT(*) AS total FROM chat_sessions WHERE id IN (${sessionIds.map(() => "?").join(",")})`, sessionIds);
  const [[remainingMappings]] = await db.execute(`SELECT COUNT(*) AS total FROM guest_character_sessions WHERE guest_session_id IN (${guestIds.map(() => "?").join(",")})`, guestIds);
  const [[remainingJobs]] = await db.execute(`SELECT COUNT(*) AS total FROM memory_jobs WHERE session_id IN (${sessionIds.map(() => "?").join(",")})`, sessionIds);
  const [[remainingUser]] = await db.execute("SELECT COUNT(*) AS total FROM users WHERE id = ?", [claimUserId]);
  assert.deepEqual([remainingGuests, remainingSessions, remainingMappings, remainingJobs, remainingUser].map((row) => Number(row.total)), [0, 0, 0, 0, 0], "all owned guest mapping/image fixtures must be removed");
  for (const fileName of createdFiles) await assert.rejects(stat(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName)), { code: "ENOENT" }, "controlled image files must be removed");
  await closeDbPool();
}

function fixtureIds(label, value) {
  const compact = value.replaceAll("-", "");
  return {
    guestId: `guest_img_${label}_${compact}`.slice(0, 64),
    sessionId: `chat_img_${label}_${compact}`.slice(0, 64),
    token: createToken(),
    networkHash: createHash("sha256").update(`guest-image-self-check:${label}:${value}`).digest("hex"),
  };
}

async function createGuestFixture({ guestId, sessionId, token, siteId, characterId, baseCharacterId = characterId }) {
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [guestId, hashSessionToken(token), siteId, baseCharacterId, sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Guest image self-check', 'active', 'guest', 'guest-image-self-check', NOW(3))`,
    [sessionId, guestId, characterId]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);
}

async function createImageRequest({ fixture, character, requestKey, displayOrder }) {
  return withTransaction(async (tx) => {
    const userMessage = await insertMessage(tx, {
      sessionId: fixture.sessionId,
      characterId: null,
      senderType: "user",
      senderLabel: "You",
      contentType: "text",
      text: "Take a selfie #mock-image",
      displayOrder,
      sourceType: "guest",
      sourceRef: `guest-image-check:${requestKey}`,
    });
    const result = await maybeCreateGuestChatImagePlaceholder(tx, {
      guest: { id: fixture.guestId, site_id: fixture.siteId },
      session: { id: fixture.sessionId, guest_session_id: fixture.guestId, character_id: character.id },
      character,
      userText: "Take a selfie #mock-image",
      userMessage,
      requestKey,
      networkHash: fixture.networkHash,
    });
    await tx.execute("UPDATE memory_jobs SET available_at = DATE_ADD(NOW(3), INTERVAL 1 HOUR) WHERE session_id = ? AND job_type = 'generate_chat_image'", [fixture.sessionId]);
    return result;
  });
}

async function loadImageJob(sessionId, { latest = false, claim = true } = {}) {
  const [[row]] = await db.execute(
    `SELECT id, job_status, retry_count, max_retries, payload_json
     FROM memory_jobs
     WHERE session_id = ?
       AND job_type = 'generate_chat_image'
     ORDER BY created_at ${latest ? "DESC" : "ASC"}
     LIMIT 1`,
    [sessionId]
  );
  assert.ok(row, "guest image job should be queued");
  if (!claim) return { id: row.id };
  await db.execute("UPDATE memory_jobs SET available_at = NOW(3) WHERE id = ?", [row.id]);
  const claimed = await claimNextMemoryJob({ jobId: row.id });
  assert.ok(claimed?.claimToken, "guest image fixture must obtain its own execution lease");
  return claimed;
}
