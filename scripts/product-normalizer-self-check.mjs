import assert from "node:assert/strict";
import {
  normalizeProducts,
  normalizeShopifySearchProduct,
} from "../server/product-normalizer.js";

const genericProducts = normalizeProducts({
  products: [{
    title: "AC Milan Home Football Shirt 2026/27",
    type: "AC Milan",
    salePrice: "33",
    originalPrice: "73.5",
    imageUrl: "/front.png",
    images: ["/front.png", "/back.png", { url: "/detail.png" }],
    sizes: [{ label: "M", available: true, price: "33" }],
    parameters: ["Fan version", { label: "Material", value: "Polyester" }],
  }],
}, { currency: "GBP" });

assert.equal(genericProducts[0].name, "AC Milan Home Football Shirt 2026/27", "generic product title should normalize to name");
assert.equal(genericProducts[0].subtitle, "AC Milan", "generic product type should normalize to subtitle");
assert.equal(genericProducts[0].price, "£33.00", "generic numeric sale price should use site currency");
assert.equal(genericProducts[0].priceWas, "£73.50", "generic numeric original price should use site currency");
assert.equal(genericProducts[0].currency, "GBP", "normalized products should retain their trusted currency code");
assert.deepEqual(genericProducts[0].imageUrls, ["/front.png", "/back.png", "/detail.png"], "generic image gallery should dedupe and preserve images");
assert.deepEqual(genericProducts[0].sizes, [{ label: "M", available: true, sku: "", price: "£33.00", priceWas: "", variantId: "", buyUrl: "" }], "generic size prices should use site currency");
assert.deepEqual(genericProducts[0].features, ["Fan version", "Material"], "generic features should normalize string and object rows");

const shopifyProduct = await normalizeShopifySearchProduct("https://footballkituk.com", {
  title: "Spain Away Football Shirt World Cup 2026 White",
  url: "/products/spain-away",
  image: "//cdn.example.test/search.png",
  price: "2300",
}, {
  currency: "GBP",
  fetchProductDetail: async () => ({
    title: "Spain Away Football Shirt World Cup 2026 White",
    url: "/products/spain-away",
    featured_image: "//cdn.example.test/front.png",
    images: ["//cdn.example.test/front.png", "//cdn.example.test/back.png"],
    price: 2300,
    compare_at_price: 7300,
    variants: [
      { id: 5012345678901, title: "S", public_title: "S", available: true, price: 2300, sku: "SPAIN-S" },
      { id: 5012345678902, title: "XL", public_title: "XL", available: false, price: 2300, sku: "SPAIN-XL" },
    ],
    available: true,
    product_type: "Football Shirt",
    vendor: "Football Kit UK",
  }),
  fetchCustomizationOptions: async () => [{ id: "customize", name: "CUSTOMIZE", type: "radio", values: [{ id: "custom", label: "Add yours" }] }],
});

assert.equal(shopifyProduct.price, "£23.00", "Shopify cent price should use site currency");
assert.equal(shopifyProduct.priceWas, "£73.00", "Shopify compare-at cent price should use site currency");
assert.equal(shopifyProduct.imageUrl, "https://cdn.example.test/front.png", "Shopify primary image should normalize protocol-relative URL");
assert.deepEqual(shopifyProduct.imageUrls, [
  "https://cdn.example.test/front.png",
  "https://cdn.example.test/search.png",
  "https://cdn.example.test/back.png",
], "Shopify image gallery should include detail and search images");
assert.deepEqual(shopifyProduct.sizes, [
  { label: "S", available: true, sku: "SPAIN-S", price: "£23.00", variantId: "5012345678901", buyUrl: "https://footballkituk.com/cart/5012345678901:1" },
  { label: "XL", available: false, sku: "SPAIN-XL", price: "£23.00", variantId: "5012345678902", buyUrl: "https://footballkituk.com/cart/5012345678902:1" },
], "Shopify variants should normalize to sizes");
assert.deepEqual(shopifyProduct.features, ["Football Shirt", "Football Kit UK", "Available now"], "Shopify features should include type, vendor, and availability");
assert.equal(shopifyProduct.customizationOptions[0].name, "CUSTOMIZE", "Shopify product normalization should preserve live customization options");

console.log("product normalizer self-check passed");
