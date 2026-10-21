import { API_ENDPOINTS, buildApiUrl } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listHomeCarouselItems({ siteSlug = "" } = {}) {
  const query = new URLSearchParams();
  if (siteSlug) query.set("siteSlug", siteSlug);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(`${API_ENDPOINTS.home.carousel}${suffix}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function listAdminCarouselItems() {
  return requestJson(API_ENDPOINTS.admin.carousel).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function createAdminCarouselItem(payload) {
  return requestJson(API_ENDPOINTS.admin.carousel, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function updateAdminCarouselItem(itemId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.carousel}/${encodeURIComponent(String(itemId || "").trim())}`, {
    method: "PATCH",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export async function uploadAdminCarouselImage({ blob, filename = "carousel.webp" } = {}) {
  if (!(blob instanceof Blob)) throw new Error("Invalid carousel image.");
  const response = await fetch(buildApiUrl(API_ENDPOINTS.admin.carouselUpload), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": blob.type || "image/webp",
      "X-Upload-Filename": encodeURIComponent(String(filename || "carousel.webp")),
    },
    body: blob,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || payload?.message || "轮播图片上传失败");
  }
  return {
    ...payload,
    imageUrl: String(payload?.imageUrl || "").trim(),
  };
}
