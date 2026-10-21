import { getAdminKitshop, refreshAdminKitshop } from "./admin-kitshop-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminKitshopRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/kitshop") {
    await requireAdmin(req);
    sendJson(res, 200, await getAdminKitshop({
      site: requestUrl.searchParams.get("site"),
      productPage: requestUrl.searchParams.get("productPage"),
      productLimit: requestUrl.searchParams.get("productLimit"),
    }));
    return true;
  }

  if (req.method === "POST" && path === "/api/admin/kitshop/refresh") {
    await requireAdmin(req, ADMIN_SCOPES.KITSHOP_WRITE);
    sendJson(res, 200, await refreshAdminKitshop(await readJson(req, 16 * 1024)));
    return true;
  }

  return false;
}
