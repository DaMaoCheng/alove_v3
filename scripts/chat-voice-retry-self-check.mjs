import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import {
  createAiReplyVoiceAssetForDb,
  retryAiReplyVoiceAssetForDb,
} from "../server/chat-voice-asset-service.js";

const db = getDbPool();
const CHARACTER_ID = "self_check_voice_retry_character";
const MESSAGE_ID = "self_check_voice_retry_message";

try {
  await initializeDatabase();
  await cleanup();
  await seedCharacter();
  await seedMessage();

  const failed = await createAiReplyVoiceAssetForDb(db, {
    messageId: MESSAGE_ID,
    characterId: CHARACTER_ID,
    userId: "self_check_user",
    speechText: "Retry should update the failed asset instead of inserting duplicates.",
    voiceMeta: {
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      languageCode: "en",
      languageLabel: "English",
    },
    generateAudio: async () => {
      const error = new Error("provider raw failure");
      error.providerErrorRaw = "{\"detail\":\"quota temporarily unavailable\"}";
      throw error;
    },
  });

  assert.equal(failed.assetStatus, "failed");
  assert.equal(failed.retryCount, 0);
  assert.match(failed.providerErrorRaw, /quota temporarily unavailable/);

  const retried = await retryAiReplyVoiceAssetForDb(db, {
    messageId: MESSAGE_ID,
    generateAudio: async () => ({
      status: "ready",
      audioUrl: "/uploads/voice/ai/retry-self-check.mp3",
      audioBytes: 4096,
      durationSeconds: 7,
      outputFormat: "mp3_44100_128",
      providerRequestId: "req_retry_self_check",
    }),
  });

  assert.equal(retried.id, failed.id, "retry should update the existing failed asset");
  assert.equal(retried.assetStatus, "ready");
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.providerRequestId, "req_retry_self_check");

  const [[countRow]] = await db.execute("SELECT COUNT(*) AS total FROM character_voice_assets WHERE message_id = ?", [MESSAGE_ID]);
  assert.equal(Number(countRow.total), 1, "retry should not create duplicate voice assets for one message");

  const skipped = await retryAiReplyVoiceAssetForDb(db, {
    messageId: MESSAGE_ID,
    generateAudio: async () => {
      throw new Error("should not run when asset is ready");
    },
  });
  assert.equal(skipped.skipped, true, "ready assets should not be regenerated");
  assert.equal(skipped.assetStatus, "ready");

  console.log("chat voice retry self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seedCharacter() {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'companion', NULL, NULL, ?, 'Voice Retry Check', 'Companion', 'Temporary voice retry check.',
       '', '', 'Hello.', 'Base persona.', 'Calm', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Nova', '/uploads/voice/presets/nova.mp3',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT('chatCountLabel', '0'), 'public', 'published', 'self-check', 'voice-retry', NOW(3))
     ON DUPLICATE KEY UPDATE
       voice_provider = VALUES(voice_provider),
       voice_id = VALUES(voice_id),
       character_status = 'published',
       updated_at = NOW(3)`,
    [CHARACTER_ID, CHARACTER_ID]
  );
}

async function seedMessage() {
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
     ) VALUES ('self_check_voice_retry_session', NULL, ?, 'Voice Retry Session', 'active', 'self-check', 'voice-retry', NOW(3))
     ON DUPLICATE KEY UPDATE last_message_at = NOW(3)`,
    [CHARACTER_ID]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       voice_asset_id, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, 'self_check_voice_retry_session', ?, 'character', 'Voice Retry Check', 'text',
       'Retry should update this message voice.', NULL, NULL, 10, 'sent', 'self-check', 'voice-retry', NOW(3))
     ON DUPLICATE KEY UPDATE voice_asset_id = NULL, updated_at = NOW(3)`,
    [MESSAGE_ID, CHARACTER_ID]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE id = ?", [MESSAGE_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = 'self_check_voice_retry_session'").catch(() => {});
  await db.execute("DELETE FROM character_voice_assets WHERE character_id = ?", [CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [CHARACTER_ID]).catch(() => {});
}
