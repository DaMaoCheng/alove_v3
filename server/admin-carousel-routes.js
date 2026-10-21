import { createAdminHomeCarouselItem, listAdminHomeCarouselItems, updateAdminHomeCarouselItem } from "./home-carousel-service.js";
import { readJson, readRequestBuffer, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, decodeUploadFilename, requireAdmin } from "./route-utils.js";
import { saveCarouselUpload } from "./upload-service.js";
import { CAROUSEL_UPLOAD_POLICY } from "./upload-policies.js";

export async function handleAdminCarouselRoute(req, res, { path }) {
  if (req.method === "GET" && path === "/api/admin/carousel") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminHomeCarouselItems());
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/carousel/upload") {
    const user = await requireAdmin(req, ADMIN_SCOPES.CAROUSEL_WRITE);
    sendJson(res, 200, await saveCarouselUpload({
      userId: user.id,
      buffer: await readRequestBuffer(req, CAROUSEL_UPLOAD_POLICY.maxBytes),
      contentType: req.headers["content-type"],
      filename: decodeUploadFilename(req.headers["x-upload-filename"]),
    }));
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/carousel") {
    await requireAdmin(req, ADMIN_SCOPES.CAROUSEL_WRITE);
    sendJson(res, 201, await createAdminHomeCarouselItem(await readJson(req)));
    return true;
  }
  const carouselMatch = path.match(/^\/api\/admin\/carousel\/([^/]+)$/);
  if (req.method === "PATCH" && carouselMatch) {
    await requireAdmin(req, ADMIN_SCOPES.CAROUSEL_WRITE);
    sendJson(res, 200, await updateAdminHomeCarouselItem(decodeURIComponent(carouselMatch[1]), await readJson(req)));
    return true;
  }
  return false;
}
