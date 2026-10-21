import assert from "node:assert/strict";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";
import { getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminMascotSettings, saveAdminSiteMascot } from "../server/admin-mascot-service.js";

const CHECK_SITE_ID = "site_admin_mascot_persona_check";
const CHECK_SITE_NAME = "Admin Mascot Persona Check";
const CHECK_SITE_SLUG = "admin-mascot-persona-check";
const CHECK_CHARACTER_ID = "mascot_admin_mascot_persona_check";
const LEGACY_TONE = "Legacy setting tone must remain untouched.";
const INITIAL_PERSONA = "Initial isolated mascot persona. Keep the relationship warm and helpful.";
const INITIAL_SPEAKING_STYLE = "Initial isolated speaking style: concise and friendly.";

await initializeDatabase();
const pool = getDbPool();

try {
  await resetCheckFixtures();
  await createCheckSite();

  await saveAdminSiteMascot(CHECK_SITE_ID, {
    characterId: CHECK_CHARACTER_ID,
    name: "Persona Check Mascot",
    avatarUrl: "",
    tone: LEGACY_TONE,
    personaPrompt: INITIAL_PERSONA,
    speakingStyle: INITIAL_SPEAKING_STYLE,
    greeting: "Initial isolated greeting.",
    cta: "",
    knowledge: [],
  });

  const initialCharacter = await readCharacter();
  assert.equal(initialCharacter.persona_prompt, INITIAL_PERSONA);
  assert.equal(initialCharacter.speaking_style, INITIAL_SPEAKING_STYLE);
  assert.equal(await readLegacyTone(), LEGACY_TONE, "initial legacy tone should remain stored for compatibility");

  await saveAdminSiteMascot(CHECK_SITE_ID, {
    characterId: CHECK_CHARACTER_ID,
    name: "Persona Check Mascot Renamed",
    avatarUrl: "",
    greeting: "Changed greeting without editing persona fields.",
    cta: "",
    knowledge: [],
  });
  const afterNonPersonaSave = await readCharacter();
  assert.equal(afterNonPersonaSave.persona_prompt, initialCharacter.persona_prompt, "non-persona save must not change persona_prompt");
  assert.equal(afterNonPersonaSave.speaking_style, initialCharacter.speaking_style, "non-persona save must not change speaking_style");
  assert.equal(afterNonPersonaSave.profile_json, initialCharacter.profile_json, "non-persona save must preserve profile_json byte-for-byte");
  assert.equal(await readLegacyTone(), LEGACY_TONE, "new payload without tone must not rewrite legacy tone");

  const updatedPersona = "Updated isolated mascot persona with an explicitly configured visitor relationship.";
  await saveAdminSiteMascot(CHECK_SITE_ID, {
    characterId: CHECK_CHARACTER_ID,
    name: "Persona Check Mascot Renamed",
    avatarUrl: "",
    personaPrompt: updatedPersona,
    greeting: "Changed greeting without editing persona fields.",
    cta: "",
    knowledge: [],
  });
  const afterPersonaSave = await readCharacter();
  assert.equal(afterPersonaSave.persona_prompt, updatedPersona, "explicit persona edit should update persona_prompt");
  assert.equal(afterPersonaSave.speaking_style, initialCharacter.speaking_style, "persona edit must not change speaking_style");
  assert.equal(afterPersonaSave.profile_json, initialCharacter.profile_json, "persona edit must not change profile_json");

  const updatedSpeakingStyle = "Updated isolated speaking style: playful, brief, and direct.";
  await saveAdminSiteMascot(CHECK_SITE_ID, {
    characterId: CHECK_CHARACTER_ID,
    name: "Persona Check Mascot Renamed",
    avatarUrl: "",
    speakingStyle: updatedSpeakingStyle,
    greeting: "Changed greeting without editing persona fields.",
    cta: "",
    knowledge: [],
  });
  const afterSpeakingSave = await readCharacter();
  assert.equal(afterSpeakingSave.persona_prompt, updatedPersona, "speaking-style edit must preserve persona_prompt");
  assert.equal(afterSpeakingSave.speaking_style, updatedSpeakingStyle, "explicit speaking-style edit should update speaking_style");
  assert.deepEqual(
    withoutStyle(parseJsonObject(afterSpeakingSave.profile_json)),
    withoutStyle(parseJsonObject(initialCharacter.profile_json)),
    "speaking-style edit must preserve every unrelated profile field"
  );
  assert.equal(parseJsonObject(afterSpeakingSave.profile_json).style, updatedSpeakingStyle, "profile style should align only with an explicit speaking-style edit");
  assert.equal(await readLegacyTone(), LEGACY_TONE, "explicit new fields must not rewrite legacy tone");

  const result = await listAdminMascotSettings();
  const site = result.sites.find((item) => item.id === CHECK_SITE_ID);
  assert.equal(site?.mascot?.personaPrompt, updatedPersona, "admin DTO should read persona from the character record");
  assert.equal(site?.mascot?.speakingStyle, updatedSpeakingStyle, "admin DTO should read speaking style from the character record");

  const prompt = buildChatReplyPrompt({
    character: {
      id: CHECK_CHARACTER_ID,
      name: "Persona Check Mascot Renamed",
      category_id: "mascot",
      persona_prompt: afterSpeakingSave.persona_prompt,
      speaking_style: afterSpeakingSave.speaking_style,
      profile_json: afterSpeakingSave.profile_json,
    },
    userText: "Hello",
  });
  assert.match(prompt.systemPrompt, new RegExp(updatedPersona), "chat prompt should read the saved persona_prompt");
  assert.match(prompt.systemPrompt, new RegExp(updatedSpeakingStyle), "chat prompt should read the saved speaking_style");
  assert.doesNotMatch(prompt.systemPrompt, new RegExp(LEGACY_TONE), "legacy mascot_settings.tone must not enter the chat prompt");

  console.log(JSON.stringify({ ok: true, checked: "isolated mascot persona and speaking-style write chain" }, null, 2));
} finally {
  await resetCheckFixtures();
  await pool.end();
}

async function readCharacter() {
  const [rows] = await pool.execute(
    "SELECT persona_prompt, speaking_style, CAST(profile_json AS CHAR) AS profile_json FROM ai_characters WHERE id = ? LIMIT 1",
    [CHECK_CHARACTER_ID]
  );
  assert.ok(rows[0], "isolated mascot character should exist");
  return rows[0];
}

async function readLegacyTone() {
  const [rows] = await pool.execute(
    "SELECT tone FROM mascot_settings WHERE site_id = ? AND setting_status = 'active' LIMIT 1",
    [CHECK_SITE_ID]
  );
  return rows[0]?.tone || "";
}

async function createCheckSite() {
  await pool.execute(
    `INSERT INTO sites (
       id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default,
       mascot_character_id, product_api_url, description
     ) VALUES (?, ?, ?, '', 'English', 'USD', 'UTC', 'active', 0, 'mascot_template', '', 'Temporary isolated mascot persona self-check site')`,
    [CHECK_SITE_ID, CHECK_SITE_NAME, CHECK_SITE_SLUG]
  );
}

async function resetCheckFixtures() {
  await pool.execute("DELETE FROM mascot_settings WHERE site_id = ? OR character_id = ?", [CHECK_SITE_ID, CHECK_CHARACTER_ID]).catch(() => null);
  await pool.execute("DELETE FROM knowledge_base_bindings WHERE target_id = ?", [CHECK_CHARACTER_ID]).catch(() => null);
  await pool.execute("DELETE FROM ai_characters WHERE id = ?", [CHECK_CHARACTER_ID]).catch(() => null);
  await pool.execute("DELETE FROM sites WHERE id = ?", [CHECK_SITE_ID]).catch(() => null);
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function withoutStyle(profile = {}) {
  const { style, ...rest } = profile;
  return rest;
}
