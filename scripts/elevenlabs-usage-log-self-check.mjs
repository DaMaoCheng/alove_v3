import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import {
  createAiReplyVoiceAssetForDb,
  estimateElevenLabsCredits,
  getAiReplyVoiceUsageSummary,
  mapAiReplyVoiceAssetRow,
} from "../server/chat-voice-asset-service.js";

const db = getDbPool();
const CHARACTER_ID = "self_check_voice_usage_character";
const MESSAGE_ID = "self_check_voice_usage_message";

try {
  await initializeDatabase();
  await cleanup();
  await seedCharacter();

  assert.equal(estimateElevenLabsCredits({ characterCount: 42 }), 42, "credit estimate should default to one credit per character");
  assert.equal(estimateElevenLabsCredits({ characterCount: 42, multiplier: 2 }), 84, "credit estimate should support explicit model multipliers");
  assert.equal(estimateElevenLabsCredits({ model: "eleven_v4_turbo", characterCount: 42 }), 21, "Turbo estimate should use the official 0.5 multiplier");
  assert.equal(estimateElevenLabsCredits({ model: "eleven_v4_turbo", characterCount: 43 }), 22, "fractional credit estimates round up");
  assert.equal(estimateElevenLabsCredits({ model: "eleven_v3", characterCount: 42 }), 42, "historical v3 estimates stay unchanged");

  const asset = await createAiReplyVoiceAssetForDb(db, {
    messageId: MESSAGE_ID,
    characterId: CHARACTER_ID,
    userId: "self_check_user",
    speechText: "Usage records should be auditable.",
    voiceMeta: {
      provider: "elevenlabs",
      model: "eleven_v3",
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      languageCode: "en",
      languageLabel: "English",
    },
    generateAudio: async () => ({
      status: "ready",
      audioUrl: "/uploads/voice/ai/usage-self-check.mp3",
      audioBytes: 2048,
      durationSeconds: 5,
      outputFormat: "mp3_44100_128",
    }),
  });

  const [[row]] = await db.execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [asset.id]);
  const mapped = mapAiReplyVoiceAssetRow(row);
  assert.equal(mapped.estimatedCredits, mapped.characterCount);
  assert.equal(mapped.retryCount, 0);
  assert.equal(mapped.providerRequestId, "");
  assert.equal(mapped.providerErrorRaw, "");

  const summary = await getAiReplyVoiceUsageSummary(db, { characterId: CHARACTER_ID });
  assert.equal(summary.totalRequests, 1);
  assert.equal(summary.readyCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.estimatedCredits, mapped.estimatedCredits);
  assert.equal(summary.characterCount, mapped.characterCount);

  console.log("ElevenLabs usage log self-check passed");
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
     ) VALUES (?, 'companion', NULL, NULL, ?, 'Voice Usage Check', 'Companion', 'Temporary voice usage check.',
       '', '', 'Hello.', 'Base persona.', 'Calm', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Nova', '/uploads/voice/presets/nova.mp3',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT('chatCountLabel', '0'), 'public', 'published', 'self-check', 'voice-usage', NOW(3))
     ON DUPLICATE KEY UPDATE
       voice_provider = VALUES(voice_provider),
       voice_id = VALUES(voice_id),
       character_status = 'published',
       updated_at = NOW(3)`,
    [CHARACTER_ID, CHARACTER_ID]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM character_voice_assets WHERE character_id = ?", [CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [CHARACTER_ID]).catch(() => {});
}
