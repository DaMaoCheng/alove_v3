import assert from "node:assert/strict";
import { buildProductSearchIntent } from "../server/product-intent-service.js";
import { executeProductSearch } from "../server/product-search-execution-service.js";

const searchIntent = buildProductSearchIntent("Cristiano Ronaldo Trikot Al Nassr");
const products = await executeProductSearch({
  productApiUrl: "https://catalogue.example.test/products",
  query: searchIntent.query,
  searchIntent,
  currency: "USD",
  fetchProducts: async () => [{
    id: "al-nassr-current",
    name: "Al Nassr Home Soccer Jersey 2026/27",
    url: "https://catalogue.example.test/products/al-nassr-current",
    publishedAt: "2026-08-01T00:00:00.000Z",
  }],
  includePublicSearchFallback: false,
});

assert.equal(products[0]?.name, "Al Nassr Home Soccer Jersey 2026/27", "a verified team item should remain eligible when the requested player is not printed in the title");
console.log("product search soft-anchor self-check passed");
