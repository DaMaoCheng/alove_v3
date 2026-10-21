import { getDbPool } from "./db.js";
import {
  parseJsonArray,
  safeString,
  throwUserError,
} from "./admin-site-shared.js";

export async function listGeoRegions() {
  const [rows] = await getDbPool().execute(
    `SELECT id, parent_id, level, code, name_zh, name_en, aliases_json, display_order
     FROM geo_regions
     WHERE is_active = 1
     ORDER BY display_order ASC, name_en ASC`
  );
  return rows.map(mapRegionRow);
}

export async function loadSiteRegionMap(siteIds = []) {
  const ids = siteIds.map((id) => safeString(id)).filter(Boolean);
  const where = ids.length ? `WHERE sgr.site_id IN (${ids.map(() => "?").join(",")})` : "";
  const [rows] = await getDbPool().execute(
    `SELECT sgr.site_id, sgr.priority, r.id, r.parent_id, r.level, r.code, r.name_zh, r.name_en, r.aliases_json, r.display_order
     FROM site_geo_regions sgr
     INNER JOIN geo_regions r ON r.id = sgr.region_id AND r.is_active = 1
     ${where}
     ORDER BY sgr.priority ASC, r.display_order ASC, r.name_en ASC`,
    ids
  );
  const map = new Map();
  rows.forEach((row) => {
    const siteId = row.site_id || "";
    if (!map.has(siteId)) map.set(siteId, []);
    map.get(siteId).push(mapRegionRow(row));
  });
  return map;
}

export async function replaceSiteRegions(db, siteId, regionIds = []) {
  const normalizedSiteId = safeString(siteId);
  const ids = normalizeRegionIds(regionIds);
  await db.execute("DELETE FROM site_geo_regions WHERE site_id = ?", [normalizedSiteId]);
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const [regions] = await db.execute(`SELECT id FROM geo_regions WHERE id IN (${placeholders}) AND is_active = 1`, ids);
  const existingIds = new Set(regions.map((row) => row.id));
  if (existingIds.size !== ids.length) throwUserError("目标地区不存在或已停用");
  const [boundRows] = await db.execute(
    `SELECT region_id, site_id
     FROM site_geo_regions
     WHERE region_id IN (${placeholders}) AND site_id <> ?`,
    [...ids, normalizedSiteId]
  );
  if (boundRows[0]) throwUserError("目标地区已绑定到其他站点");
  const values = ids.flatMap((id, index) => [normalizedSiteId, id, index]);
  await db.execute(
    `INSERT INTO site_geo_regions (site_id, region_id, priority)
     VALUES ${ids.map(() => "(?, ?, ?)").join(", ")}`,
    values
  );
}

export function normalizeRegionIds(value) {
  const items = Array.isArray(value) ? value : String(value == null ? "" : value).split(/[\n,，]/);
  const seen = new Set();
  return items.map((item) => safeString(item).slice(0, 64)).filter(Boolean).filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  }).slice(0, 64);
}

function mapRegionRow(row) {
  return {
    id: row.id || "",
    parentId: row.parent_id || "",
    level: row.level || "",
    code: row.code || "",
    nameZh: row.name_zh || "",
    nameEn: row.name_en || "",
    aliases: parseJsonArray(row.aliases_json),
    displayOrder: Number(row.display_order || 0),
  };
}
