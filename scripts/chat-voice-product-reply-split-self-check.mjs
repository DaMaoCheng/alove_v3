import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectProductsForMessage, selectProductsForReply } from "../server/chat-product-reply-service.js";

const voiceSource = readFileSync("server/chat-voice-message-service.js", "utf8");
const productReplySource = readFileSync("server/chat-product-reply-service.js", "utf8");
const textSource = readFileSync("server/chat-text-message-service.js", "utf8");
const orchestratorSource = readFileSync("server/chat-reply-orchestrator-service.js", "utf8");

assert.match(voiceSource, /buildCharacterReplyGenerationForDb/, "voice reply should reuse shared reply generation");
assert.match(voiceSource, /persistCharacterReplyForDb/, "voice reply should reuse shared reply persistence");
assert.doesNotMatch(voiceSource, /recordProductBubbleTriggered/, "voice reply should not record product analytics directly");
assert.doesNotMatch(voiceSource, /function\s+selectProductForMessage/, "voice reply should not keep a duplicate product selector");
assert.doesNotMatch(voiceSource, /sourceRef:\s*"site-product-context"[\s\S]{0,400}recordProductBubbleTriggered/, "voice reply should not inline product bubble insertion");

assert.match(textSource, /buildCharacterReplyGenerationForDb/, "text reply should reuse shared reply generation");
assert.match(textSource, /persistCharacterReplyForDb/, "text reply should reuse shared reply persistence");
assert.match(productReplySource, /export function selectProductsForMessage/, "product reply service should own the shared multi-product selection");
assert.match(productReplySource, /export async function insertProductReplyMessage/, "product reply service should own product message insertion");
assert.match(productReplySource, /recordProductBubbleTriggered/, "product reply service should own product analytics recording");
assert.match(orchestratorSource, /insertProductReplyMessage/, "reply orchestrator should own shared product message insertion flow");
assert.match(orchestratorSource, /const selectedProducts = selectProductsForReply\(productContext, replyResult\)/, "reply orchestrator should use the shared post-review selection flow");
assert.match(productReplySource, /export function selectProductsForReply/, "product reply service should own the shared post-review gates");
assert.match(orchestratorSource, /selectedProducts\.length \? nextOrder \+ selectedProducts\.length \* 5/, "reply text should be ordered after every selected product card");

const selected = selectProductsForMessage({
  products: [
    { id: "home", name: "Liverpool Home Football Shirt 2026/27" },
    { id: "away", name: "Liverpool Away Football Shirt 2026/27" },
  ],
  searchIntent: { requestedTeam: "Liverpool", requestedVariants: ["home", "away"] },
  siteId: "site_fkk",
  siteSlug: "footballkituk",
});
assert.deepEqual(selected.map((product) => product.name), [
  "Liverpool Home Football Shirt 2026/27",
  "Liverpool Away Football Shirt 2026/27",
], "the shared selector should preserve the requested home-and-away order");
assert.equal(
  selectProductsForMessage({ products: selected, searchIntent: { requestedTeam: "Liverpool", requestedProductType: "shirt" } }).length,
  1,
  "a normal single-shirt request should still send exactly one product card"
);

// Both text and voice use this actual persistence gate. Keep the permission
// matrix executable when ownership moves between the orchestrator and service.
const pairContext = { products: selected, searchIntent: { requestedVariants: ["home", "away"] } };
for (const candidate of [false, true]) {
  for (const scope of [undefined, false, true]) {
    for (const evidence of [undefined, false, true]) {
      for (const sales of [undefined, false, true]) {
        for (const transport of [false, true]) {
          const context = { ...pairContext, ...(candidate ? { candidateContext: { requiresConfirmation: true } } : {}) };
          const reply = { productScopeVerified: scope, candidateEvidenceVerified: evidence,
            replyBoundary: { salesAllowed: sales }, ...(transport ? { sourceRef: "ai-request-fallback" } : {}) };
          const allowed = scope !== false && sales !== false && !transport && (!candidate || evidence === true);
          assert.deepEqual(selectProductsForReply(context, reply).map(product => product.id), allowed ? ["home", "away"] : [],
            `post-review card permissions: ${JSON.stringify({ candidate, scope, evidence, sales, transport })}`);
        }
      }
    }
  }
}

console.log("chat voice product reply split self-check passed (shared source boundaries, original selector behavior and 108 post-review permission combinations; no DB/network)");
