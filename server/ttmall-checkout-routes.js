import { requireAuth } from "./auth-service.js";
import { readAuthToken, readJson, sendJson } from "./http-utils.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import {
  getTtmallAddressRegions,
  getTtmallCheckoutOptions,
  getTtmallCheckoutState,
  removeTtmallAddress,
  saveTtmallAddress,
  submitTtmallCheckout,
} from "./ttmall-checkout-service.js";

const BASE_PATH = "/api/ttmall-checkout";

export async function handleTtmallCheckoutRoute(req, res, { path } = {}) {
  if (!path.startsWith(BASE_PATH)) return false;
  const user = await requireAuth(req, readAuthToken);
  const requestUrl = new URL(req.url || BASE_PATH, "http://localhost");
  const siteSlug = requestUrl.searchParams.get("siteSlug");
  if (path === `${BASE_PATH}/state` && req.method === "GET") {
    sendJson(res, 200, await getTtmallCheckoutState({ userId: user.id, siteSlug }));
    return true;
  }
  if (path === `${BASE_PATH}/address-regions` && req.method === "GET") {
    sendJson(res, 200, await getTtmallAddressRegions({ userId: user.id, siteSlug }));
    return true;
  }
  if (path === `${BASE_PATH}/options` && req.method === "GET") {
    sendJson(res, 200, await getTtmallCheckoutOptions({ userId: user.id, siteSlug, addressId: requestUrl.searchParams.get("addressId") }));
    return true;
  }
  if (path === `${BASE_PATH}/address` && req.method === "POST") {
    assertPublicAppOrigin(req);
    const body = await readJson(req, 32 * 1024);
    sendJson(res, 200, await saveTtmallAddress({ userId: user.id, siteSlug: body.siteSlug || body.site_slug, addressId: body.addressId || body.address_id, input: body.address }));
    return true;
  }
  const addressMatch = path.match(/^\/api\/ttmall-checkout\/address\/(\d{1,12})$/);
  if (addressMatch && req.method === "PUT") {
    assertPublicAppOrigin(req);
    const body = await readJson(req, 32 * 1024);
    sendJson(res, 200, await saveTtmallAddress({ userId: user.id, siteSlug: body.siteSlug || body.site_slug, addressId: addressMatch[1], input: body.address }));
    return true;
  }
  if (addressMatch && req.method === "DELETE") {
    assertPublicAppOrigin(req);
    sendJson(res, 200, await removeTtmallAddress({ userId: user.id, siteSlug, addressId: addressMatch[1] }));
    return true;
  }
  if (path === `${BASE_PATH}/submit` && req.method === "POST") {
    assertPublicAppOrigin(req);
    const body = await readJson(req, 32 * 1024);
    sendJson(res, 200, await submitTtmallCheckout({
      userId: user.id, siteSlug: body.siteSlug || body.site_slug,
      addressId: body.addressId, shippingId: body.shippingId, paymentId: body.paymentId,
      billingAddressId: body.billingAddressId, message: body.message,
    }));
    return true;
  }
  return false;
}
