import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const facadeSource = readSource("server/product-search-service.js");
const publicSource = readSource("server/product-search-public-service.js");
const adminSource = readSource("server/product-search-admin-service.js");
const checkoutSource = readSource("server/product-checkout-resolver-service.js");
const routeSource = readSource("server/product-search-routes.js");
const matchSource = readSource("server/product-search-match-service.js");
const siteSource = readSource("server/product-search-site-service.js");

assert.match(facadeSource, /export \{ searchSiteProducts \} from "\.\/product-search-public-service\.js";/, "product search facade should re-export public search");
assert.match(facadeSource, /export \{ searchAdminPromotionProducts \} from "\.\/product-search-admin-service\.js";/, "product search facade should re-export admin product search");
assert.match(facadeSource, /export \{ resolveProductCheckoutProduct \} from "\.\/product-checkout-resolver-service\.js";/, "product search facade should re-export checkout resolver");
assert.match(facadeSource, /export \{ handleProductSearchRoute \} from "\.\/product-search-routes\.js";/, "product search facade should re-export route handler");
assert.doesNotMatch(facadeSource, /fetchProductSummary|getDbPool|readJson|filterProductsByTitle|findResolvedCheckoutProduct/, "product search facade should stay thin");

assert.match(publicSource, /export async function searchSiteProducts/, "public product search module should own public search");
assert.match(adminSource, /export async function searchAdminPromotionProducts/, "admin product search module should own promotion picker search");
assert.match(checkoutSource, /export async function resolveProductCheckoutProduct/, "checkout resolver module should own legacy product hydration");
assert.match(routeSource, /export async function handleProductSearchRoute/, "route module should own public product HTTP routes");
assert.match(matchSource, /export function filterProductsByTitle/, "match module should own title filtering");
assert.match(matchSource, /export function findResolvedCheckoutProduct/, "match module should own checkout matching");
assert.match(siteSource, /export async function resolveSearchSite/, "site module should own public site lookup");
assert.match(siteSource, /export async function resolveAdminSearchSite/, "site module should own admin site lookup");

console.log("product search split self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}
