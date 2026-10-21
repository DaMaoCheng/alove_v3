const MASCOT_CATEGORY_ID = "mascot";
const CREATOR_CATEGORY_ID = "creator";
const TEMPLATE_MASCOT_ID = "mascot_template";

export function canCharacterSendProductContext(character = {}) {
  const id = safeString(character.id);
  const categoryId = safeString(character.category_id || character.categoryId);
  return categoryId === MASCOT_CATEGORY_ID || categoryId === CREATOR_CATEGORY_ID || id === TEMPLATE_MASCOT_ID || id.startsWith("mascot_");
}

export async function resolveProductRecommendationSite(db, { character = {}, userId = "" } = {}) {
  const characterSiteId = safeString(character.site_id || character.siteId);
  if (canCharacterUseOwnProductSite(character) && characterSiteId) {
    const [siteRows] = await db.execute(
      `SELECT s.id, s.name, s.slug, s.currency, s.product_api_url, s.product_access_token_encrypted, s.payment_methods_json, s.commerce_enabled, COALESCE(ms.character_id, s.mascot_character_id) AS identity_mascot_character_id
       FROM sites s
       LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
       WHERE s.id = ?
         AND s.site_status = 'active'
       LIMIT 1`,
      [characterSiteId]
    );
    if (siteRows[0]) return siteRows[0];
  }

  const normalizedUserId = safeString(userId);
  if (normalizedUserId) {
    const [rows] = await db.execute(
      `SELECT s.id, s.name, s.slug, s.currency, s.product_api_url, s.product_access_token_encrypted, s.payment_methods_json, s.commerce_enabled, COALESCE(ms.character_id, s.mascot_character_id) AS identity_mascot_character_id
       FROM users u
       INNER JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
       LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
       WHERE u.id = ?
       LIMIT 1`,
      [normalizedUserId]
    );
    if (rows[0]) return rows[0];
  }

  const [defaultRows] = await db.execute(
    `SELECT s.id, s.name, s.slug, s.currency, s.product_api_url, s.product_access_token_encrypted, s.payment_methods_json, s.commerce_enabled, COALESCE(ms.character_id, s.mascot_character_id) AS identity_mascot_character_id
     FROM sites s
       LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.is_default = 1 AND s.site_status = 'active'
     ORDER BY s.updated_at DESC
     LIMIT 1`
  );
  return defaultRows[0] || null;
}

function canCharacterUseOwnProductSite(character = {}) {
  const id = safeString(character.id || character.characterId);
  const categoryId = safeString(character.category_id || character.categoryId);
  return categoryId === CREATOR_CATEGORY_ID || categoryId === MASCOT_CATEGORY_ID || id === TEMPLATE_MASCOT_ID || id.startsWith("mascot_");
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
