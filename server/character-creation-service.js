import { getDbPool, withTransaction } from "./db.js";
import { createId } from "./security.js";
import { createUniqueSlug, normalizeCreateCharacterPayload } from "./character-normalizers.js";
import { deriveCharacterRoleTitle } from "./character-polish-service.js";
import { generateCharacterShortBio } from "./character-short-bio-service.js";
import { getCharacterDetail } from "./character-public-service.js";
import { activateUserCharacterForDb } from "./character-activation-service.js";
import { isActiveCreatorOwnerConflict } from "./character-owner-constraint.js";

export async function createUserCharacter(userId, payload = {}) {
  const fields = normalizeCreateCharacterPayload(payload);
  const creator = await loadCharacterCreator(userId);
  validateCreateCharacterRules(fields, creator);
  const id = createId("char");
  const slug = await createUniqueSlug(fields.name);
  const fallbackRoleTitle = [fields.categoryLabel, fields.personality].filter(Boolean).join(" · ");
  const derivedRoleTitle = await deriveCharacterRoleTitle({
    name: fields.name,
    category: fields.categoryLabel,
    personality: fields.personality,
    voice: fields.voice,
    language: fields.language,
    openingLine: fields.openingLine,
    backstory: fields.backstory,
  }).catch(() => null);
  const roleTitle = String(derivedRoleTitle?.text || "").trim() || fallbackRoleTitle;
  const shortBio = await generateCharacterShortBio({
    name: fields.name,
    category: fields.categoryLabel,
    categoryLabel: fields.categoryLabel,
    personality: fields.personality,
    voice: fields.voice,
    language: fields.language,
    openingLine: fields.openingLine,
    backstory: fields.backstory,
  });

  try {
    await withTransaction(async (db) => {
      if (fields.categoryId === "creator" && creator.accountType === "creator") {
        await assertCreatorHasNoExistingCharacter(db, creator.id);
      }

      await db.execute(
        `INSERT INTO ai_characters (
           id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
           opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
           tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref,
           published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'user', 'create-page', CURRENT_TIMESTAMP(3))`,
        [
          id,
          fields.categoryId,
          userId,
          resolveCharacterSiteId(fields, creator),
          slug,
          fields.name,
          roleTitle,
          shortBio,
          fields.avatarUrl,
          fields.avatarUrl,
          fields.openingLine,
          buildCreatePersonaPrompt(fields),
          fields.personality,
          fields.voiceProvider,
          fields.voiceId,
          fields.voice,
          fields.voiceSampleUrl,
          JSON.stringify(["user-created", fields.categoryLabel, fields.personality].filter(Boolean)),
          fields.profileJson,
          JSON.stringify({
            chatCountLabel: "0",
            ratingLabel: "New",
          }),
          fields.visibility,
        ]
      );

      await activateUserCharacterForDb(db, {
        userId,
        characterId: id,
        sourceType: "create-page",
        sourceRef: fields.visibility,
      });
    });
  } catch (error) {
    if (isActiveCreatorOwnerConflict(error)) throwUserError("主播账号只能创建一个网红角色");
    throw error;
  }

  return getCharacterDetail(id, {
    userId,
    accountType: creator.accountType,
    siteSlug: creator.siteSlug,
  });
}

async function loadCharacterCreator(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throwUserError("未登录，请先登录", 401);
  }

  const [rows] = await getDbPool().execute(
    `SELECT u.id, u.account_type, u.site_id, s.slug AS site_slug
     FROM users u
     LEFT JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
     WHERE u.id = ? AND u.account_status = 'active'
     LIMIT 1`,
    [normalizedUserId]
  );
  const row = rows[0] || null;
  if (!row) throwUserError("账号不存在或不可用", 401);
  return {
    id: row.id,
    accountType: normalizeAccountType(row.account_type),
    siteId: row.site_id || "",
    siteSlug: row.site_slug || "",
  };
}

function validateCreateCharacterRules(fields, creator) {
  if (fields.categoryId !== "creator") return;
  if (creator.accountType === "admin") return;
  if (creator.accountType !== "creator") {
    throwUserError("普通用户不能创建网红角色");
  }
  if (!creator.siteId) {
    throwUserError("主播账号需要先绑定站点后才能创建网红角色");
  }
}

async function assertCreatorHasNoExistingCharacter(db, userId) {
  const [rows] = await db.execute(
    `SELECT id
     FROM ai_characters
     WHERE owner_uid = ?
       AND category_id = 'creator'
       AND character_status <> 'archived'
     LIMIT 1`,
    [userId]
  );
  if (rows.length) {
    throwUserError("主播账号只能创建一个网红角色");
  }
}

function resolveCharacterSiteId(fields, creator) {
  if (fields.categoryId !== "creator") return null;
  if (creator.accountType === "admin") return creator.siteId || null;
  return creator.siteId;
}

function buildCreatePersonaPrompt(fields) {
  return [
    fields.backstory,
    fields.language ? `Language guidance: Use ${fields.language} as the configured output language. Do not change output language just because the user's message is written in another language. Change language only when the user explicitly asks you to reply, speak, or write in a specific language.` : "",
  ].filter(Boolean).join("\n\n");
}

function normalizeAccountType(value = "personal") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["personal", "creator", "admin"].includes(normalized) ? normalized : "personal";
}

function throwUserError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
