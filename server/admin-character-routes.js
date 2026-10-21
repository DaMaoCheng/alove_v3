import { createAdminCharacter, listAdminCharacters, updateAdminCharacterSettings } from "./character-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminCharacterRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/characters") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminCharacters({
      query: requestUrl.searchParams.get("query"),
      type: requestUrl.searchParams.get("type"),
    }));
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/characters") {
    const admin = await requireAdmin(req, ADMIN_SCOPES.CHARACTERS_WRITE);
    sendJson(res, 201, await createAdminCharacter(admin.id, await readJson(req)));
    return true;
  }
  const settingsMatch = path.match(/^\/api\/admin\/characters\/([^/]+)\/settings$/);
  if (req.method === "PATCH" && settingsMatch) {
    await requireAdmin(req, ADMIN_SCOPES.CHARACTERS_WRITE);
    sendJson(res, 200, await updateAdminCharacterSettings(decodeURIComponent(settingsMatch[1]), await readJson(req)));
    return true;
  }
  return false;
}
