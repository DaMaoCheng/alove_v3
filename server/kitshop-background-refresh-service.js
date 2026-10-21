import { getKitshopShelves } from "./kitshop-service.js";

const pendingRefreshes = new Map();

export function scheduleKitshopRefresh(siteSlug = "") {
  const key = String(siteSlug || "").trim().toLowerCase();
  if (!key || pendingRefreshes.has(key)) return;
  const task = getKitshopShelves({
    siteSlug: key,
    forceRefresh: true,
    allowRefresh: true,
    strictSite: true,
    refreshLockTimeoutSeconds: 0,
  })
    .catch((error) => console.warn("[aiove] background Kitshop refresh failed:", error?.message || "unknown error"))
    .finally(() => pendingRefreshes.delete(key));
  pendingRefreshes.set(key, task);
}
