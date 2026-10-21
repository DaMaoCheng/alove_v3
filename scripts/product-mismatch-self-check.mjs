import assert from "node:assert/strict";
import { buildProductSearchIntent, filterProductsByIntent, isProductImageCardRequest, isRecentProductConversationActive } from "../server/product-intent-service.js";
import { resolveGuestProductRecommendation, resolveGuestCurrentProductImageCardContext } from "../server/guest-chat-product-service.js";
import { selectProductsForMessage, suppressRepeatedProductCards } from "../server/chat-product-reply-service.js";
import { normalizeGuestReplyText } from "../server/guest-chat-output-policy.js";

globalThis.fetch = async () => { throw new Error("External providers disabled in isolated product check"); };
const singleProductRequest = { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" };
const classifyShopping = async () => ({ route: "product_search", confident: true, confidence: .99, productRequest: singleProductRequest, replyBoundary: { salesAllowed: true, contactAllowed: true } });
const classifyNonShopping = async () => ({ route: "chat", confident: true, confidence: .99, productRequest: { ...singleProductRequest, relation: "none" } });
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
for (const text of ["Can I be your boyfriend?", "Tus piernas sobre ms hombros", "How was your morning?"]) {
  check(!buildProductSearchIntent(text).shouldLoadProductContext, `ordinary conversation must not activate deterministic product intent: ${text}`);
}
for (const text of ["Show me an Arsenal shirt", "Let me know the price of an Arsenal jersey", "Show me the Nike collaboration jersey"]) {
  check(buildProductSearchIntent(text).shouldLoadProductContext, `shopping must stay available: ${text}`);
}
for (const text of ["Looking for Barcelona sponsorship for my video project", "I am looking for a collaboration with Barcelona for my content project", "Busco una colaboración con Barcelona para mi proyecto", "Avisarme cuando ponen a la venta la camiseta", "I don't want to buy any jersey"]) {
  let calls = 0;
  const result = await resolveGuestProductRecommendation({ execute: async () => { calls += 1; throw new Error("unexpected DB access"); } }, {
    guest: { site_id: "test" }, userText: text,
    classifyCommerce: classifyNonShopping,
    classifyIntent: async () => { calls += 1; return { isProductRequest: true }; },
    searchProducts: async () => { calls += 1; return { items: [] }; },
  });
  check(!result.requested && !result.context && calls === 0, `non-shopping must stop before fallback classification/source search: ${text}`);
}
const kids = buildProductSearchIntent("Me gustaría comprar la segunda equipación del Real Madrid de color verde para niño");
check(kids.requestedTeam === "Real Madrid" && kids.requestedProductType === "shirt" && kids.requestedAudience === "kids", "accented Spanish must extract garment and child audience");
const candidates = [
  { id: "jacket", name: "Real Madrid Green Away Kids Training Jacket" },
  { id: "adult", name: "Real Madrid Green Away Adult Jersey" },
  { id: "kids", name: "Real Madrid Green Away Kids Jersey" },
  { id: "other", name: "Barcelona Green Away Kids Jersey" },
];
assert.deepEqual(filterProductsByIntent(candidates, kids).map((row) => row.id), ["kids"]); checks += 1;
for (const text of ["Cristiano Ronaldo Portugal camiseta para niño", "Espero que Cristiano Ronaldo me firme una camiseta", "I want a France kids football shirt"]) {
  check(filterProductsByIntent([{ name: "Happy Birthday Card" }], buildProductSearchIntent(text)).length === 0, "birthday cards must fail garment constraints across different teams and languages");
}
const site = { id: "test", slug: "shop", name: "Test Shop", currency: "USD", product_api_url: "https://shop.example/products.json" };
const db = { execute: async () => [[site]] };
const product = { id: "shirt", name: "Arsenal Home Shirt", price: "$30", siteId: "test", siteSlug: "shop", url: "https://shop.example/products/shirt" };
const card = { senderType: "character", product };
const chatter = { senderType: "user", text: "How was your morning?" };
check(isRecentProductConversationActive([card]), "continuous product context stays active");
check(!isRecentProductConversationActive([card, chatter]), "unrelated conversation closes implicit product photo context");
check(!isProductImageCardRequest("Send me a photo of you"), "character photos must not reuse merchandise");
check(await resolveGuestCurrentProductImageCardContext(db, { guest: { site_id: "test" }, userText: "Send me a photo", recentMessages: [card, chatter] }) === null, "generic photo after topic change must not attach an old product");
check(Boolean(await resolveGuestCurrentProductImageCardContext(db, { guest: { site_id: "test" }, userText: "Send me a photo of that shirt again", recentMessages: [card, chatter] })), "explicit return to the previous shirt must still allow its image");
let searched = 0;
const mismatched = await resolveGuestProductRecommendation(db, {
  classifyCommerce: classifyShopping,
  guest: { site_id: "test" }, userText: "Show me an Arsenal shirt",
  classifyIntent: async () => { throw new Error("unexpected provider call"); },
  searchProducts: async () => { searched += 1; return { ok: true, site: { ...site, storefrontUrl: "https://shop.example" }, items: [{ ...product, name: "Barcelona Birthday Card" }] }; },
});
check(searched === 1 && mismatched.context.products.length === 0, "guest selection must enforce hard constraints even when source returns a wrong item");
const context = { siteId: "test", siteSlug: "shop", products: [product], searchIntent: buildProductSearchIntent("Arsenal shirt") };
const deduped = suppressRepeatedProductCards(context, { recentMessages: [card], userText: "What's the price?" });
check(selectProductsForMessage(deduped).length === 0 && deduped.products.length === 1, "repeat card suppressed while verified product facts remain");
check(selectProductsForMessage(suppressRepeatedProductCards(context, { recentMessages: [card], userText: "Send it again" })).length === 1, "explicit resend stays allowed");
check(selectProductsForMessage(suppressRepeatedProductCards({ ...context, products: [{ ...product, id: "different" }] }, { recentMessages: [card] })).length === 1, "same name with different identity must not be suppressed");
check(selectProductsForMessage(suppressRepeatedProductCards({ ...context, siteId: "other", products: [{ ...product, siteId: "other" }] }, { recentMessages: [card] })).length === 1, "same product id on different sites must not collide");
const factualProduct = selectProductsForMessage({ ...deduped, suppressedProductKeys: [] })[0];
check(normalizeGuestReplyText({ text: "The shirt costs $30.", product: factualProduct, productCardShown: false, productRequested: true, productSearchIntent: context.searchIntent, userText: "What's the price?" }).includes("30"), "suppressed cards must not turn a valid price answer into a no-match reply");
console.log(`product mismatch self-check passed (${checks} assertions; no provider calls or database writes)`);
