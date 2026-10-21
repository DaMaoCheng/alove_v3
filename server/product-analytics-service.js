import { createHash } from "node:crypto";
import { acquireDedicatedDbAdvisoryLock } from "./db-advisory-lock-service.js";
import { getDbPool } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { createId } from "./security.js";
import { verifyProductCatalogAnalyticsReceipt } from "./product-search-analytics-receipt-service.js";

export const PRODUCT_ANALYTICS_EVENTS = Object.freeze({
  BUBBLE_TRIGGERED: "product_bubble_triggered",
  BUBBLE_IMPRESSION: "product_bubble_impression",
  BUBBLE_CLICK: "product_bubble_click",
  SEARCH_RESULT_IMPRESSION: "product_search_result_impression",
  SEARCH_RESULT_CLICK: "product_search_result_click",
  KITSHOP_IMPRESSION: "product_kitshop_impression",
  KITSHOP_CARD_CLICK: "product_kitshop_card_click",
  DETAIL_OPEN: "product_detail_open",
  DETAIL_CTA_CLICK: "product_detail_cta_click",
});

const ALLOWED_EVENT_TYPES = new Set(Object.values(PRODUCT_ANALYTICS_EVENTS));
const CLIENT_EVENT_TYPES = new Set([
  PRODUCT_ANALYTICS_EVENTS.BUBBLE_IMPRESSION,
  PRODUCT_ANALYTICS_EVENTS.BUBBLE_CLICK,
  PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_IMPRESSION,
  PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_CLICK,
  PRODUCT_ANALYTICS_EVENTS.KITSHOP_IMPRESSION,
  PRODUCT_ANALYTICS_EVENTS.KITSHOP_CARD_CLICK,
  PRODUCT_ANALYTICS_EVENTS.DETAIL_OPEN,
  PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
]);

export async function recordProductBubbleTriggered(db, {
  userId = "",
  sessionId = "",
  messageId = "",
  character = {},
  product = {},
} = {}) {
  const releaseLock = await acquireDedicatedDbAdvisoryLock(
    clientEventLockName(PRODUCT_ANALYTICS_EVENTS.BUBBLE_TRIGGERED, userId, messageId),
    3
  );
  try {
    return await recordProductAnalyticsEvent({
      db,
      eventType: PRODUCT_ANALYTICS_EVENTS.BUBBLE_TRIGGERED,
      userId,
      sessionId,
      messageId,
      characterId: character.id || character.characterId,
      characterName: character.name,
      ownerUserId: character.owner_uid || character.ownerUserId || character.ownerUid,
      siteId: product.siteId || character.site_id || character.siteId,
      siteSlug: product.siteSlug || character.site_slug || character.siteSlug,
      product,
      source: "server_reply",
    });
  } finally {
    await releaseLock();
  }
}

export async function recordProductAnalyticsEvent({
  db = null,
  eventType = "",
  userId = "",
  sessionId = "",
  messageId = "",
  characterId = "",
  characterName = "",
  ownerUserId = "",
  siteId = "",
  siteSlug = "",
  product = {},
  source = "",
  metadata = {},
} = {}) {
  const payload = safeEventPayload({
    eventType,
    userId,
    sessionId,
    messageId,
    characterId,
    characterName,
    ownerUserId,
    siteId,
    siteSlug,
    product,
    source,
    metadata,
  });
  if (!payload) return { ok: false, skipped: true };
  const executor = db || getDbPool();
  const enrichedPayload = await enrichProductAnalyticsPayload(executor, payload);
  if (await shouldSkipDuplicateEvent(executor, enrichedPayload)) {
    return { ok: true, skipped: true, duplicate: true };
  }
  await executor.execute(
    `INSERT INTO product_analytics_events (
       id, event_type, site_id, site_slug, character_id, character_name, owner_user_id,
       user_id, session_id, message_id, product_id, product_title, product_url, source, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createId("pae"),
      enrichedPayload.eventType,
      enrichedPayload.siteId || null,
      enrichedPayload.siteSlug || null,
      enrichedPayload.characterId || null,
      enrichedPayload.characterName || null,
      enrichedPayload.ownerUserId || null,
      enrichedPayload.userId || null,
      enrichedPayload.sessionId || null,
      enrichedPayload.messageId || null,
      enrichedPayload.productId || null,
      enrichedPayload.productTitle || null,
      enrichedPayload.productUrl || null,
      enrichedPayload.source || null,
      JSON.stringify(enrichedPayload.metadata || {}),
    ]
  );
  return { ok: true };
}

export async function recordClientProductAnalyticsEvent(userInput, payload = {}, { db = getDbPool() } = {}) {
  const user = normalizeEventUser(userInput);
  const userId = user.id;
  const eventType = safeString(payload.eventType || payload.event_type);
  if (!CLIENT_EVENT_TYPES.has(eventType)) {
    throw createPublicError("Unsupported product event.", 400, "INVALID_PRODUCT_EVENT");
  }
  if (payload.catalogReceipt || payload.catalog_receipt || payload.searchReceipt || payload.search_receipt) {
    return recordTrustedCatalogEvent(db, user, payload);
  }
  const messageId = safeString(payload.messageId || payload.message_id, 64);
  if (!messageId) throw createPublicError("Product message is required.", 400, "PRODUCT_MESSAGE_REQUIRED");

  const trusted = await resolveTrustedClientProductEvent(db, userId, messageId);
  if (!trusted) throw createPublicError("Product message is unavailable.", 400, "PRODUCT_MESSAGE_UNAVAILABLE");

  const releaseLock = await acquireDedicatedDbAdvisoryLock(clientEventLockName(eventType, userId, messageId), 3);
  try {
    if (eventType === PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK && await hasRecordedEvent(db, { eventType, userId, messageId })) {
      return { ok: true, skipped: true, duplicate: true };
    }
    return await recordProductAnalyticsEvent({
      db,
      eventType,
      userId,
      sessionId: trusted.sessionId,
      messageId,
      characterId: trusted.characterId,
      characterName: trusted.characterName,
      ownerUserId: trusted.ownerUserId,
      siteId: trusted.siteId,
      siteSlug: trusted.siteSlug,
      product: trusted.product,
      source: safeString(payload.source, 64) || "client",
      metadata: payload.metadata,
    });
  } finally {
    await releaseLock();
  }
}

async function recordTrustedCatalogEvent(db, user, payload = {}) {
  const eventType = safeString(payload.eventType || payload.event_type);
  const trusted = verifyProductCatalogAnalyticsReceipt(payload.catalogReceipt || payload.catalog_receipt || payload.searchReceipt || payload.search_receipt, { userId: user.id });
  if (!trusted) throw createPublicError("Product search result is unavailable.", 400, "PRODUCT_SEARCH_RESULT_UNAVAILABLE");
  if (!isCatalogEventAllowedForSource(eventType, trusted.source)) {
    throw createPublicError("Product catalog event is unavailable.", 400, "PRODUCT_CATALOG_EVENT_UNAVAILABLE");
  }
  if (user.accountType !== "admin"
    && ((user.siteId && trusted.siteId !== user.siteId) || (user.siteSlug && trusted.siteSlug !== user.siteSlug))) {
    throw createPublicError("Product search result is unavailable.", 400, "PRODUCT_SEARCH_RESULT_UNAVAILABLE");
  }
  const releaseLock = await acquireDedicatedDbAdvisoryLock(clientEventLockName(eventType, user.id, `${trusted.source}:${trusted.product.id || trusted.product.url}`), 3);
  try {
    if (await hasRecordedCatalogEvent(db, { eventType, userId: user.id, source: trusted.source, product: trusted.product })) {
      return { ok: true, skipped: true, duplicate: true };
    }
    return recordProductAnalyticsEvent({
      db,
      eventType,
      userId: user.id,
      siteId: trusted.siteId,
      siteSlug: trusted.siteSlug,
      product: trusted.product,
      source: trusted.source,
      metadata: { entrySource: trusted.source },
    });
  } finally {
    await releaseLock();
  }
}

function isCatalogEventAllowedForSource(eventType = "", source = "") {
  const allowed = source === "search"
    ? new Set([
      PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_IMPRESSION,
      PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_CLICK,
      PRODUCT_ANALYTICS_EVENTS.DETAIL_OPEN,
      PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
    ])
    : source === "kitshop"
      ? new Set([
        PRODUCT_ANALYTICS_EVENTS.KITSHOP_IMPRESSION,
        PRODUCT_ANALYTICS_EVENTS.KITSHOP_CARD_CLICK,
        PRODUCT_ANALYTICS_EVENTS.DETAIL_OPEN,
        PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
      ])
      : new Set();
  return allowed.has(eventType);
}

async function enrichProductAnalyticsPayload(executor, payload = {}) {
  if (!payload.messageId) return payload;
  if (payload.productTitle && payload.productUrl && payload.siteSlug && payload.siteId) return payload;
  const [rows] = await executor.execute(
    `SELECT text_content, product_payload_json
     FROM chat_messages
     WHERE id = ?
     LIMIT 1`,
    [payload.messageId]
  );
  const row = rows[0];
  if (!row) return payload;
  const product = parseJsonValue(row.product_payload_json, {});
  return {
    ...payload,
    siteId: payload.siteId || safeString(product.siteId, 64),
    siteSlug: payload.siteSlug || safeString(product.siteSlug, 96),
    productId: payload.productId || safeString(product.id || product.productId, 128),
    productTitle: payload.productTitle || safeString(product.name || product.title || row.text_content, 255),
    productUrl: payload.productUrl || safeString(product.url, 512),
  };
}

async function shouldSkipDuplicateEvent(executor, payload) {
  if (![PRODUCT_ANALYTICS_EVENTS.BUBBLE_IMPRESSION, PRODUCT_ANALYTICS_EVENTS.BUBBLE_TRIGGERED].includes(payload.eventType)) return false;
  if (!payload.userId || !payload.messageId) return false;
  return hasRecordedEvent(executor, payload);
}

async function hasRecordedEvent(executor, { eventType, userId, messageId }) {
  const [rows] = await executor.execute(
    `SELECT id
     FROM product_analytics_events
     WHERE event_type = ?
       AND user_id = ?
       AND message_id = ?
     LIMIT 1`,
    [eventType, userId, messageId]
  );
  return Boolean(rows[0]);
}

async function hasRecordedCatalogEvent(executor, { eventType, userId, source, product = {} }) {
  const productId = safeString(product.id || product.productId, 128);
  const productUrl = safeString(product.url, 512);
  const [rows] = await executor.execute(
    `SELECT id
     FROM product_analytics_events
     WHERE event_type = ?
       AND user_id = ?
       AND source = ?
       AND (product_id = ? OR (product_id IS NULL AND product_url = ?))
       AND created_at >= DATE_SUB(NOW(3), INTERVAL 30 MINUTE)
     LIMIT 1`,
    [eventType, userId, source, productId, productUrl]
  );
  return Boolean(rows[0]);
}

async function resolveTrustedClientProductEvent(db, userId, messageId) {
  const [rows] = await db.execute(
    `SELECT m.session_id, m.product_payload_json,
            c.id AS character_id, c.name AS character_name, c.owner_uid,
            c.site_id, site.slug AS site_slug
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id AND s.internal_uid = ?
     JOIN ai_characters c ON c.id = s.character_id
     LEFT JOIN sites site ON site.id = c.site_id
     WHERE m.id = ?
       AND m.content_type = 'product'
       AND m.delivery_status = 'sent'
     LIMIT 1`,
    [userId, messageId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id || "",
    characterId: row.character_id || "",
    characterName: row.character_name || "",
    ownerUserId: row.owner_uid || "",
    siteId: row.site_id || "",
    siteSlug: row.site_slug || "",
    product: parseJsonValue(row.product_payload_json, {}),
  };
}

function clientEventLockName(eventType, userId, messageId) {
  const digest = createHash("sha256").update(`${eventType}|${userId}|${messageId}`).digest("hex").slice(0, 40);
  return `product-event:${digest}`;
}

export function safeEventPayload(payload = {}) {
  const eventType = safeString(payload.eventType || payload.event_type);
  if (!ALLOWED_EVENT_TYPES.has(eventType)) return null;
  const product = payload.product && typeof payload.product === "object" ? payload.product : {};
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  return {
    eventType,
    userId: safeString(payload.userId || payload.user_id, 64),
    sessionId: safeString(payload.sessionId || payload.session_id, 64),
    messageId: safeString(payload.messageId || payload.message_id, 64),
    characterId: safeString(payload.characterId || payload.character_id, 64),
    characterName: safeString(payload.characterName || payload.character_name, 128),
    ownerUserId: safeString(payload.ownerUserId || payload.owner_user_id || payload.creatorUserId, 64),
    siteId: safeString(payload.siteId || payload.site_id || product.siteId, 64),
    siteSlug: safeString(payload.siteSlug || payload.site_slug || product.siteSlug, 96),
    productId: safeString(payload.productId || payload.product_id || product.id || product.productId, 128),
    productTitle: safeString(payload.productTitle || payload.product_title || product.name || product.title, 255),
    productUrl: safeString(payload.productUrl || payload.product_url || product.url, 512),
    source: safeString(payload.source, 64),
    metadata,
  };
}

function parseJsonValue(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeString(value = "", max = 512) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizeEventUser(value) {
  if (value && typeof value === "object") {
    return {
      id: safeString(value.id, 64),
      accountType: safeString(value.account_type || value.accountType, 32).toLowerCase(),
      siteId: safeString(value.site_id || value.siteId, 64),
      siteSlug: safeString(value.site_slug || value.siteSlug, 96),
    };
  }
  return { id: safeString(value, 64), accountType: "", siteId: "", siteSlug: "" };
}
