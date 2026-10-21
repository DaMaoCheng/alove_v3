import { listAdminFeedback, updateAdminFeedbackStatus } from "./admin-feedback-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminFeedbackRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/feedback") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminFeedback({
      page: requestUrl.searchParams.get("page"),
      limit: requestUrl.searchParams.get("limit"),
      status: requestUrl.searchParams.get("status"),
      query: requestUrl.searchParams.get("query"),
      site: requestUrl.searchParams.get("site"),
    }));
    return true;
  }

  const feedbackStatusMatch = path.match(/^\/api\/admin\/feedback\/([^/]+)\/status$/);
  if (req.method === "PATCH" && feedbackStatusMatch) {
    await requireAdmin(req, ADMIN_SCOPES.FEEDBACK_WRITE);
    sendJson(res, 200, await updateAdminFeedbackStatus(
      decodeURIComponent(feedbackStatusMatch[1]),
      await readJson(req, 16 * 1024)
    ));
    return true;
  }

  return false;
}
