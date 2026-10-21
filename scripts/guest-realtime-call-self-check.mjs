import { classifiedMessages, restore, assertFixtureTransport } from "./fixtures/chat-image-classifier-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { accountGuestCall, endGuestCall, GUEST_CALL_MESSAGE_LIMIT, startGuestCall } from "../server/guest-call-usage-service.js";
import { assertGuestCallProviderGuard, consumeCallAudioInput, consumeCallAudioProbe, parseAndValidateCallClientMessage } from "../server/call-input-guard-service.js";
import { createGuestCallMessage } from "../server/guest-chat-service.js";
import { closeDbPool, getDbPool } from "../server/db.js";
import { createToken, hashSessionToken } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest realtime call self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const guestId = `guest_call_${suffix}`.slice(0, 64);
const chatSessionId = `chat_call_${suffix}`.slice(0, 64);
const token = createToken();
const networkHash = "a".repeat(64);
const secondGuestId = `guest_call_network_${suffix}`.slice(0, 64);
const secondChatSessionId = `chat_call_network_${suffix}`.slice(0, 64);
const secondToken = createToken();
const callIds = Array.from({ length: 7 }, (_, index) => `call_${index}-${suffix}`.slice(0, 64));
let site = null;

try {
  [[site]] = await db.execute(
    `SELECT s.id, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk' AND s.guest_chat_enabled = 1 LIMIT 1`
  );
  assert.ok(site?.id && site?.character_id, "enabled FKK guest mascot is required");
  await insertGuest({ id: guestId, sessionId: chatSessionId, tokenValue: token, title: "Guest call self-check" });
  await insertGuest({ id: secondGuestId, sessionId: secondChatSessionId, tokenValue: secondToken, title: "Guest call network self-check" });

  await db.execute(
    `UPDATE guest_character_sessions
     SET rate_window_started_at = NOW(3), rate_window_count = 10
     WHERE guest_session_id = ? AND character_id = ?`,
    [guestId, site.character_id]
  );
  const first = await startGuestCall({ token, callSessionId: callIds[0], characterId: site.character_id, networkHash });
  assert.equal(first.guestSessionId, guestId);
  assert.equal(first.messageLimit, GUEST_CALL_MESSAGE_LIMIT);
  assert.equal(first.remainingMessages, GUEST_CALL_MESSAGE_LIMIT);
  await assert.rejects(
    () => startGuestCall({ token, callSessionId: callIds[1], characterId: site.character_id, networkHash }),
    (error) => Number(error?.statusCode || 0) === 409,
    "one guest must not hold two fresh calls"
  );
  await assert.rejects(
    () => startGuestCall({ token: secondToken, callSessionId: callIds[6], characterId: site.character_id, networkHash }),
    (error) => Number(error?.statusCode || 0) === 409,
    "different guest cookies on one network must not open parallel provider calls"
  );

  await db.execute("UPDATE guest_call_sessions SET last_accounted_at = DATE_SUB(NOW(3), INTERVAL 2 SECOND) WHERE id = ?", [callIds[0]]);
  const metered = await accountGuestCall({ guestSessionId: guestId, callSessionId: callIds[0], leaseToken: first.leaseToken });
  assert.equal(metered.active, true);
  assert.equal(metered.remainingMessages, GUEST_CALL_MESSAGE_LIMIT, "elapsed seconds must not consume guest allowance");
  assert.ok(metered.durationMilliseconds >= 1900, "elapsed time remains available for admin audit only");
  await accountGuestCall({ guestSessionId: guestId, callSessionId: callIds[0], leaseToken: first.leaseToken, pendingInputMilliseconds: 5000 });

  const callMessage = await createGuestCallMessage({ token, text: "Guest realtime call transcript", callSessionId: callIds[0], turnId: 1, leaseToken: first.leaseToken });
  const duplicateCallMessage = await createGuestCallMessage({ token, text: "Guest realtime call transcript", callSessionId: callIds[0], turnId: 1, leaseToken: first.leaseToken });
  assert.equal(callMessage.callUserMessageId, duplicateCallMessage.callUserMessageId, "same call turn should reuse one user message");
  assert.equal(duplicateCallMessage.duplicate, true);
  const [[firstMessageState]] = await db.execute(
    `SELECT gcs.message_window_count, gcs.rate_window_count,
            (SELECT COUNT(*) FROM chat_messages WHERE session_id = ? AND source_ref = 'guest-call') AS call_message_count,
            (SELECT turn_count FROM guest_call_sessions WHERE id = ?) AS call_turn_count,
            (SELECT pending_input_milliseconds FROM guest_call_sessions WHERE id = ?) AS pending_input_milliseconds
     FROM guest_character_sessions gcs
     WHERE gcs.guest_session_id = ? AND gcs.character_id = ?`,
    [chatSessionId, callIds[0], callIds[0], guestId, site.character_id]
  );
  assert.equal(Number(firstMessageState.message_window_count), 1, "one persisted call transcript should consume one shared message");
  assert.equal(Number(firstMessageState.rate_window_count), 10, "call turns should not consume the 10-per-10-minute text rate limit");
  assert.equal(Number(firstMessageState.call_message_count), 1);
  assert.equal(Number(firstMessageState.call_turn_count), 1, "duplicate call turn must not duplicate the audit count");
  assert.equal(Number(firstMessageState.pending_input_milliseconds), 0, "a successfully persisted final transcript should clear pending Provider input");
  await accountGuestCall({ guestSessionId: guestId, callSessionId: callIds[0], leaseToken: first.leaseToken, pendingInputMilliseconds: 5000, pendingInputEpoch: 0 });
  const [[afterStaleMeter]] = await db.execute("SELECT pending_input_milliseconds FROM guest_call_sessions WHERE id = ?", [callIds[0]]);
  assert.equal(Number(afterStaleMeter.pending_input_milliseconds), 0, "a pre-final meter snapshot must not restore cleared pending input");
  await assert.rejects(
    () => createGuestCallMessage({ token, text: "Invalid lease must roll back", callSessionId: callIds[0], turnId: 99, leaseToken: "wrong-lease" }),
    (error) => Number(error?.statusCode || 0) === 409,
    "call lease validation must share the message transaction"
  );
  const [[afterInvalidLease]] = await db.execute(
    "SELECT message_window_count FROM guest_character_sessions WHERE guest_session_id = ? AND character_id = ?",
    [guestId, site.character_id]
  );
  assert.equal(Number(afterInvalidLease.message_window_count), 1, "invalid call lease must not consume shared quota");

  await db.execute(
    "UPDATE guest_character_sessions SET message_window_count = 29 WHERE guest_session_id = ? AND character_id = ?",
    [guestId, site.character_id]
  );
  const finalAllowed = await createGuestCallMessage({ token, text: "The thirtieth shared message", callSessionId: callIds[0], turnId: 2, leaseToken: first.leaseToken });
  assert.equal(finalAllowed.guest.messageCount, 30);
  await assert.rejects(
    () => createGuestCallMessage({ token, text: "The blocked thirty-first message", callSessionId: callIds[0], turnId: 3, leaseToken: first.leaseToken }),
    (error) => Number(error?.statusCode || 0) === 429,
    "the thirty-first shared message must be rejected"
  );
  await endGuestCall({ guestSessionId: guestId, callSessionId: callIds[0], leaseToken: first.leaseToken, status: "message_limit_reached" });
  await assert.rejects(
    () => startGuestCall({ token, callSessionId: callIds[1], characterId: site.character_id, networkHash }),
    (error) => Number(error?.statusCode || 0) === 429,
    "a guest with 30 shared messages must not start another call"
  );

  await db.execute(
    `UPDATE guest_character_sessions
     SET message_window_started_at = DATE_SUB(NOW(3), INTERVAL 25 HOUR), message_window_count = 30
     WHERE guest_session_id = ? AND character_id = ?`,
    [guestId, site.character_id]
  );
  await db.execute(
    `UPDATE guest_call_sessions
     SET duration_milliseconds = 7200000
     WHERE id = ?`,
    [callIds[0]]
  );
  const longHistoryAllowed = await startGuestCall({ token, callSessionId: callIds[1], characterId: site.character_id, networkHash });
  assert.equal(longHistoryAllowed.remainingMessages, 30, "call duration history must not block a new call");

  await db.execute("UPDATE guest_call_sessions SET last_accounted_at = DATE_SUB(NOW(3), INTERVAL 11 SECOND) WHERE id = ?", [callIds[1]]);
  const replacement = await startGuestCall({ token, callSessionId: callIds[2], characterId: site.character_id, networkHash });
  const [[staleState]] = await db.execute("SELECT call_status FROM guest_call_sessions WHERE id = ?", [callIds[1]]);
  assert.equal(staleState.call_status, "interrupted", "stale calls should be fenced before replacement");
  await db.execute("UPDATE guest_sessions SET session_status = 'claimed', claimed_user_id = 'self-check-user', claimed_at = NOW(3), active_call_id = NULL WHERE id = ?", [guestId]);
  const claimed = await accountGuestCall({ guestSessionId: guestId, callSessionId: callIds[2], leaseToken: replacement.leaseToken });
  assert.equal(claimed.active, false, "claim should revoke active guest call ownership");

  const guardSession = {};
  assert.deepEqual(parseAndValidateCallClientMessage(Buffer.from('{"type":"end_call"}')), { type: "end_call" });
  assert.equal(consumeCallAudioInput(guardSession, Buffer.alloc(320).toString("base64")).length > 0, true);
  assert.throws(() => consumeCallAudioInput(guardSession, "x".repeat(25000)), /Invalid call audio/);
  assert.equal(consumeCallAudioProbe(guardSession, 1000), true);
  assert.equal(consumeCallAudioProbe(guardSession, 1100), false);
  assert.throws(
    () => assertGuestCallProviderGuard({ listening: true, processing: false, listeningStartedAt: 1000, lastAudioInputAt: 1000 }, 92_000),
    /long period without speech/,
    "idle guest provider connections should be bounded without limiting normal call duration"
  );
  assert.throws(
    () => consumeCallAudioInput({ listeningTurnAudioBytes: 4 * 1024 * 1024 }, Buffer.alloc(320).toString("base64"), 2000),
    /pause briefly/,
    "one uninterrupted noise/partial turn should have a provider-cost boundary"
  );
  assert.throws(
    () => assertGuestCallProviderGuard({ listening: true, processing: false, listeningStartedAt: 1000, lastAudioInputAt: 120_000 }, 122_000),
    /pause briefly/,
    "small keepalive audio must not bypass the per-listening-turn wall guard"
  );
  assert.throws(
    () => assertGuestCallProviderGuard({ listening: false, processing: false, turnPhase: "awaiting_resume", awaitingResumeStartedAt: 1000 }, 92_000),
    /waiting too long to resume/,
    "awaiting resume must not hold guest call admission forever"
  );

  const guardedNetworkHash = "c".repeat(64);
  await db.execute(
    `INSERT INTO guest_call_sessions (
       id, guest_session_id, site_id, character_id, network_hash, lease_token, call_status,
       duration_milliseconds, guarded_input_milliseconds, guarded_input_updated_at, started_at, last_accounted_at, ended_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, 'guard-history', 'provider_guard', 1200000, 1200000, NOW(3), NOW(3), NOW(3), NOW(3), DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [callIds[6], secondGuestId, site.id, site.character_id, guardedNetworkHash]
  );
  await assert.rejects(
    () => startGuestCall({ token: secondToken, callSessionId: `call_guarded-${suffix}`.slice(0, 64), characterId: site.character_id, networkHash: guardedNetworkHash }),
    (error) => error?.code === "GUEST_PROVIDER_GUARD_REACHED",
    "provider-guard cost must persist across calls and enforce a rolling network budget"
  );
  await db.execute("DELETE FROM guest_call_sessions WHERE id = ?", [callIds[6]]);

  const manualNetworkHash = "d".repeat(64);
  const manualCallId = `call_manual-${suffix}`.slice(0, 64);
  const manualCall = await startGuestCall({ token: secondToken, callSessionId: manualCallId, characterId: site.character_id, networkHash: manualNetworkHash });
  await accountGuestCall({ guestSessionId: secondGuestId, callSessionId: manualCallId, leaseToken: manualCall.leaseToken, pendingInputMilliseconds: 4000 });
  await endGuestCall({ guestSessionId: secondGuestId, callSessionId: manualCallId, leaseToken: manualCall.leaseToken, status: "ended" });
  const [[manualEnded]] = await db.execute("SELECT guarded_input_milliseconds, pending_input_milliseconds FROM guest_call_sessions WHERE id = ?", [manualCallId]);
  assert.equal(Number(manualEnded.guarded_input_milliseconds), 4000, "manual disconnect should convert unfinished Provider input into guarded usage");
  assert.equal(Number(manualEnded.pending_input_milliseconds), 0);
  for (let index = 0; index < 9; index += 1) {
    await db.execute(
      `INSERT INTO guest_call_sessions (
         id, guest_session_id, site_id, character_id, network_hash, lease_token, call_status,
         started_at, last_accounted_at, ended_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, 'rapid-history', 'ended', NOW(3), NOW(3), NOW(3), DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
      [`call_rapid-${index}-${suffix}`.slice(0, 64), secondGuestId, site.id, site.character_id, manualNetworkHash]
    );
  }
  await assert.rejects(
    () => startGuestCall({ token: secondToken, callSessionId: `call_rapid-blocked-${suffix}`.slice(0, 64), characterId: site.character_id, networkHash: manualNetworkHash }),
    (error) => error?.code === "GUEST_CALL_START_RATE_REACHED",
    "rapid sub-meter reconnects should be bounded by a persistent start rate"
  );

  const [usageSource, realtimeSource, turnSource, sessionSource, capabilitySource, clientSource, callActionsSource, callEventStateSource, chatPageSource, productOverlaySource] = await Promise.all([
    readFile(new URL("../server/guest-call-usage-service.js", import.meta.url), "utf8"),
    readFile(new URL("../server/call-realtime-service.js", import.meta.url), "utf8"),
    readFile(new URL("../server/call-turn-service.js", import.meta.url), "utf8"),
    readFile(new URL("../server/call-session-service.js", import.meta.url), "utf8"),
    readFile(new URL("../server/guest-chat-routes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/call-modal/call-realtime-client.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/app-call-actions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/call-modal/call-client-event-state.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/chat/chat-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/call-modal/call-product-overlay.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(usageSource, /CALL_LIMIT_MILLISECONDS|NETWORK_CALL_LIMIT_MILLISECONDS/, "guest calls must not have a time allowance");
  assert.match(realtimeSource, /readAuthToken[\s\S]*requireGuest/, "call handshake should support formal auth or the guest cookie without client guest ids");
  assert.match(realtimeSource, /messageCount[\s\S]*messageLimit[\s\S]*remainingMessages/, "call usage should report the shared message allowance");
  assert.match(realtimeSource, /turnPhase !== "awaiting_resume"[\s\S]*guestMessageLimitReached/, "the thirtieth reply should finish before the call is closed");
  assert.match(turnSource, /acquireGuestReplyLockForToken[\s\S]*createGuestCallMessage[\s\S]*user_message[\s\S]*createGuestCallReply/, "a guest call turn should hold the claim barrier through message and AI reply");
  assert.match(sessionSource, /onCloseSession/, "abrupt socket close should finalize guest audit duration");
  assert.match(capabilitySource, /realtimeCall:\s*true/, "guest capability should enable the existing call button");
  assert.match(clientSource, /payload\.type === "call_ended"[\s\S]*this\.stop\(\)/, "server call termination should release browser microphone resources");
  assert.match(callEventStateSource, /messageLimit[\s\S]*messageCount/, "call usage should update the shared guest quota in app state");
  assert.match(`${callActionsSource}\n${callEventStateSource}`, /GUEST_MESSAGE_LIMIT_REACHED[\s\S]*refreshGuestChat|refreshGuestChat[\s\S]*messageLimit/, "quota rejection and limit usage should refresh cross-tab guest state");
  assert.match(chatPageSource, /guestLimitReached[\s\S]*allowRealtimeCall/, "the shared message limit should disable new guest calls");
  assert.match(productOverlaySource, /recordAnalytics:\s*!guestMode[\s\S]*requireAuthForCheckout:\s*guestMode/, "guest call products should avoid formal analytics and require auth for checkout");

  assert.ok(classifiedMessages.includes("Guest realtime call transcript"), "call transcript must exercise isolated image classification");
  assertFixtureTransport();
  console.log("guest realtime call self-check passed");
} finally {
  restore();
  await db.execute("DELETE FROM memory_jobs WHERE session_id IN (?, ?)", [chatSessionId, secondChatSessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_call_sessions WHERE guest_session_id IN (?, ?)", [guestId, secondGuestId]).catch(() => {});
  await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id IN (?, ?)", [guestId, secondGuestId]).catch(() => {});
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id IN (?, ?)", [guestId, secondGuestId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?)", [chatSessionId, secondChatSessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_sessions WHERE id IN (?, ?)", [guestId, secondGuestId]).catch(() => {});
  await closeDbPool();
}

async function insertGuest({ id, sessionId, tokenValue, title }) {
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [id, hashSessionToken(tokenValue), site.id, site.character_id, sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, last_message_at)
     VALUES (?, NULL, ?, ?, ?, 'active', 'guest', 'guest-call-self-check', NOW(3))`,
    [sessionId, id, site.character_id, title]
  );
  await db.execute(
    `INSERT INTO guest_character_sessions (guest_session_id, character_id, chat_session_id)
     VALUES (?, ?, ?)`,
    [id, site.character_id, sessionId]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [id]);
}
