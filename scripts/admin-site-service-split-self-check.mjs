import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const facadeSource = readFileSync("server/admin-site-service.js", "utf8");
const querySource = readFileSync("server/admin-site-query-service.js", "utf8");
const writeSource = readFileSync("server/admin-site-write-service.js", "utf8");
const regionSource = readFileSync("server/site-region-binding-service.js", "utf8");
const productSource = readFileSync("server/admin-site-product-source-service.js", "utf8");
const mapperSource = readFileSync("server/admin-site-mapper.js", "utf8");

assert.match(facadeSource, /from "\.\/admin-site-query-service\.js"/, "facade should export query service");
assert.match(facadeSource, /from "\.\/admin-site-write-service\.js"/, "facade should export write service");
assert.doesNotMatch(facadeSource, /SELECT s\.\*|normalizeProductSourcePayload|replaceSiteRegions/, "facade should not keep implementation details");
assert.ok(facadeSource.length < 320, "facade should stay thin");

assert.match(querySource, /export async function listAdminSites/, "query service should own listAdminSites");
assert.match(querySource, /export async function getAdminSite/, "query service should own getAdminSite");
assert.match(querySource, /const SITE_SELECT_SQL/, "query service should centralize site select SQL");
assert.match(querySource, /loadSiteRegionMap/, "query service should load region bindings");

assert.match(writeSource, /export async function createAdminSite/, "write service should own create flow");
assert.match(writeSource, /export async function updateAdminSite/, "write service should own update flow");
assert.match(writeSource, /export async function setDefaultAdminSite/, "write service should own default-site flow");
assert.match(writeSource, /replaceSiteRegions/, "write service should update region bindings");
assert.match(writeSource, /normalizeProductSourcePayload/, "write service should normalize product source payload");

assert.match(regionSource, /export async function replaceSiteRegions/, "region service should own region writes");
assert.match(regionSource, /目标地区已绑定到其他站点/, "region service should preserve conflict validation");
assert.match(productSource, /encryptSecret/, "product source service should still encrypt access tokens");
assert.match(productSource, /Shopify 店铺域名必须是 xxx\.myshopify\.com/, "product source service should validate Shopify domain");
assert.match(mapperSource, /hasProductAccessToken/, "mapper should expose token configured state without leaking token");

console.log("admin site service split self-check passed");
