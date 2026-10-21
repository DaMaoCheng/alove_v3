import { API_ENDPOINTS, buildApiUrl } from "../config/api-config.js";
import { ApiError, requestJson } from "./http-client.js";

export function listAdminMascotSettings() {
  return requestJson(API_ENDPOINTS.admin.mascot).then((result) => ({
    ...result,
    template: result.template || null,
    sites: Array.isArray(result.sites) ? result.sites : [],
    unboundMascots: Array.isArray(result.unboundMascots) ? result.unboundMascots : [],
  }));
}

export function saveAdminMascotTemplate(payload) {
  return normalizeMascotResult(requestJson(`${API_ENDPOINTS.admin.mascot}/template`, {
    method: "PATCH",
    body: payload,
  }));
}

export function createAdminMascot(payload) {
  return normalizeMascotResult(requestJson(API_ENDPOINTS.admin.mascot, {
    method: "POST",
    body: payload,
  }));
}

export function updateAdminMascot(mascotId, payload) {
  return normalizeMascotResult(requestJson(`${API_ENDPOINTS.admin.mascot}/${encodeURIComponent(String(mascotId || "").trim())}`, {
    method: "PATCH",
    body: payload,
  }));
}

export function saveAdminSiteMascot(siteId, payload) {
  return normalizeMascotResult(requestJson(`${API_ENDPOINTS.admin.mascot}/sites/${encodeURIComponent(String(siteId || "").trim())}`, {
    method: "PATCH",
    body: payload,
  }));
}

export function listAdminMascotCampaigns(siteId) {
  return requestJson(`${API_ENDPOINTS.admin.mascot}/sites/${encodeURIComponent(String(siteId || "").trim())}/ads/campaigns`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function createAdminMascotAdDelivery(siteId, campaignId) {
  return requestJson(`${API_ENDPOINTS.admin.mascot}/sites/${encodeURIComponent(String(siteId || "").trim())}/ads`, {
    method: "POST",
    body: { campaignId },
  });
}

export function getAdminMascotAdDelivery(siteId, deliveryId) {
  return requestJson(`${API_ENDPOINTS.admin.mascot}/sites/${encodeURIComponent(String(siteId || "").trim())}/ads/${encodeURIComponent(String(deliveryId || "").trim())}`);
}

export function disableAdminSiteMascot(siteId) {
  return normalizeMascotResult(requestJson(`${API_ENDPOINTS.admin.mascot}/sites/${encodeURIComponent(String(siteId || "").trim())}/disable`, {
    method: "PATCH",
  }));
}

export function listAdminMascotGreetingImages(mascotId) {
  return requestJson(`${mascotGreetingImagesPath(mascotId)}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function deleteAdminMascotGreetingImage(mascotId, slotIndex) {
  return requestJson(`${mascotGreetingImagesPath(mascotId)}/${normalizeSlotIndex(slotIndex)}`, {
    method: "DELETE",
  });
}

export async function uploadAdminMascotGreetingImage(mascotId, slotIndex, file) {
  if (!(file instanceof Blob)) throw new ApiError("请选择问候素材。");
  const response = await fetch(buildApiUrl(`${mascotGreetingImagesPath(mascotId)}/${normalizeSlotIndex(slotIndex)}/upload`), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(String(file.name || (Number(slotIndex) === 5 ? "mascot-greeting-video.mp4" : `mascot-greeting-${slotIndex}.webp`))),
    },
    body: file,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(String(payload?.error || payload?.message || "素材上传失败，请稍后再试"), { status: response.status, payload });
  }
  return payload;
}

function mascotGreetingImagesPath(mascotId) {
  return `${API_ENDPOINTS.admin.mascot}/${encodeURIComponent(String(mascotId || "").trim())}/greeting-images`;
}

function normalizeSlotIndex(value) {
  const slot = Number.parseInt(value, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new ApiError("素材槽位无效。");
  return slot;
}

function normalizeMascotResult(promise) {
  return promise.then((result) => ({
    ...result,
    template: result.template || null,
    sites: Array.isArray(result.sites) ? result.sites : [],
    unboundMascots: Array.isArray(result.unboundMascots) ? result.unboundMascots : [],
  }));
}
