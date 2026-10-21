import { createPublicError } from "./public-error-utils.js";

const OWNERSHIP_TYPES = new Set(["site", "creator", "all_site"]);
const VALIDITY_MODES = new Set(["indefinite", "fixed"]);

export function normalizeDiscountCodePayload(payload = {}, { current = null, shopifyRule = null } = {}) {
  const ownershipType = normalizeEnum(
    pickValue(payload.ownershipType, payload.ownership_type, current?.ownershipType, "site"),
    OWNERSHIP_TYPES,
    "折扣码归属类型不支持",
  );
  const validityMode = shopifyRule
    ? normalizeEnum(shopifyRule.validityMode || "indefinite", VALIDITY_MODES, "Shopify 有效期类型不支持")
    : normalizeEnum(
        pickValue(payload.validityMode, payload.validity_mode, current?.validityMode, "indefinite"),
        VALIDITY_MODES,
        "有效期类型不支持",
      );
  const startsAt = shopifyRule
    ? normalizeOptionalDate(shopifyRule.startsAt)
    : validityMode === "fixed"
      ? requireDateTime(pickValue(payload.startsAt, payload.starts_at, current?.startsAt), "开始时间")
      : null;
  const endsAt = shopifyRule
    ? normalizeOptionalDate(shopifyRule.endsAt)
    : validityMode === "fixed"
      ? requireDateTime(pickValue(payload.endsAt, payload.ends_at, current?.endsAt), "结束时间")
      : null;
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw createPublicError("结束时间必须晚于开始时间", 400, "DISCOUNT_CODE_TIME_RANGE_INVALID");
  }

  return {
    code: requireText(pickValue(shopifyRule?.code, payload.code, current?.code), "折扣码", 64).toUpperCase(),
    siteId: requireText(pickValue(payload.siteId, payload.site_id, current?.siteId), "站点", 64),
    ownershipType,
    creatorUid: ownershipType === "creator"
      ? requireText(pickValue(payload.creatorUid, payload.creator_uid, current?.creatorUid), "网红账号", 64)
      : null,
    offerDescription: requireText(
      pickValue(shopifyRule?.offerDescription, payload.offerDescription, payload.offer_description, current?.offerDescription),
      "优惠说明",
      255,
    ),
    validityMode,
    startsAt,
    endsAt,
    isEnabled: normalizeBoolean(pickValue(payload.isEnabled, payload.is_enabled, current?.isEnabled, true)),
    notes: optionalText(pickValue(payload.notes, current?.notes), 1000),
    shopifyDiscountId: optionalText(shopifyRule?.shopifyDiscountId, 255),
    shopifyDiscountType: optionalText(shopifyRule?.shopifyDiscountType, 32),
    shopifyStatus: optionalText(shopifyRule?.shopifyStatus, 32).toUpperCase(),
    shopifyRule: shopifyRule?.rule && typeof shopifyRule.rule === "object" ? shopifyRule.rule : null,
  };
}

export function deriveDiscountCodeStatus(item = {}, now = new Date()) {
  if (!normalizeBoolean(item.isEnabled ?? item.is_enabled)) return "disabled";
  const startsAt = normalizeOptionalDate(item.startsAt ?? item.starts_at);
  const endsAt = normalizeOptionalDate(item.endsAt ?? item.ends_at);
  if (endsAt && endsAt.getTime() <= now.getTime()) return "expired";
  if (startsAt && startsAt.getTime() > now.getTime()) return "scheduled";
  const shopifyStatus = String(item.shopifyStatus ?? item.shopify_status ?? "").trim().toUpperCase();
  if (shopifyStatus === "EXPIRED") return "expired";
  if (shopifyStatus && !["ACTIVE", "SCHEDULED"].includes(shopifyStatus)) return "disabled";
  return "active";
}

function normalizeEnum(value, supported, message) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!supported.has(normalized)) throw createPublicError(message, 400);
  return normalized;
}

function normalizeBoolean(value) {
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return true;
}

function requireText(value, label, maxLength) {
  const normalized = optionalText(value, maxLength);
  if (!normalized) throw createPublicError(`${label}不能为空`, 400);
  return normalized;
}

function optionalText(value, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (normalized.length > maxLength) throw createPublicError(`输入内容不能超过 ${maxLength} 个字符`, 400);
  return normalized;
}

function requireDateTime(value, label) {
  const date = normalizeOptionalDate(value);
  if (!date) throw createPublicError(`${label}不能为空`, 400);
  return date;
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw createPublicError("时间格式不正确", 400);
  return date;
}

function pickValue(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}
