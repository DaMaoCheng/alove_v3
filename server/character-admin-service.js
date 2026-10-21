import { getDbPool } from "./db.js";
import { mapCharacterRow } from "./character-mapper.js";
import { createUniqueSlug, normalizeAdminCharacterPayload } from "./character-normalizers.js";
import { FULL_CHARACTER_SELECT } from "./character-sql.js";
import { generateCharacterShortBio } from "./character-short-bio-service.js";
import { deriveCharacterRoleTitle } from "./character-polish-service.js";
import { createId } from "./security.js";
import { isActiveCreatorOwnerConflict } from "./character-owner-constraint.js";

export async function getAdminCharacterDetail(characterId) {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) {
    throwNotFound();
  }

  const [rows] = await getDbPool().execute(
    `${FULL_CHARACTER_SELECT}
     WHERE c.id = ?
     LIMIT 1`,
    [normalizedId]
  );

  const row = rows[0] || null;
  if (!row) {
    throwNotFound();
  }

  return {
    ok: true,
    item: mapCharacterRow(row, { includeSettings: true }),
  };
}

export async function listAdminCharacters({ query = "", type = "" } = {}) {
  const whereParts = [];
  const params = [];
  const normalizedType = String(type || "").trim().toLowerCase();
  const normalizedQuery = String(query || "").trim();
  if (normalizedType === "common") {
    whereParts.push("c.category_id NOT IN ('creator', 'mascot')");
  } else if (normalizedType === "creator") {
    whereParts.push("c.category_id = 'creator'");
  } else if (normalizedType === "mascot") {
    whereParts.push("c.category_id = 'mascot'");
  }
  if (normalizedQuery) {
    const like = `%${normalizedQuery}%`;
    whereParts.push("(c.name LIKE ? OR c.id LIKE ? OR c.role_title LIKE ? OR c.short_bio LIKE ? OR cat.label LIKE ? OR u.nickname LIKE ? OR u.email LIKE ?)");
    params.push(like, like, like, like, like, like, like);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const [rows] = await getDbPool().execute(
    `${FULL_CHARACTER_SELECT}
     ${whereSql}
     ORDER BY c.updated_at DESC, c.created_at DESC`
    , params
  );

  return {
    ok: true,
    items: rows.map((row) => mapCharacterRow(row, { includeSettings: true })),
  };
}

export async function createAdminCharacter(adminUserId, payload = {}) {
  const id = createId("char");
  const fields = normalizeAdminCharacterPayload(payload, createAdminCharacterDefaults());
  if (fields.categoryId === "mascot") throwUserError("前台角色不能从这里创建");
  const creatorOwner = fields.categoryId === "creator" ? await resolveCreatorOwnerForAdminCharacter(fields.ownerUid) : null;
  if (creatorOwner) await assertCreatorHasNoActiveCharacter(creatorOwner.id);
  const roleTitle = fields.roleTitle || await deriveAdminCharacterRoleTitle(fields);
  const shortBio = await generateCharacterShortBio({
    name: fields.name,
    category: fields.categoryId,
    personality: fields.speakingStyle,
    voice: fields.voiceStyle,
    language: extractProfileLanguage(fields.profileJson),
    openingLine: fields.openingLine,
    backstory: fields.personaPrompt,
  });

  try {
    await getDbPool().execute(
      `INSERT INTO ai_characters (
         id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
         opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
         tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin-console', ${fields.characterStatus === "published" ? "CURRENT_TIMESTAMP(3)" : "NULL"})`,
      [
        id,
        fields.categoryId,
        creatorOwner?.id || normalizeNullableId(adminUserId),
        creatorOwner?.siteId || null,
        await createUniqueSlug(fields.name),
        fields.name,
        roleTitle,
        shortBio,
        fields.avatarUrl,
        fields.avatarUrl,
        fields.openingLine,
        fields.personaPrompt,
        fields.speakingStyle,
        fields.voiceProvider,
        fields.voiceId,
        fields.voiceStyle,
        fields.voiceSampleUrl,
        JSON.stringify(["admin-created", fields.categoryId].filter(Boolean)),
        fields.profileJson,
        JSON.stringify({ chatCountLabel: "0", ratingLabel: "New" }),
        fields.visibility,
        fields.characterStatus,
      ]
    );
  } catch (error) {
    if (isActiveCreatorOwnerConflict(error)) throwUserError("该创作者账号已绑定网红角色，只能绑定一个网红角色");
    throw error;
  }

  return getAdminCharacterDetail(id);
}

export async function updateAdminCharacterSettings(characterId, payload = {}) {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) {
    throwNotFound();
  }

  const current = await findAdminCharacterRow(normalizedId);
  const fields = normalizeAdminCharacterPayload(payload, current);
  if (current.category_id !== fields.categoryId && (current.category_id === "creator" || fields.categoryId === "creator")) {
    throwUserError("网红角色不能通过普通编辑变更角色分类");
  }
  const avatarChanged = String(fields.avatarUrl || "") !== String(current.avatar_url || "");
  const avatarTouched = normalizeBooleanFlag(payload.avatarTouched || payload.avatar_touched || payload.avatarChanged || payload.avatar_changed);
  const nextCoverUrl = avatarChanged || avatarTouched ? fields.avatarUrl : current.cover_url;
  const requestedOwnerUid = String(payload.ownerUid ?? payload.owner_uid ?? "").trim();
  if (current.category_id === "creator" && requestedOwnerUid && requestedOwnerUid !== String(current.owner_uid || "")) {
    throwUserError("网红角色创建后不能更换绑定账号");
  }
  const creatorOwner = await resolveCreatorOwnerForAdminUpdate({ current, fields });
  if (creatorOwner && fields.characterStatus !== "archived") {
    await assertCreatorHasNoActiveCharacter(creatorOwner.id, normalizedId);
  }
  let result;
  try {
    [result] = await getDbPool().execute(
      `UPDATE ai_characters
       SET
       name = ?,
       category_id = ?,
       owner_uid = ?,
       site_id = ?,
       role_title = ?,
       short_bio = ?,
       avatar_url = ?,
       cover_url = ?,
       opening_line = ?,
       persona_prompt = ?,
       speaking_style = ?,
       voice_provider = ?,
       voice_id = ?,
       voice_style = ?,
       voice_sample_url = ?,
       profile_json = ?,
       visibility = ?,
       character_status = ?,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?
     LIMIT 1`,
      [
        fields.name,
        fields.categoryId,
        fields.categoryId === "creator" ? creatorOwner?.id || current.owner_uid || null : current.owner_uid || null,
        fields.categoryId === "creator" ? creatorOwner?.siteId || current.site_id || null : fields.siteId,
        fields.roleTitle,
        fields.shortBio,
        fields.avatarUrl,
        nextCoverUrl,
        fields.openingLine,
        fields.personaPrompt,
        fields.speakingStyle,
        fields.voiceProvider,
        fields.voiceId,
        fields.voiceStyle,
        fields.voiceSampleUrl,
        fields.profileJson,
        fields.visibility,
        fields.characterStatus,
        normalizedId,
      ]
    );
  } catch (error) {
    if (isActiveCreatorOwnerConflict(error)) throwUserError("该创作者账号已绑定网红角色，只能绑定一个网红角色");
    throw error;
  }

  if (!result.affectedRows) {
    throwNotFound();
  }

  return getAdminCharacterDetail(normalizedId);
}

async function resolveCreatorOwnerForAdminUpdate({ current, fields }) {
  if (fields.categoryId !== "creator") return null;
  if (current.category_id === "creator" && fields.characterStatus === "archived") {
    return {
      id: current.owner_uid || "",
      siteId: current.site_id || "",
    };
  }
  const ownerUid = current.category_id === "creator" ? current.owner_uid : fields.ownerUid;
  return resolveCreatorOwnerForAdminCharacter(ownerUid);
}

async function findAdminCharacterRow(characterId) {
  const [rows] = await getDbPool().execute(
    `${FULL_CHARACTER_SELECT}
     WHERE c.id = ?
     LIMIT 1`,
    [characterId]
  );
  const row = rows[0] || null;
  if (!row) throwNotFound();
  return row;
}

async function resolveCreatorOwnerForAdminCharacter(ownerUid) {
  const normalizedOwnerUid = String(ownerUid || "").trim();
  if (!normalizedOwnerUid) throwUserError("网红角色必须绑定创作者账号");
  const [rows] = await getDbPool().execute(
    `SELECT u.id, u.site_id, s.name AS site_name
     FROM users u
     LEFT JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
     WHERE u.id = ?
       AND u.account_type = 'creator'
       AND u.account_status = 'active'
     LIMIT 1`,
    [normalizedOwnerUid]
  );
  const row = rows[0] || null;
  if (!row) throwUserError("请选择有效的创作者账号");
  if (!row.site_id) throwUserError("该创作者账号未绑定站点，不能创建网红角色");
  if (!row.site_name) throwUserError("该创作者账号绑定的站点不存在或已停用");
  return { id: row.id, siteId: row.site_id };
}

async function assertCreatorHasNoActiveCharacter(ownerUid, excludeCharacterId = "") {
  const excludeClause = excludeCharacterId ? "AND id <> ?" : "";
  const params = excludeCharacterId ? [ownerUid, excludeCharacterId] : [ownerUid];
  const [rows] = await getDbPool().execute(
    `SELECT id
     FROM ai_characters
     WHERE owner_uid = ?
       AND category_id = 'creator'
       AND character_status <> 'archived'
       ${excludeClause}
     LIMIT 1`,
    params
  );
  if (rows.length) throwUserError("该创作者账号已绑定网红角色，只能绑定一个网红角色");
}

async function deriveAdminCharacterRoleTitle(fields) {
  const fallback = [labelForAdminCategory(fields.categoryId), fields.speakingStyle].filter(Boolean).join(" · ") || "Football · Companion";
  const derived = await deriveCharacterRoleTitle({
    name: fields.name,
    category: labelForAdminCategory(fields.categoryId),
    personality: fields.speakingStyle,
    voice: fields.voiceStyle,
    language: extractProfileLanguage(fields.profileJson),
    openingLine: fields.openingLine,
    backstory: fields.personaPrompt,
  }).catch(() => null);
  return String(derived?.text || "").trim() || fallback;
}

function labelForAdminCategory(categoryId) {
  const labels = {
    football_babe: "Football Babe",
    creator: "Creator",
    pundit: "Pundit",
    fan: "Fan",
    companion: "Companion",
  };
  return labels[String(categoryId || "").trim()] || "Football Companion";
}

function createAdminCharacterDefaults() {
  return {
    site_id: null,
    role_title: "",
    short_bio: "",
    persona_prompt: "",
    profile_json: JSON.stringify({}),
    voice_provider: "system",
    voice_id: "",
    voice_sample_url: "",
  };
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1 || String(value || "").trim().toLowerCase() === "true" || String(value || "").trim() === "1";
}

function normalizeNullableId(value) {
  return String(value || "").trim() || null;
}

function throwUserError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function extractProfileLanguage(profileJson) {
  try {
    return JSON.parse(profileJson || "{}").language || "";
  } catch {
    return "";
  }
}

function throwNotFound() {
  const error = new Error("角色不存在");
  error.statusCode = 404;
  throw error;
}
