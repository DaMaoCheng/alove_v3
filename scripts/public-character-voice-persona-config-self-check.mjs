import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { getElevenLabsVoicePreset } from "../shared/voice-presets.js";

const daniVoice = getElevenLabsVoicePreset("rook");
assert.ok(daniVoice, "Rook preset should exist for Dani");

await initializeDatabase();
const db = getDbPool();

try {
  const scriptSource = readFileSync("scripts/apply-public-character-voice-persona-config.mjs", "utf8");
  assert.match(scriptSource, /DANI_ID = "fan"/, "config script should target Dani only by stable id");
  assert.match(scriptSource, /resetDaniActivatedLanguagePreferences/, "config script should reset already activated Dani language preferences");
  assert.match(scriptSource, /upsertPersonaLanguageSetting\(DANI_PERSONA, "English"\)/, "config script should apply the shared language guidance to Dani");
  assert.match(scriptSource, /applyMascotVoiceBinding/, "config script should bind the verified cloned voice to front desk mascots");
  assert.doesNotMatch(scriptSource, /elevenlabs_clone_pending/, "config script should no longer keep front desk mascots in pending cloned voice state");
  assert.match(scriptSource, /pvc_primary/, "config script should record the PVC primary slot mode");
  assert.match(scriptSource, /professional_voice_clone/, "config script should record the professional PVC slot type");
  assert.match(scriptSource, /m98EUhgNJclFM2V0xXhQ/, "config script should record the created front desk PVC voice id");
  assert.match(scriptSource, /category_id = 'creator'/, "config script should classify Dani as a creator character for product cards");
  assert.match(scriptSource, /FKK_PRODUCT_API = "shopify-admin:\/\/fbed87-94\.myshopify\.com"/, "config script should seed the real FKK Shopify Admin product source when the FKK API is empty");
  assert.doesNotMatch(scriptSource, /127\.0\.0\.1:4173\/api\/demo\/products/, "config script should not seed internal demo products into FKK");

  const [[dani]] = await db.execute(
    "SELECT category_id, site_id, voice_provider, voice_id, voice_style, voice_sample_url, persona_prompt, profile_json FROM ai_characters WHERE id = 'fan' LIMIT 1"
  );
  assert.equal(dani.category_id, "creator", "Dani should be classified as a creator character");
  assert.equal(dani.site_id, "site_fkk", "Dani should be bound to the FKK site");
  assert.equal(dani.voice_provider, "elevenlabs", "Dani should use ElevenLabs");
  assert.equal(dani.voice_id, daniVoice.voiceId, "Dani should use the selected male preset voice id");
  assert.equal(dani.voice_style, daniVoice.label, "Dani should show the app voice label");
  assert.equal(dani.voice_sample_url, daniVoice.sampleUrl, "Dani should have the preset preview audio");
  assert.match(dani.persona_prompt, /male football superfan/i, "Dani persona should be updated for a male superfan");
  assert.match(
    dani.persona_prompt,
    /Do not change output language just because the user's message is written in another language/i,
    "Dani persona should include the global output-language rule"
  );
  const daniProfile = parseJsonObject(dani.profile_json);
  assert.equal(daniProfile.defaultLanguageCode, "en", "Dani should have structured default language code");
  assert.equal(daniProfile.voicePreset, daniVoice.id, "Dani profile should record the selected voice preset");

  const [[template]] = await db.execute(
    "SELECT voice_provider, voice_id, voice_style, profile_json FROM ai_characters WHERE id = 'mascot_template' LIMIT 1"
  );
  assert.equal(template.voice_provider, "elevenlabs");
  assert.equal(template.voice_id, "m98EUhgNJclFM2V0xXhQ");
  assert.equal(template.voice_style, "ALOVE Front Desk PVC");
  const templateProfile = parseJsonObject(template.profile_json);
  assert.equal(templateProfile.voiceClone?.provider, "elevenlabs");
  assert.equal(templateProfile.voiceClone?.slot, "pvc_primary");
  assert.equal(templateProfile.voiceClone?.slotType, "professional_voice_clone");
  assert.equal(templateProfile.voiceClone?.cloneType, "professional");
  assert.equal(templateProfile.voiceClone?.status, "ready");
  assert.equal(templateProfile.voiceClone?.voiceId, "m98EUhgNJclFM2V0xXhQ");

  const [[fkk]] = await db.execute(
    `SELECT s.mascot_character_id, s.product_api_url, ms.character_id, c.name, c.voice_provider, c.profile_json
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     LEFT JOIN ai_characters c ON c.id = s.mascot_character_id
     WHERE s.id = 'site_fkk'
     LIMIT 1`
  );
  assert.equal(fkk.name, "Millie", "FKK should point to the real Millie character");
  assert.ok(fkk.product_api_url, "FKK should have a product API URL for front desk and creator product cards");
  assert.ok(fkk.mascot_character_id, "FKK should have a site-bound mascot character id");
  if (fkk.character_id) {
    assert.equal(fkk.mascot_character_id, fkk.character_id, "site and mascot setting should agree when an active setting exists");
  }
  assert.equal(fkk.voice_provider, "elevenlabs", "Millie should use the verified front desk PVC voice");
  assert.equal(parseJsonObject(fkk.profile_json).voiceClone?.status, "ready");
  assert.equal(parseJsonObject(fkk.profile_json).voiceClone?.slot, "pvc_primary");
  assert.equal(parseJsonObject(fkk.profile_json).voiceClone?.voiceId, "m98EUhgNJclFM2V0xXhQ");

  console.log("public character voice/persona config self-check passed");
} finally {
  await closeDbPool();
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
