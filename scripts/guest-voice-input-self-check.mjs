import { classifiedMessages, restore, assertFixtureTransport } from "./fixtures/chat-image-classifier-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { closeDbPool, getDbPool } from "../server/db.js";
import { createToken, hashSessionToken } from "../server/security.js";
import { sendGuestMessage, sendGuestReplyForMessage } from "../server/guest-chat-service.js";
import { completeGuestVoiceTranscription, reserveGuestVoiceRequest } from "../server/guest-voice-request-service.js";
import { assertGuestWavDuration } from "../server/wav-audio-duration-service.js";
import { encodeMonoPcm16Wav } from "../src/services/guest-voice-wav-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest voice input self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const guestId = `guest_voice_input_${suffix}`.slice(0, 64);
const sessionId = `chat_voice_input_${suffix}`.slice(0, 64);
const clientMessageId = `voice_input_${suffix}`;
const networkHash = `voice_network_${suffix}`;
const token = createToken();
let siteId = "";

try {
  const [[site]] = await db.execute(
    `SELECT s.id, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk' AND s.guest_chat_enabled = 1
     LIMIT 1`
  );
  assert.ok(site?.id && site?.character_id, "enabled FKK guest mascot is required");
  siteId = site.id;
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [guestId, hashSessionToken(token), site.id, site.character_id, sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, last_message_at)
     VALUES (?, NULL, ?, ?, 'Guest voice input self-check', 'active', 'guest', 'guest-voice-input-self-check', NOW(3))`,
    [sessionId, guestId, site.character_id]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);

  const typedBefore = await sendGuestMessage({
    token,
    text: "A typed message before the voice transcript.",
    clientMessageId: `typed_before_voice_${suffix}`,
    networkHash,
    deferReply: true,
  });
  const typedMessages = Array.isArray(typedBefore.messages) ? typedBefore.messages : typedBefore.items || [];
  const typedMessage = typedMessages.find((message) => String(message.text || "").includes("typed message before"));
  await assert.rejects(
    () => sendGuestReplyForMessage({ token, messageId: typedMessage.id }),
    (error) => Number(error?.statusCode || 0) === 404,
    "voice reply endpoint must reject ordinary typed guest messages"
  );

  const voiceReservation = await reserveGuestVoiceRequest({
    guest: { id: guestId },
    requestKey: clientMessageId,
    networkHash,
  });
  assert.equal(voiceReservation.shouldTranscribe, true);
  await assert.rejects(
    () => reserveGuestVoiceRequest({ guest: { id: guestId }, requestKey: clientMessageId, networkHash }),
    (error) => Number(error?.statusCode || 0) === 409,
    "same-key concurrent voice upload must not call STT twice"
  );
  const wav = Buffer.from(encodeMonoPcm16Wav(new Float32Array(16_000), 16_000));
  assert.equal(Math.round(assertGuestWavDuration(wav, 120)), 1, "server should verify WAV duration from audio bytes");
  const forgedByteRate = Buffer.from(wav);
  forgedByteRate.writeUInt32LE(0xffffffff, 28);
  assert.throws(() => assertGuestWavDuration(forgedByteRate, 120), /16kHz mono PCM16/, "forged WAV byteRate must not bypass duration validation");
  const forgedSampleRate = Buffer.from(wav);
  forgedSampleRate.writeUInt32LE(8_000, 24);
  assert.throws(() => assertGuestWavDuration(forgedSampleRate, 120), /16kHz mono PCM16/, "forged WAV sampleRate must be rejected");
  const transcriptText = await completeGuestVoiceTranscription({
    requestId: voiceReservation.id,
    attemptToken: voiceReservation.attemptToken,
    transcriptText: "A short voice transcript for the guest input check.",
  });
  const reusedReservation = await reserveGuestVoiceRequest({ guest: { id: guestId }, requestKey: clientMessageId, networkHash });
  assert.equal(reusedReservation.shouldTranscribe, false, "completed same-key retry should reuse the transcript without STT");

  const first = await sendGuestMessage({
    token,
    text: transcriptText,
    clientMessageId,
    networkHash,
    deferReply: true,
    sourceRef: "voice-asr",
    networkQuotaReserved: true,
    reservedVoiceRequestKey: clientMessageId,
  });
  const firstMessages = Array.isArray(first.messages) ? first.messages : first.items || [];
  const userMessage = firstMessages.find((message) => message.senderType === "user" && String(message.text || "").includes("short voice transcript"));
  assert.ok(userMessage?.id, "voice ASR should create a normal guest user text message");
  assert.equal(firstMessages.some((message) => message.senderType === "character"), false, "voice upload should return before AI reply generation");

  await sendGuestMessage({
    token,
    text: "A short voice transcript for the guest input check.",
    clientMessageId,
    networkHash,
    deferReply: true,
    sourceRef: "voice-asr",
    networkQuotaReserved: true,
    reservedVoiceRequestKey: clientMessageId,
  });
  const [[usage]] = await db.execute(
    `SELECT COALESCE(gcs.message_window_count, g.message_window_count) AS message_window_count,
            (SELECT COUNT(*) FROM chat_messages WHERE session_id = ? AND client_message_id = ?) AS matching_messages,
            (SELECT source_ref FROM chat_messages WHERE id = ?) AS source_ref
     FROM guest_sessions g
     LEFT JOIN guest_character_sessions gcs ON gcs.guest_session_id = g.id AND gcs.character_id = g.mascot_character_id
     WHERE g.id = ?`,
    [sessionId, clientMessageId, userMessage.id, guestId]
  );
  assert.equal(Number(usage.message_window_count), 2, "voice input should add one use to the shared guest message quota after an earlier text turn");
  assert.equal(Number(usage.matching_messages), 1, "voice upload retry should remain idempotent");
  assert.equal(usage.source_ref, "voice-asr", "guest voice input should preserve the lightweight ASR source marker");

  await assert.rejects(
    () => sendGuestReplyForMessage({ token, messageId: `other_${suffix}` }),
    (error) => Number(error?.statusCode || 0) === 404,
    "guest reply endpoint must reject messages outside the frozen guest session"
  );

  const [routeSource, clientSource, actionSource, composerSource] = await Promise.all([
    readFile(new URL("../server/guest-chat-routes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/guest-chat-service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/chat-voice-actions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/chat/chat-composer.js", import.meta.url), "utf8"),
  ]);
  assert.match(routeSource, /validateUploadForPolicy\([\s\S]*CHAT_VOICE_UPLOAD_POLICY[\s\S]*transcribeChatVoice/, "guest voice input should reuse formal upload validation and STT");
  assert.match(routeSource, /await requireGuestCharacter\(token, req\.headers\["x-guest-character-id"\]\)[\s\S]*transcribeChatVoice/, "invalid, expired, or invisible guest roles must be rejected before paid STT");
  assert.match(routeSource, /deferReply:\s*true[\s\S]*sourceRef:\s*"voice-asr"/, "guest voice upload should persist ASR text before the reply phase");
  assert.match(clientSource, /X-Client-Message-Id/, "guest voice retries should carry a stable client message id");
  assert.match(actionSource, /uploadGuestChatVoice[\s\S]*sendGuestVoiceReply/, "guest voice UI should render the transcript before requesting the reply");
  assert.match(actionSource, /prepareGuestVoiceClip/, "guest recorder audio should be normalized to server-verifiable WAV");
  assert.match(actionSource, /guestVoiceMessageId[\s\S]*getGuestChatSession/, "failed second-stage voice replies should recover by the same message id");
  assert.match(actionSource, /scheduleGuestLimitReset/, "guest voice sends should schedule rolling quota recovery");
  assert.match(composerSource, /if \(allowVoiceInput\) bindChatVoiceControls/, "guest voice controls should be capability-driven");

  assert.ok(classifiedMessages.includes("A typed message before the voice transcript."), "typed input must exercise isolated image classification");
  assert.ok(classifiedMessages.includes(transcriptText), "deferred voice input must exercise isolated image classification");
  assertFixtureTransport();
  console.log("guest voice input self-check passed");
} finally {
  restore();
  await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM guest_voice_requests WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guestId]).catch(() => {});
  if (siteId) await db.execute("DELETE FROM guest_network_rate_limits WHERE network_hash = ? AND site_id = ?", [networkHash, siteId]).catch(() => {});
  await closeDbPool();
}
