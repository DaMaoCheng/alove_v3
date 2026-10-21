import { getDbPool } from "./db.js";
import { mapSiteRow } from "./admin-site-mapper.js";
import { throwNotFound } from "./admin-site-shared.js";
import {
  listGeoRegions,
  loadSiteRegionMap,
} from "./site-region-binding-service.js";

const SITE_SELECT_SQL = `
  SELECT s.*,
         COALESCE(ms.character_id, s.mascot_character_id) AS effective_mascot_character_id,
         m.name AS mascot_name,
         COALESCE(users.user_count, 0) AS user_count,
         COALESCE(creators.creator_count, 0) AS creator_count
  FROM sites s
  LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
  LEFT JOIN ai_characters m ON m.id = COALESCE(ms.character_id, s.mascot_character_id)
  LEFT JOIN (
    SELECT site_id, COUNT(*) AS user_count
    FROM users
    GROUP BY site_id
  ) users ON users.site_id = s.id
  LEFT JOIN (
    SELECT site_id, COUNT(*) AS creator_count
    FROM ai_characters
    WHERE category_id = 'creator'
    GROUP BY site_id
  ) creators ON creators.site_id = s.id
`;

export async function listAdminSites() {
  const [rows] = await getDbPool().execute(
    `${SITE_SELECT_SQL}
     ORDER BY s.is_default DESC, s.created_at ASC, s.name ASC`
  );
  const regionMap = await loadSiteRegionMap();
  const regions = await listGeoRegions();

  return {
    ok: true,
    items: rows.map((row) => mapSiteRow(row, regionMap.get(row.id) || [])),
    regions,
  };
}

export async function getAdminSite(siteId) {
  const [rows] = await getDbPool().execute(
    `${SITE_SELECT_SQL}
     WHERE s.id = ?
     LIMIT 1`,
    [siteId]
  );
  if (!rows[0]) throwNotFound();
  const regionMap = await loadSiteRegionMap([siteId]);
  return { ok: true, item: mapSiteRow(rows[0], regionMap.get(siteId) || []) };
}

export async function getExistingSite(siteId) {
  const [rows] = await getDbPool().execute(
    `SELECT id, is_default, site_logo_url, payment_methods_json, commerce_enabled, shopify_login_enabled, guest_chat_enabled,
            product_api_url, product_source_type, product_shop_domain, product_api_version
     FROM sites WHERE id = ? LIMIT 1`,
    [siteId]
  );
  if (!rows[0]) throwNotFound();
  return rows[0];
}
