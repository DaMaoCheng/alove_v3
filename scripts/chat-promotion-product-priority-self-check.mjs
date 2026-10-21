import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createPromotionCampaign, updatePromotionCampaign } from "../server/promotion-campaign-service.js";
import { buildChatProductRecommendationContext } from "../server/chat-product-recommendation-service.js";
import { insertProductReplyMessage, selectProductForMessage } from "../server/chat-product-reply-service.js";
import { PRODUCT_TRIGGER_QUICK, isAlternativeProductRequest } from "../server/product-intent-service.js";
import { createUserMemoryRecord } from "../server/user-memory-record-service.js";

await initializeDatabase();

const suffix = Date.now();
const ids = {
  site: `site_chat_campaign_${suffix}`,
  user: `u_chat_campaign_${suffix}`,
  character: `creator_chat_campaign_${suffix}`,
  session: `chat_campaign_priority_${suffix}`,
};

try {
  await seed();

  const wrongRoleCampaign = await createPromotionCampaign({
    title: "Wrong role campaign",
    siteId: ids.site,
    roleTarget: "mascot",
    productId: "wrong-role-001",
    productTitle: "Wrong Role Shirt",
    productUrl: "https://footballkituk.example/products/wrong-role-shirt",
    productSnapshot: buildSnapshot("wrong-role-001", "Wrong Role Shirt"),
    messageText: "Wrong role should not show.",
    keywords: ["shirt"],
    priority: 1,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    sourceRef: `chat-campaign-priority-self-check-${suffix}`,
  });
  const lowPriorityCampaign = await createPromotionCampaign({
    title: "Low priority campaign",
    siteId: ids.site,
    roleTarget: "all",
    productId: "low-priority-001",
    productTitle: "Low Priority Shirt",
    productUrl: "https://footballkituk.example/products/low-priority-shirt",
    productSnapshot: buildSnapshot("low-priority-001", "Low Priority Shirt"),
    messageText: "Low priority should lose.",
    keywords: ["shirt"],
    priority: 50,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    sourceRef: `chat-campaign-priority-self-check-${suffix}`,
  });
  const bestCampaign = await createPromotionCampaign({
    title: "Best campaign",
    siteId: ids.site,
    roleTarget: "creator",
    productId: "best-campaign-001",
    productTitle: "Best Campaign Shirt",
    productUrl: "https://footballkituk.example/products/best-campaign-shirt",
    productSnapshot: buildSnapshot("best-campaign-001", "Best Campaign Shirt"),
    discountCode: "BEST10",
    messageText: "Best campaign should win.",
    keywords: ["shirt"],
    priority: 10,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    sourceRef: `chat-campaign-priority-self-check-${suffix}`,
  });

  const db = getDbPool();
  const character = await loadCharacter();
  const recommendation = await buildChatProductRecommendationContext(db, {
    character,
    userId: ids.user,
    sessionId: ids.session,
    userText: "recommend a product",
    recentMessages: [],
    classifyCommerce: approvedShoppingClassification,
  });
  assertEqual(recommendation.sourceType, "promotion_campaign", "chat recommendation should prefer campaign source");
  assertEqual(recommendation.campaign.id, bestCampaign.item.id, "chat recommendation should choose best campaign by role and priority");
  assertEqual(recommendation.products[0].name, "Best Campaign Shirt", "campaign product should come from snapshot");
  assertEqual(recommendation.products[0].discountCode, "BEST10", "campaign product should include discount code");

  for (const classifyCommerce of [
    async () => ({ confident: false, confidence: 0 }),
    async () => ({ ...(await approvedShoppingClassification()), replyBoundary: { salesAllowed: false, contactAllowed: false } }),
  ]) {
    const restricted = await buildChatProductRecommendationContext(db, {
      character, userId: ids.user, sessionId: ids.session,
      userText: "recommend a product", recentMessages: [], classifyCommerce,
      fetchProducts: async () => { throw new Error("Isolated catalogue source unavailable"); },
    });
    assertEqual(Boolean(restricted?.campaign), false, "uncertain or no-sales classification must not select an active campaign");
    assertEqual(selectProductForMessage(restricted), null, "uncertain or no-sales classification must not emit any product card");
  }

  const quickRecommendation = await buildChatProductRecommendationContext(db, {
    character,
    userId: ids.user,
    sessionId: ids.session,
    userText: "how was your day",
    productTrigger: PRODUCT_TRIGGER_QUICK,
    recentMessages: [],
    classifyCommerce: approvedShoppingClassification,
  });
  assertEqual(quickRecommendation.sourceType, "promotion_campaign", "quick product trigger should prefer campaign source");
  assertEqual(quickRecommendation.campaign.id, bestCampaign.item.id, "quick product trigger should choose best campaign");

  const constrainedRecommendation = await buildChatProductRecommendationContext(db, {
    character,
    userId: ids.user,
    sessionId: `${ids.session}_hard_requirement`,
    userText: "England black goalkeeper third shirt 2026/27",
    recentMessages: [],
    classifyCommerce: approvedShoppingClassification,
    fetchProducts: async () => [
      {
        id: "england-hard-match",
        name: "England Third Goalkeeper Soccer Jersey 2026/27 Black",
        price: "£49.99",
        url: "https://footballkituk.example/products/england-hard-match",
        imageUrl: "https://img.example/england-hard-match.jpg",
      },
    ],
  });
  assertEqual(constrainedRecommendation.sourceType, "product_api", "campaign must not override explicit catalogue constraints");
  assertEqual(constrainedRecommendation.products[0].name, "England Third Goalkeeper Soccer Jersey 2026/27 Black", "hard requirements must select the matching API product");

  const selectedProduct = selectProductForMessage(recommendation);
  const productMessage = await insertProductReplyMessage(db, {
    session: { id: ids.session },
    character,
    userId: ids.user,
    characterId: ids.character,
    product: selectedProduct,
    displayOrder: 20,
  });
  const [messageRows] = await db.execute(
    `SELECT source_type, source_ref, product_payload_json
     FROM chat_messages
     WHERE id = ?
     LIMIT 1`,
    [productMessage.id]
  );
  assertEqual(messageRows[0]?.source_type, "promotion_campaign", "campaign chat product bubble should use campaign source type");
  assertEqual(messageRows[0]?.source_ref, "promotion-campaign-product", "campaign chat product bubble should use campaign source ref");
  const payload = typeof messageRows[0]?.product_payload_json === "string"
    ? JSON.parse(messageRows[0].product_payload_json || "{}")
    : messageRows[0]?.product_payload_json || {};
  assertEqual(payload.campaignId, bestCampaign.item.id, "campaign chat product payload should keep campaign id");
  assertEqual(isAlternativeProductRequest("show me another one"), true, "alternative intent should detect another one");
  assertEqual(isAlternativeProductRequest("换一个"), true, "alternative intent should detect Chinese alternative request");

  const alternativeRecommendation = await buildChatProductRecommendationContext(db, {
    character,
    userId: ids.user,
    sessionId: ids.session,
    userText: "show me another one",
    recentMessages: [],
    classifyCommerce: approvedShoppingClassification,
  });
  assertEqual(alternativeRecommendation.sourceType, "promotion_campaign", "alternative should still use campaign if another campaign is available");
  assertEqual(alternativeRecommendation.campaign.id, lowPriorityCampaign.item.id, "alternative should skip recently shown campaign");
  assertEqual(alternativeRecommendation.products[0].name, "Low Priority Shirt", "alternative should choose the next campaign product");

  const [campaignDeliveries] = await db.execute(
    "SELECT COUNT(*) AS total FROM promotion_campaign_deliveries WHERE internal_uid = ?",
    [ids.user]
  );
  assertEqual(Number(campaignDeliveries[0]?.total || 0), 0, "chat recommendation should not write campaign deliveries");
  const [proactiveDeliveries] = await db.execute(
    "SELECT COUNT(*) AS total FROM proactive_message_deliveries WHERE internal_uid = ?",
    [ids.user]
  );
  assertEqual(Number(proactiveDeliveries[0]?.total || 0), 0, "chat recommendation should not write proactive deliveries");

  for (const campaign of [wrongRoleCampaign, lowPriorityCampaign, bestCampaign]) {
    await updatePromotionCampaign(campaign.item.id, { status: "paused" });
  }
  await createUserMemoryRecord(db, {
    userId: ids.user,
    memoryType: "favorite_club",
    summary: "AC Milan",
    content: "AC Milan",
    confidenceScore: 90,
    importanceScore: 90,
    freshnessScore: 90,
    sourceKind: "manual",
  });
  await createUserMemoryRecord(db, {
    userId: ids.user,
    memoryType: "purchased_product",
    summary: "Already Bought Shirt",
    content: "Already Bought Shirt",
    confidenceScore: 90,
    importanceScore: 80,
    freshnessScore: 80,
    sourceKind: "manual",
  });
  let fallbackQuery = "";
  const fallback = await buildChatProductRecommendationContext(db, {
    character,
    userId: ids.user,
    sessionId: ids.session,
    userText: "show me another one",
    recentMessages: [],
    classifyCommerce: approvedShoppingClassification,
    fetchProducts: async (_url, searchIntent = {}) => {
      fallbackQuery = searchIntent.query || "";
      return [
        {
          id: "already-bought-001",
          name: "Already Bought Shirt",
          price: "£39.99",
          url: "https://footballkituk.example/products/already-bought-shirt",
          imageUrl: "https://img.example/already-bought.jpg",
        },
        {
          id: "api-fallback-001",
          name: "API Fallback Shirt",
          price: "£44.99",
          url: "https://footballkituk.example/products/api-fallback-shirt",
          imageUrl: "https://img.example/api-fallback.jpg",
        },
      ];
    },
  });
  assertEqual(fallback.sourceType, "product_api", "no campaign should fall back to product API source");
  assertEqual(fallbackQuery, "AC Milan shirt", "alternative fallback should use favorite club memory as query");
  assertEqual(fallback.products[0].name, "API Fallback Shirt", "fallback should return API product");

  console.log(JSON.stringify({
    ok: true,
    bestCampaignId: bestCampaign.item.id,
    productMessageId: productMessage.id,
    fallbackProduct: fallback.products[0].name,
  }, null, 2));
} finally {
  await cleanup();
  await closeDbPool();
}

// This SQL test covers campaign ordering and hard catalogue constraints;
// commerce interpretation is isolated from provider configuration and billing.
async function approvedShoppingClassification() {
  return { route: "product_search", confidence: .99, confident: true, searchQuery: "", productRequest: { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" }, replyBoundary: { salesAllowed: true, contactAllowed: true } };
}

function buildSnapshot(id, name) {
  return {
    id,
    sku: id.toUpperCase(),
    name,
    subtitle: "Campaign check",
    price: "£49.99",
    priceWas: "£69.99",
    url: `https://footballkituk.example/products/${id}`,
    imageUrl: `https://img.example/${id}.jpg`,
    imageUrls: [`https://img.example/${id}.jpg`],
    sizes: [{ label: "M", available: true, sku: `${id}-M`, price: "£49.99" }],
    features: ["Campaign", "Available now"],
  };
}

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Chat Campaign Site', ?, '', 'English', 'GBP', 'Europe/London', 'active', 0, NULL, 'https://footballkituk.example/products.json', 'chat campaign priority self-check')`,
    [ids.site, `chat-campaign-${suffix}`]
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
     ) VALUES (?, 'creator', NULL, ?, ?, 'Chat Campaign Creator', 'Self Check', 'self-check', 'assets/char_fan.png', 'assets/banner_hero.png',
       'hello', 'self-check prompt', 'friendly', JSON_ARRAY('creator'), JSON_OBJECT(), JSON_OBJECT(),
       'public', 'published', 'self-check', 'chat-campaign-priority-self-check', NOW(3))`,
    [ids.character, ids.site, `${ids.character}-slug`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, ?, ?, 'chat campaign priority self-check', 'active', 'user', 'chat-campaign-priority-self-check', 'English', NOW(3))`,
    [ids.session, ids.user, ids.character]
  );
}

async function loadCharacter() {
  const [rows] = await getDbPool().execute(
    "SELECT * FROM ai_characters WHERE id = ? LIMIT 1",
    [ids.character]
  );
  return rows[0];
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM proactive_message_deliveries WHERE internal_uid = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaign_deliveries WHERE internal_uid = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM promotion_campaigns WHERE source_ref = ?", [`chat-campaign-priority-self-check-${suffix}`]).catch(() => {});
  await db.execute("DELETE FROM user_memory_records WHERE internal_uid = ?", [ids.user]).catch(() => {});
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
