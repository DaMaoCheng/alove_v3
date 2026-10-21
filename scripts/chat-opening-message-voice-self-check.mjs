import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { ensureOpeningMessageWithVoiceForSession } from "../server/chat-opening-message-service.js";
import { listMessagesForSessionWithDb } from "../server/chat-message-store.js";

const db = getDbPool();
const USER_ID = "self_check_opening_voice_user";
const CHARACTER_ID = "self_check_opening_voice_character";
const SESSION_ID = "self_check_opening_voice_session";
const LOCALIZED_SESSION_ID = "self_check_opening_voice_localized_session";

try {
  await initializeDatabase();
  await cleanup();
  await seed();

  const opening = await ensureOpeningMessageWithVoiceForSession(db, {
    sessionId: SESSION_ID,
    character: {
      id: CHARACTER_ID,
      name: "Opening Voice Check",
      opening_line: "Hey, welcome in.",
      voice_provider: "elevenlabs",
      voice_id: "EXAVITQu4vr4xnSDxMaL",
      profile_json: JSON.stringify({
        defaultLanguageCode: "en",
        defaultLanguageLabel: "English",
      }),
    },
    userId: USER_ID,
    generateVoiceAudio: async ({ speechText, voiceMeta }) => {
      assert.equal(speechText, "Hey, welcome in.");
      assert.equal(voiceMeta.provider, "elevenlabs");
      assert.equal(voiceMeta.voiceId, "EXAVITQu4vr4xnSDxMaL");
      return {
        status: "ready",
        audioUrl: "/uploads/voice/ai/opening-self-check.mp3",
        audioBytes: 1234,
        durationSeconds: 2,
        outputFormat: "mp3_44100_128",
      };
    },
  });

  assert.ok(opening?.id, "opening message should be created");
  assert.ok(opening.voiceAssetId, "opening message should bind a voice asset");

  const messages = await listMessagesForSessionWithDb(db, SESSION_ID);
  assert.equal(messages.length, 1, "a mascot without ready greeting media must create only the text opening");
  assert.equal(messages[0].sourceRef, undefined, "mapped messages should not expose internal source refs");
  assert.equal(messages[0].text, "Hey, welcome in.");
  assert.equal(messages[0].voice?.assetStatus, "ready");
  assert.equal(messages[0].voice?.audioUrl, "/api/uploads/voice/ai/opening-self-check.mp3");
  assert.equal(
    messages.filter((message) => message.contentType === "mascot_greeting_image").length,
    0,
    "missing greeting materials must not create an empty media bubble"
  );

  const again = await ensureOpeningMessageWithVoiceForSession(db, {
    sessionId: SESSION_ID,
    character: {
      id: CHARACTER_ID,
      name: "Opening Voice Check",
      opening_line: "Hey, welcome in.",
      voice_provider: "elevenlabs",
      voice_id: "EXAVITQu4vr4xnSDxMaL",
    },
    userId: USER_ID,
    generateVoiceAudio: async () => {
      throw new Error("opening voice should not be generated twice");
    },
  });
  assert.equal(again.voiceAssetId, opening.voiceAssetId, "opening voice should not duplicate once bound");

  const localizedOpening = await ensureOpeningMessageWithVoiceForSession(db, {
    sessionId: LOCALIZED_SESSION_ID,
    character: {
      id: CHARACTER_ID,
      name: "Opening Voice Check",
      opening_line: "Hey, welcome in.",
      localized_content: {
        translations: {
          hu: { openingLine: "Szia, örülök, hogy itt vagy." },
        },
      },
      voice_provider: "elevenlabs",
      voice_id: "EXAVITQu4vr4xnSDxMaL",
    },
    userId: USER_ID,
    preferredLanguage: "Hungarian",
    generateVoiceAudio: async ({ speechText, voiceMeta }) => {
      assert.equal(speechText, "Szia, örülök, hogy itt vagy.", "opening voice must use the same persisted localized greeting");
      assert.equal(voiceMeta.languageCode, "hu", "opening voice must keep the session language");
      return {
        status: "ready",
        audioUrl: "/uploads/voice/ai/opening-self-check-hu.mp3",
        audioBytes: 1234,
        durationSeconds: 2,
        outputFormat: "mp3_44100_128",
      };
    },
  });
  assert.ok(localizedOpening?.id, "a localized opening message should be created");
  const localizedMessages = await listMessagesForSessionWithDb(db, LOCALIZED_SESSION_ID);
  assert.equal(localizedMessages[0]?.text, "Szia, örülök, hogy itt vagy.", "the visible guest opening must read from localized content");

  console.log("chat opening message voice self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_auth_provider, account_type, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, 'hash', 'Opening Voice User',
       'opening-voice@example.test', 'email', 'personal', NOW(3))`,
    [USER_ID, USER_ID, USER_ID]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, NULL, ?, 'Opening Voice Check', 'Mascot', 'Temporary opening voice check.',
       '', '', 'Hey, welcome in.', 'Base persona.', 'Friendly', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Nova', '',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', 'opening-voice', NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'Opening Voice Check conversation', 'active', 'user', 'self-check', NULL, NOW(3))`,
    [SESSION_ID, USER_ID, CHARACTER_ID]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'Opening Voice Check localized conversation', 'active', 'user', 'self-check', 'Hungarian', NOW(3))`,
    [LOCALIZED_SESSION_ID, USER_ID, CHARACTER_ID]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [LOCALIZED_SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM character_voice_assets WHERE character_id = ?", [CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [LOCALIZED_SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
}
