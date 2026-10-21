import { SERVER_CONFIG } from "./config.js";
import { getDbPool, withTransaction } from "./db.js";
import { createPublicError } from "./public-error-utils.js";

const CONTINENT_BY_COUNTRY = {
  CN: ["geo_asia", "AS", "亚洲", "Asia"],
  JP: ["geo_asia", "AS", "亚洲", "Asia"],
  KR: ["geo_asia", "AS", "亚洲", "Asia"],
  GB: ["geo_europe", "EU", "欧洲", "Europe"],
  DE: ["geo_europe", "EU", "欧洲", "Europe"],
  FR: ["geo_europe", "EU", "欧洲", "Europe"],
  ES: ["geo_europe", "EU", "欧洲", "Europe"],
  IT: ["geo_europe", "EU", "欧洲", "Europe"],
  US: ["geo_north_america", "NA", "北美洲", "North America"],
  CA: ["geo_north_america", "NA", "北美洲", "North America"],
  BR: ["geo_latin_america", "LATAM", "拉美", "Latin America"],
  MX: ["geo_latin_america", "LATAM", "拉美", "Latin America"],
  AR: ["geo_latin_america", "LATAM", "拉美", "Latin America"],
  CL: ["geo_latin_america", "LATAM", "拉美", "Latin America"],
};

const COUNTRY_ZH = {
  CN: "中国",
  JP: "日本",
  KR: "韩国",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  ES: "西班牙",
  IT: "意大利",
  US: "美国",
  CA: "加拿大",
  BR: "巴西",
  MX: "墨西哥",
  AR: "阿根廷",
  CL: "智利",
};

export async function searchAdminGeoRegions(query, { fetchImpl = fetch } = {}) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) throwUserError("请输入要搜索的地区");

  const localMatches = await searchLocalGeoRegions(normalizedQuery);
  if (localMatches.length) {
    return { ok: true, source: "local", items: localMatches, regions: await listAllGeoRegions() };
  }

  const remote = await searchRemoteGeoRegions(normalizedQuery, { fetchImpl });
  if (!remote.length) {
    return { ok: true, source: "remote", items: [], regions: await listAllGeoRegions(), message: "未找到匹配地区" };
  }

  const imported = [];
  await withTransaction(async (db) => {
    for (const item of remote.slice(0, 8)) {
      const normalized = normalizeRemotePlace(item);
      if (!normalized) continue;
      const saved = await upsertNormalizedPlace(db, normalized);
      if (saved) imported.push(saved);
    }
  });

  return {
    ok: true,
    source: "remote",
    items: dedupeRegions(imported),
    regions: await listAllGeoRegions(),
    message: imported.length ? "已更新地区库" : "未找到可用的标准地区",
  };
}

export async function searchLocalGeoRegions(query) {
  const normalizedQuery = normalizeQuery(query).toLowerCase();
  if (!normalizedQuery) return [];
  const [rows] = await getDbPool().execute(
    `SELECT id, parent_id, level, code, name_zh, name_en, aliases_json, display_order
     FROM geo_regions
     WHERE is_active = 1
       AND (
         LOWER(id) LIKE ?
         OR LOWER(code) LIKE ?
         OR LOWER(name_zh) LIKE ?
         OR LOWER(name_en) LIKE ?
         OR LOWER(CAST(aliases_json AS CHAR)) LIKE ?
       )
     ORDER BY display_order ASC, name_en ASC
     LIMIT 40`,
    Array(5).fill(`%${normalizedQuery}%`)
  );
  return rows.map(mapRegionRow);
}

export async function listAllGeoRegions() {
  const [rows] = await getDbPool().execute(
    `SELECT id, parent_id, level, code, name_zh, name_en, aliases_json, display_order
     FROM geo_regions
     WHERE is_active = 1
     ORDER BY display_order ASC, name_en ASC`
  );
  return rows.map(mapRegionRow);
}

async function searchRemoteGeoRegions(query, { fetchImpl = fetch } = {}) {
  if (SERVER_CONFIG.geoSearch.provider === "off") {
    throwUserError("在线地区搜索未启用");
  }
  if (SERVER_CONFIG.geoSearch.provider !== "nominatim") {
    throwUserError("在线地区搜索服务未配置");
  }

  const url = new URL(`${SERVER_CONFIG.geoSearch.baseUrl}/search`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("q", query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.geoSearch.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": SERVER_CONFIG.geoSearch.userAgent,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throwUserError(`在线地区搜索失败：HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error?.statusCode) throw error;
    if (error?.name === "AbortError") throwUserError("在线地区搜索超时，请稍后再试");
    throwUserError("在线地区搜索失败，请稍后再试");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRemotePlace(place = {}) {
  const address = place.address || {};
  const countryCode = String(address.country_code || "").trim().toUpperCase();
  if (!countryCode) return null;
  const continent = CONTINENT_BY_COUNTRY[countryCode];
  if (!continent) return null;

  const countryNameEn = safeString(address.country || place.name || countryCode);
  const countryNameZh = COUNTRY_ZH[countryCode] || countryNameEn;
  const cityName = safeString(address.city || address.town || address.village || address.municipality || address.state || "");
  const cityCode = cityName ? `${countryCode}-${slugCode(cityName).slice(0, 12).toUpperCase()}` : "";

  return {
    continent: {
      id: continent[0],
      code: continent[1],
      nameZh: continent[2],
      nameEn: continent[3],
    },
    country: {
      id: `geo_${countryCode.toLowerCase()}_country`,
      code: countryCode,
      nameZh: countryNameZh,
      nameEn: countryNameEn,
      aliases: [countryCode, countryNameEn, countryNameZh],
    },
    subdivision: cityName ? {
      id: `geo_${countryCode.toLowerCase()}_${slugCode(cityName)}`,
      code: cityCode,
      nameZh: cityName,
      nameEn: cityName,
      aliases: [cityName, String(place.display_name || "")].filter(Boolean),
    } : null,
  };
}

async function upsertNormalizedPlace(db, place) {
  await upsertRegion(db, {
    ...place.continent,
    parentId: null,
    level: "continent",
    displayOrder: displayOrderForLevel("continent", place.continent.code),
  });
  await upsertRegion(db, {
    ...place.country,
    parentId: place.continent.id,
    level: "country",
    displayOrder: displayOrderForLevel("country", place.country.code),
  });
  if (!place.subdivision) return await getRegionById(db, place.country.id);
  await upsertRegion(db, {
    ...place.subdivision,
    parentId: place.country.id,
    level: "subdivision",
    displayOrder: displayOrderForLevel("subdivision", place.subdivision.code),
  });
  return await getRegionById(db, place.subdivision.id);
}

async function upsertRegion(db, region) {
  await db.execute(
    `INSERT INTO geo_regions (id, parent_id, level, code, name_zh, name_en, aliases_json, display_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, 1)
     ON DUPLICATE KEY UPDATE
       parent_id = VALUES(parent_id),
       level = VALUES(level),
       name_zh = VALUES(name_zh),
       name_en = VALUES(name_en),
       aliases_json = VALUES(aliases_json),
       display_order = VALUES(display_order),
       is_active = 1,
       updated_at = CURRENT_TIMESTAMP(3)`,
    [
      region.id,
      region.parentId || null,
      region.level,
      region.code,
      region.nameZh,
      region.nameEn,
      JSON.stringify(region.aliases || [region.code, region.nameZh, region.nameEn].filter(Boolean)),
      region.displayOrder,
    ]
  );
}

async function getRegionById(db, id) {
  const [[row]] = await db.execute(
    `SELECT id, parent_id, level, code, name_zh, name_en, aliases_json, display_order
     FROM geo_regions
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [id]
  );
  return row ? mapRegionRow(row) : null;
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

function dedupeRegions(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function displayOrderForLevel(level, code) {
  const base = level === "continent" ? 1000 : level === "country" ? 100000 : 1000000;
  return base + Math.abs(hashCode(code || level)) % 800000;
}

function hashCode(value) {
  let hash = 0;
  for (const char of String(value || "")) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  return hash;
}

function slugCode(value) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || "region";
}

function normalizeQuery(value = "") {
  return safeString(value).replace(/\s+/g, " ").slice(0, 96);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(safeString).filter(Boolean);
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(safeString).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

function throwUserError(message) {
  throw createPublicError(message, 400);
}
