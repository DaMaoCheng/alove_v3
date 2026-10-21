import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import {
  buildAnalyticsPeriod,
  buildMetricComparison,
  buildNaturalDayBuckets,
  getCreatorAnalytics,
} from "../server/creator-analytics-service.js";
import { PRODUCT_ANALYTICS_EVENTS, recordClientProductAnalyticsEvent } from "../server/product-analytics-service.js";
import { createProductSearchAnalyticsReceipt, verifyProductSearchAnalyticsReceipt } from "../server/product-search-analytics-receipt-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "creator analytics self-check" });
await initializeDatabase();

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const ids = {
  site: `site_creator_${suffix}`,
  otherSite: `site_other_${suffix}`,
  owner: `u_creator_${suffix}`,
  otherOwner: `u_other_creator_${suffix}`,
  returning: `u_returning_${suffix}`,
  newcomer: `u_new_${suffix}`,
  previous: `u_previous_${suffix}`,
  character: `char_creator_${suffix}`,
  secondaryCharacter: `char_secondary_${suffix}`,
  otherCharacter: `char_other_${suffix}`,
};
const now = new Date("2026-07-20T12:00:00.000Z");
const db = getDbPool();

try {
  await seedFixtures();

  const result = await getCreatorAnalytics({
    id: ids.owner,
    account_type: "creator",
    site_id: ids.site,
  }, { range: "30d", now, db });

  assert.equal(result.character.id, ids.character);
  assert.equal(result.summary.conversations, 2);
  assert.equal(result.summary.productTriggers, 3);
  assert.equal(result.summary.storeVisits, 1);
  assert.ok(Math.abs(result.summary.visitRate - 100 / 3) < 1e-9);
  assert.equal(result.audience.uniqueChatters, 2);
  assert.equal(result.audience.newChatters, 1);
  assert.equal(result.audience.returningChatters, 1);
  assert.equal(result.audience.returnRate, 50);
  assert.equal(result.audience.averageMessages, 1.5);
  assert.equal(result.comparison.conversations.direction, "up");
  assert.equal(result.comparison.conversations.percent, 100);
  assert.equal(result.comparison.productTriggers.percent, 200);
  assert.equal(result.topProducts.length, 2);
  assert.deepEqual(result.topProducts[0], {
    productKey: "product-a",
    name: "Product A",
    imageUrl: "https://example.test/product-a.jpg",
    productTriggers: 2,
    storeVisits: 1,
    visitRate: 50,
  });
  assert.equal(result.topProducts[1].productKey, "product-b");
  assert.equal(result.trend.reduce((sum, point) => sum + point.conversations, 0), 3, "a session active on two days should appear in both daily buckets");
  assert.equal(result.trend.reduce((sum, point) => sum + point.productTriggers, 0), 3);
  assert.equal(result.trend.reduce((sum, point) => sum + point.storeVisits, 0), 1);
  assert.ok(result.trend.length >= 30, "rolling period should return continuous site-local day buckets");
  assert.ok(result.trend.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date)));
  assert.deepEqual(buildMetricComparison(null, 25), { direction: "neutral", percent: null });

  await assert.rejects(
    () => recordClientProductAnalyticsEvent(ids.returning, {
      eventType: PRODUCT_ANALYTICS_EVENTS.BUBBLE_TRIGGERED,
      messageId: productMessageId("product-a", "returning-current"),
    }, { db }),
    /Unsupported product event/
  );
  await assert.rejects(
    () => recordClientProductAnalyticsEvent(ids.newcomer, {
      eventType: PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
      messageId: productMessageId("product-a", "returning-current"),
    }, { db }),
    /Product message is unavailable/
  );
  const firstClientVisit = await recordClientProductAnalyticsEvent(ids.newcomer, {
    eventType: PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
    messageId: productMessageId("product-b", "new-current"),
    ownerUserId: ids.otherOwner,
    siteId: ids.otherSite,
  }, { db });
  const duplicateClientVisit = await recordClientProductAnalyticsEvent(ids.newcomer, {
    eventType: PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
    messageId: productMessageId("product-b", "new-current"),
  }, { db });
  assert.equal(firstClientVisit.ok, true);
  assert.equal(duplicateClientVisit.duplicate, true);
  const [[trustedClientEvent]] = await db.execute(
    `SELECT owner_user_id, site_id, COUNT(*) OVER () AS event_count
     FROM product_analytics_events
     WHERE event_type = ? AND user_id = ? AND message_id = ?`,
    [PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK, ids.newcomer, productMessageId("product-b", "new-current")]
  );
  assert.equal(trustedClientEvent.owner_user_id, ids.owner);
  assert.equal(trustedClientEvent.site_id, ids.site);
  assert.equal(Number(trustedClientEvent.event_count), 1);

  const searchReceipt = createProductSearchAnalyticsReceipt({
    userId: ids.newcomer,
    siteId: ids.site,
    siteSlug: `creator-${suffix}`,
    product: {
      id: "search-product",
      name: "Search Product",
      url: "https://example.test/products/search-product",
    },
  });
  assert.equal(verifyProductSearchAnalyticsReceipt(`${searchReceipt}x`, { userId: ids.newcomer }), null, "tampered search receipts must be rejected");
  assert.equal(verifyProductSearchAnalyticsReceipt(searchReceipt, { userId: ids.returning }), null, "search receipts must be bound to the signed-in user");
  const expiredSearchReceipt = createProductSearchAnalyticsReceipt({
    userId: ids.newcomer,
    siteId: ids.site,
    siteSlug: `creator-${suffix}`,
    product: { id: "expired-product" },
    now: Date.now() - 31 * 60 * 1000,
  });
  assert.equal(verifyProductSearchAnalyticsReceipt(expiredSearchReceipt, { userId: ids.newcomer }), null, "expired search receipts must be rejected");
  const searchClick = await recordClientProductAnalyticsEvent({
    id: ids.newcomer,
    site_id: ids.site,
    site_slug: `creator-${suffix}`,
  }, {
    eventType: PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_CLICK,
    searchReceipt,
    source: "search_product_result",
  }, { db });
  assert.equal(searchClick.ok, true, "a server-issued search result receipt should record without a chat message ID");
  const [[trustedSearchEvent]] = await db.execute(
    `SELECT site_id, site_slug, product_id, product_title, product_url
     FROM product_analytics_events
     WHERE event_type = ? AND user_id = ? AND product_id = ?
     LIMIT 1`,
    [PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_CLICK, ids.newcomer, "search-product"]
  );
  assert.deepEqual(trustedSearchEvent, {
    site_id: ids.site,
    site_slug: `creator-${suffix}`,
    product_id: "search-product",
    product_title: "Search Product",
    product_url: "https://example.test/products/search-product",
  });

  const dstPeriod = buildAnalyticsPeriod({ days: 7, now: new Date("2026-10-26T12:00:00.000Z") });
  const dstBuckets = buildNaturalDayBuckets(dstPeriod.startAt, dstPeriod.endAt, "Europe/London");
  assert.ok(dstBuckets.some((bucket) => bucket.endAt - bucket.startAt === 25 * 60 * 60 * 1000), "London DST transition should preserve a 25-hour natural day");

  const noCharacter = await getCreatorAnalytics({
    id: ids.otherOwner,
    account_type: "creator",
    site_id: ids.site,
  }, { range: "7d", now, db });
  assert.equal(noCharacter.character, null);
  assert.equal(noCharacter.summary.conversations, 0);
  assert.equal(noCharacter.topProducts.length, 0);

  console.log("creator analytics self-check passed");
} finally {
  await cleanupFixtures().catch((error) => console.error("creator analytics fixture cleanup failed", error));
  await closeDbPool();
}

async function seedFixtures() {
  await db.execute(
    `INSERT INTO sites (id, name, slug, time_zone, site_status, is_default)
     VALUES (?, 'Creator Test', ?, 'Europe/London', 'active', 0),
            (?, 'Other Test', ?, 'UTC', 'active', 0)`,
    [ids.site, `creator-${suffix}`, ids.otherSite, `other-${suffix}`]
  );
  for (const [id, type, siteId] of [
    [ids.owner, "creator", ids.site],
    [ids.otherOwner, "creator", ids.otherSite],
    [ids.returning, "personal", ids.site],
    [ids.newcomer, "personal", ids.site],
    [ids.previous, "personal", ids.site],
  ]) {
    await db.execute(
      `INSERT INTO users (
         id, platform, platform_uid, locale, username, password_hash, email, account_type, site_id, account_status
       ) VALUES (?, 'web', ?, 'en', ?, 'self-check', ?, ?, ?, 'active')`,
      [id, id, id, `${id}@example.test`, type, siteId]
    );
  }
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, visibility, character_status, source_type
     ) VALUES
       (?, 'creator', ?, ?, ?, 'Creator Test Character', 'public', 'published', 'self_check'),
       (?, 'creator', ?, ?, ?, 'Secondary Character', 'public', 'archived', 'self_check'),
       (?, 'creator', ?, ?, ?, 'Other Creator Character', 'public', 'published', 'self_check')`,
    [
      ids.character, ids.owner, ids.site, `creator-char-${suffix}`,
      ids.secondaryCharacter, ids.owner, ids.site, `secondary-char-${suffix}`,
      ids.otherCharacter, ids.otherOwner, ids.otherSite, `other-char-${suffix}`,
    ]
  );
  await db.execute("UPDATE ai_characters SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [ids.secondaryCharacter]);

  await insertSessionWithUserMessages("returning-current", ids.returning, ids.character, [
    "2026-07-19T10:00:00.000Z",
    "2026-07-20T10:00:00.000Z",
  ]);
  await insertSessionWithUserMessages("new-current", ids.newcomer, ids.character, ["2026-07-18T10:00:00.000Z"]);
  await insertSessionWithUserMessages("returning-old", ids.returning, ids.character, ["2026-05-01T10:00:00.000Z"]);
  await insertSessionWithUserMessages("previous-period", ids.previous, ids.character, ["2026-06-01T10:00:00.000Z"]);
  await insertSessionWithUserMessages("other-owner", ids.newcomer, ids.otherCharacter, ["2026-07-18T10:00:00.000Z"]);
  await insertSessionWithUserMessages("secondary-character", ids.newcomer, ids.secondaryCharacter, ["2026-07-18T10:00:00.000Z"]);

  const productA = await insertProductMessage("returning-current", ids.returning, ids.character, "product-a", ids.site, `creator-${suffix}`, "2026-07-19T10:05:00.000Z");
  const productB = await insertProductMessage("new-current", ids.newcomer, ids.character, "product-b", ids.site, `creator-${suffix}`, "2026-07-18T10:05:00.000Z");
  const productPrevious = await insertProductMessage("previous-period", ids.previous, ids.character, "product-a", ids.site, `creator-${suffix}`, "2026-06-01T10:05:00.000Z");
  const productOther = await insertProductMessage("other-owner", ids.newcomer, ids.otherCharacter, "product-other", ids.otherSite, `other-${suffix}`, "2026-07-18T10:05:00.000Z");
  const productCrossSite = await insertProductMessage("returning-current", ids.returning, ids.character, "product-cross", ids.otherSite, `creator-${suffix}`, "2026-07-19T10:06:00.000Z");

  await insertEvent("a-trigger-1", "product_bubble_triggered", ids.returning, productA, "2026-07-19T10:06:00.000Z", ids.otherOwner);
  await insertEvent("a-trigger-2", "product_bubble_triggered", ids.returning, productA, "2026-07-19T10:07:00.000Z");
  await insertEvent("a-visit", "product_detail_cta_click", ids.returning, productA, "2026-07-19T10:08:00.000Z");
  await insertEvent("b-trigger", "product_bubble_triggered", ids.newcomer, productB, "2026-07-18T10:06:00.000Z");
  await insertEvent("previous-trigger", "product_bubble_triggered", ids.previous, productPrevious, "2026-06-01T10:06:00.000Z");
  await insertEvent("other-owner", "product_bubble_triggered", ids.newcomer, productOther, "2026-07-18T10:06:00.000Z");
  await insertEvent("wrong-user", "product_bubble_triggered", ids.newcomer, productA, "2026-07-19T10:09:00.000Z");
  await insertEvent("cross-site", "product_bubble_triggered", ids.returning, productCrossSite, "2026-07-19T10:10:00.000Z");
  await insertEvent("orphan", "product_bubble_triggered", ids.returning, `missing_${suffix}`, "2026-07-19T10:11:00.000Z");
}

async function insertSessionWithUserMessages(key, userId, characterId, sentTimes) {
  const sessionId = sessionIdFor(key);
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_status, source_type)
     VALUES (?, ?, ?, 'active', 'self_check')`,
    [sessionId, userId, characterId]
  );
  let order = 10;
  for (const sentAt of sentTimes) {
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, content_type, text_content, display_order, delivery_status, source_type, sent_at
       ) VALUES (?, ?, ?, 'user', 'text', 'self-check', ?, 'sent', 'self_check', ?)`,
      [`msg_${key}_${order}_${suffix}`, sessionId, characterId, order, new Date(sentAt)]
    );
    order += 10;
  }
}

async function insertProductMessage(sessionKey, userId, characterId, productId, siteId, siteSlug, sentAt) {
  const messageId = productMessageId(productId, sessionKey);
  const payload = {
    id: productId,
    name: productId === "product-a" ? "Product A" : productId === "product-b" ? "Product B" : productId,
    imageUrl: `https://example.test/${productId}.jpg`,
    url: `https://example.test/products/${productId}`,
    siteId,
    siteSlug,
  };
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, content_type, text_content, product_payload_json,
       display_order, delivery_status, source_type, sent_at
     ) VALUES (?, ?, ?, 'character', 'product', ?, ?, 90, 'sent', 'self_check', ?)`,
    [messageId, sessionIdFor(sessionKey), characterId, payload.name, JSON.stringify(payload), new Date(sentAt)]
  );
  return messageId;
}

async function insertEvent(key, eventType, userId, messageId, createdAt, forgedOwner = "") {
  await db.execute(
    `INSERT INTO product_analytics_events (
       id, event_type, owner_user_id, user_id, message_id, source, created_at
     ) VALUES (?, ?, ?, ?, ?, 'self_check', ?)`,
    [`event_${key}_${suffix}`, eventType, forgedOwner || ids.owner, userId, messageId, new Date(createdAt)]
  );
}

function sessionIdFor(key) {
  return `session_${key}_${suffix}`;
}

function productMessageId(productId, sessionKey) {
  return `msg_product_${productId}_${sessionKey}_${suffix}`;
}

async function cleanupFixtures() {
  await db.execute(
    "DELETE FROM product_analytics_events WHERE id LIKE ? OR user_id IN (?, ?, ?)",
    [`event_%_${suffix}`, ids.returning, ids.newcomer, ids.previous]
  );
  await db.execute("DELETE FROM chat_messages WHERE source_type = 'self_check' AND id LIKE ?", [`%_${suffix}`]);
  await db.execute("DELETE FROM chat_sessions WHERE source_type = 'self_check' AND id LIKE ?", [`%_${suffix}`]);
  await db.execute("DELETE FROM ai_characters WHERE source_type = 'self_check' AND id IN (?, ?, ?)", [ids.character, ids.secondaryCharacter, ids.otherCharacter]);
  await db.execute("DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)", [ids.owner, ids.otherOwner, ids.returning, ids.newcomer, ids.previous]);
  await db.execute("DELETE FROM sites WHERE id IN (?, ?)", [ids.site, ids.otherSite]);
}
