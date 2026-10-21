import { requireAuth } from "./auth-service.js";
import { resolveSiteForRequest } from "./geo-site-resolver-service.js";
import { buildRequestLogContext, recordAppErrorLog } from "./app-error-log-service.js";
import { readAuthToken, readJson, sendJson } from "./http-utils.js";
import { recordClientProductAnalyticsEvent } from "./product-analytics-service.js";
import { resolvePublicSiteBranding } from "./site-branding-service.js";

export async function handleAdminClientEventRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/site/branding") {
    const item = await resolvePublicSiteBranding(requestUrl.searchParams.get("siteSlug") || "");
    if (!item) {
      sendJson(res, 404, { ok: false, error: "站点不存在或已停用" });
      return true;
    }
    sendJson(res, 200, { ok: true, item });
    return true;
  }
  if (req.method === "GET" && path === "/api/site/resolve") {
    sendJson(res, 200, await resolveSiteForRequest(req));
    return true;
  }
  if (req.method === "POST" && path === "/api/client-errors/report") {
    const user = await requireAuth(req, readAuthToken);
    const body = await readJson(req, 96 * 1024).catch(() => ({}));
    await recordAppErrorLog({
      ...body,
      userId: user.id,
      source: "client",
      request: buildRequestLogContext(req, requestUrl),
    });
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "POST" && path === "/api/analytics/product-events") {
    const user = await requireAuth(req, readAuthToken);
    const body = await readJson(req, 64 * 1024).catch(() => ({}));
    await recordClientProductAnalyticsEvent(user, body);
    sendJson(res, 200, { ok: true });
    return true;
  }
  return false;
}
