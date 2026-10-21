import {
  createDiscountCode,
  getDiscountCodeOptions,
  listDiscountCodes,
  searchDiscountCodesFromShopify,
  updateDiscountCode,
} from "./discount-code-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";
import { assertShopifyDiscountSearchAllowed } from "./shopify-discount-catalog-service.js";

export async function handleAdminDiscountCodeRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/discount-codes") {
    await requireAdmin(req);
    sendJson(res, 200, await listDiscountCodes({
      query: requestUrl.searchParams.get("query"),
      site: requestUrl.searchParams.get("site"),
      ownershipType: requestUrl.searchParams.get("ownershipType"),
      status: requestUrl.searchParams.get("status"),
    }));
    return true;
  }
  if (req.method === "GET" && path === "/api/admin/discount-codes/options") {
    await requireAdmin(req);
    sendJson(res, 200, await getDiscountCodeOptions());
    return true;
  }
  if (req.method === "GET" && path === "/api/admin/discount-codes/shopify-search") {
    const admin = await requireAdmin(req, ADMIN_SCOPES.PROMOTIONS_WRITE);
    assertShopifyDiscountSearchAllowed(admin.id);
    sendJson(res, 200, await searchDiscountCodesFromShopify(
      requestUrl.searchParams.get("siteId"),
      requestUrl.searchParams.get("query"),
    ));
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/discount-codes") {
    const admin = await requireAdmin(req, ADMIN_SCOPES.PROMOTIONS_WRITE);
    sendJson(res, 201, await createDiscountCode(admin.id, await readJson(req, 64 * 1024)));
    return true;
  }
  const match = path.match(/^\/api\/admin\/discount-codes\/([^/]+)$/);
  if (req.method === "PATCH" && match) {
    const admin = await requireAdmin(req, ADMIN_SCOPES.PROMOTIONS_WRITE);
    sendJson(res, 200, await updateDiscountCode(admin.id, decodeURIComponent(match[1]), await readJson(req, 64 * 1024)));
    return true;
  }
  return false;
}
