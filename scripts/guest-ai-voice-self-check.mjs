import assert from "node:assert/strict";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { generateReservedAiReplyVoiceAsset, reserveAiReplyVoiceAssetForDb } from "../server/chat-voice-asset-service.js";
import { attachVoiceAssetToMessage, ensureOpeningMessageForSession, insertMessage, listMessagesForSessionWithDb } from "../server/chat-message-store.js";
import { resolveElevenLabsTtsConfig } from "../server/elevenlabs-tts-service.js";
import { retryGuestVoiceAssets } from "../server/guest-chat-service.js";
import { readSourceBundle } from "./source-bundle.mjs";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest AI voice self-check" });
const db = getDbPool();
const GUEST_ID = "guest_self_check_ai_voice";
const CHARACTER_ID = "guest_self_check_ai_voice_character";
const SESSION_ID = "guest_self_check_ai_voice_session";
const createdVoiceFiles = new Set();

try {
  await initializeDatabase();
  await cleanup();
  await seed();

  const opening = await ensureOpeningMessageForSession(db, {
    sessionId: SESSION_ID,
    guestSessionId: GUEST_ID,
    characterId: CHARACTER_ID,
    senderLabel: "Guest Voice Check",
    openingLine: "Welcome to the guest voice check.",
  });
  const reserved = await reserveAiReplyVoiceAssetForDb(db, {
    messageId: opening.id,
    characterId: CHARACTER_ID,
    speechText: opening.text,
    voiceMeta: {
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      languageCode: "en",
      languageLabel: "English",
    },
    deterministic: true,
  });
  await attachVoiceAssetToMessage(db, { messageId: opening.id, voiceAssetId: reserved.id });
  const generated = await generateReservedAiReplyVoiceAsset({
    assetId: reserved.id,
    generateAudio: async () => ({
      status: "ready",
      audioUrl: "/uploads/voice/ai/guest-opening-self-check.mp3",
      audioBytes: 2048,
      durationSeconds: 3,
      outputFormat: "mp3_44100_128",
    }),
  });

  assert.equal(generated.assetStatus, "ready");
  const [[rawMessage]] = await db.execute(
    "SELECT guest_session_id, voice_asset_id FROM chat_messages WHERE id = ? LIMIT 1",
    [opening.id]
  );
  assert.equal(rawMessage.guest_session_id, GUEST_ID, "guest opening should keep guest provenance");
  assert.equal(rawMessage.voice_asset_id, reserved.id);

  const messages = await listMessagesForSessionWithDb(db, SESSION_ID);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].voice?.assetStatus, "ready");
  assert.equal(messages[0].voice?.audioUrl, "/api/uploads/voice/ai/guest-opening-self-check.mp3");

  const retryMessage = await insertMessage(db, {
    sessionId: SESSION_ID,
    guestSessionId: GUEST_ID,
    characterId: CHARACTER_ID,
    senderType: "character",
    senderLabel: "Guest Voice Check",
    contentType: "text",
    text: "Retry the same guest voice asset.",
    displayOrder: 20,
    sourceType: "ai",
    sourceRef: "guest-voice-retry-self-check",
  });
  const retryReserved = await reserveAiReplyVoiceAssetForDb(db, {
    messageId: retryMessage.id,
    characterId: CHARACTER_ID,
    speechText: retryMessage.text,
    voiceMeta: { provider: "elevenlabs", model: "eleven_v3", voiceId: "EXAVITQu4vr4xnSDxMaL", languageCode: "en", languageLabel: "English" },
    deterministic: true,
  });
  await attachVoiceAssetToMessage(db, { messageId: retryMessage.id, voiceAssetId: retryReserved.id });
  const failed = await generateReservedAiReplyVoiceAsset({
    assetId: retryReserved.id,
    generateAudio: async () => { throw new Error("mock guest TTS failure"); },
  });
  assert.equal(failed.assetStatus, "failed");
  const retried = await generateReservedAiReplyVoiceAsset({
    assetId: retryReserved.id,
    generateAudio: async () => ({ status: "ready", audioUrl: "/uploads/voice/ai/guest-retry-self-check.mp3", audioBytes: 1024, durationSeconds: 2, outputFormat: "mp3" }),
  });
  assert.equal(retried.assetStatus, "ready");
  const [[assetCount]] = await db.execute("SELECT COUNT(*) AS total FROM character_voice_assets WHERE message_id = ?", [retryMessage.id]);
  assert.equal(Number(assetCount.total), 1, "failed guest TTS should retry the same reserved asset");

  const recoveryMessage = await insertMessage(db, {
    sessionId: SESSION_ID,
    guestSessionId: GUEST_ID,
    characterId: CHARACTER_ID,
    senderType: "character",
    senderLabel: "Guest Voice Check",
    contentType: "text",
    text: "Recover a finalizing voice asset after restart.",
    displayOrder: 30,
    sourceType: "ai",
    sourceRef: "guest-voice-finalizing-recovery-self-check",
  });
  const recoveryReserved = await reserveAiReplyVoiceAssetForDb(db, {
    messageId: recoveryMessage.id,
    characterId: CHARACTER_ID,
    speechText: recoveryMessage.text,
    voiceMeta: { provider: "elevenlabs", model: "eleven_v3", voiceId: "EXAVITQu4vr4xnSDxMaL", languageCode: "en", languageLabel: "English" },
    deterministic: true,
  });
  await attachVoiceAssetToMessage(db, { messageId: recoveryMessage.id, voiceAssetId: recoveryReserved.id });
  const recoveryAttemptToken = "voice_attempt_interrupted_self_check";
  await db.execute(
    `UPDATE character_voice_assets
     SET asset_status = 'finalizing', attempt_token = ?, retry_count = 2,
         last_attempt_at = DATE_SUB(NOW(3), INTERVAL 31 SECOND)
     WHERE id = ?`,
    [recoveryAttemptToken, recoveryReserved.id]
  );
  const voiceConfig = resolveElevenLabsTtsConfig();
  await mkdir(voiceConfig.outputDir, { recursive: true });
  const recoveryFileName = `${recoveryReserved.id}.mp3`;
  const recoveryFilePath = resolve(voiceConfig.outputDir, recoveryFileName);
  const abandonedTemporaryPath = `${recoveryFilePath}.voice_attempt_abandoned_self_check.tmp`;
  await writeFile(recoveryFilePath, Buffer.from("completed before ready database update"));
  await writeFile(abandonedTemporaryPath, Buffer.from("abandoned old attempt"));
  createdVoiceFiles.add(recoveryFilePath);
  createdVoiceFiles.add(abandonedTemporaryPath);
  await retryGuestVoiceAssets(GUEST_ID);
  const [[recoveredRow]] = await db.execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [recoveryReserved.id]);
  const recovered = { assetStatus: recoveredRow.asset_status, audioUrl: recoveredRow.audio_url };
  assert.equal(recovered.assetStatus, "ready", "stale finalizing voice should recover the deterministic final file");
  assert.equal(recovered.audioUrl, `/uploads/voice/ai/${recoveryFileName}`);
  const recoveredMessages = await listMessagesForSessionWithDb(db, SESSION_ID);
  assert.equal(
    recoveredMessages.find((message) => message.id === recoveryMessage.id)?.voice?.audioUrl,
    `/api/uploads/voice/ai/${recoveryFileName}`,
    "the real conversation response should expose the recovered file through the protected route"
  );
  await stat(recoveryFilePath);
  await assert.rejects(
    () => stat(abandonedTemporaryPath),
    (error) => error?.code === "ENOENT",
    "recovery should remove all historical temporary files for the same asset"
  );

  const raceMessage = await insertMessage(db, {
    sessionId: SESSION_ID,
    guestSessionId: GUEST_ID,
    characterId: CHARACTER_ID,
    senderType: "character",
    senderLabel: "Guest Voice Check",
    contentType: "text",
    text: "Keep the recovered final file when the original worker resumes.",
    displayOrder: 40,
    sourceType: "ai",
    sourceRef: "guest-voice-finalizing-worker-race-self-check",
  });
  const raceReserved = await reserveAiReplyVoiceAssetForDb(db, {
    messageId: raceMessage.id,
    characterId: CHARACTER_ID,
    speechText: raceMessage.text,
    voiceMeta: { provider: "elevenlabs", model: "eleven_v3", voiceId: "EXAVITQu4vr4xnSDxMaL", languageCode: "en", languageLabel: "English" },
    deterministic: true,
  });
  await attachVoiceAssetToMessage(db, { messageId: raceMessage.id, voiceAssetId: raceReserved.id });
  let signalOriginalWorkerPaused;
  let releaseOriginalWorker;
  const originalWorkerPaused = new Promise((resolvePaused) => { signalOriginalWorkerPaused = resolvePaused; });
  const originalWorkerGate = new Promise((resolveGate) => { releaseOriginalWorker = resolveGate; });
  const raceFileName = `${raceReserved.id}.mp3`;
  const raceFilePath = resolve(voiceConfig.outputDir, raceFileName);
  createdVoiceFiles.add(raceFilePath);
  const originalWorker = generateReservedAiReplyVoiceAsset({
    assetId: raceReserved.id,
    generateAudio: async ({ temporaryFileSuffix }) => {
      const temporaryPath = `${raceFilePath}.${temporaryFileSuffix}.tmp`;
      await writeFile(temporaryPath, Buffer.from("ready before the database commit"));
      createdVoiceFiles.add(temporaryPath);
      return {
        status: "ready",
        audioUrl: `/uploads/voice/ai/${raceFileName}`,
        audioBytes: 32,
        durationSeconds: 2,
        outputFormat: "mp3",
        outputPath: raceFilePath,
        temporaryPath,
      };
    },
    beforeReadyCommit: async () => {
      signalOriginalWorkerPaused();
      await originalWorkerGate;
    },
  });
  await originalWorkerPaused;
  await db.execute(
    "UPDATE character_voice_assets SET last_attempt_at = DATE_SUB(NOW(3), INTERVAL 31 SECOND) WHERE id = ?",
    [raceReserved.id]
  );
  const recoveryWinner = await generateReservedAiReplyVoiceAsset({ assetId: raceReserved.id });
  assert.equal(recoveryWinner.assetStatus, "ready");
  releaseOriginalWorker();
  const lateOriginalWorker = await originalWorker;
  assert.equal(lateOriginalWorker.assetStatus, "ready");
  await stat(raceFilePath);
  const [[raceRow]] = await db.execute("SELECT asset_status FROM character_voice_assets WHERE id = ? LIMIT 1", [raceReserved.id]);
  assert.equal(raceRow.asset_status, "ready", "late original worker must not delete the recovery winner's final file");

  const guestServiceSource = readSourceBundle([
    "server/guest-chat-service.js",
    "server/guest-reply-service.js",
  ]);
  const [protectedRouteSource, chatTextActionSource] = await Promise.all([
    readFile(new URL("../server/protected-upload-routes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/chat-text-actions.js", import.meta.url), "utf8"),
  ]);
  assert.match(guestServiceSource, /reserveAiReplyVoiceAssetForDb\(db,/, "guest AI replies should reserve the shared voice asset before generation");
  assert.match(guestServiceSource, /generateGuestVoiceWithoutFailingText\(voiceAssetId\)/, "guest TTS should run after the reply transaction");
  assert.match(guestServiceSource, /speechText: resolveReplySpeechText\(\{ speechText: replyText \}/, "guest TTS must use the final sanitized guest reply");
  assert.match(protectedRouteSource, /requireGuestVoiceAccess/, "protected AI voice reads should support guest ownership checks");
  assert.match(protectedRouteSource, /m\.guest_session_id = \?/, "guest voice access should verify message provenance");
  assert.match(chatTextActionSource, /markVoiceMessagesForAutoplay\(appState, normalizedCharacterId, newMessages\)/, "guest replies should autoplay only newly returned voice messages");

  console.log("guest AI voice self-check passed");
} finally {
  await cleanup();
  for (const filePath of createdVoiceFiles) await unlink(filePath).catch(() => {});
  await closeDbPool();
}

async function seed() {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, NULL, ?, 'Guest Voice Check', 'Mascot', 'Temporary guest voice check.',
       '', '', 'Welcome to the guest voice check.', 'Base persona.', 'Friendly', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Nova', '',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', 'guest-ai-voice', NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Guest Voice Check conversation', 'active', 'guest', 'self-check', NOW(3))`,
    [SESSION_ID, GUEST_ID, CHARACTER_ID]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM character_voice_assets WHERE character_id = ?", [CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [CHARACTER_ID]).catch(() => {});
}
