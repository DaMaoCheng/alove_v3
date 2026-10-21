import { createAdminSite, listAdminSites, setDefaultAdminSite, updateAdminSite } from "./admin-site-service.js";
import { searchAdminGeoRegions } from "./geo-region-search-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminSiteRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/sites") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminSites());
    return true;
  }
  if (req.method === "GET" && path === "/api/admin/geo-regions/search") {
    await requireAdmin(req);
    sendJson(res, 200, await searchAdminGeoRegions(requestUrl.searchParams.get("query") || requestUrl.searchParams.get("q") || ""));
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/sites") {
    await requireAdmin(req, ADMIN_SCOPES.SITES_WRITE);
    sendJson(res, 201, await createAdminSite(await readJson(req)));
    return true;
  }
  const siteMatch = path.match(/^\/api\/admin\/sites\/([^/]+)$/);
  if (req.method === "PATCH" && siteMatch) {
    await requireAdmin(req, ADMIN_SCOPES.SITES_WRITE);
    sendJson(res, 200, await updateAdminSite(decodeURIComponent(siteMatch[1]), await readJson(req)));
    return true;
  }
  const siteDefaultMatch = path.match(/^\/api\/admin\/sites\/([^/]+)\/default$/);
  if (req.method === "PATCH" && siteDefaultMatch) {
    await requireAdmin(req, ADMIN_SCOPES.SITES_WRITE);
    sendJson(res, 200, await setDefaultAdminSite(decodeURIComponent(siteDefaultMatch[1])));
    return true;
  }
  return false;
}
