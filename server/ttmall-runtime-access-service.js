import { SERVER_CONFIG } from "./config.js";
import { createPublicError } from "./public-error-utils.js";
import { resolveSearchSite } from "./product-search-site-service.js";
import { assertSafeProductSourceFetchUrl } from "./product-source-http-service.js";
import { safeString } from "./product-source-shared-service.js";
import { parseTtmallProductSource } from "./product-source-ttmall-service.js";

const LOCAL_TEST_TTMALL_HOST = "api.taotens.com";

export async function resolveTtmallRuntimeAccess(siteSlug = "", dependencies = {}) {
  const config = dependencies.config || SERVER_CONFIG;
  const runtimeMode = resolveRuntimeMode(config);
  const normalizedSiteSlug = safeString(siteSlug).toLowerCase();
  if (!normalizedSiteSlug) {
    throw createPublicError("Please reopen the product and try again.", 400, "TTMALL_CONTEXT_REQUIRED");
  }
  const site = await (dependencies.resolveSite || resolveSearchSite)(normalizedSiteSlug, { allowDefault: false });
  if (!site) throw createPublicError("This site is unavailable right now.", 404, "TTMALL_SITE_NOT_FOUND");
  const source = parseTtmallProductSource(site.product_api_url);
  if (!source) return { site, source: null, mode: "not_ttmall", runtimeMode };

  assertTtmallRuntimePolicy(source, runtimeMode, config);
  await (dependencies.assertSafeSource || assertSafeProductSourceFetchUrl)(source.apiBaseUrl);
  return { site, source, mode: "ttmall", runtimeMode };
}

export function isEnabledTtmallAccess(access = {}) {
  return access?.mode === "ttmall" && Boolean(access?.source);
}

export function isLocalTtmallTestHost(value = "") {
  try {
    return normalizeHostname(new URL(value).hostname) === LOCAL_TEST_TTMALL_HOST;
  } catch {
    return false;
  }
}

function resolveRuntimeMode(config = SERVER_CONFIG) {
  return config?.runtime?.isProduction ? "production" : "local_test";
}

function assertTtmallRuntimePolicy(source, runtimeMode, config) {
  const sourceUrl = new URL(source.apiBaseUrl);
  if (runtimeMode === "local_test") {
    if (!isLoopbackHost(config?.host) || !isLoopbackPublicUrl(config?.publicBaseUrl)) {
      throw configurationError("TTMALL_LOCAL_TEST_LOOPBACK_REQUIRED", "TTMall local test mode requires loopback app URLs.");
    }
    if (normalizeHostname(sourceUrl.hostname) !== LOCAL_TEST_TTMALL_HOST) {
      throw createPublicError("This site has not enabled the local TTMall test flow.", 409, "TTMALL_TEST_SOURCE_REQUIRED");
    }
    return;
  }
  const allowLocalProduction = config?.runtime?.allowLocalProduction === true && isLoopbackPublicUrl(config?.publicBaseUrl);
  if (!isPublicHttpsUrl(config?.publicBaseUrl) && !allowLocalProduction) {
    throw configurationError("TTMALL_PRODUCTION_PUBLIC_URL_REQUIRED", "TTMall production mode requires a public HTTPS app URL.");
  }
  if (sourceUrl.protocol !== "https:" || sourceUrl.port || !isPublicHostname(sourceUrl.hostname)) {
    throw createPublicError("This site does not use a valid public TTMall source.", 409, "TTMALL_PRODUCTION_SOURCE_REQUIRED");
  }
}

function configurationError(code, message) {
  return createPublicError(message, 503, code);
}

function isLoopbackPublicUrl(value = "") {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isPublicHttpsUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(value = "") {
  const hostname = normalizeHostname(value);
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

function normalizeHostname(value = "") {
  return safeString(value).replace(/^\[|\]$/g, "").toLowerCase();
}

function isPublicHostname(value = "") {
  const hostname = normalizeHostname(value);
  if (isLoopbackHost(hostname)) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname);
}
