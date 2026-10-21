import { PRODUCT_PREFERENCE_MEMORY_TYPES } from "./chat-memory-taxonomy.js";

export async function buildUserProductPreferenceFallback(db, {
  userId = "",
  characterId = "",
  limit = 20,
} = {}) {
  const normalizedUserId = safeString(userId);
  if (!normalizedUserId || !db?.execute) {
    return {
      query: "",
      reason: "no_user",
      excludeProductNames: [],
    };
  }

  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const [rows] = await db.execute(
    `SELECT memory_type, COALESCE(NULLIF(summary, ''), content) AS memory_value
     FROM user_memory_records
     WHERE internal_uid = ?
       AND memory_status = 'active'
       AND memory_type IN (${PRODUCT_PREFERENCE_MEMORY_TYPES.map(() => "?").join(", ")})
       AND (character_id IS NULL OR character_id = ?)
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY importance_score DESC, freshness_score DESC, updated_at DESC
     LIMIT ${safeLimit}`,
    [normalizedUserId, ...PRODUCT_PREFERENCE_MEMORY_TYPES, safeString(characterId)]
  );

  const grouped = groupMemoryValues(rows);
  const query = buildPreferenceQuery(grouped);
  return {
    query,
    reason: query ? "user_memory" : "no_preference",
    excludeProductNames: grouped.purchased_product || [],
  };
}

export function filterPurchasedProductDuplicates(products = [], excludeProductNames = []) {
  const excluded = new Set(
    (Array.isArray(excludeProductNames) ? excludeProductNames : [])
      .map(normalizeComparableText)
      .filter(Boolean)
  );
  if (!excluded.size) return Array.isArray(products) ? products : [];
  return (Array.isArray(products) ? products : []).filter((product) => {
    const name = normalizeComparableText(product?.name);
    return !name || !excluded.has(name);
  });
}

function groupMemoryValues(rows = []) {
  const grouped = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const type = safeString(row?.memory_type);
    const value = safeString(row?.memory_value);
    if (!PRODUCT_PREFERENCE_MEMORY_TYPES.includes(type) || !value) continue;
    if (!grouped[type]) grouped[type] = [];
    if (!grouped[type].includes(value)) grouped[type].push(value);
  }
  return grouped;
}

function buildPreferenceQuery(grouped = {}) {
  const favoriteClub = firstValue(grouped.favorite_club);
  if (favoriteClub) return `${favoriteClub} shirt`;
  const teamEntity = firstValue(grouped.favorite_team_entity);
  if (teamEntity) return `${teamEntity} shirt`;
  const favoritePlayer = firstValue(grouped.favorite_player);
  if (favoritePlayer) return `${favoritePlayer} jersey`;
  return "";
}

function firstValue(values = []) {
  return Array.isArray(values) ? safeString(values[0]) : "";
}

function normalizeComparableText(value = "") {
  return safeString(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
