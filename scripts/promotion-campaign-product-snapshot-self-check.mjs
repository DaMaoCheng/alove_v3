import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createPromotionCampaign, getPromotionCampaignById } from "../server/promotion-campaign-service.js";

await initializeDatabase();

const suffix = Date.now();
const ids = {
  site: `site_campaign_snapshot_${suffix}`,
};

try {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Campaign Snapshot Site', ?, '', 'English', 'GBP', 'Europe/London', 'active', 0, NULL, '', 'campaign snapshot self-check')`,
    [ids.site, `campaign-snapshot-${suffix}`]
  );

  const snapshot = {
    id: "acm-001",
    sku: "ACM-HOME",
    name: "AC Milan Home Shirt",
    subtitle: "Supporter edition",
    price: "£49.99",
    priceWas: "£69.99",
    url: "https://footballkituk.example/products/ac-milan-home-shirt",
    imageUrl: "https://img.example/acm-main.jpg",
    imageUrls: [
      "https://img.example/acm-main.jpg",
      "https://img.example/acm-back.jpg"
    ],
    stock: "Available",
    sizes: [{ label: "M", available: true, sku: "ACM-HOME-M", price: "£49.99" }],
    features: ["AC Milan", "Home shirt"],
  };

  const created = await createPromotionCampaign({
    title: "Snapshot campaign",
    siteId: ids.site,
    roleTarget: "creator",
    productId: snapshot.id,
    productTitle: snapshot.name,
    productUrl: snapshot.url,
    productSnapshot: snapshot,
    discountCode: "MILAN10",
    messageText: "Snapshot campaign message",
    keywords: ["ac", "milan"],
    priority: 10,
    status: "draft",
    sourceRef: `campaign-snapshot-self-check-${suffix}`,
  });

  const stored = await getPromotionCampaignById(created.item.id);
  assertEqual(stored.productSnapshot?.id, snapshot.id, "campaign should persist product snapshot id");
  assertEqual(stored.productSnapshot?.imageUrl, snapshot.imageUrl, "campaign should persist product snapshot image");
  assertEqual(stored.productSnapshot?.price, snapshot.price, "campaign should persist product snapshot price");
  assertEqual(Array.isArray(stored.productSnapshot?.imageUrls), true, "campaign should persist product snapshot image list");
  assertEqual(Array.isArray(stored.productSnapshot?.sizes), true, "campaign should persist product snapshot sizes");

  console.log(JSON.stringify({ ok: true, campaignId: created.item.id, snapshot: stored.productSnapshot }, null, 2));
} finally {
  const db = getDbPool();
  await db.execute("DELETE FROM promotion_campaigns WHERE source_ref = ?", [`campaign-snapshot-self-check-${suffix}`]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [ids.site]).catch(() => {});
  await closeDbPool();
}

function assertEqual(actual, expected, message) {
  if (actual === expected) return;
  throw new Error(`${message}: expected ${expected}, received ${actual}`);
}
