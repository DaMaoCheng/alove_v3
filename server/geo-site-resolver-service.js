import { SERVER_CONFIG } from "./config.js";
import { getDbPool } from "./db.js";
import { mapPublicSiteBranding } from "./site-branding-service.js";

const CONTINENT_BY_COUNTRY = Object.freeze({
  CN: "geo_asia",
  JP: "geo_asia",
  KR: "geo_asia",
  SG: "geo_asia",
  TH: "geo_asia",
  VN: "geo_asia",
  PH: "geo_asia",
  MY: "geo_asia",
  ID: "geo_asia",
  IN: "geo_asia",
  GB: "geo_europe",
  IE: "geo_europe",
  DE: "geo_europe",
  FR: "geo_europe",
  ES: "geo_europe",
  IT: "geo_europe",
  NL: "geo_europe",
  PT: "geo_europe",
  US: "geo_north_america",
  CA: "geo_north_america",
  BR: "geo_latin_america",
  MX: "geo_latin_america",
  AR: "geo_latin_america",
  CL: "geo_latin_america",
  CO: "geo_latin_america",
  PE: "geo_latin_america",
});

export async function resolveSiteForRequest(req, { fetchImpl = fetch } = {}) {
  const ip = getClientIp(req);
  const location = await lookupIpLocation(ip, { req, fetchImpl }).catch(() => null);
  return resolveSiteForIpLocation(location || {});
}

export async function resolveSiteForIpLocation(location = {}) {
  const defaultSite = await getDefaultSite();
  const candidates = await buildRegionCandidates(location);
  if (!candidates.length) {
    return buildResolution(defaultSite, { matchLevel: "default", regionId: "", location });
  }

  const placeholders = candidates.map(() => "?").join(",");
  const [rows] = await getDbPool().execute(
    `SELECT sgr.region_id, s.id, s.name, s.slug, s.site_url, s.site_logo_url, s.default_language,
            s.product_access_token_encrypted, s.shopify_login_enabled, s.is_default
     FROM site_geo_regions sgr
     INNER JOIN sites s ON s.id = sgr.site_id AND s.site_status = 'active'
     WHERE sgr.region_id IN (${placeholders})`,
    candidates.map((item) => item.regionId)
  );
  const siteByRegion = new Map(rows.map((row) => [row.region_id, row]));
  for (const candidate of candidates) {
    const site = siteByRegion.get(candidate.regionId);
    if (site) return buildResolution(site, { ...candidate, location });
  }

  return buildResolution(defaultSite, { matchLevel: "default", regionId: "", location });
}

async function lookupIpLocation(ip, { req = null, fetchImpl = fetch } = {}) {
  const providers = SERVER_CONFIG.geoIp.providers.length ? SERVER_CONFIG.geoIp.providers : [SERVER_CONFIG.geoIp.provider];
  if (providers.includes("off")) return null;

  for (const provider of providers) {
    if (provider === "cloudflare") {
      const location = locationFromCloudflareHeaders(req);
      if (location) return { ...location, ip: ip || "" };
      continue;
    }
    if (!ip || isPrivateIp(ip)) continue;

    const location = await lookupIpLocationWithProvider(provider, ip, { fetchImpl }).catch(() => null);
    if (location?.countryCode) return location;
  }

  return null;
}

async function lookupIpLocationWithProvider(provider, ip, { fetchImpl = fetch } = {}) {
  const normalizedProvider = safeString(provider).toLowerCase();
  const url = buildGeoIpUrl(normalizedProvider, ip);
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.geoIp.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return normalizeProviderLocation(normalizedProvider, ip, data);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGeoIpUrl(provider, ip) {
  if (provider === "ipapi") return new URL(`${SERVER_CONFIG.geoIp.baseUrl}/${encodeURIComponent(ip)}/json/`);
  if (provider === "ipwhois" || provider === "ipwho.is") return new URL(`${SERVER_CONFIG.geoIp.ipwhoisBaseUrl}/${encodeURIComponent(ip)}`);
  if (provider === "ip-api" || provider === "ipapi-com") return new URL(`${SERVER_CONFIG.geoIp.ipApiBaseUrl}/json/${encodeURIComponent(ip)}?fields=status,countryCode,regionName,city,query,message`);
  return null;
}

function normalizeProviderLocation(provider, ip, data = {}) {
  if (provider === "ipapi") {
    return normalizeLocation({
      ip,
      countryCode: data.country_code,
      subdivision: data.region || data.city || "",
      city: data.city || "",
      source: provider,
    });
  }
  if (provider === "ipwhois" || provider === "ipwho.is") {
    if (data.success === false) return null;
    return normalizeLocation({
      ip,
      countryCode: data.country_code,
      subdivision: data.region || data.city || "",
      city: data.city || "",
      source: "ipwhois",
    });
  }
  if (provider === "ip-api" || provider === "ipapi-com") {
    if (data.status && data.status !== "success") return null;
    return normalizeLocation({
      ip,
      countryCode: data.countryCode,
      subdivision: data.regionName || data.city || "",
      city: data.city || "",
      source: "ip-api",
    });
  }
  return null;
}

function locationFromCloudflareHeaders(req) {
  const countryCode = safeString(req?.headers?.["cf-ipcountry"]).toUpperCase();
  if (!countryCode || countryCode === "XX" || countryCode === "T1") return null;
  return normalizeLocation({
    countryCode,
    subdivision: safeString(req?.headers?.["cf-region"] || req?.headers?.["cf-ipcity"]),
    city: safeString(req?.headers?.["cf-ipcity"]),
    source: "cloudflare",
  });
}

function normalizeLocation(location) {
  const countryCode = safeString(location.countryCode || location.country_code).toUpperCase();
  if (!countryCode) return null;
  return {
    ip: safeString(location.ip),
    countryCode,
    subdivision: safeString(location.subdivision || location.region || location.city),
    city: safeString(location.city),
    source: safeString(location.source),
  };
}

async function buildRegionCandidates(location = {}) {
  const countryCode = safeString(location.countryCode || location.country_code).toUpperCase();
  if (!countryCode) return [];

  const candidates = [];
  const subdivisionName = safeString(location.subdivision || location.region || location.city);
  const subdivisionRegion = subdivisionName ? await findSubdivisionRegion(countryCode, subdivisionName) : null;
  if (subdivisionRegion) candidates.push({ regionId: subdivisionRegion.id, matchLevel: "subdivision" });

  const countryRegion = await findCountryRegion(countryCode);
  if (countryRegion) candidates.push({ regionId: countryRegion.id, matchLevel: "country" });

  const continentId = countryRegion?.parent_id || CONTINENT_BY_COUNTRY[countryCode] || "";
  if (continentId) candidates.push({ regionId: continentId, matchLevel: "continent" });

  const seen = new Set();
  return candidates.filter((item) => {
    if (!item.regionId || seen.has(item.regionId)) return false;
    seen.add(item.regionId);
    return true;
  });
}

async function findCountryRegion(countryCode) {
  const [[row]] = await getDbPool().execute(
    `SELECT id, parent_id
     FROM geo_regions
     WHERE is_active = 1 AND level = 'country' AND UPPER(code) = ?
     LIMIT 1`,
    [countryCode]
  );
  return row || null;
}

async function findSubdivisionRegion(countryCode, subdivisionName) {
  const normalizedName = safeString(subdivisionName).toLowerCase();
  if (!normalizedName) return null;
  const [rows] = await getDbPool().execute(
    `SELECT r.id, r.parent_id, r.name_zh, r.name_en, r.aliases_json
     FROM geo_regions r
     INNER JOIN geo_regions c ON c.id = r.parent_id AND c.level = 'country' AND UPPER(c.code) = ?
     WHERE r.is_active = 1 AND r.level = 'subdivision'
     ORDER BY r.display_order ASC, r.name_en ASC`,
    [countryCode]
  );
  return rows.find((row) => regionMatchesName(row, normalizedName)) || null;
}

function regionMatchesName(row, normalizedName) {
  const values = [row.name_zh, row.name_en, ...parseJsonArray(row.aliases_json)];
  return values.some((value) => {
    const normalized = safeString(value).toLowerCase();
    return normalized && (normalized === normalizedName || normalized.includes(normalizedName) || normalizedName.includes(normalized));
  });
}

async function getDefaultSite() {
  const [[row]] = await getDbPool().execute(
    `SELECT id, name, slug, site_url, site_logo_url, default_language,
            product_access_token_encrypted, shopify_login_enabled, is_default
     FROM sites
     WHERE site_status = 'active'
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`
  );
  if (row) return row;
  return { id: "", name: "", slug: "gogoalshop", is_default: 1 };
}

function buildResolution(site, { matchLevel, regionId, location } = {}) {
  const branding = mapPublicSiteBranding(site) || {};
  return {
    ok: true,
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "gogoalshop",
    siteUrl: branding.siteUrl || "",
    logoUrl: branding.logoUrl || "",
    language: branding.language,
    hasProductAccessToken: branding.hasProductAccessToken === true,
    shopifyLoginEnabled: branding.shopifyLoginEnabled !== false,
    regionId: regionId || "",
    matchLevel: matchLevel || "default",
    location: {
      countryCode: safeString(location?.countryCode || location?.country_code).toUpperCase(),
      subdivision: safeString(location?.subdivision || location?.region),
      city: safeString(location?.city),
      source: safeString(location?.source),
    },
  };
}

function getClientIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").trim();
  const raw = forwarded ? forwarded.split(",")[0].trim() : String(req?.socket?.remoteAddress || "").trim();
  return raw.replace(/^::ffff:/, "").slice(0, 64);
}

function isPrivateIp(ip) {
  const value = safeString(ip).toLowerCase();
  return !value || value === "::1" || value === "127.0.0.1" || value.startsWith("10.") || value.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value);
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
