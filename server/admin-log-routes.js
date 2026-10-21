import { listAdminErrorLogs } from "./ai-reply-log-service.js";
import { sendJson } from "./http-utils.js";
import { requireAdmin } from "./route-utils.js";

export async function handleAdminLogRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/error-logs") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminErrorLogs({
      level: requestUrl.searchParams.get("level"),
      limit: requestUrl.searchParams.get("limit"),
      page: requestUrl.searchParams.get("page"),
      type: requestUrl.searchParams.get("type"),
      source: requestUrl.searchParams.get("source"),
      startDate: requestUrl.searchParams.get("startDate"),
      endDate: requestUrl.searchParams.get("endDate"),
    }));
    return true;
  }
  return false;
}
