import assert from "node:assert/strict";
import {
  isEnabledTtmallAccess,
  resolveTtmallRuntimeAccess,
} from "../server/ttmall-runtime-access-service.js";

const LOCAL_CONFIG = config({
  host: "127.0.0.1",
  publicBaseUrl: "http://127.0.0.1:4173",
  isProduction: false,
});
const PRODUCTION_CONFIG = config({
  host: "0.0.0.0",
  publicBaseUrl: "https://alove.example",
  isProduction: true,
});
const LOCAL_PRODUCTION_CONFIG = config({
  host: "127.0.0.1",
  publicBaseUrl: "http://127.0.0.1:4173",
  isProduction: true,
  allowLocalProduction: true,
});

const dependencies = {
  resolveSite: async (slug) => ({
    id: "site-1",
    slug,
    product_api_url: "ttmall://api.taotens.com?websiteId=4",
  }),
  assertSafeSource: async () => {},
};

const localAccess = await resolveTtmallRuntimeAccess("ttmall-site", { ...dependencies, config: LOCAL_CONFIG });
assert.equal(localAccess.mode, "ttmall");
assert.equal(localAccess.runtimeMode, "local_test");
assert.equal(isEnabledTtmallAccess(localAccess), true);

const localProductionAccess = await resolveTtmallRuntimeAccess("ttmall-site", {
  ...dependencies,
  config: LOCAL_PRODUCTION_CONFIG,
  resolveSite: async (slug) => ({ id: "site-local-production", slug, product_api_url: "ttmall://api.bestsoccerstore.cn?websiteId=6" }),
});
assert.equal(localProductionAccess.runtimeMode, "production");
assert.equal(new URL(localProductionAccess.source.apiBaseUrl).hostname, "api.bestsoccerstore.cn");

await assert.rejects(
  () => resolveTtmallRuntimeAccess("ttmall-site", { ...dependencies, config: config({ host: "0.0.0.0", publicBaseUrl: "https://alove.example" }) }),
  (error) => (error?.publicCode || error?.code) === "TTMALL_LOCAL_TEST_LOOPBACK_REQUIRED",
  "local test mode must remain loopback-only",
);

const productionAccess = await resolveTtmallRuntimeAccess("ttmall-site", {
  config: PRODUCTION_CONFIG,
  assertSafeSource: async () => {},
  resolveSite: async (slug) => ({ id: "site-2", slug, product_api_url: "ttmall://api.ttmall.example?websiteId=5" }),
});
assert.deepEqual(
  { mode: productionAccess.mode, runtimeMode: productionAccess.runtimeMode, host: new URL(productionAccess.source.apiBaseUrl).hostname },
  { mode: "ttmall", runtimeMode: "production", host: "api.ttmall.example" },
  "a production runtime should resolve the configured public HTTPS site source",
);
await assert.rejects(
  () => resolveTtmallRuntimeAccess("ttmall-site", {
    config: PRODUCTION_CONFIG,
    assertSafeSource: async () => {},
    resolveSite: async (slug) => ({ id: "site-3", slug, product_api_url: "ttmall://localhost?websiteId=5" }),
  }),
  (error) => error?.publicCode === "TTMALL_PRODUCTION_SOURCE_REQUIRED",
  "production mode must reject a local source",
);
await assert.rejects(
  () => resolveTtmallRuntimeAccess("ttmall-site", {
    config: PRODUCTION_CONFIG,
    assertSafeSource: async () => {},
    resolveSite: async (slug) => ({ id: "site-4", slug, product_api_url: "ttmall://api.ttmall.example:8443?websiteId=5" }),
  }),
  (error) => error?.publicCode === "TTMALL_PRODUCTION_SOURCE_REQUIRED",
  "production mode must reject a custom provider port",
);

console.log("TTMall runtime access self-check passed");

function config({
  host = "127.0.0.1",
  publicBaseUrl = "http://127.0.0.1:4173",
  isProduction = false,
  allowLocalProduction = false,
} = {}) {
  return {
    host,
    publicBaseUrl,
    runtime: { isProduction, allowLocalProduction },
    ttmallAccountBinding: { secretKey: "local-test-binding-secret" },
  };
}
