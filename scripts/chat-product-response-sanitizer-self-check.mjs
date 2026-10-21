import assert from "node:assert/strict";
import { insertMessage, mapMessageRow } from "../server/chat-message-store.js";

const product = {
  id: "product-one",
  name: "Trusted Shirt",
  currency: "AUD",
  inventoryQuantity: 99,
  accessToken: "top-secret",
  sourceItem: { accessToken: "nested-secret" },
  sizes: [{ label: "M", inventoryQuantity: 9, available: true, raw: { inventoryQuantity: 8 } }],
  searchIntent: { query: "shirt", requestedTeam: "Milan", accessToken: "intent-secret" },
};

const historical = mapMessageRow({
  id: "message-old",
  session_id: "session-one",
  character_id: "character-one",
  sender_type: "character",
  sender_label: "Mascot",
  content_type: "product",
  text_content: "",
  product_payload_json: JSON.stringify(product),
  display_order: 10,
  delivery_status: "sent",
  sent_at: new Date(),
});
assert.equal("inventoryQuantity" in historical.product.sizes[0], false, "historical product messages should hide exact Admin inventory at read time");
assert.equal("inventoryQuantity" in historical.product, false, "historical product messages should remove top-level exact inventory");
assert.equal("sourceItem" in historical.product, false, "historical product messages should remove nested source snapshots");
assert.equal("accessToken" in historical.product, false, "historical product messages should only expose explicitly allowed product fields");
assert.equal(historical.product.currency, "AUD", "trusted product currency should survive the response allowlist for price preview");
assert.deepEqual(historical.product.searchIntent, { query: "shirt", requestedTeam: "Milan" }, "nested product context should use its own explicit field allowlist");

let storedPayload = null;
const inserted = await insertMessage({
  async execute(_sql, params) {
    storedPayload = JSON.parse(params[9]);
    return [{ affectedRows: 1 }];
  },
}, {
  sessionId: "session-one",
  characterId: "character-one",
  senderType: "character",
  senderLabel: "Mascot",
  contentType: "product",
  text: "",
  product,
  displayOrder: 20,
  sourceType: "self_check",
  sourceRef: "chat-product-response-sanitizer",
});
assert.equal("inventoryQuantity" in storedPayload.sizes[0], false, "new product messages should not persist exact Admin inventory");
assert.equal("inventoryQuantity" in inserted.product.sizes[0], false, "new product message responses should hide exact Admin inventory");
assert.equal("raw" in storedPayload.sizes[0], false, "new product messages should not persist arbitrary nested size data");
assert.equal("accessToken" in storedPayload, false, "new product messages should not persist arbitrary sensitive product fields");
assert.equal(JSON.stringify(storedPayload).includes("secret"), false, "new product payloads should remove sensitive values at every nested boundary");

console.log("chat product response sanitizer self-check passed");
