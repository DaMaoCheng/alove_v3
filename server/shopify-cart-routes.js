import { requireAuth } from "./auth-service.js";
import { getRequestIp, readAuthToken, readJson, redirect, sendJson } from "./http-utils.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { getShopifyCartReadiness, getShopifyDraftOrderPaymentUrl, startShopifyCheckout, syncShopifyCart } from "./shopify-cart-service.js";

export async function handleShopifyCartRoute(req, res, { path } = {}) {
  if (path === "/api/product-cart/shopify/payment" && req.method === "GET") {
    const user = await requireAuth(req, readAuthToken);
    const siteSlug = new URL(req.url || "/", "http://localhost").searchParams.get("siteSlug") || "";
    const paymentUrl = await getShopifyDraftOrderPaymentUrl({ userId: user.id, siteSlug, userSiteId: user.site_id, userSiteSlug: user.site_slug, buyerIp: getRequestIp(req) });
    redirect(res, paymentUrl, 303);
    return true;
  }
  if (!['/api/product-cart/shopify/ready', '/api/product-cart/shopify/sync', '/api/product-cart/shopify/checkout'].includes(path) || req.method !== 'POST') return false;
  const user = await requireAuth(req, readAuthToken);
  assertPublicAppOrigin(req);
  const body = await readJson(req, 128 * 1024).catch(() => ({}));
  const access = { userId: user.id, siteSlug: body.siteSlug || body.site_slug, userSiteId: user.site_id, userSiteSlug: user.site_slug };
  const result = path.endsWith('/ready')
    ? await getShopifyCartReadiness(access)
    : path.endsWith('/checkout')
      ? await startShopifyCheckout({ ...access, buyerIp: getRequestIp(req) })
      : await syncShopifyCart({ ...access, items: body.items, buyerIp: getRequestIp(req) });
  sendJson(res, 200, result);
  return true;
}
