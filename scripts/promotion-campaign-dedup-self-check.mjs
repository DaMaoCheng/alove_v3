import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createPromotionCampaign } from "../server/promotion-campaign-service.js";
import {
  hasRecentlySeenPromotionCampaign,
  listRecentlySeenPromotionCampaignIds,
} from "../server/promotion-campaign-dedup-service.js";
import { buildCampaignProductPayload } from "../server/promotion-campaign-product-payload-service.js";
import { resolvePromotionCampaignForProactive } from "../server/promotion-campaign-match-service.js";

await initializeDatabase();

const suffix = Date.now();
const ids = {
  site: `site_campaign_dedup_${suffix}`,
  user: `u_campaign_dedup_${suffix}`,
  otherUser: `u_campaign_dedup_other_${suffix}`,
  character: `creator_campaign_dedup_${suffix}`,
  session: `chat_campaign_dedup_${suffix}`,
  otherSession: `chat_campaign_dedup_other_${suffix}`,
  userMessage: `msg_campaign_dedup_user_${suffix}`,
  seenProductMessage: `msg_campaign_dedup_seen_${suffix}`,
  oldProductMessage: `msg_campaign_dedup_old_${suffix}`,
};

try {
  await seedBaseRows();

  const campaign = await createPromotionCampaign({
    title: "AC Milan dedup offer",
    siteId: ids.site,
    roleTarget: "creator",
    productId: "acm-dedup-001",
    productTitle: "AC Milan Dedup Shirt",
    productUrl: "https://footballkituk.example/products/ac-milan-dedup-shirt",
    productSnapshot: {
      id: "acm-dedup-001",
      sku: "ACM-DEDUP",
      name: "AC Milan Dedup Shirt",
      subtitle: "Campaign check",
      price: "£49.99",
      priceWas: "£69.99",
      url: "https://footballkituk.example/products/ac-milan-dedup-shirt",
      imageUrl: "https://img.example/acm-dedup-main.jpg",
      imageUrls: ["https://img.example/acm-dedup-main.jpg"],
      sizes: [{ label: "M", available: true, sku: "ACM-DEDUP-M", price: "£49.99" }],
      features: ["AC Milan", "Limited promo"],
    },
    discountCode: "MILAN10",
    messageText: "Quick one, bro - AC Milan shirts are on a short promo today.",
    keywords: ["ac", "milan", "shirt"],
    priority: 20,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    sourceRef: `campaign-dedup-self-check-${suffix}`,
  });

  const product = buildCampaignProductPayload(campaign.item);
  assertEqual(product.campaignId, campaign.item.id, "campaign payload should include campaign id");
  assertEqual(product.siteId, ids.site, "campaign payload should include site id");
  assertEqual(product.discountCode, "MILAN10", "campaign payload should keep discount code");
  assertEqual(product.features[0], "Code: MILAN10", "campaign payload should expose code as first feature");

  await insertSeenProductMessage({
    id: ids.seenProductMessage,
    sessionId: ids.session,
    campaign: campaign.item,
    sentAtSql: "DATE_SUB(NOW(3), INTERVAL 2 HOUR)",
  });
  await insertSeenProductMessage({
    id: ids.oldProductMessage,
    sessionId: ids.session,
    campaign: campaign.item,
    sentAtSql: "DATE_SUB(NOW(3), INTERVAL 25 HOUR)",
  });
  const db = getDbPool();
  const recentIds = await listRecentlySeenPromotionCampaignIds(db, {
    userId: ids.user,
    siteId: ids.site,
    withinHours: 24,
  });
  assertEqual(recentIds.length, 1, "recent seen campaign list should dedupe campaign ids");
  assertEqual(recentIds[0], campaign.item.id, "recent seen campaign id should match campaign");

  const seen = await hasRecentlySeenPromotionCampaign(db, {
    userId: ids.user,
    siteId: ids.site,
    campaignId: campaign.item.id,
    withinHours: 24,
  });
  assertEqual(seen, true, "recent campaign should be detected");

  const seenWithOneHourWindow = await hasRecentlySeenPromotionCampaign(db, {
    userId: ids.user,
    siteId: ids.site,
    campaignId: campaign.item.id,
    withinHours: 1,
  });
  assertEqual(seenWithOneHourWindow, false, "campaign outside short window should not be detected");

  const firstMatch = await resolvePromotionCampaignForProactive({
    userId: ids.user,
    characterId: ids.character,
    sessionId: ids.session,
    recentMessages: [{ senderType: "user", text: "do you have ac milan shirts?" }],
  });
  assertEqual(firstMatch.matched, false, "recently seen campaign should be skipped for proactive");
  assertEqual(firstMatch.reason, "no_campaign", "recently seen campaign should leave no eligible campaign");

  const otherUserMatch = await resolvePromotionCampaignForProactive({
    userId: ids.otherUser,
    characterId: ids.character,
    sessionId: ids.otherSession,
    recentMessages: [{ senderType: "user", text: "do you have ac milan shirts?" }],
  });
  assertEqual(otherUserMatch.matched, true, "other user should still match the campaign");
  assertEqual(otherUserMatch.campaign.id, campaign.item.id, "other user matched campaign should be the created campaign");

  console.log(JSON.stringify({ ok: true, campaignId: campaign.item.id, recentIds }, null, 2));
} finally {
  await cleanup();
  await closeDbPool();
}

async function seedBaseRows() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Campaign Dedup Site', ?, '', 'English', 'GBP', 'Europe/London', 'active', 0, NULL, '', 'campaign dedup self-check')`,
    [ids.site, `campaign-dedup-${suffix}`]
  );
  for (const userId of [ids.user, ids.otherUser]) {
    await db.execute(
      `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
       VALUES (?, ?, ?, 'x', ?, 'active', 'personal', ?)`,
      [userId, userId, userId, `${userId}@example.local`, ids.site]
    );
  }
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'creator', NULL, ?, ?, 'Campaign Dedup Creator', 'Self Check', 'self-check', 'assets/char_fan.png', 'assets/banner_hero.png',
       'hello', 'self-check prompt', 'friendly', JSON_ARRAY('creator'), JSON_OBJECT(), JSON_OBJECT(),
       'public', 'published', 'self-check', 'campaign-dedup-self-check', NOW(3))`,
    [ids.character, ids.site, `${ids.character}-slug`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, ?, ?, 'campaign dedup self-check', 'active', 'user', 'campaign-dedup-self-check', 'English', NOW(3))`,
    [ids.session, ids.user, ids.character]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, ?, ?, 'campaign dedup self-check other', 'active', 'user', 'campaign-dedup-self-check', 'English', NOW(3))`,
    [ids.otherSession, ids.otherUser, ids.character]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'user', 'You', 'text', 'do you have ac milan shirts?', 10, 'sent', 'user', 'self-check', DATE_SUB(NOW(3), INTERVAL 5 HOUR))`,
    [ids.userMessage, ids.session, ids.character]
  );
}

async function insertSeenProductMessage({ id, sessionId, campaign, sentAtSql }) {
  const db = getDbPool();
  const product = buildCampaignProductPayload(campaign);
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'character', 'Campaign Dedup Creator', 'product', ?, ?, 20, 'sent', 'promotion_campaign', 'promotion-campaign-product', ${sentAtSql})`,
    [id, sessionId, ids.character, product.name, JSON.stringify(product)]
  );
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM promotion_campaign_deliveries WHERE internal_uid IN (?, ?)", [ids.user, ids.otherUser]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaigns WHERE source_ref = ?", [`campaign-dedup-self-check-${suffix}`]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (?, ?)", [ids.session, ids.otherSession]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?)", [ids.session, ids.otherSession]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [ids.character]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?)", [ids.user, ids.otherUser]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [ids.site]).catch(() => {});
}

function assertEqual(actual, expected, message) {
  if (actual === expected) return;
  throw new Error(`${message}: expected ${expected}, received ${actual}`);
}
