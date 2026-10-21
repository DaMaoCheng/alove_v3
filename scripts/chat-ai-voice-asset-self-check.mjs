import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import {
  createAiReplyVoiceAssetForDb,
  mapAiReplyVoiceAssetRow,
} from "../server/chat-voice-asset-service.js";

const db = getDbPool();
const CHARACTER_ID = "self_check_ai_voice_character";
const MESSAGE_ID = "self_check_ai_voice_message";

try {
  await initializeDatabase();
  await cleanup();
  await seedCharacter();

  const ready = await createAiReplyVoiceAssetForDb(db, {
    messageId: MESSAGE_ID,
    characterId: CHARACTER_ID,
    userId: "self_check_user",
    speechText: "That kit has proper matchday energy.",
    voiceMeta: {
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      languageCode: "en",
      languageLabel: "English",
    },
    generateAudio: async () => ({
      status: "ready",
      audioUrl: "/uploads/voice/ai/self-check.mp3",
      audioBytes: 12345,
      durationSeconds: 6,
      outputFormat: "mp3_44100_128",
    }),
  });

  assert.equal(ready.assetStatus, "ready");
  assert.equal(ready.audioUrl, "/api/uploads/voice/ai/self-check.mp3");
  assert.equal(ready.provider, "elevenlabs");
  assert.equal(ready.model, "eleven_v3");
  assert.equal(ready.voiceId, "EXAVITQu4vr4xnSDxMaL");
  assert.equal(ready.languageCode, "en");
  assert.equal(ready.characterCount, 36);
  assert.equal(ready.audioBytes, 12345);

  const [[readyRow]] = await db.execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [ready.id]);
  const mappedReady = mapAiReplyVoiceAssetRow(readyRow);
  assert.equal(mappedReady.assetStatus, "ready");
  assert.equal(mappedReady.audioUrl, ready.audioUrl);
  assert.equal(mappedReady.messageId, MESSAGE_ID);

  const flashReady = await createAiReplyVoiceAssetForDb(db, {
    messageId: `${MESSAGE_ID}_flash`,
    characterId: CHARACTER_ID,
    userId: "self_check_user",
    speechText: "Fast call voice asset.",
    voiceMeta: {
      provider: "elevenlabs",
      model: "eleven_flash_v2_5",
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      languageCode: "en",
      languageLabel: "English",
    },
    generateAudio: async () => ({
      status: "ready",
      audioUrl: "/uploads/voice/ai/self-check-flash.mp3",
      audioBytes: 5678,
      durationSeconds: 3,
      outputFormat: "mp3_44100_128",
    }),
  });
  assert.equal(flashReady.model, "eleven_flash_v2_5", "voice asset should preserve explicit Flash model");

  const [[flashReadyRow]] = await db.execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [flashReady.id]);
  assert.equal(mapAiReplyVoiceAssetRow(flashReadyRow).model, "eleven_flash_v2_5", "DB row should preserve explicit Flash model");

  const failed = await createAiReplyVoiceAssetForDb(db, {
    messageId: `${MESSAGE_ID}_failed`,
    characterId: CHARACTER_ID,
    userId: "self_check_user",
    speechText: "This should still create a failed asset record.",
    voiceMeta: {
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      languageCode: "en",
      languageLabel: "English",
    },
    generateAudio: async () => {
      throw new Error("mock tts failure");
    },
  });

  assert.equal(failed.assetStatus, "failed");
  assert.equal(failed.audioUrl, "");
  assert.match(failed.errorMessage, /mock tts failure/);

  console.log("chat AI voice asset self-check passed");
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
     ) VALUES (?, 'companion', NULL, NULL, ?, 'AI Voice Asset Check', 'Companion', 'Temporary AI voice asset check.',
       '', '', 'Hello.', 'Base persona.', 'Calm', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Nova', '/uploads/voice/presets/nova.mp3',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT('chatCountLabel', '0'), 'public', 'published', 'self-check', 'ai-voice-asset', NOW(3))
     ON DUPLICATE KEY UPDATE
       voice_provider = VALUES(voice_provider),
       voice_id = VALUES(voice_id),
       character_status = 'published',
       updated_at = NOW(3)`,
    [CHARACTER_ID, CHARACTER_ID]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE id IN (?, ?, ?)", [MESSAGE_ID, `${MESSAGE_ID}_flash`, `${MESSAGE_ID}_failed`]).catch(() => {});
  await db.execute("DELETE FROM character_voice_assets WHERE character_id = ?", [CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [CHARACTER_ID]).catch(() => {});
}
