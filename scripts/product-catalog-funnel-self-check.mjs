import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { getAdminProductAnalyticsOverview } from "../server/admin-product-analytics-service.js";
import { PRODUCT_ANALYTICS_EVENTS, recordClientProductAnalyticsEvent } from "../server/product-analytics-service.js";
import { createProductCatalogAnalyticsReceipt } from "../server/product-search-analytics-receipt-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "product catalog funnel self-check" });
await initializeDatabase();

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const ids = {
  site: `site_funnel_${suffix}`,
  otherSite: `site_funnel_other_${suffix}`,
  user: `u_funnel_${suffix}`,
  otherUser: `u_funnel_other_${suffix}`,
};
const slug = `funnel-${suffix}`;
const db = getDbPool();
const user = { id: ids.user, site_id: ids.site, site_slug: slug, account_type: "personal" };
const product = {
  id: `product_funnel_${suffix}`,
  name: "Unified funnel test shirt",
  url: `https://example.test/products/funnel-${suffix}`,
};

try {
  await seedFixtures();

  const searchReceipt = createProductCatalogAnalyticsReceipt({ userId: ids.user, siteId: ids.site, siteSlug: slug, product, source: "search" });
  const kitshopReceipt = createProductCatalogAnalyticsReceipt({ userId: ids.user, siteId: ids.site, siteSlug: slug, product, source: "kitshop" });

  await recordCatalogFlow(searchReceipt, [
    PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_IMPRESSION,
    PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_CLICK,
    PRODUCT_ANALYTICS_EVENTS.DETAIL_OPEN,
    PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
  ]);
  await recordCatalogFlow(kitshopReceipt, [
    PRODUCT_ANALYTICS_EVENTS.KITSHOP_IMPRESSION,
    PRODUCT_ANALYTICS_EVENTS.KITSHOP_CARD_CLICK,
    PRODUCT_ANALYTICS_EVENTS.DETAIL_OPEN,
    PRODUCT_ANALYTICS_EVENTS.DETAIL_CTA_CLICK,
  ]);

  const repeated = await recordClientProductAnalyticsEvent(user, {
    eventType: PRODUCT_ANALYTICS_EVENTS.KITSHOP_IMPRESSION,
    catalogReceipt: kitshopReceipt,
  }, { db });
  assert.equal(repeated.duplicate, true, "catalog renders should be de-duplicated within the guard window");

  await assert.rejects(
    () => recordClientProductAnalyticsEvent({ ...user, id: ids.otherUser }, {
      eventType: PRODUCT_ANALYTICS_EVENTS.SEARCH_RESULT_CLICK,
      catalogReceipt: searchReceipt,
    }, { db }),
    /Product search result is unavailable/
  );
  await assert.rejects(
    () => recordClientProductAnalyticsEvent(user, {
      eventType: PRODUCT_ANALYTICS_EVENTS.KITSHOP_CARD_CLICK,
      catalogReceipt: searchReceipt,
    }, { db }),
    /Product catalog event is unavailable/
  );

  await db.execute(
    `INSERT INTO product_analytics_events (
       id, event_type, site_id, site_slug, user_id, product_id, product_title, product_url, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chat')`,
    [`pae_chat_impression_${suffix}`, PRODUCT_ANALYTICS_EVENTS.BUBBLE_IMPRESSION, ids.site, slug, ids.user, product.id, product.name, product.url]
  );
  await db.execute(
    `INSERT INTO product_analytics_events (
       id, event_type, site_id, site_slug, user_id, product_id, product_title, product_url, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chat')`,
    [`pae_chat_click_${suffix}`, PRODUCT_ANALYTICS_EVENTS.BUBBLE_CLICK, ids.site, slug, ids.user, product.id, product.name, product.url]
  );

  const overview = await getAdminProductAnalyticsOverview({ range: "7d", site: ids.site });
  assert.deepEqual(overview.summary, {
    impressions: 3,
    clicks: 3,
    detailOpens: 2,
    ctaClicks: 2,
    ctr: 1,
    detailOpenRate: 0.6667,
    ctaClickRate: 1,
  });
  assert.deepEqual(overview.sourceBreakdown.map((item) => [item.source, item.impressions, item.clicks, item.detailOpens, item.ctaClicks]), [
    ["chat", 1, 1, 0, 0],
    ["search", 1, 1, 1, 1],
    ["kitshop", 1, 1, 1, 1],
  ]);
  assert.equal(overview.products.length, 3, "the ranking should retain source-specific rows for the same product");
  assert.deepEqual(new Set(overview.products.map((item) => item.source)), new Set(["chat", "search", "kitshop"]));

  console.log("product catalog funnel self-check passed");
} finally {
  await db.execute("DELETE FROM product_analytics_events WHERE id LIKE ? OR user_id IN (?, ?)", [`%${suffix}%`, ids.user, ids.otherUser]);
  await db.execute("DELETE FROM users WHERE id IN (?, ?)", [ids.user, ids.otherUser]);
  await db.execute("DELETE FROM sites WHERE id IN (?, ?)", [ids.site, ids.otherSite]);
  await closeDbPool();
}

async function recordCatalogFlow(catalogReceipt, eventTypes) {
  for (const eventType of eventTypes) {
    const result = await recordClientProductAnalyticsEvent(user, { eventType, catalogReceipt }, { db });
    assert.equal(result.ok, true, `${eventType} should be accepted for its signed catalog source`);
  }
}

async function seedFixtures() {
  await db.execute(
    `INSERT INTO sites (id, name, slug, time_zone, site_status, is_default)
     VALUES (?, 'Unified funnel test', ?, 'Europe/London', 'active', 0),
            (?, 'Unified funnel other site', ?, 'UTC', 'active', 0)`,
    [ids.site, slug, ids.otherSite, `other-${slug}`]
  );
  for (const [id, siteId] of [[ids.user, ids.site], [ids.otherUser, ids.otherSite]]) {
    await db.execute(
      `INSERT INTO users (id, platform, platform_uid, locale, username, password_hash, email, account_type, site_id, account_status)
       VALUES (?, 'web', ?, 'en', ?, 'self-check', ?, 'personal', ?, 'active')`,
      [id, id, id, `${id}@example.test`, siteId]
    );
  }
}
