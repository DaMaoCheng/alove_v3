import { createPublicError } from "./public-error-utils.js";

const CAMPAIGN_STATUS = new Set(["draft", "active", "paused", "archived"]);
const ROLE_TARGETS = new Set(["all", "mascot", "creator"]);
const SNAPSHOT_STRING_LIMITS = Object.freeze({
  id: 128,
  sku: 128,
  name: 255,
  subtitle: 255,
  price: 64,
  priceWas: 64,
  url: 512,
  imageUrl: 512,
  stock: 128,
});

export async function normalizePromotionCampaignPayload(payload, { mode, current = null, assertSiteExists, now = new Date() } = {}) {
  const siteId = pickString(payload.siteId, payload.site_id, current?.siteId);
  await assertSiteExists?.(siteId);

  const title = requireText(pickString(payload.title, current?.title), "活动标题", 128);
  const roleTarget = normalizeRoleTarget(pickString(payload.roleTarget, payload.role_target, current?.roleTarget));
  const productTitle = requireText(pickString(payload.productTitle, payload.product_title, current?.productTitle), "商品标题", 255);
  const messageText = requireText(pickString(payload.messageText, payload.message_text, current?.messageText), "活动文案", 1000);
  const productId = requireText(pickString(payload.productId, payload.product_id, current?.productId), "请选择商品", 128);
  const productUrl = requireText(pickString(payload.productUrl, payload.product_url, current?.productUrl), "请选择商品", 512);
  const productSnapshot = normalizeProductSnapshot(payload.productSnapshot ?? payload.product_snapshot ?? current?.productSnapshot ?? null);
  const discountCode = optionalText(pickString(payload.discountCode, payload.discount_code, current?.discountCode), 64);
  const sourceRef = optionalText(pickString(payload.sourceRef, payload.source_ref, current?.sourceRef), 128);
  const priority = normalizePriority(payload.priority ?? current?.priority);
  const status = normalizeCampaignStatus(pickString(payload.status, payload.campaign_status, current?.status, mode === "create" ? "draft" : ""));
  const keywords = normalizeKeywords(payload.keywords ?? current?.keywords ?? []);
  const startsAt = normalizeDateTime(payload.startsAt ?? payload.starts_at ?? current?.startsAt ?? null);
  const endsAt = normalizeDateTime(payload.endsAt ?? payload.ends_at ?? current?.endsAt ?? null);

  if (status === "active" && endsAt && endsAt.getTime() <= now.getTime()) {
    throw createPublicError(
      "结束时间必须晚于当前时间，才能将活动状态设为进行中",
      400,
      "PROMOTION_CAMPAIGN_EXPIRED"
    );
  }
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error("活动结束时间必须晚于开始时间");
  }

  return {
    siteId,
    title,
    roleTarget,
    productId,
    productTitle,
    productUrl,
    productSnapshot,
    discountCode,
    messageText,
    keywords,
    priority,
    status,
    startsAt,
    endsAt,
    sourceType: current?.sourceType || "admin",
    sourceRef,
  };
}

export function normalizeProductSnapshot(value) {
  const source = parseProductSnapshot(value);
  if (!source || typeof source !== "object") return null;
  const snapshot = {};
  for (const [key, limit] of Object.entries(SNAPSHOT_STRING_LIMITS)) {
    const text = optionalText(source[key], limit);
    if (text) snapshot[key] = text;
  }
  snapshot.imageUrls = normalizeStringArray(source.imageUrls, 8, 512);
  snapshot.sizes = normalizeSnapshotRows(source.sizes, 12);
  snapshot.features = normalizeStringArray(source.features, 8, 180);
  return Object.keys(snapshot).length ? snapshot : null;
}

export function normalizeKeywords(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());
  return Array.from(new Set(list.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))).slice(0, 20);
}

export function normalizeRoleTarget(value) {
  const normalized = String(value || "all").trim();
  if (!ROLE_TARGETS.has(normalized)) throw new Error("角色范围不支持");
  return normalized;
}

export function normalizeCampaignStatus(value) {
  const normalized = String(value || "draft").trim();
  if (!CAMPAIGN_STATUS.has(normalized)) throw new Error("活动状态不支持");
  return normalized;
}

export function normalizePriority(value) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(9999, Math.round(parsed)));
}

export function normalizeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("时间格式不正确");
  return date;
}

function parseProductSnapshot(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeStringArray(value, maxItems, maxLength) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((item) => optionalText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function normalizeSnapshotRows(value, maxItems) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((item) => {
    if (!item || typeof item !== "object") return null;
    return {
      label: optionalText(item.label, 80) || "",
      available: item.available === true ? true : item.available === false ? false : null,
      sku: optionalText(item.sku, 128) || "",
      price: optionalText(item.price, 64) || "",
    };
  }).filter((item) => item?.label || item?.sku).slice(0, maxItems);
}

function requireText(value, label, maxLength) {
  const normalized = optionalText(value, maxLength);
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function optionalText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function pickString(...values) {
  for (const value of values) {
    if (value === undefined) continue;
    if (value === null) return "";
    return String(value);
  }
  return "";
}
