import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createPromotionCampaign, listPromotionCampaigns, updatePromotionCampaign } from "../server/promotion-campaign-service.js";
import { resolvePromotionCampaignForProactive, reservePromotionCampaignDelivery, completePromotionCampaignDelivery } from "../server/promotion-campaign-match-service.js";

await initializeDatabase();

const suffix = Date.now();
const ids = {
  site: `site_campaign_${suffix}`,
  user: `u_campaign_${suffix}`,
  character: `creator_campaign_${suffix}`,
  session: `chat_campaign_${suffix}`,
  message: `msg_campaign_${suffix}`,
};

try {
  await seed();

  const campaign = await createPromotionCampaign({
    title: "AC Milan flash offer",
    siteId: ids.site,
    roleTarget: "creator",
    productId: "acm-001",
    productTitle: "AC Milan Home Shirt",
    productUrl: "https://footballkituk.example/products/ac-milan-home-shirt",
    discountCode: "MILAN10",
    messageText: "Quick one, bro - AC Milan shirts are on a short promo today if you want to check them out.",
    keywords: ["ac", "milan", "shirt"],
    priority: 20,
    status: "active",
    startsAt: "2026-06-22T00:00:00.000Z",
    endsAt: "2099-06-23T00:00:00.000Z",
    sourceRef: `campaign-self-check-${suffix}`,
  });
  assertEqual(campaign.item.discountCode, "MILAN10", "created campaign should persist discount code");

  let missingProductFailed = false;
  try {
    await createPromotionCampaign({
      title: "Broken campaign",
      siteId: ids.site,
      roleTarget: "creator",
      productTitle: "Typed but not selected",
      messageText: "This should not save.",
      status: "draft",
      sourceRef: `campaign-self-check-${suffix}`,
    });
  } catch (error) {
    missingProductFailed = /选择商品|商品/.test(error.message || "");
  }
  assertEqual(missingProductFailed, true, "campaign save should require a selected product id and URL");

  await assertRejects(
    () => createPromotionCampaign({
      title: "Expired active campaign",
      siteId: ids.site,
      roleTarget: "creator",
      productId: "expired-001",
      productTitle: "Expired Shirt",
      productUrl: "https://footballkituk.example/products/expired-shirt",
      messageText: "This active campaign is already expired.",
      status: "active",
      endsAt: "2026-01-01T00:00:00.000Z",
      sourceRef: `campaign-self-check-${suffix}`,
    }),
    /结束时间必须晚于当前时间/,
    "active campaign save should reject an expired end time"
  );
  await assertRejects(
    () => updatePromotionCampaign(campaign.item.id, {
      status: "active",
      endsAt: "2026-01-01T00:00:00.000Z",
    }),
    /结束时间必须晚于当前时间/,
    "active campaign edit should reject an expired end time"
  );

  const historicalDraft = await createPromotionCampaign({
    title: "Historical draft campaign",
    siteId: ids.site,
    roleTarget: "creator",
    productId: "history-001",
    productTitle: "Historical Shirt",
    productUrl: "https://footballkituk.example/products/historical-shirt",
    messageText: "Historical drafts may retain an expired end time.",
    status: "draft",
    endsAt: "2026-01-01T00:00:00.000Z",
    sourceRef: `campaign-self-check-${suffix}`,
  });
  await getDbPool().execute(
    "UPDATE promotion_campaigns SET campaign_status = 'active' WHERE id = ?",
    [historicalDraft.item.id]
  );

  const listResult = await listPromotionCampaigns();
  const listed = listResult.items.find((item) => item.id === campaign.item.id);
  assertEqual(Boolean(listed), true, "created campaign should appear in admin list");
  assertEqual(listed.discountCode, "MILAN10", "admin list should include discount code");
  const archivedHistorical = listResult.items.find((item) => item.id === historicalDraft.item.id);
  assertEqual(archivedHistorical.status, "archived", "admin list should reconcile a legacy expired active campaign to archived");

  const firstMatch = await resolvePromotionCampaignForProactive({
    userId: ids.user,
    characterId: ids.character,
    sessionId: ids.session,
    now: new Date("2026-06-22T12:00:00.000Z"),
    recentMessages: [
      { senderType: "user", text: "do you have ac milan shirts?" },
      { senderType: "character", text: "Yeah, I can help with that." },
    ],
  });
  assertEqual(firstMatch.matched, true, "campaign should match relevant proactive context");
  assertEqual(firstMatch.campaign.id, campaign.item.id, "matched campaign id should match created campaign");
  assertEqual(firstMatch.campaign.discountCode, "MILAN10", "matched campaign should carry discount code");

  const reserved = await reservePromotionCampaignDelivery({
    campaign: firstMatch.campaign,
    userId: ids.user,
    characterId: ids.character,
    sessionId: ids.session,
    matchScore: firstMatch.matchScore,
    matchReason: firstMatch.matchReason,
  });
  assertEqual(reserved.reserved, true, "first campaign delivery should reserve");

  await completePromotionCampaignDelivery({
    deliveryId: reserved.deliveryId,
    messageId: "msg_campaign_delivery_check",
  });

  await seedAnalyticsEvents(campaign.item.id);
  const listWithStats = await listPromotionCampaigns();
  const listedWithStats = listWithStats.items.find((item) => item.id === campaign.item.id);
  assertEqual(listedWithStats.stats.sentCount, 1, "campaign stats should count sent deliveries");
  assertEqual(listedWithStats.stats.bubbleImpressions, 1, "campaign stats should count product impressions");
  assertEqual(listedWithStats.stats.bubbleClicks, 1, "campaign stats should count product bubble clicks");
  assertEqual(listedWithStats.stats.detailOpens, 1, "campaign stats should count detail opens");
  assertEqual(listedWithStats.stats.ctaClicks, 1, "campaign stats should count CTA clicks");
  assertEqual(listedWithStats.stats.ctr, 1, "campaign stats should calculate CTR");
  assertEqual(listedWithStats.stats.ctaClickRate, 1, "campaign stats should calculate CTA click rate");

  const secondMatch = await resolvePromotionCampaignForProactive({
    userId: ids.user,
    characterId: ids.character,
    sessionId: ids.session,
    now: new Date("2026-06-22T12:05:00.000Z"),
    recentMessages: [{ senderType: "user", text: "ac milan again" }],
  });
  assertEqual(secondMatch.matched, false, "same account should not match the same campaign twice");
  assertEqual(secondMatch.reason, "no_campaign", "second match should report no campaign after delivery");

  console.log(JSON.stringify({ ok: true, campaignId: campaign.item.id, firstMatch, secondMatch }, null, 2));
} finally {
  await cleanup();
  await closeDbPool();
}

async function seedAnalyticsEvents(campaignId) {
  const db = getDbPool();
  const events = [
    "product_bubble_impression",
    "product_bubble_click",
    "product_detail_open",
    "product_detail_cta_click",
  ];
  for (const eventType of events) {
    await db.execute(
      `INSERT INTO product_analytics_events (
         id, event_type, site_id, site_slug, character_id, user_id, session_id, message_id,
         product_id, product_title, product_url, source, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'self-check', JSON_OBJECT('campaignId', ?))`,
      [
        `pae_campaign_${eventType}_${suffix}`,
        eventType,
        ids.site,
        `campaign-${suffix}`,
        ids.character,
        ids.user,
        ids.session,
        "msg_campaign_delivery_check",
        "acm-001",
        "AC Milan Home Shirt",
        "https://footballkituk.example/products/ac-milan-home-shirt",
        campaignId,
      ]
    );
  }
}

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Campaign Site', ?, '', 'English', 'GBP', 'Europe/London', 'active', 0, NULL, '', 'campaign self-check')`,
    [ids.site, `campaign-${suffix}`]
  );
  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
     VALUES (?, ?, ?, 'x', ?, 'active', 'personal', ?)`,
    [ids.user, ids.user, ids.user, `${ids.user}@example.local`, ids.site]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'creator', NULL, ?, ?, 'Campaign Creator', 'Self Check', 'self-check', 'assets/char_fan.png', 'assets/banner_hero.png',
       'hello', 'self-check prompt', 'friendly', JSON_ARRAY('creator'), JSON_OBJECT(), JSON_OBJECT(),
       'public', 'published', 'self-check', 'campaign-self-check', NOW(3))`,
    [ids.character, ids.site, `${ids.character}-slug`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, ?, ?, 'campaign self-check', 'active', 'user', 'campaign-self-check', 'English', NOW(3))`,
    [ids.session, ids.user, ids.character]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'user', 'You', 'text', 'do you have ac milan shirts?', 10, 'sent', 'user', 'self-check', NOW(3))`,
    [ids.message, ids.session, ids.character]
  );
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM product_analytics_events WHERE user_id = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaign_deliveries WHERE internal_uid = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaigns WHERE source_ref = ?", [`campaign-self-check-${suffix}`]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [ids.session]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [ids.session]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [ids.character]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [ids.site]).catch(() => {});
}

function assertEqual(actual, expected, message) {
  if (actual === expected) return;
  throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

async function assertRejects(action, pattern, message) {
  try {
    await action();
  } catch (error) {
    if (pattern.test(error.message || "")) return;
    throw new Error(`${message}: unexpected error ${error.message || error}`);
  }
  throw new Error(`${message}: expected rejection`);
}
