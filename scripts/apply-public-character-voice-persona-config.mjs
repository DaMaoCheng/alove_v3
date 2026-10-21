import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { upsertPersonaLanguageSetting } from "../server/chat-language-preference-service.js";
import { getElevenLabsVoicePreset } from "../shared/voice-presets.js";

const DANI_ID = "fan";
const TEMPLATE_MASCOT_ID = "mascot_template";
const FKK_SITE_ID = "site_fkk";
const FKK_PRODUCT_API = "shopify-admin://fbed87-94.myshopify.com";
const MILLIE_NAME = "Millie";

const daniVoice = getElevenLabsVoicePreset("rook");
assert.ok(daniVoice, "Dani male voice preset should exist");

const DANI_PERSONA = `You are Dani Ultra, a male football superfan host with sharp matchday energy.

Core identity:
- You are a loud but friendly football supporter who lives for fixtures, derbies, chants, kits, transfers, rival banter, late winners, and post-match arguments.
- You speak like a quick, funny fan mate, not like a coach, journalist, or customer support bot.
- You can tease playfully, hype big moments, and challenge weak takes, but never become hateful, abusive, or discriminatory.
- You do not claim to know live scores, injuries, lineups, or confirmed transfers unless the system, trusted data, or the user provides them.

Conversation style:
- Keep replies short, punchy, and easy to hear as voice.
- Use natural football expressions like matchday, derby, away end, clean sheet, top bins, proper finish, bottled it, big-game energy, and full-time mood when they fit.
- Ask one simple follow-up when useful: club, player, fixture, prediction, kit style, or what the user wants to talk about next.
- If the user asks about products, kits, drops, or recommendations, respond like a fan giving a useful pick, not like an ad.

Boundaries:
- Banter is fine; hate, slurs, harassment, illegal streaming links, betting certainty, and unsafe advice are not.
- Do not pressure users to buy, recharge, or keep chatting.`;

const DANI_SPEAKING_STYLE = "Male football superfan voice: punchy, playful, warm, quick with banter, easy to hear aloud, never corporate.";
const FRONT_DESK_PVC_VOICE_ID = "m98EUhgNJclFM2V0xXhQ";
const FRONT_DESK_PVC_LABEL = "ALOVE Front Desk PVC";

const MASCOT_CLONE_PROFILE = Object.freeze({
  provider: "elevenlabs",
  cloneType: "professional",
  apiFamily: "pvc",
  slot: "pvc_primary",
  slotType: "professional_voice_clone",
  slotLimit: 1,
  status: "ready",
  voiceId: FRONT_DESK_PVC_VOICE_ID,
  sampleUrl: "",
  note: "Verified one-slot ElevenLabs professional voice clone for all front desk mascot voices.",
});

await initializeDatabase();
const pool = getDbPool();
const db = await pool.getConnection();

try {
  await db.beginTransaction();
  await applyDaniConfig(db);
  await resetDaniActivatedLanguagePreferences(db);
  await applyMascotVoiceBinding(db, TEMPLATE_MASCOT_ID);
  await fixMillieBindingAndVoice(db);
  await db.commit();

  await assertApplied(db);

  console.log(JSON.stringify({
    ok: true,
    updated: [
      { id: DANI_ID, voice: daniVoice.label, provider: daniVoice.provider, voiceId: daniVoice.voiceId, category: "creator", siteId: FKK_SITE_ID },
      { id: FKK_SITE_ID, productApiUrl: FKK_PRODUCT_API },
      { id: DANI_ID, activatedLanguagePreferences: "reset-to-character-config" },
      { id: TEMPLATE_MASCOT_ID, voiceCloneStatus: MASCOT_CLONE_PROFILE.status },
      { name: MILLIE_NAME, siteId: FKK_SITE_ID, voiceCloneStatus: MASCOT_CLONE_PROFILE.status },
    ],
  }, null, 2));
} catch (error) {
  await db.rollback().catch(() => {});
  throw error;
} finally {
  db.release();
  await closeDbPool();
}

async function applyDaniConfig(db) {
  const profile = await loadCharacterProfile(db, DANI_ID);
  const nextProfile = {
    ...profile,
    language: "English",
    languageCode: "en",
    languageLabel: "English",
    defaultLanguageCode: "en",
    defaultLanguageLabel: "English",
    languageFlashSupported: true,
    languageV3Supported: true,
    style: DANI_SPEAKING_STYLE,
    voicePreset: daniVoice.id,
    voiceProvider: daniVoice.provider,
    voiceId: daniVoice.voiceId,
  };

  const [result] = await db.execute(
    `UPDATE ai_characters
     SET role_title = ?,
         short_bio = ?,
         category_id = 'creator',
         site_id = ?,
         opening_line = ?,
         persona_prompt = ?,
         speaking_style = ?,
         voice_provider = ?,
         voice_id = ?,
         voice_style = ?,
         voice_sample_url = ?,
         profile_json = CAST(? AS JSON),
         updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [
      "Male Superfan · Hype",
      "Male football superfan built for chants, banter, predictions, and live-reaction match chat.",
      FKK_SITE_ID,
      "Right then, give me your club and your boldest matchday take.",
      buildDaniPersonaPrompt(),
      DANI_SPEAKING_STYLE,
      daniVoice.provider,
      daniVoice.voiceId,
      daniVoice.label,
      daniVoice.sampleUrl,
      JSON.stringify(nextProfile),
      DANI_ID,
    ]
  );
  assert.equal(result.affectedRows, 1, "Dani should exist and be updated");

  await db.execute(
    "UPDATE sites SET product_api_url = COALESCE(NULLIF(product_api_url, ''), ?), updated_at = NOW(3) WHERE id = ? LIMIT 1",
    [FKK_PRODUCT_API, FKK_SITE_ID]
  );
}

async function resetDaniActivatedLanguagePreferences(db) {
  await db.execute(
    `UPDATE user_character_activations
     SET preferred_language_code = NULL,
         preferred_language_label = NULL,
         updated_at = NOW(3)
     WHERE character_id = ?`,
    [DANI_ID]
  );
  await db.execute(
    `UPDATE chat_sessions
     SET preferred_language = NULL,
         updated_at = NOW(3)
     WHERE character_id = ?
       AND source_type = 'user'`,
    [DANI_ID]
  );
}

function buildDaniPersonaPrompt() {
  return upsertPersonaLanguageSetting(DANI_PERSONA, "English");
}

async function applyMascotVoiceBinding(db, characterId) {
  const profile = await loadCharacterProfile(db, characterId);
  const nextProfile = {
    ...profile,
    language: profile.language || "English",
    languageCode: profile.languageCode || "en",
    languageLabel: profile.languageLabel || "English",
    defaultLanguageCode: profile.defaultLanguageCode || "en",
    defaultLanguageLabel: profile.defaultLanguageLabel || "English",
    languageFlashSupported: true,
    languageV3Supported: true,
    voiceClone: MASCOT_CLONE_PROFILE,
  };
  await db.execute(
    `UPDATE ai_characters
     SET voice_provider = 'elevenlabs',
         voice_id = ?,
         voice_style = ?,
         voice_sample_url = NULL,
         profile_json = CAST(? AS JSON),
         updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [FRONT_DESK_PVC_VOICE_ID, FRONT_DESK_PVC_LABEL, JSON.stringify(nextProfile), characterId]
  );
}

async function fixMillieBindingAndVoice(db) {
  const [[millie]] = await db.execute(
    `SELECT id
     FROM ai_characters
     WHERE category_id = 'mascot'
       AND name = ?
       AND character_status = 'published'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [MILLIE_NAME]
  );
  assert.ok(millie?.id, "Millie mascot character should exist");

  await applyMascotVoiceBinding(db, millie.id);
  await db.execute(
    "UPDATE ai_characters SET site_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1",
    [FKK_SITE_ID, millie.id]
  );
  await db.execute(
    `UPDATE mascot_settings
     SET character_id = ?,
         source_type = 'admin',
         source_ref = 'voice-persona-config',
         setting_status = 'active',
         updated_at = NOW(3)
     WHERE site_id = ?
     LIMIT 1`,
    [millie.id, FKK_SITE_ID]
  );
  await db.execute(
    "UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1",
    [millie.id, FKK_SITE_ID]
  );
}

async function assertApplied(db) {
  const [[dani]] = await db.execute(
    "SELECT category_id, site_id, voice_provider, voice_id, voice_style, voice_sample_url, persona_prompt, profile_json FROM ai_characters WHERE id = ? LIMIT 1",
    [DANI_ID]
  );
  assert.equal(dani.category_id, "creator");
  assert.equal(dani.site_id, FKK_SITE_ID);
  assert.equal(dani.voice_provider, "elevenlabs");
  assert.equal(dani.voice_id, daniVoice.voiceId);
  assert.equal(dani.voice_style, daniVoice.label);
  assert.equal(dani.voice_sample_url, daniVoice.sampleUrl);
  assert.match(dani.persona_prompt, /male football superfan/i);
  assert.match(dani.persona_prompt, /Do not change output language just because the user's message is written in another language/i);

  const [[languagePrefs]] = await db.execute(
    `SELECT
       SUM(CASE WHEN preferred_language IS NOT NULL AND preferred_language <> '' THEN 1 ELSE 0 END) AS session_count,
       (
         SELECT COUNT(*)
         FROM user_character_activations
         WHERE character_id = ?
           AND (
             preferred_language_code IS NOT NULL
             OR preferred_language_label IS NOT NULL
           )
       ) AS activation_count
     FROM chat_sessions
     WHERE character_id = ?
       AND source_type = 'user'`,
    [DANI_ID, DANI_ID]
  );
  assert.equal(Number(languagePrefs.session_count || 0), 0, "Dani user sessions should not carry stale language preferences");
  assert.equal(Number(languagePrefs.activation_count || 0), 0, "Dani activations should not carry stale language preferences");

  const [[fkkProductSite]] = await db.execute(
    "SELECT product_api_url FROM sites WHERE id = ? LIMIT 1",
    [FKK_SITE_ID]
  );
  assert.ok(fkkProductSite.product_api_url, "FKK site should have product API URL for product card tests");

  const [[template]] = await db.execute(
    "SELECT voice_provider, voice_id, profile_json FROM ai_characters WHERE id = ? LIMIT 1",
    [TEMPLATE_MASCOT_ID]
  );
  assert.equal(template.voice_provider, "elevenlabs");
  assert.equal(template.voice_id, FRONT_DESK_PVC_VOICE_ID);
  assert.equal(parseJsonObject(template.profile_json).voiceClone?.status, "ready");
  assert.equal(parseJsonObject(template.profile_json).voiceClone?.slot, "pvc_primary");
  assert.equal(parseJsonObject(template.profile_json).voiceClone?.voiceId, FRONT_DESK_PVC_VOICE_ID);

  const [[site]] = await db.execute(
    `SELECT s.mascot_character_id, ms.character_id, c.name, c.voice_provider, c.profile_json
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     LEFT JOIN ai_characters c ON c.id = s.mascot_character_id
     WHERE s.id = ?
     LIMIT 1`,
    [FKK_SITE_ID]
  );
  assert.equal(site.name, MILLIE_NAME);
  if (site.character_id) {
    assert.equal(site.mascot_character_id, site.character_id);
  }
  assert.equal(site.voice_provider, "elevenlabs");
  assert.equal(parseJsonObject(site.profile_json).voiceClone?.status, "ready");
  assert.equal(parseJsonObject(site.profile_json).voiceClone?.slot, "pvc_primary");
  assert.equal(parseJsonObject(site.profile_json).voiceClone?.voiceId, FRONT_DESK_PVC_VOICE_ID);
}

async function loadCharacterProfile(db, characterId) {
  const [[row]] = await db.execute("SELECT profile_json FROM ai_characters WHERE id = ? LIMIT 1", [characterId]);
  assert.ok(row, `character should exist: ${characterId}`);
  return parseJsonObject(row.profile_json);
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
