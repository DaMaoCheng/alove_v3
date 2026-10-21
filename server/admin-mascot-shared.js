import { getDbPool } from "./db.js";
import { createId } from "./security.js";

const FRONT_DESK_PVC_VOICE_ID = "m98EUhgNJclFM2V0xXhQ";
const FRONT_DESK_PVC_LABEL = "ALOVE Front Desk PVC";
const FRONT_DESK_PVC_PROFILE = Object.freeze({
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

export async function getExistingSite(siteId) {
  const normalizedId = safeString(siteId);
  if (!normalizedId) throwNotFound("站点不存在");
  const [rows] = await getDbPool().execute("SELECT * FROM sites WHERE id = ? LIMIT 1", [normalizedId]);
  if (!rows[0]) throwNotFound("站点不存在");
  return rows[0];
}

export async function getExistingUnboundMascot(mascotId) {
  const normalizedId = normalizeId(mascotId);
  if (!normalizedId || normalizedId === "mascot_template") throwNotFound("前台不存在");
  const [rows] = await getDbPool().execute(
    `SELECT c.id
     FROM ai_characters c
     LEFT JOIN mascot_settings ms ON ms.character_id = c.id AND ms.setting_status = 'active'
     LEFT JOIN sites s ON s.mascot_character_id = c.id
     WHERE c.id = ?
       AND c.category_id = 'mascot'
       AND c.site_id IS NULL
       AND ms.character_id IS NULL
       AND s.mascot_character_id IS NULL
     LIMIT 1`,
    [normalizedId]
  );
  if (!rows[0]) throwNotFound("前台不存在或已绑定站点");
  return rows[0];
}

export function createSiteMascotId(site) {
  return normalizeId(`mascot_${site.slug || site.id.replace(/^site_/, "")}`);
}

export async function assertSiteCanCreateMascot(db, siteId) {
  const [rows] = await db.execute(
    `SELECT id, character_id
     FROM mascot_settings
     WHERE site_id = ?
       AND setting_status = 'active'
       AND character_id <> 'mascot_template'
     LIMIT 1`,
    [siteId]
  );
  if (rows[0]) throwUserError("该站点已有前台，请编辑现有前台");
}

export async function upsertMascotCharacter(db, fields = {}) {
  const { characterId, siteId, name, avatarUrl, tone, greeting, cta, knowledge } = fields;
  const [existingRows] = await db.execute(
    "SELECT persona_prompt, speaking_style, profile_json FROM ai_characters WHERE id = ? LIMIT 1",
    [characterId]
  );
  const existing = existingRows[0] || null;
  const personaPrompt = resolveMascotPersonaPrompt({ fields, existing, name, tone, greeting, cta, knowledge });
  const speakingStyle = resolveMascotSpeakingStyle({ fields, existing, tone });
  const profileJson = buildMascotProfileJson({
    tone: speakingStyle,
    existingProfile: existing?.profile_json,
    replaceStyle: Boolean(fields.hasSpeakingStyle) || !existing,
  });
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       card_tag, card_tag_text, opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style,
       voice_sample_url, tags_json, profile_json, metrics_json, visibility, character_status,
       source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, ?, ?, ?, 'Site Guide · Mascot', ?, ?, 'assets/banner_hero.png',
       'gold', 'Guide', ?, ?, ?, 'elevenlabs', ?, ?, NULL,
       CAST(? AS JSON), CAST(? AS JSON), JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', '5.0'),
       'public', 'published', 'admin', 'mascot-admin', NOW(3))
     ON DUPLICATE KEY UPDATE
       site_id = VALUES(site_id),
       category_id = VALUES(category_id),
       name = VALUES(name),
       short_bio = VALUES(short_bio),
       avatar_url = VALUES(avatar_url),
       opening_line = VALUES(opening_line),
       persona_prompt = IF(?, VALUES(persona_prompt), persona_prompt),
       speaking_style = IF(?, VALUES(speaking_style), speaking_style),
       voice_provider = VALUES(voice_provider),
       voice_id = VALUES(voice_id),
       voice_style = VALUES(voice_style),
       tags_json = VALUES(tags_json),
       profile_json = IF(?, VALUES(profile_json), profile_json),
       visibility = VALUES(visibility),
       character_status = VALUES(character_status),
       updated_at = CURRENT_TIMESTAMP(3)`,
    [
      characterId,
      siteId || null,
      normalizeSlug(characterId || name || "mascot"),
      name,
      `${name} is a site mascot for onboarding, promotions, and product guidance.`,
      avatarUrl || null,
      greeting,
      personaPrompt,
      speakingStyle,
      FRONT_DESK_PVC_VOICE_ID,
      FRONT_DESK_PVC_LABEL,
      JSON.stringify(["mascot", "guide"]),
      JSON.stringify(profileJson),
      fields.hasPersonaPrompt ? 1 : 0,
      fields.hasSpeakingStyle ? 1 : 0,
      fields.hasSpeakingStyle ? 1 : 0,
    ]
  );
}

export async function ensureMascotCategory(db) {
  await db.execute(
    `INSERT INTO character_categories (id, label, description, avatar_url, display_order, source_type, source_ref)
     VALUES ('mascot', 'Mascot', 'Site mascot characters managed from the mascot console.', 'assets/char_coach.png', 55, 'system', 'mascot-category')
     ON DUPLICATE KEY UPDATE
       label = VALUES(label),
       description = VALUES(description),
       avatar_url = VALUES(avatar_url),
       display_order = VALUES(display_order),
       is_active = 1,
      updated_at = CURRENT_TIMESTAMP(3)`
  );
  await backfillMascotCharacterCategory(db);
}

export async function replaceKnowledgeBindings(db, { targetType, targetId, knowledgeIds }) {
  const normalizedTargetType = normalizeKnowledgeBindingTargetType(targetType);
  const normalizedTargetId = safeString(targetId).slice(0, 64);
  if (!normalizedTargetType || !normalizedTargetId) return;
  const ids = Array.from(new Set((knowledgeIds || []).map((id) => safeString(id).slice(0, 64)).filter(Boolean)));
  await db.execute("DELETE FROM knowledge_base_bindings WHERE target_type = ? AND target_id = ?", [normalizedTargetType, normalizedTargetId]);
  await db.execute("DELETE FROM knowledge_base_bindings WHERE target_type = 'mascot' AND target_id = ?", [normalizedTargetId]);
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await db.execute(`SELECT id FROM knowledge_bases WHERE id IN (${placeholders})`, ids);
  const validIds = new Set(rows.map((row) => row.id));
  for (const knowledgeBaseId of ids.filter((id) => validIds.has(id))) {
    await db.execute(
      `INSERT IGNORE INTO knowledge_base_bindings (
         id, knowledge_base_id, target_type, target_id, binding_status
       ) VALUES (?, ?, ?, ?, 'active')`,
      [createId("kb_bind"), knowledgeBaseId, normalizedTargetType, normalizedTargetId]
    );
  }
}

function normalizeKnowledgeBindingTargetType(value) {
  const normalized = safeString(value).slice(0, 32);
  if (normalized === "mascot") return "character";
  return normalized;
}

export function normalizeMascotPayload(payload = {}, { fallbackCharacterId } = {}) {
  const name = safeString(payload.name).slice(0, 96);
  if (!name) throwUserError("前台名称不能为空");
  const characterId = normalizeId(payload.characterId || payload.character_id || fallbackCharacterId || `mascot_${name}`);
  if (!characterId) throwUserError("前台角色 ID 不能为空");
  return {
    characterId,
    name,
    avatarUrl: normalizeNullableText(payload.avatarUrl || payload.avatar_url, 512),
    tone: normalizeNullableText(payload.tone, 12000),
    hasTone: hasPayloadField(payload, ["tone"]),
    personaPrompt: normalizeNullableText(payload.personaPrompt ?? payload.persona_prompt, 12000),
    hasPersonaPrompt: hasPayloadField(payload, ["personaPrompt", "persona_prompt"]),
    speakingStyle: normalizeNullableText(payload.speakingStyle ?? payload.speaking_style, 12000),
    hasSpeakingStyle: hasPayloadField(payload, ["speakingStyle", "speaking_style"]),
    greeting: normalizeNullableText(payload.greeting, 512),
    cta: normalizeNullableText(payload.cta, 512),
    knowledge: normalizeKnowledge(payload.knowledge ?? payload.knowledgeText ?? payload.knowledge_text),
  };
}

export function safeString(value) {
  return String(value == null ? "" : value).trim();
}

export function normalizeId(value) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9_:-]/g, "_").replace(/_+/g, "_").slice(0, 64);
}

export function normalizeNullableText(value, maxLength) {
  const normalized = safeString(value).slice(0, maxLength);
  return normalized || null;
}

export function throwUserError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

export function throwNotFound(message) {
  const error = new Error(message || "数据不存在");
  error.statusCode = 404;
  throw error;
}

function normalizeKnowledge(value) {
  const items = Array.isArray(value) ? value : String(value == null ? "" : value).split(/[\n,，]/);
  return items.map((item) => safeString(item).slice(0, 128)).filter(Boolean).slice(0, 24);
}

async function backfillMascotCharacterCategory(db) {
  await db.execute("UPDATE ai_characters SET site_id = NULL, updated_at = CURRENT_TIMESTAMP(3) WHERE id = 'mascot_template'");
  await db.execute(
    `UPDATE sites s
     LEFT JOIN ai_characters c ON c.id = s.mascot_character_id
     SET s.mascot_character_id = 'mascot_template', s.updated_at = CURRENT_TIMESTAMP(3)
     WHERE s.mascot_character_id IS NOT NULL
       AND s.mascot_character_id <> 'mascot_template'
       AND c.id IS NULL`
  );
  await db.execute(
    `UPDATE ai_characters c
     LEFT JOIN mascot_settings ms ON ms.character_id = c.id
     LEFT JOIN sites s ON s.mascot_character_id = c.id
     SET c.category_id = 'mascot', c.updated_at = CURRENT_TIMESTAMP(3)
     WHERE (c.category_id IS NULL OR c.category_id <> 'mascot')
       AND (
         c.id IN ('mascot_template', 'mascot_global', 'mascot_latam')
         OR c.source_ref IN ('mascot-admin', 'mascot-seed')
         OR ms.character_id IS NOT NULL
         OR s.mascot_character_id IS NOT NULL
       )`
  );
}

function buildPersonaPrompt({ name, tone, greeting, knowledge }) {
  return [
    `${name} is the site mascot and user guide.`,
    tone ? `Tone: ${tone}.` : "",
    greeting ? `Default greeting: ${greeting}.` : "",
    knowledge?.length ? `Knowledge focus: ${knowledge.join("; ")}.` : "",
    "Promotion behavior: only mention products, offers, drops, discounts, recommendations, or site activities when the user naturally shows related interest. Keep it soft and optional, do not repeat fixed marketing copy, and do not push promotions during unrelated chat, emotional support, account help, or safety-sensitive topics.",
  ].filter(Boolean).join("\n");
}

function buildMascotProfileJson({ tone, existingProfile, replaceStyle = false } = {}) {
  // This stored value is only a safe fallback. New sessions for admin-managed
  // characters resolve their output language from the trusted active site.
  if (!existingProfile) {
    return {
      language: "English",
      languageCode: "en",
      languageLabel: "English",
      defaultLanguageCode: "en",
      defaultLanguageLabel: "English",
      languageFlashSupported: true,
      languageV3Supported: true,
      style: tone || "",
      voiceClone: FRONT_DESK_PVC_PROFILE,
    };
  }
  const currentProfile = parseJsonObject(existingProfile);
  const nextProfile = {
    ...currentProfile,
    ...(replaceStyle ? { style: tone || "" } : {}),
  };
  return nextProfile;
}

function resolveMascotPersonaPrompt({ fields, existing, name, tone, greeting, cta, knowledge }) {
  if (fields.hasPersonaPrompt && (existing || fields.personaPrompt)) return fields.personaPrompt || "";
  if (existing) return safeString(existing.persona_prompt);
  return buildPersonaPrompt({ name, tone, greeting, cta, knowledge });
}

function resolveMascotSpeakingStyle({ fields, existing, tone }) {
  if (fields.hasSpeakingStyle && (existing || fields.speakingStyle)) return fields.speakingStyle || "";
  if (existing) return safeString(existing.speaking_style);
  return tone || "";
}

function hasPayloadField(payload = {}, names = []) {
  return names.some((name) => Object.prototype.hasOwnProperty.call(payload, name));
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

function normalizeSlug(value) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 96) || `mascot-${Date.now()}`;
}
