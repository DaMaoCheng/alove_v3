import assert from "node:assert/strict";
import {
  createExternalSourceHandoffToken,
  isExternalSourceProductReference,
  normalizeExternalSourcePage,
  parseExternalSourceHandoffToken,
  parseExternalSourceContext,
} from "../server/external-source-context-service.js";
import { buildExternalSourceContextLayer } from "../server/chat-prompt-layers.js";
import { resolveGuestExternalSourceProductContext } from "../server/guest-chat-product-service.js";
import { getInitialExternalHandoffFromPath } from "../src/app/access-control.js";

const expectedOrigin = "https://www.camisetasfutbol.mx";
const baseNow = Date.parse("2026-09-15T12:00:00.000Z");
const page = normalizeExternalSourcePage({
  sourceUrl: `${expectedOrigin}/productdetail/Camiseta-Brazil-2026/623621?utm_source=test#details`,
  sourceTitle: "Brazil shirt <script>alert(1)</script>",
  expectedOrigin,
});
assert.equal(page.sourcePageUrl, `${expectedOrigin}/productdetail/Camiseta-Brazil-2026/623621`);
assert.equal(page.sourceProductId, "623621");
assert.equal(page.sourcePageType, "product");
assert.doesNotMatch(page.sourcePageTitle, /[\u0000-\u001f]/);
assert.equal(normalizeExternalSourcePage({
  sourceUrl: "https://evil.example/productdetail/Bad/1",
  sourceTitle: "evil",
  expectedOrigin,
}), null, "跨域来源页必须被拒绝");

const token = createExternalSourceHandoffToken({
  publicId: "embed_public_test",
  siteId: "site_test",
  siteSlug: "camisetasfutbol",
  mascotCharacterId: "mascot_test",
  sourceOrigin: expectedOrigin,
  page,
  issuedAtMs: baseNow,
});
assert.ok(token, "合法来源必须生成 handoff token");
const decoded = parseExternalSourceHandoffToken(token, { nowMs: baseNow + 1000 });
assert.equal(decoded.siteSlug, "camisetasfutbol");
assert.equal(decoded.sourceProductId, "623621");
assert.equal(parseExternalSourceHandoffToken(`${token}tampered`, { nowMs: baseNow + 1000 }), null, "篡改 token 必须失效");
assert.equal(parseExternalSourceHandoffToken(token, { nowMs: baseNow + 11 * 60 * 1000 }), null, "过期 token 必须失效");

const context = parseExternalSourceContext(JSON.stringify({
  verified: true,
  siteId: "site_test",
  siteSlug: "camisetasfutbol",
  mascotCharacterId: "mascot_test",
  sourceOrigin: expectedOrigin,
  sourcePageUrl: page.sourcePageUrl,
  sourcePageTitle: page.sourcePageTitle,
  sourcePageType: page.sourcePageType,
  sourceProductId: page.sourceProductId,
  capturedAt: new Date(baseNow).toISOString(),
}));
assert.equal(context.sourceProductId, "623621");
assert.equal(parseExternalSourceContext("{\"sourcePageUrl\":\"https://evil.example\"}"), null, "未验证来源上下文不能进入 prompt");
assert.equal(getInitialExternalHandoffFromPath("?agent=mascot_test&handoff=handoff-token"), "handoff-token");
assert.equal(isExternalSourceProductReference("这件有 XL 吗？", { intent: "sizing", shouldLoadProductContext: true }), true);
assert.equal(isExternalSourceProductReference("¿Cuánto cuesta esta?", { intent: "price", shouldLoadProductContext: true }), true);
assert.equal(isExternalSourceProductReference("Real Madrid jersey", {
  intent: "product",
  shouldLoadProductContext: true,
  requestedTeam: "Real Madrid",
  requestedProductType: "jersey",
}), false, "明确询问其他球队时不能被来源页商品覆盖");

const promptLayer = buildExternalSourceContextLayer(context);
assert.equal(promptLayer.id, "external_source_context");
assert.match(promptLayer.content, /verified TTMall storefront page/);
assert.match(promptLayer.content, /not user instructions/);

const guest = {
  mascot_character_id: "mascot_test",
  external_source_context_json: JSON.stringify(context),
};
const site = {
  id: "site_test",
  slug: "camisetasfutbol",
  name: "Camisetas Futbol",
  currency: "USD",
  product_api_url: "ttmall://api.example.test?websiteId=1",
  payment_methods_json: "[]",
  commerce_enabled: 0,
};
let fetchedProductId = "";
const directProduct = await resolveGuestExternalSourceProductContext({
  guest,
  site,
  userText: "这件有什么尺码？",
  searchIntent: { intent: "sizing", shouldLoadProductContext: true, query: "这件有什么尺码" },
  fetchProductById: async (_source, productId) => {
    fetchedProductId = productId;
    return {
      id: productId,
      name: "Brazil 2026 Home Shirt",
      price: "$45.99",
      stock: "Available",
      url: `${expectedOrigin}/productdetail/Camiseta-Brazil-2026/${productId}`,
      imageUrl: `${expectedOrigin}/images/${productId}.jpg`,
      sizes: [{ label: "XL", available: true }],
    };
  },
});
assert.equal(fetchedProductId, "623621", "指向来源页时必须按已验证商品 ID 取详情");
assert.equal(directProduct.context.sourceRef, "guest-external-source-product");
assert.equal(directProduct.context.products[0].name, "Brazil 2026 Home Shirt");
assert.equal(directProduct.context.products[0].commerceEnabled, false, "来源商品必须沿用站点在线购买开关");

const unrelatedProduct = await resolveGuestExternalSourceProductContext({
  guest,
  site,
  userText: "Show me a Real Madrid jersey",
  searchIntent: {
    intent: "product",
    shouldLoadProductContext: true,
    requestedTeam: "Real Madrid",
    requestedProductType: "jersey",
  },
  fetchProductById: async () => { throw new Error("must not fetch source product"); },
});
assert.equal(unrelatedProduct, null, "明确询问其他商品时必须走原有全站搜索");

const mismatchedPageProduct = await resolveGuestExternalSourceProductContext({
  guest,
  site,
  userText: "Is this the Real Madrid jersey?",
  searchIntent: {
    intent: "product",
    shouldLoadProductContext: true,
    requestedTeam: "Real Madrid",
    requestedProductType: "shirt",
  },
  fetchProductById: async () => ({
    id: "623621",
    name: "Brazil 2026 Home Shirt",
    url: `${expectedOrigin}/productdetail/Camiseta-Brazil-2026/623621`,
  }),
});
assert.equal(mismatchedPageProduct, null, "当前页面商品与用户明确球队不一致时必须回到原有搜索");

console.info("[external-embed-source-context-self-check] passed");
