import { sendJson } from "./http-utils.js";
import { getAdminProductAnalyticsOverview } from "./admin-product-analytics-service.js";
import { requireAdmin } from "./route-utils.js";

export async function handleAdminAnalyticsRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/analytics/product-overview") {
    await requireAdmin(req);
    sendJson(res, 200, await getAdminProductAnalyticsOverview({
      range: requestUrl.searchParams.get("range"),
      site: requestUrl.searchParams.get("site"),
    }));
    return true;
  }
  return false;
}
