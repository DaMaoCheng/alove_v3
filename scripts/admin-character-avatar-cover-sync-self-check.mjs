import assert from "node:assert/strict";
import { getDbPool, closeDbPool, initializeDatabase } from "../server/db.js";
import { updateAdminCharacterSettings } from "../server/character-admin-service.js";

const CHARACTER_ID = "char_admin_avatar_cover_sync_check";
const SOURCE_REF = "admin-avatar-cover-sync-self-check";
const ORIGINAL_AVATAR = "assets/self-check-avatar-original.png";
const ORIGINAL_COVER = "assets/self-check-cover-original.png";
const UPDATED_AVATAR = "assets/self-check-avatar-updated.png";
const CUSTOM_COVER = "assets/self-check-cover-custom.png";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await seedCharacter();

  await updateAdminCharacterSettings(CHARACTER_ID, {
    name: "Avatar Cover Sync Check",
    category: "football_babe",
    roleTitle: "Self Check",
    shortBio: "Temporary character for avatar cover sync verification.",
    avatarUrl: UPDATED_AVATAR,
    openingLine: "Hello.",
    backstory: "Temporary admin character avatar sync check.",
    personality: "Friendly",
    voiceProvider: "system",
    voiceId: "bright_playful",
    voiceStyle: "Bright",
    visibility: "public",
    characterStatus: "published",
    language: "English",
  });

  let [[row]] = await db.execute(
    "SELECT avatar_url, cover_url FROM ai_characters WHERE id = ? LIMIT 1",
    [CHARACTER_ID]
  );
  assert.equal(row.avatar_url, UPDATED_AVATAR, "avatar_url should update to the saved avatar");
  assert.equal(row.cover_url, UPDATED_AVATAR, "cover_url should follow avatar_url when avatar changes");

  await db.execute(
    "UPDATE ai_characters SET cover_url = ? WHERE id = ? LIMIT 1",
    [ORIGINAL_COVER, CHARACTER_ID]
  );
  await updateAdminCharacterSettings(CHARACTER_ID, {
    name: "Avatar Cover Sync Check",
    category: "football_babe",
    roleTitle: "Self Check",
    shortBio: "Temporary character for avatar cover sync verification.",
    avatarUrl: UPDATED_AVATAR,
    avatarTouched: true,
    openingLine: "Hello.",
    backstory: "Temporary admin character avatar sync check.",
    personality: "Friendly",
    voiceProvider: "system",
    voiceId: "bright_playful",
    voiceStyle: "Bright",
    visibility: "public",
    characterStatus: "published",
    language: "English",
  });

  [[row]] = await db.execute(
    "SELECT avatar_url, cover_url FROM ai_characters WHERE id = ? LIMIT 1",
    [CHARACTER_ID]
  );
  assert.equal(row.avatar_url, UPDATED_AVATAR, "avatar_url should stay on the saved avatar when the avatar control is touched");
  assert.equal(row.cover_url, UPDATED_AVATAR, "cover_url should heal a stale cover when the avatar control is touched");

  await db.execute(
    "UPDATE ai_characters SET cover_url = ? WHERE id = ? LIMIT 1",
    [CUSTOM_COVER, CHARACTER_ID]
  );
  await updateAdminCharacterSettings(CHARACTER_ID, {
    name: "Avatar Cover Sync Check Renamed",
    category: "football_babe",
    roleTitle: "Self Check",
    shortBio: "Temporary character renamed for avatar cover sync verification.",
    avatarUrl: UPDATED_AVATAR,
    openingLine: "Hello again.",
    backstory: "Temporary admin character avatar sync check renamed.",
    personality: "Friendly",
    voiceProvider: "system",
    voiceId: "bright_playful",
    voiceStyle: "Bright",
    visibility: "public",
    characterStatus: "published",
    language: "English",
  });

  [[row]] = await db.execute(
    "SELECT avatar_url, cover_url FROM ai_characters WHERE id = ? LIMIT 1",
    [CHARACTER_ID]
  );
  assert.equal(row.avatar_url, UPDATED_AVATAR, "avatar_url should remain unchanged on non-avatar edits");
  assert.equal(row.cover_url, CUSTOM_COVER, "cover_url should not be overwritten by non-avatar edits");

  console.log(JSON.stringify({
    ok: true,
    checked: "admin character avatar changes sync cover_url, touched avatar edits heal stale cover_url, non-avatar edits preserve cover_url",
    cleanedUp: true,
  }, null, 2));
} finally {
  await cleanup().catch(() => {});
  await closeDbPool();
}

async function seedCharacter() {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio,
       avatar_url, cover_url, opening_line, persona_prompt, speaking_style,
       voice_provider, voice_id, voice_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'football_babe', NULL, NULL, ?, 'Avatar Cover Sync Check', 'Self Check',
       'Temporary character for avatar cover sync verification.', ?, ?, 'Hello.',
       'Temporary admin character avatar sync check.', 'Friendly', 'system', 'bright_playful',
       'Bright', JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English'),
       JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', 'New'), 'public', 'published',
       'self-check', ?, NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID, ORIGINAL_AVATAR, ORIGINAL_COVER, SOURCE_REF]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM ai_characters WHERE id = ? OR source_ref = ?", [CHARACTER_ID, SOURCE_REF]);
}
