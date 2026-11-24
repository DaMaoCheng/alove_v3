import { getAdminExternalPromotion, saveAdminExternalPromotion } from "./external-promotion-service.js";
import { listAdminExternalEmbeds, saveAdminExternalEmbed } from "./external-embed-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminExternalEmbedRoute(req, res, { path, requestUrl }) {
  if (path === "/api/admin/external-embeds/promotion" && ["GET","PUT"].includes(req.method)) {
    await requireAdmin(req, req.method === "PUT" ? ADMIN_SCOPES.SITES_WRITE : ADMIN_SCOPES.READ);
    const body = req.method === "PUT" ? await readJson(req, 16 * 1024) || {} : {};
    const siteId = req.method === "PUT" ? body.siteId : requestUrl.searchParams.get("siteId");
    sendJson(res, 200, req.method === "PUT" ? await saveAdminExternalPromotion(siteId, body) : await getAdminExternalPromotion(siteId));
    return true;
  }
  if (req.method === "GET" && path === "/api/admin/external-embeds") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminExternalEmbeds());
    return true;
  }
  const match = path.match(/^\/api\/admin\/external-embeds\/([^/]+)$/);
  if (req.method === "PUT" && match) {
    await requireAdmin(req, ADMIN_SCOPES.SITES_WRITE);
    sendJson(res, 200, await saveAdminExternalEmbed(decodeURIComponent(match[1]), await readJson(req)));
    return true;
  }
  return false;
}
