import crypto from "node:crypto";
import { getDbPool } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { deriveDiscountCodeStatus, normalizeDiscountCodePayload } from "./discount-code-normalizers.js";
import {
  resolveShopifyDiscountCode,
  searchShopifyDiscountCodes,
} from "./shopify-discount-catalog-service.js";

const FILTER_STATUSES = new Set(["scheduled", "active", "expired", "disabled"]);
const FILTER_OWNERS = new Set(["site", "creator", "all_site"]);

export async function listDiscountCodes({ query = "", site = "", ownershipType = "", status = "" } = {}) {
  const filters = [];
  const values = [];
  const normalizedQuery = String(query || "").trim();
  const normalizedSite = String(site || "").trim();
  const normalizedOwner = String(ownershipType || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedQuery) {
    const keyword = `%${normalizedQuery}%`;
    filters.push("(dc.code LIKE ? OR dc.offer_description LIKE ? OR u.nickname LIKE ? OR u.email LIKE ?)");
    values.push(keyword, keyword, keyword, keyword);
  }
  if (normalizedSite) {
    filters.push("dc.site_id = ?");
    values.push(normalizedSite);
  }
  if (FILTER_OWNERS.has(normalizedOwner)) {
    filters.push("dc.ownership_type = ?");
    values.push(normalizedOwner);
  }
  const [rows] = await getDbPool().execute(
    `${discountCodeSelectSql()}
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY dc.updated_at DESC, dc.id DESC`,
    values,
  );
  const items = rows.map(mapDiscountCodeRow);
  return {
    ok: true,
    items: FILTER_STATUSES.has(normalizedStatus)
      ? items.filter((item) => item.status === normalizedStatus)
      : items,
  };
}

export async function getDiscountCodeOptions() {
  const [sites] = await getDbPool().execute(
    `SELECT id, name, slug FROM sites WHERE site_status = 'active' ORDER BY is_default DESC, name ASC`,
  );
  const [creators] = await getDbPool().execute(
    `SELECT u.id, u.site_id, u.nickname, u.email, c.id AS character_id, c.name AS character_name
     FROM users u
     INNER JOIN ai_characters c
       ON c.owner_uid = u.id AND c.category_id = 'creator' AND c.character_status <> 'archived'
     WHERE u.account_type = 'creator' AND u.account_status = 'active' AND u.site_id IS NOT NULL
       AND c.site_id = u.site_id
     ORDER BY u.nickname ASC, u.email ASC`,
  );
  return {
    ok: true,
    sites: sites.map((site) => ({ id: site.id, name: site.name, slug: site.slug })),
    creators: creators.map(mapCreatorOption),
  };
}

export async function searchDiscountCodesFromShopify(siteId = "", query = "", options = {}) {
  const site = await getDiscountCodeShopifySite(siteId);
  const items = await searchShopifyDiscountCodes(site, query, options);
  return { ok: true, items };
}

export async function createDiscountCode(adminId, payload = {}, options = {}) {
  const shopifyRule = await resolveTrustedShopifyRule(payload.siteId, payload.code, options);
  const normalized = normalizeDiscountCodePayload(payload, { shopifyRule });
  await assertDiscountCodeRelations(normalized);
  assertShopifyDiscountCanBeEnabled(normalized);
  const id = `discount_${crypto.randomUUID()}`;
  try {
    await getDbPool().execute(
      `INSERT INTO discount_codes (
         id, site_id, code, ownership_type, creator_uid, offer_description,
         validity_mode, starts_at, ends_at, is_enabled, notes,
         shopify_discount_id, shopify_discount_type, shopify_status, shopify_rule_json, shopify_synced_at,
         created_by_uid, updated_by_uid
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?)`,
      [
        id,
        normalized.siteId,
        normalized.code,
        normalized.ownershipType,
        normalized.creatorUid,
        normalized.offerDescription,
        normalized.validityMode,
        normalized.startsAt,
        normalized.endsAt,
        normalized.isEnabled ? 1 : 0,
        normalized.notes || null,
        normalized.shopifyDiscountId || null,
        normalized.shopifyDiscountType || null,
        normalized.shopifyStatus || null,
        normalized.shopifyRule ? JSON.stringify(normalized.shopifyRule) : null,
        adminId || null,
        adminId || null,
      ],
    );
  } catch (error) {
    throw normalizeDiscountCodeWriteError(error);
  }
  return { ok: true, item: await getDiscountCodeById(id) };
}

export async function updateDiscountCode(adminId, discountCodeId, payload = {}, options = {}) {
  const current = await getDiscountCodeById(discountCodeId);
  const siteId = payload.siteId ?? payload.site_id ?? current.siteId;
  const code = payload.code ?? current.code;
  const shopifyRule = await resolveTrustedShopifyRule(siteId, code, options);
  const normalized = normalizeDiscountCodePayload(payload, { current, shopifyRule });
  await assertDiscountCodeRelations(normalized);
  assertShopifyDiscountCanBeEnabled(normalized);
  try {
    await getDbPool().execute(
      `UPDATE discount_codes
       SET site_id = ?, code = ?, ownership_type = ?, creator_uid = ?, offer_description = ?,
           validity_mode = ?, starts_at = ?, ends_at = ?, is_enabled = ?, notes = ?,
           shopify_discount_id = ?, shopify_discount_type = ?, shopify_status = ?,
           shopify_rule_json = ?, shopify_synced_at = NOW(3), updated_by_uid = ?
       WHERE id = ? LIMIT 1`,
      [
        normalized.siteId,
        normalized.code,
        normalized.ownershipType,
        normalized.creatorUid,
        normalized.offerDescription,
        normalized.validityMode,
        normalized.startsAt,
        normalized.endsAt,
        normalized.isEnabled ? 1 : 0,
        normalized.notes || null,
        normalized.shopifyDiscountId || null,
        normalized.shopifyDiscountType || null,
        normalized.shopifyStatus || null,
        normalized.shopifyRule ? JSON.stringify(normalized.shopifyRule) : null,
        adminId || null,
        discountCodeId,
      ],
    );
  } catch (error) {
    throw normalizeDiscountCodeWriteError(error);
  }
  return { ok: true, item: await getDiscountCodeById(discountCodeId) };
}

export async function getDiscountCodeById(discountCodeId) {
  const id = String(discountCodeId || "").trim();
  const [rows] = await getDbPool().execute(`${discountCodeSelectSql()} WHERE dc.id = ? LIMIT 1`, [id]);
  if (!rows[0]) throw createPublicError("折扣码不存在", 404, "DISCOUNT_CODE_NOT_FOUND");
  return mapDiscountCodeRow(rows[0]);
}

async function assertDiscountCodeRelations(item) {
  const [[site]] = await getDbPool().execute(
    "SELECT id FROM sites WHERE id = ? AND site_status = 'active' LIMIT 1",
    [item.siteId],
  );
  if (!site) throw createPublicError("站点不存在或已停用", 400, "DISCOUNT_CODE_SITE_INVALID");
  if (item.ownershipType !== "creator") return;
  const [[creator]] = await getDbPool().execute(
    `SELECT u.id
     FROM users u
     INNER JOIN ai_characters c
       ON c.owner_uid = u.id AND c.category_id = 'creator' AND c.character_status <> 'archived'
     WHERE u.id = ? AND u.site_id = ? AND u.account_type = 'creator' AND u.account_status = 'active'
       AND c.site_id = u.site_id
     LIMIT 1`,
    [item.creatorUid, item.siteId],
  );
  if (!creator) throw createPublicError("网红账号不存在、不可用或不属于所选站点", 400, "DISCOUNT_CODE_CREATOR_INVALID");
}

function discountCodeSelectSql() {
  return `SELECT
     dc.id, dc.site_id, dc.code, dc.ownership_type, dc.creator_uid,
     dc.offer_description, dc.validity_mode, dc.starts_at, dc.ends_at,
     dc.is_enabled, dc.notes, dc.shopify_discount_id, dc.shopify_discount_type,
     dc.shopify_status, dc.shopify_rule_json, dc.shopify_synced_at,
     dc.created_at, dc.updated_at,
     s.name AS site_name, s.slug AS site_slug,
     u.nickname AS creator_nickname, u.email AS creator_email,
     c.id AS character_id, c.name AS character_name
   FROM discount_codes dc
   INNER JOIN sites s ON s.id = dc.site_id
   LEFT JOIN users u ON u.id = dc.creator_uid
   LEFT JOIN ai_characters c
     ON c.owner_uid = dc.creator_uid AND c.category_id = 'creator' AND c.character_status <> 'archived'`;
}

function mapDiscountCodeRow(row) {
  const item = {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name || "",
    siteSlug: row.site_slug || "",
    code: row.code || "",
    ownershipType: row.ownership_type || "site",
    creatorUid: row.creator_uid || "",
    creatorNickname: row.creator_nickname || "",
    creatorEmail: row.creator_email || "",
    characterId: row.character_id || "",
    characterName: row.character_name || "",
    offerDescription: row.offer_description || "",
    validityMode: row.validity_mode || "indefinite",
    startsAt: toIsoString(row.starts_at),
    endsAt: toIsoString(row.ends_at),
    isEnabled: Boolean(row.is_enabled),
    notes: row.notes || "",
    shopifyDiscountId: row.shopify_discount_id || "",
    shopifyDiscountType: row.shopify_discount_type || "",
    shopifyStatus: row.shopify_status || "",
    shopifyRule: parseJsonObject(row.shopify_rule_json),
    shopifySyncedAt: toIsoString(row.shopify_synced_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
  return { ...item, status: deriveDiscountCodeStatus(item) };
}

async function resolveTrustedShopifyRule(siteId, code, options = {}) {
  const site = await getDiscountCodeShopifySite(siteId);
  const resolver = typeof options.resolveShopifyDiscountCodeImpl === "function"
    ? options.resolveShopifyDiscountCodeImpl
    : resolveShopifyDiscountCode;
  return resolver(site, code, options);
}

async function getDiscountCodeShopifySite(siteId) {
  const id = String(siteId || "").trim();
  if (!id) throw createPublicError("请选择站点", 400, "DISCOUNT_CODE_SITE_REQUIRED");
  const [[site]] = await getDbPool().execute(
    `SELECT id, name, slug, site_status, product_api_url, product_access_token_encrypted
     FROM sites
     WHERE id = ? AND site_status = 'active'
     LIMIT 1`,
    [id],
  );
  if (!site) throw createPublicError("站点不存在或已停用", 400, "DISCOUNT_CODE_SITE_INVALID");
  return site;
}

function assertShopifyDiscountCanBeEnabled(item) {
  if (!item.isEnabled) return;
  if (item.shopifyStatus === "ACTIVE" || item.shopifyStatus === "SCHEDULED") return;
  throw createPublicError(
    "该 Shopify 折扣码当前不可启用",
    400,
    "SHOPIFY_DISCOUNT_NOT_ENABLEABLE",
  );
}

function parseJsonObject(value) {
  if (!value) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapCreatorOption(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    nickname: row.nickname || "",
    email: row.email || "",
    characterId: row.character_id || "",
    characterName: row.character_name || "",
  };
}

function toIsoString(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeDiscountCodeWriteError(error) {
  if (error?.code === "ER_DUP_ENTRY") {
    return createPublicError("该站点已经登记了相同折扣码", 409, "DISCOUNT_CODE_DUPLICATE");
  }
  return error;
}
