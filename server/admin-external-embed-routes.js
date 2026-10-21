import { listAdminExternalEmbeds, saveAdminExternalEmbed } from "./external-embed-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminExternalEmbedRoute(req, res, { path }) {
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
