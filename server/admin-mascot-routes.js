import { createAdminMascot, disableAdminSiteMascot, listAdminMascotSettings, saveAdminMascotTemplate, saveAdminSiteMascot, updateAdminMascot } from "./admin-mascot-service.js";
import { readJson, readRequestBuffer, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, decodeUploadFilename, requireAdmin } from "./route-utils.js";
import { createAdminMascotCampaignDelivery, getAdminMascotCampaignDelivery, listAdminMascotCampaigns } from "./admin-mascot-campaign-service.js";
import { deleteMascotGreetingImage, generateMascotGreetingImage, listMascotGreetingImages, MASCOT_GREETING_VIDEO_SLOT_INDEX, uploadMascotGreetingImage } from "./mascot-greeting-image-service.js";
import { MASCOT_GREETING_IMAGE_UPLOAD_POLICY, MASCOT_GREETING_VIDEO_UPLOAD_POLICY } from "./upload-policies.js";

export async function handleAdminMascotRoute(req, res, { path }) {
  if (req.method === "GET" && path === "/api/admin/mascot") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminMascotSettings());
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/mascot") {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    sendJson(res, 201, await createAdminMascot(await readJson(req)));
    return true;
  }
  if (req.method === "PATCH" && path === "/api/admin/mascot/template") {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    sendJson(res, 200, await saveAdminMascotTemplate(await readJson(req)));
    return true;
  }
  const greetingImagesMatch = path.match(/^\/api\/admin\/mascot\/([^/]+)\/greeting-images$/);
  if (req.method === "GET" && greetingImagesMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await listMascotGreetingImages(decodeURIComponent(greetingImagesMatch[1])));
    return true;
  }
  const greetingImageSlotMatch = path.match(/^\/api\/admin\/mascot\/([^/]+)\/greeting-images\/(\d+)$/);
  if (req.method === "DELETE" && greetingImageSlotMatch) {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    sendJson(res, 200, await deleteMascotGreetingImage({
      characterId: decodeURIComponent(greetingImageSlotMatch[1]),
      slotIndex: greetingImageSlotMatch[2],
    }));
    return true;
  }
  const greetingImageGenerateMatch = path.match(/^\/api\/admin\/mascot\/([^/]+)\/greeting-images\/(\d+)\/generate$/);
  if (req.method === "POST" && greetingImageGenerateMatch) {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    sendJson(res, 200, await generateMascotGreetingImage({
      characterId: decodeURIComponent(greetingImageGenerateMatch[1]),
      slotIndex: greetingImageGenerateMatch[2],
    }));
    return true;
  }
  const greetingImageUploadMatch = path.match(/^\/api\/admin\/mascot\/([^/]+)\/greeting-images\/(\d+)\/upload$/);
  if (req.method === "POST" && greetingImageUploadMatch) {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    const slotIndex = Number.parseInt(greetingImageUploadMatch[2], 10);
    const uploadPolicy = slotIndex === MASCOT_GREETING_VIDEO_SLOT_INDEX
      ? MASCOT_GREETING_VIDEO_UPLOAD_POLICY
      : MASCOT_GREETING_IMAGE_UPLOAD_POLICY;
    sendJson(res, 200, await uploadMascotGreetingImage({
      characterId: decodeURIComponent(greetingImageUploadMatch[1]),
      slotIndex,
      buffer: await readRequestBuffer(req, uploadPolicy.maxBytes),
      contentType: req.headers["content-type"],
      filename: decodeUploadFilename(req.headers["x-upload-filename"]),
    }));
    return true;
  }
  const mascotMatch = path.match(/^\/api\/admin\/mascot\/([^/]+)$/);
  if (req.method === "PATCH" && mascotMatch) {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    sendJson(res, 200, await updateAdminMascot(decodeURIComponent(mascotMatch[1]), await readJson(req)));
    return true;
  }
  const mascotSiteMatch = path.match(/^\/api\/admin\/mascot\/sites\/([^/]+)$/);
  if (req.method === "PATCH" && mascotSiteMatch) {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    sendJson(res, 200, await saveAdminSiteMascot(decodeURIComponent(mascotSiteMatch[1]), await readJson(req)));
    return true;
  }
  const mascotAdMatch = path.match(/^\/api\/admin\/mascot\/sites\/([^/]+)\/ads$/);
  const mascotAdCampaignsMatch = path.match(/^\/api\/admin\/mascot\/sites\/([^/]+)\/ads\/campaigns$/);
  if (req.method === "GET" && mascotAdCampaignsMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminMascotCampaigns(decodeURIComponent(mascotAdCampaignsMatch[1])));
    return true;
  }
  if (req.method === "POST" && mascotAdMatch) {
    await requireAdmin(req, ADMIN_SCOPES.PROMOTIONS_WRITE);
    sendJson(res, 201, await createAdminMascotCampaignDelivery(decodeURIComponent(mascotAdMatch[1]), await readJson(req)));
    return true;
  }
  const mascotAdStatusMatch = path.match(/^\/api\/admin\/mascot\/sites\/([^/]+)\/ads\/([^/]+)$/);
  if (req.method === "GET" && mascotAdStatusMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await getAdminMascotCampaignDelivery(
      decodeURIComponent(mascotAdStatusMatch[1]),
      decodeURIComponent(mascotAdStatusMatch[2])
    ));
    return true;
  }
  const mascotDisableMatch = path.match(/^\/api\/admin\/mascot\/sites\/([^/]+)\/disable$/);
  if (req.method === "PATCH" && mascotDisableMatch) {
    await requireAdmin(req, ADMIN_SCOPES.MASCOT_WRITE);
    sendJson(res, 200, await disableAdminSiteMascot(decodeURIComponent(mascotDisableMatch[1])));
    return true;
  }
  return false;
}
