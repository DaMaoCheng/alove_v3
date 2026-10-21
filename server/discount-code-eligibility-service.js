import { createPublicError } from "./public-error-utils.js";
import { refreshDiscountOfferSnapshots } from "./discount-code-snapshot-service.js";
import { parseShopifyAdminSource, resolveShopifyAdminToken } from "./product-source-shopify-admin-service.js";
import { resolveShopifyMarketPricingContext } from "./shopify-market-context-service.js";

const CHARACTER_CATEGORIES = new Set(["mascot", "creator"]);
const ALL_SITE_OWNERSHIP_TYPE = "all_site";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_SNAPSHOT_CANDIDATES = 100;

/**
 * Resolve the codes that the current character may expose to a formal user.
 * Callers provide identity hints, but ownership and site scope are re-read here.
 */
export async function resolveCharacterDiscountOffers(db, {
  userId = "",
  characterId = "",
  messageId = "",
  siteId = "",
  now = new Date(),
  limit = DEFAULT_LIMIT,
  resolveShopifyDiscountCodeImpl = null,
  resolveShopifyMarketPricingContextImpl = null,
  snapshotMaxAgeMs = null,
} = {}) {
  const normalizedUserId = normalizeText(userId);
  const normalizedCharacterId = normalizeText(characterId);
  const normalizedMessageId = normalizeText(messageId);
  if (!normalizedUserId || !normalizedCharacterId) return { ok: true, offers: [] };
  if (!db?.execute) throw new Error("A database adapter is required");

  const currentTime = normalizeDate(now);
  const [characterRows] = await db.execute(
    `SELECT
       c.id,
       c.category_id,
       c.owner_uid,
       c.site_id,
       c.name AS character_name,
       s.id AS resolved_site_id,
       s.name AS resolved_site_name,
       s.slug AS resolved_site_slug,
       s.currency AS resolved_site_currency,
       s.product_api_url AS resolved_product_api_url,
       s.product_access_token_encrypted AS resolved_product_access_token_encrypted,
       u.account_type AS owner_account_type,
       u.account_status AS owner_account_status,
       u.site_id AS owner_site_id,
       viewer.site_id AS viewer_site_id,
       viewer.account_status AS viewer_account_status
     FROM ai_characters c
     LEFT JOIN sites s
       ON s.id = c.site_id AND s.site_status = 'active'
     LEFT JOIN users u
       ON u.id = c.owner_uid
     INNER JOIN users viewer
       ON viewer.id = ?
     WHERE c.id = ?
       AND c.category_id IN ('mascot', 'creator')
       AND c.character_status = 'published'
       AND (c.visibility = 'public' OR c.owner_uid = ?)
     LIMIT 1`,
    [normalizedUserId, normalizedCharacterId, normalizedUserId],
  );
  const character = characterRows[0];
  if (!character) {
    throw createPublicError("当前角色无权使用该折扣码", 403, "DISCOUNT_CODE_CHARACTER_FORBIDDEN");
  }
  if (normalizedMessageId) {
    const [messageRows] = await db.execute(
      `SELECT m.id
       FROM chat_messages m
       INNER JOIN chat_sessions cs
         ON cs.id = m.session_id
        AND cs.internal_uid = ?
        AND cs.character_id = ?
        AND cs.source_type = 'user'
       WHERE m.id = ?
         AND m.character_id = ?
         AND m.content_type = 'product'
         AND m.sender_type = 'character'
         AND m.delivery_status = 'sent'
       LIMIT 1`,
      [normalizedUserId, normalizedCharacterId, normalizedMessageId, normalizedCharacterId],
    );
    if (!messageRows[0]) {
      throw createPublicError("商品与当前角色会话不匹配", 403, "DISCOUNT_CODE_CONTEXT_FORBIDDEN");
    }
  }
  if (String(character.viewer_account_status || "").toLowerCase() !== "active") {
    throw createPublicError("当前账号不可使用折扣码", 403, "DISCOUNT_CODE_USER_INACTIVE");
  }

  const category = normalizeText(character.category_id).toLowerCase();
  if (!CHARACTER_CATEGORIES.has(category)) return { ok: true, offers: [] };
  const resolvedSiteId = normalizeText(character.resolved_site_id || character.site_id || character.viewer_site_id || siteId);
  if (!resolvedSiteId) return { ok: true, offers: [] };
  const viewerSiteId = normalizeText(character.viewer_site_id);
  if (!viewerSiteId || viewerSiteId !== resolvedSiteId) {
    throw createPublicError("角色与账号站点不匹配", 403, "DISCOUNT_CODE_SITE_MISMATCH");
  }
  const requestedSiteId = normalizeText(siteId);
  if (requestedSiteId && requestedSiteId !== resolvedSiteId) {
    throw createPublicError("角色与站点不匹配", 403, "DISCOUNT_CODE_SITE_MISMATCH");
  }
  if (!character.resolved_site_id && resolvedSiteId !== normalizeText(character.viewer_site_id)) {
    throw createPublicError("角色与账号站点不匹配", 403, "DISCOUNT_CODE_SITE_MISMATCH");
  }
  if (category === "creator" && (
    normalizeText(character.owner_uid) === ""
    || normalizeText(character.owner_account_type).toLowerCase() !== "creator"
    || normalizeText(character.owner_account_status).toLowerCase() !== "active"
    || normalizeText(character.owner_site_id) !== resolvedSiteId
  )) {
    return { ok: true, offers: [] };
  }

  const ownershipType = category === "creator" ? "creator" : "site";
  const safeLimit = normalizeLimit(limit);
  const [rows] = await db.execute(
    `SELECT
       dc.id,
       dc.code,
       dc.ownership_type,
       dc.offer_description,
       dc.ends_at,
       dc.shopify_discount_type,
       dc.shopify_status,
       dc.shopify_rule_json,
       dc.shopify_synced_at,
       dc.starts_at
     FROM discount_codes dc
     INNER JOIN sites s
       ON s.id = dc.site_id AND s.site_status = 'active'
     WHERE dc.site_id = ?
       AND ${discountOwnershipClause(ownershipType)}
       AND dc.is_enabled = 1
     ORDER BY dc.updated_at DESC, dc.code ASC
     LIMIT ${MAX_SNAPSHOT_CANDIDATES}`,
    discountOwnershipValues(ownershipType, character.owner_uid, resolvedSiteId),
  );
  const { trustedRows, marketPricingContext } = await resolveTrustedDiscountOffers(db, {
    rows,
    site: {
      id: resolvedSiteId,
      product_api_url: character.resolved_product_api_url,
      product_access_token_encrypted: character.resolved_product_access_token_encrypted,
    },
    pricingContext: character,
    now: currentTime,
    resolveShopifyDiscountCodeImpl,
    resolveShopifyMarketPricingContextImpl,
    snapshotMaxAgeMs,
  });

  return {
    ok: true,
    siteId: resolvedSiteId,
    characterId: normalizedCharacterId,
    ownershipType,
    offers: trustedRows.slice(0, safeLimit).map((row) => mapDiscountOffer(row, {
      ownershipType,
      marketPricingContext,
    })),
  };
}

/**
 * Resolve a selected site's all-site codes for a formal user without assigning
 * that user a mascot or creator identity. Search product cards use this path.
 */
export async function resolveSiteDiscountOffers(db, {
  userId = "",
  siteId = "",
  now = new Date(),
  limit = DEFAULT_LIMIT,
  resolveShopifyDiscountCodeImpl = null,
  resolveShopifyMarketPricingContextImpl = null,
  snapshotMaxAgeMs = null,
} = {}) {
  const normalizedUserId = normalizeText(userId);
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedUserId || !normalizedSiteId) return { ok: true, offers: [] };
  if (!db?.execute) throw new Error("A database adapter is required");

  const [scopeRows] = await db.execute(
    `SELECT
       u.id AS user_id,
       u.site_id AS user_site_id,
       u.account_status AS user_account_status,
       s.id AS resolved_site_id,
       s.currency AS resolved_site_currency,
       s.product_api_url AS resolved_product_api_url,
       s.product_access_token_encrypted AS resolved_product_access_token_encrypted
     FROM users u
     INNER JOIN sites s
       ON s.id = ? AND s.site_status = 'active'
     WHERE u.id = ?
     LIMIT 1`,
    [normalizedSiteId, normalizedUserId],
  );
  const scope = scopeRows[0];
  if (!scope || String(scope.user_account_status || "").toLowerCase() !== "active") {
    throw createPublicError("当前账号不可使用折扣码", 403, "DISCOUNT_CODE_USER_INACTIVE");
  }
  if (normalizeText(scope.user_site_id) !== normalizedSiteId) {
    throw createPublicError("账号与站点不匹配", 403, "DISCOUNT_CODE_SITE_MISMATCH");
  }

  const [rows] = await db.execute(
    `SELECT
       dc.id,
       dc.code,
       dc.ownership_type,
       dc.offer_description,
       dc.ends_at,
       dc.shopify_discount_type,
       dc.shopify_status,
       dc.shopify_rule_json,
       dc.shopify_synced_at,
       dc.starts_at
     FROM discount_codes dc
     INNER JOIN sites s
       ON s.id = dc.site_id AND s.site_status = 'active'
     WHERE dc.site_id = ?
       AND dc.ownership_type = ?
       AND dc.is_enabled = 1
     ORDER BY dc.updated_at DESC, dc.code ASC
     LIMIT ${MAX_SNAPSHOT_CANDIDATES}`,
    [normalizedSiteId, ALL_SITE_OWNERSHIP_TYPE],
  );
  const { trustedRows, marketPricingContext } = await resolveTrustedDiscountOffers(db, {
    rows,
    site: {
      id: normalizedSiteId,
      product_api_url: scope.resolved_product_api_url,
      product_access_token_encrypted: scope.resolved_product_access_token_encrypted,
    },
    pricingContext: scope,
    now: normalizeDate(now),
    resolveShopifyDiscountCodeImpl,
    resolveShopifyMarketPricingContextImpl,
    snapshotMaxAgeMs,
  });
  return {
    ok: true,
    siteId: normalizedSiteId,
    ownershipType: ALL_SITE_OWNERSHIP_TYPE,
    offers: trustedRows.slice(0, normalizeLimit(limit)).map((row) => mapDiscountOffer(row, {
      ownershipType: ALL_SITE_OWNERSHIP_TYPE,
      marketPricingContext,
    })),
  };
}

export function mapDiscountOffer(row = {}, { ownershipType = "site", marketPricingContext = null } = {}) {
  const code = normalizeText(row.code).toUpperCase();
  const rule = parseJsonObject(row.shopify_rule_json);
  return {
    id: normalizeText(row.id),
    code,
    offerDescription: normalizeText(row.offer_description),
    ownershipType,
    endsAt: toIsoString(row.ends_at),
    // Server-only trusted rule. Product/cart routes consume it before their
    // response is passed through the public product sanitizer.
    shopifyRule: rule,
    combination: {
      discountClasses: Array.isArray(rule.discountClasses) ? rule.discountClasses : [],
      combinesWith: rule.combinesWith && typeof rule.combinesWith === "object" ? rule.combinesWith : {},
    },
    pricingPreview: normalizePricingPreview(rule, row.shopify_discount_type, row.shopify_status, marketPricingContext),
  };
}

function normalizePricingPreview(rule = {}, discountType = "", shopifyStatus = "", marketPricingContext = null) {
  if (!isSafeProductPricePreviewRule(rule, discountType)) return null;
  const type = normalizeText(rule.type || discountType).toLowerCase();
  if (!["percentage", "fixed_amount"].includes(type)) return null;
  const value = Number(rule.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (normalizeText(shopifyStatus).toUpperCase() !== "ACTIVE") return null;
  const preview = {
    type,
    value,
    currencyCode: normalizeText(rule.currencyCode).toUpperCase(),
    appliesOnEachItem: rule.appliesOnEachItem === true,
    eligible: true,
  };
  const marketValue = resolveMarketFixedDiscountValue(preview, marketPricingContext);
  return marketValue == null
    ? preview
    : { ...preview, marketValue, marketCurrencyCode: marketPricingContext.currency };
}

/**
 * `pricePreviewEligible` is persisted in Shopify snapshots. Recalculate the
 * narrow safe rule from the same snapshot fields so an already-synced code is
 * not held back merely because the eligibility policy expanded later.
 * Product routes only call this after trusted product/variant/collection
 * filtering, so products outside a selected scope never receive the preview.
 */
function isSafeProductPricePreviewRule(rule = {}, discountType = "") {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
  if (rule.pricePreviewEligible === true) return true;
  const type = normalizeText(rule.type || discountType).toLowerCase();
  const scopeType = normalizeText(rule.targetScope?.type).toLowerCase();
  return !rule.minimumRequirement
    && ["percentage", "fixed_amount"].includes(type)
    && ["all", "products", "collections"].includes(scopeType)
    && /All$/i.test(normalizeText(rule.customerContext));
}

async function resolveTrustedDiscountOffers(db, {
  rows = [],
  site = {},
  pricingContext = {},
  now = new Date(),
  resolveShopifyDiscountCodeImpl = null,
  resolveShopifyMarketPricingContextImpl = null,
  snapshotMaxAgeMs = null,
} = {}) {
  const trustedRows = await refreshDiscountOfferSnapshots(db, {
    rows,
    site,
    now,
    ...(typeof resolveShopifyDiscountCodeImpl === "function" ? { resolveShopifyDiscountCodeImpl } : {}),
    ...(snapshotMaxAgeMs != null && Number.isFinite(Number(snapshotMaxAgeMs))
      ? { maxAgeMs: Number(snapshotMaxAgeMs) }
      : {}),
  });
  return {
    trustedRows,
    marketPricingContext: await resolveDiscountMarketPricingContext({
      pricingContext,
      rows: trustedRows,
      resolveShopifyMarketPricingContextImpl,
    }),
  };
}

async function resolveDiscountMarketPricingContext({ pricingContext = {}, rows = [], resolveShopifyMarketPricingContextImpl = null } = {}) {
  const targetCurrency = normalizeText(pricingContext.resolved_site_currency).toUpperCase();
  const hasFixedAmountOffer = (Array.isArray(rows) ? rows : []).some((row) => {
    const rule = parseJsonObject(row?.shopify_rule_json);
    return normalizeText(rule.type || row?.shopify_discount_type).toLowerCase() === "fixed_amount" && rule.pricePreviewEligible === true;
  });
  if (!targetCurrency || !hasFixedAmountOffer) return null;

  const source = parseShopifyAdminSource(pricingContext.resolved_product_api_url);
  const token = source ? resolveShopifyAdminToken(source.tokenEnv, pricingContext.resolved_product_access_token_encrypted) : "";
  if (!source || !token) return null;

  const resolver = typeof resolveShopifyMarketPricingContextImpl === "function"
    ? resolveShopifyMarketPricingContextImpl
    : resolveShopifyMarketPricingContext;
  try {
    return await resolver({ endpoint: source.endpoint, token, currency: targetCurrency });
  } catch {
    // Cross-currency display is optional. A market permission or API failure must
    // never hide otherwise valid discount codes or interrupt chat/product data.
    return null;
  }
}

function discountOwnershipClause(ownershipType = "site") {
  if (ownershipType === "creator") {
    return "dc.ownership_type = ? AND dc.creator_uid = ?";
  }
  return "dc.ownership_type IN (?, ?)";
}

function discountOwnershipValues(ownershipType = "site", creatorUid = "", siteId = "") {
  if (ownershipType === "creator") {
    return [siteId, "creator", normalizeText(creatorUid)];
  }
  return [siteId, "site", ALL_SITE_OWNERSHIP_TYPE];
}

function resolveMarketFixedDiscountValue(preview = {}, context = null) {
  if (preview.type !== "fixed_amount" || !context || typeof context !== "object") return null;
  const sourceCurrency = normalizeText(preview.currencyCode).toUpperCase();
  if (!sourceCurrency || sourceCurrency !== normalizeText(context.shopCurrency).toUpperCase()) return null;
  const targetCurrency = normalizeText(context.currency).toUpperCase();
  if (!targetCurrency || targetCurrency === sourceCurrency) return null;
  const manualRate = Number(context.manualRate);
  if (!Number.isFinite(manualRate) || manualRate <= 0) return null;
  const fractionDigits = Math.max(0, Math.min(4, Number(context.fractionDigits) || 2));
  const scaled = 10 ** fractionDigits;
  const value = Math.round(Number(preview.value) * manualRate * scaled) / scaled;
  return Number.isFinite(value) && value > 0 ? value : null;
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

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw createPublicError("时间格式不正确", 400, "DISCOUNT_CODE_TIME_INVALID");
  return date;
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(numeric)));
}

function toIsoString(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
