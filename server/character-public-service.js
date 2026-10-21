import { getDbPool } from "./db.js";
import { mapCharacterRow } from "./character-mapper.js";
import { FULL_CHARACTER_SELECT, PUBLIC_CHARACTER_SELECT } from "./character-sql.js";

const DEFAULT_SITE_SLUG = "gogoalshop";

export async function listPublicCharacters({ category = "", siteSlug = "" } = {}) {
  const normalizedCategory = String(category || "").trim();
  const site = await resolveActiveSite(siteSlug);
  const filters = [
    "c.visibility = 'public'",
    "c.character_status = 'published'",
    "(cat.id <> 'mascot' OR c.id = ?)",
    "(cat.id <> 'creator' OR c.site_id = ?)",
  ];
  const values = [site.mascotCharacterId, site.id];

  if (normalizedCategory) {
    filters.push("(cat.id = ? OR cat.label = ?)");
    values.push(normalizedCategory.toLowerCase(), normalizedCategory);
  }

  const [rows] = await getDbPool().execute(
    `${PUBLIC_CHARACTER_SELECT}
     WHERE ${filters.join(" AND ")}
     ORDER BY c.published_at DESC, c.created_at DESC`,
    values
  );

  const [categories] = await getDbPool().execute(
    `SELECT cat.id, cat.label, cat.avatar_url, cat.display_order
     FROM character_categories cat
     WHERE cat.is_active = 1
       AND cat.id <> 'mascot'
       AND (
         cat.id <> 'creator'
         OR EXISTS (
           SELECT 1
           FROM ai_characters creator_character
           WHERE creator_character.category_id = 'creator'
             AND creator_character.site_id = ?
             AND creator_character.visibility = 'public'
             AND creator_character.character_status = 'published'
           LIMIT 1
         )
       )
     ORDER BY cat.display_order ASC, cat.label ASC`,
    [site.id]
  );

  return {
    ok: true,
    categories: categories.map((row) => ({
      id: row.id,
      label: row.label,
      avatarUrl: row.avatar_url || "",
      displayOrder: Number(row.display_order || 0),
    })),
    items: rows.map((row) => mapCharacterRow(row)),
  };
}

export async function getCharacterDetail(characterId, { userId = "", siteSlug = "", accountType = "personal" } = {}) {
  const normalizedId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedAccountType = String(accountType || "personal").trim().toLowerCase();
  if (!normalizedId) {
    throwNotFound();
  }

  const site = await resolveActiveSite(siteSlug);
  const accessClause = normalizedUserId
    ? "AND (c.visibility = 'public' OR c.owner_uid = ?)"
    : "AND c.visibility = 'public'";
  const statusClause = normalizedUserId
    ? `AND (
         c.character_status = 'published'
         OR EXISTS (
           SELECT 1
           FROM user_character_activations a
           WHERE a.internal_uid = ?
             AND a.character_id = c.id
             AND a.activation_status = 'active'
           LIMIT 1
         )
       )`
    : "AND c.character_status = 'published'";
  const siteClause = normalizedAccountType === "admin"
    ? ""
    : "AND (cat.id <> 'creator' OR c.site_id = ?) AND (cat.id <> 'mascot' OR c.id = ?)";
  const values = normalizedUserId ? [normalizedId, normalizedUserId] : [normalizedId];
  if (siteClause) values.push(site.id, site.mascotCharacterId);
  if (normalizedUserId) values.push(normalizedUserId);
  const [rows] = await getDbPool().execute(
    `${FULL_CHARACTER_SELECT}
     WHERE c.id = ?
       ${accessClause}
       ${siteClause}
       ${statusClause}
     LIMIT 1`,
    values
  );

  const row = rows[0] || null;
  if (!row) {
    throwNotFound();
  }

  return {
    ok: true,
    item: mapCharacterRow(row),
  };
}

async function resolveActiveSite(siteSlug = "") {
  const normalizedSlug = normalizeSiteSlug(siteSlug) || DEFAULT_SITE_SLUG;
  const [rows] = await getDbPool().execute(
    `SELECT sites.id, sites.name, sites.slug,
            COALESCE(ms.character_id, sites.mascot_character_id, 'mascot_template') AS mascot_character_id
     FROM sites
     LEFT JOIN mascot_settings ms ON ms.site_id = sites.id AND ms.setting_status = 'active'
     WHERE sites.slug = ? AND sites.site_status = 'active'
     LIMIT 1`,
    [normalizedSlug]
  );
  if (rows[0]) return mapResolvedSite(rows[0]);

  const [defaultRows] = await getDbPool().execute(
    `SELECT sites.id, sites.name, sites.slug,
            COALESCE(ms.character_id, sites.mascot_character_id, 'mascot_template') AS mascot_character_id
     FROM sites
     LEFT JOIN mascot_settings ms ON ms.site_id = sites.id AND ms.setting_status = 'active'
     WHERE sites.is_default = 1 AND sites.site_status = 'active'
     ORDER BY sites.updated_at DESC
     LIMIT 1`
  );
  if (defaultRows[0]) return mapResolvedSite(defaultRows[0]);

  const error = new Error("站点暂不可用");
  error.statusCode = 400;
  throw error;
}

function normalizeSiteSlug(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
}

function mapResolvedSite(row = {}) {
  return {
    id: row.id || "",
    name: row.name || "",
    slug: row.slug || DEFAULT_SITE_SLUG,
    mascotCharacterId: row.mascot_character_id || "mascot_template",
  };
}

function throwNotFound() {
  const error = new Error("角色不存在");
  error.statusCode = 404;
  throw error;
}
