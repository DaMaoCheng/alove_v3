import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool } from "../server/db.js";
import { getMessagesForSession, insertMessage } from "../server/chat-message-store.js";
import { toGuestSafeProductSearchResult } from "../server/guest-product-sanitizer.js";
import { mapProductSearchSite } from "../server/product-search-site-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest product runtime self-check" });
const db = getDbPool();
const suffix = randomUUID();
const guestId = `guest_product_check_${suffix}`;
const sessionId = `chat_product_check_${suffix}`;
const messageIdPrefix = `guest-product-runtime:${suffix}`;

try {
  const [[site]] = await db.execute(
    `SELECT s.id, s.name, s.slug, s.site_url, s.currency, s.product_api_url, s.payment_methods_json,
            COALESCE(ms.character_id, s.mascot_character_id) AS mascot_character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk'
     LIMIT 1`
  );
  assert.ok(site?.id && site?.mascot_character_id, "FKK site and mascot are required for the guest product runtime check");
  const mappedSite = mapProductSearchSite(site);
  assert.ok(mappedSite.storefrontUrl, "FKK storefront URL is required for the guest product runtime check");

  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [guestId, `sha256:${suffix.replaceAll("-", "")}`, site.id, site.mascot_character_id, sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Guest product runtime check', 'active', 'guest', 'guest-product-runtime-check', NOW(3))`,
    [sessionId, guestId, site.mascot_character_id]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);

  const safeResult = toGuestSafeProductSearchResult({
    ok: true,
    site: mappedSite,
    items: [{
      id: "runtime-shirt",
      name: "Runtime Arsenal Shirt",
      price: "£59.99",
      priceWas: "£99.99",
      url: `${mappedSite.storefrontUrl.replace(/\/$/, "")}/products/runtime-arsenal-shirt`,
      imageUrl: "https://cdn.shopify.com/s/files/runtime-arsenal-shirt.jpg",
      campaignId: "runtime-campaign",
      discountCode: "SAVE20",
      code: "SAVE20",
      features: ["20% off"],
    }],
  });
  assert.equal(safeResult.items.length, 1);
  const product = safeResult.items[0];
  await insertMessage(db, {
    sessionId,
    characterId: site.mascot_character_id,
    senderType: "character",
    senderLabel: "Runtime Mascot",
    contentType: "product",
    text: product.name,
    product,
    displayOrder: 10,
    sourceType: "product_api",
    sourceRef: messageIdPrefix,
  });

  const conversation = await getMessagesForSession({
    id: sessionId,
    internal_uid: null,
    guest_session_id: guestId,
    character_id: site.mascot_character_id,
    session_title: "Guest product runtime check",
    session_status: "active",
    source_type: "guest",
    source_ref: "guest-product-runtime-check",
    last_message_at: new Date(),
  });
  assert.equal(conversation.items.length, 1);
  assert.equal(conversation.items[0].contentType, "product");
  assert.equal(conversation.items[0].product.name, "Runtime Arsenal Shirt");
  assert.equal(conversation.items[0].product.siteSlug, "footballkituk");
  assert.doesNotMatch(JSON.stringify(conversation), /SAVE20|runtime-campaign|priceWas|discountCode|20% off/, "persisted and reloaded guest history must remain promotion-free");

  const [[sideEffects]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM chat_message_index WHERE session_id = ?) AS indexes,
       (SELECT COUNT(*) FROM product_analytics_events WHERE session_id = ?) AS analytics,
       (SELECT COUNT(*) FROM memory_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.sessionId')) = ?) AS jobs`,
    [sessionId, sessionId, sessionId]
  );
  assert.deepEqual(
    { indexes: Number(sideEffects.indexes), analytics: Number(sideEffects.analytics), jobs: Number(sideEffects.jobs) },
    { indexes: 0, analytics: 0, jobs: 0 },
    "guest product persistence must not create formal memory or analytics side effects"
  );

  console.log("guest product message runtime self-check passed");
} finally {
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guestId]).catch(() => {});
  await closeDbPool();
}
