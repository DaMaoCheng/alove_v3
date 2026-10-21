import { requireAuth } from "./auth-service.js";
import { getRequestIp, readAuthToken, readJson, sendJson } from "./http-utils.js";
import { getUserProfile, updateUserProfile } from "./profile-service.js";
import { getShopifyOrderDetail, getShopifyOrderHistory } from "./shopify-order-history-service.js";
import { reconcileCurrentUserShopifyPayment } from "./shopify-draft-order-reconciliation-service.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { getTtmallProfileOrderDetail, getTtmallProfileOrderHistory } from "./ttmall-profile-order-history-service.js";

export async function handleProfileRoute(req, res, { path }) {
  if (req.method === "POST" && path === "/api/profile/orders/reconcile") {
    const user = await requireAuth(req, readAuthToken);
    assertPublicAppOrigin(req);
    sendJson(res, 200, await reconcileCurrentUserShopifyPayment({
      userId: user.id,
      siteSlug: user.site_slug,
      userSiteId: user.site_id,
      userSiteSlug: user.site_slug,
      buyerIp: getRequestIp(req),
    }));
    return true;
  }

  if (req.method === "GET" && path === "/api/profile/orders") {
    const user = await requireAuth(req, readAuthToken);
    const ttmallOrders = await getTtmallProfileOrderHistory(user);
    sendJson(res, 200, ttmallOrders || await getShopifyOrderHistory(user));
    return true;
  }

  const orderMatch = req.method === "GET" ? path.match(/^\/api\/profile\/orders\/(.+)$/) : null;
  if (orderMatch) {
    const user = await requireAuth(req, readAuthToken);
    const orderId = safeDecodeOrderId(orderMatch[1]);
    const ttmallOrder = await getTtmallProfileOrderDetail(user, orderId);
    sendJson(res, 200, ttmallOrder || await getShopifyOrderDetail(user, orderId));
    return true;
  }

  if (req.method === "GET" && path === "/api/profile") {
    const user = await requireAuth(req, readAuthToken);
    sendJson(res, 200, await getUserProfile(user));
    return true;
  }

  if (req.method === "PATCH" && path === "/api/profile") {
    const user = await requireAuth(req, readAuthToken);
    sendJson(res, 200, await updateUserProfile(user, await readJson(req)));
    return true;
  }

  return false;
}

function safeDecodeOrderId(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
