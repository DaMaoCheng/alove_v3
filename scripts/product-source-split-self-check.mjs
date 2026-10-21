import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const facade = readFileSync("server/product-source-service.js", "utf8");
const httpSource = readFileSync("server/product-source-http-service.js", "utf8");
const shopifyAdminSource = readFileSync("server/product-source-shopify-admin-service.js", "utf8");
const shopifyPublicSource = readFileSync("server/product-source-shopify-public-service.js", "utf8");
const ttmallSource = readFileSync("server/product-source-ttmall-service.js", "utf8");
const ttmallClientSource = readFileSync("server/product-source-ttmall-client-service.js", "utf8");
const ttmallMapperSource = readFileSync("server/product-source-ttmall-mapper.js", "utf8");
const sharedSource = readFileSync("server/product-source-shared-service.js", "utf8");

assert.match(facade, /from "\.\/product-source-http-service\.js"/, "product source facade should import generic HTTP source");
assert.match(facade, /from "\.\/product-source-shopify-admin-service\.js"/, "product source facade should import Shopify Admin source");
assert.match(facade, /from "\.\/product-source-shopify-public-service\.js"/, "product source facade should import Shopify public source");
assert.match(facade, /from "\.\/product-source-ttmall-service\.js"/, "product source facade should import TTMall source");
assert.doesNotMatch(facade, /function\s+(parseShopifyAdminSource|fetchShopifyAdminGraphql|extractShopifySearchRows|fetchJsonWithTimeout|fetchTextWithTimeout)\b/, "provider implementation should not live in product source facade");
assert.ok(facade.length < 3000, "product source facade should stay thin while routing supported providers");

assert.match(httpSource, /export async function fetchHttpProducts/, "generic HTTP source should own generic product fetch");
assert.match(shopifyAdminSource, /query AioveProductSearch/, "Shopify Admin source should own GraphQL read query");
assert.doesNotMatch(shopifyAdminSource, /\bmutation\b/i, "Shopify Admin source must not contain mutation operations");
assert.match(shopifyPublicSource, /export async function fetchShopifyPublicProducts/, "Shopify public source should own public suggest fetch");
assert.match(shopifyPublicSource, /export async function fetchShopifySearchPageProducts/, "Shopify public source should own storefront search page fallback");
assert.match(ttmallSource, /export async function fetchTtmallProducts/, "TTMall source should own TTMall product reads");
assert.match(ttmallSource, /export async function fetchTtmallHomepageProductSections/, "TTMall source should own TTMall homepage floor reads");
assert.doesNotMatch(ttmallSource, /product_access_token|X-Shopify-Access-Token/, "TTMall adapter must not read or expose a stored Shopify token");
assert.match(ttmallClientSource, /export async function fetchTtmallJson/, "TTMall client should own authenticated transport");
assert.match(ttmallMapperSource, /export function normalizeTtmallProduct/, "TTMall mapper should own provider-to-domain normalization");
assert.doesNotMatch(ttmallMapperSource, /Authorization|Bearer|tokenCache/, "TTMall mapper must remain independent from credentials and transport");
assert.ok(ttmallSource.length < 12000, "TTMall orchestration adapter should stay below the project complex-file threshold");
assert.match(sharedSource, /export function fetchJsonWithTimeout/, "shared product source helpers should own JSON timeout fetch");

console.log("product source split self-check passed");
