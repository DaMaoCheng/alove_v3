import { requireAuth } from "./auth-service.js";
import { readAuthToken, readJson, sendJson } from "./http-utils.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { syncTtmallCart } from "./ttmall-cart-service.js";

export async function handleTtmallCartRoute(req, res, { path } = {}) {
  if (path !== "/api/product-cart/ttmall/sync" || req.method !== "POST") return false;
  const user = await requireAuth(req, readAuthToken);
  assertPublicAppOrigin(req);
  const body = await readJson(req, 128 * 1024).catch(() => ({}));
  const result = await syncTtmallCart({ userId: user.id, siteSlug: body.siteSlug || body.site_slug, items: body.items });
  sendJson(res, 200, result);
  return true;
}
