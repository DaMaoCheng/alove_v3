import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createPromotionCampaign } from "../server/promotion-campaign-service.js";
import { getDeliveryDateForTimeZone } from "../server/proactive-message-delivery-service.js";
import { sendProactiveMessageFromJob } from "../server/proactive-message-job-service.js";

await initializeDatabase();

const suffix = Date.now();
const ids = {
  site: `site_campaign_product_${suffix}`,
  user: `u_campaign_product_${suffix}`,
  character: `creator_campaign_product_${suffix}`,
  session: `chat_campaign_product_${suffix}`,
  message: `msg_campaign_product_${suffix}`,
};
const deliveryDate = getDeliveryDateForTimeZone(new Date(), "Europe/London");

try {
  await seed();

  const campaign = await createPromotionCampaign({
    title: "AC Milan product bubble offer",
    siteId: ids.site,
    roleTarget: "creator",
    productId: "acm-001",
    productTitle: "AC Milan Home Shirt",
    productUrl: "https://footballkituk.example/products/ac-milan-home-shirt",
    productSnapshot: {
      id: "acm-001",
      sku: "ACM-HOME",
      name: "AC Milan Home Shirt",
      subtitle: "Supporter edition",
      price: "£49.99",
      priceWas: "£69.99",
      url: "https://footballkituk.example/products/ac-milan-home-shirt",
      imageUrl: "https://img.example/acm-main.jpg",
      imageUrls: ["https://img.example/acm-main.jpg", "https://img.example/acm-back.jpg"],
      stock: "Available",
      sizes: [{ label: "M", available: true, sku: "ACM-HOME-M", price: "£49.99" }],
      features: ["AC Milan", "Home shirt"],
    },
    discountCode: "MILAN10",
    messageText: "Quick one, bro — AC Milan shirts are on promo today.",
    keywords: ["ac", "milan", "shirt"],
    priority: 20,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    sourceRef: `campaign-product-self-check-${suffix}`,
  });

  const result = await sendProactiveMessageFromJob({
    userId: ids.user,
    characterId: ids.character,
    sessionId: ids.session,
    payload: {
      userId: ids.user,
      characterId: ids.character,
      sessionId: ids.session,
      deliveryMode: "daily_required",
      slotIndex: 1,
      deliveryDate,
      selectedBy: "self_check",
      minIdleMinutes: 0,
      maxUnansweredProactive: 1,
      ignoreQuietHours: true,
    },
  });

  assertEqual(result.sent, true, "campaign proactive job should send");
  assertEqual(result.reason, "promotion_campaign_sent", "campaign proactive job should use campaign path");
  assertEqual(result.campaignId, campaign.item.id, "sent campaign id should match created campaign");
  assertEqual(Boolean(result.productMessageId), true, "campaign proactive job should return product message id");

  const db = getDbPool();
  const [messages] = await db.execute(
    `SELECT id, content_type, text_content, product_payload_json, source_ref, display_order
     FROM chat_messages
     WHERE session_id = ?
       AND source_ref IN ('promotion-campaign', 'promotion-campaign-product')
     ORDER BY display_order ASC`,
    [ids.session]
  );
  assertEqual(messages.length, 2, "campaign send should create text and product messages");
  assertEqual(messages[0].content_type, "text", "campaign text message should come first");
  assertEqual(messages[0].text_content, "Quick one, bro — AC Milan shirts are on promo today.", "campaign text should be preserved");
  assertEqual(messages[1].content_type, "product", "campaign product bubble should be a product message");
  assertEqual(messages[1].text_content, "AC Milan Home Shirt", "product message text should be product title");
  assertEqual(messages[1].source_ref, "promotion-campaign-product", "product message should identify campaign product source");

  const product = typeof messages[1].product_payload_json === "string"
    ? JSON.parse(messages[1].product_payload_json || "{}")
    : messages[1].product_payload_json || {};
  assertEqual(product.id, "acm-001", "product payload should include campaign product id");
  assertEqual(product.name, "AC Milan Home Shirt", "product payload should include campaign product title");
  assertEqual(product.url, "https://footballkituk.example/products/ac-milan-home-shirt", "product payload should include campaign product URL");
  assertEqual(product.imageUrl, "https://img.example/acm-main.jpg", "product payload should include snapshot image");
  assertEqual(product.priceNow, "£49.99", "product payload should include snapshot current price");
  assertEqual(product.priceWas, "£69.99", "product payload should include snapshot compare price");
  assertEqual(product.sizes?.[0]?.sku, "ACM-HOME-M", "product payload should include snapshot sizes");
  assertEqual(product.code, "MILAN10", "product payload should include discount code as display code");
  assertEqual(product.discountCode, "MILAN10", "product payload should keep discount code for product detail fallback");
  assertEqual(product.siteId, ids.site, "product payload should include site id");
  assertEqual(product.siteSlug, `campaign-product-${suffix}`, "product payload should include site slug");

  const [deliveries] = await db.execute(
    `SELECT message_id, delivery_status
     FROM promotion_campaign_deliveries
     WHERE campaign_id = ? AND internal_uid = ?
     LIMIT 1`,
    [campaign.item.id, ids.user]
  );
  assertEqual(deliveries[0]?.message_id, messages[1].id, "campaign delivery should point to product message id");
  assertEqual(deliveries[0]?.delivery_status, "sent", "campaign delivery should be marked sent");

  const [proactiveDeliveries] = await db.execute(
    `SELECT source_type, slot_index, campaign_id, message_id, delivery_status
     FROM proactive_message_deliveries
     WHERE internal_uid = ?
       AND delivery_date = ?
     ORDER BY created_at ASC`,
    [ids.user, deliveryDate]
  );
  assertEqual(proactiveDeliveries.length, 1, "campaign proactive send should consume exactly one account-level delivery slot");
  assertEqual(proactiveDeliveries[0]?.source_type, "promotion_campaign", "campaign proactive send should record promotion source type");
  assertEqual(proactiveDeliveries[0]?.slot_index, 1, "campaign proactive send should consume slot 1");
  assertEqual(proactiveDeliveries[0]?.campaign_id, campaign.item.id, "campaign proactive send should record the campaign id");
  assertEqual(proactiveDeliveries[0]?.message_id, messages[1].id, "account-level delivery should point to the product bubble message");
  assertEqual(proactiveDeliveries[0]?.delivery_status, "sent", "account-level delivery should be marked sent");

  console.log(JSON.stringify({ ok: true, campaignId: campaign.item.id, textMessageId: messages[0].id, productMessageId: messages[1].id }, null, 2));
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Campaign Product Site', ?, '', 'English', 'GBP', 'Europe/London', 'active', 0, NULL, '', 'campaign product self-check')`,
    [ids.site, `campaign-product-${suffix}`]
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
       'public', 'published', 'self-check', 'campaign-product-self-check', NOW(3))`,
    [ids.character, ids.site, `${ids.character}-slug`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, ?, ?, 'campaign product self-check', 'active', 'user', 'campaign-product-self-check', 'English', DATE_SUB(NOW(3), INTERVAL 5 HOUR))`,
    [ids.session, ids.user, ids.character]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'user', 'You', 'text', 'do you have ac milan shirts?', 10, 'sent', 'user', 'self-check', DATE_SUB(NOW(3), INTERVAL 5 HOUR))`,
    [ids.message, ids.session, ids.character]
  );
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM proactive_message_deliveries WHERE internal_uid = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaign_deliveries WHERE internal_uid = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaigns WHERE source_ref = ?", [`campaign-product-self-check-${suffix}`]).catch(() => {});
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
