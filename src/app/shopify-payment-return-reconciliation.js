const PAYMENT_RETURN_MARKER_KEY = "aiove_shopify_payment_return";
const PAYMENT_RETURN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function markPendingShopifyPaymentReturn(siteSlug = "", { storage = window.sessionStorage, now = Date.now() } = {}) {
  const normalizedSiteSlug = normalizeSiteSlug(siteSlug);
  if (!normalizedSiteSlug) return false;
  try {
    storage.setItem(PAYMENT_RETURN_MARKER_KEY, JSON.stringify({ siteSlug: normalizedSiteSlug, expiresAt: now + PAYMENT_RETURN_MAX_AGE_MS }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingShopifyPaymentReturn({ storage = window.sessionStorage } = {}) {
  try {
    storage.removeItem(PAYMENT_RETURN_MARKER_KEY);
  } catch {
    // Storage availability must never block a normal Checkout redirect.
  }
}

export function readPendingShopifyPaymentReturn({ storage = window.sessionStorage, now = Date.now() } = {}) {
  try {
    const marker = JSON.parse(String(storage.getItem(PAYMENT_RETURN_MARKER_KEY) || ""));
    const siteSlug = normalizeSiteSlug(marker?.siteSlug);
    const expiresAt = Number(marker?.expiresAt || 0);
    if (!siteSlug || !Number.isFinite(expiresAt) || expiresAt <= now) {
      clearPendingShopifyPaymentReturn({ storage });
      return null;
    }
    return { siteSlug, expiresAt };
  } catch {
    clearPendingShopifyPaymentReturn({ storage });
    return null;
  }
}

export function bindShopifyPaymentReturnReconciliation({
  isAuthenticated = () => false,
  getCurrentSiteSlug = () => "",
  getAssignedSiteSlug = () => "",
  reconcilePendingShopifyPayments = async () => null,
  target = window,
  storage = window.sessionStorage,
  now = () => Date.now(),
} = {}) {
  let running = false;

  async function reconcileIfPending() {
    if (running || !isAuthenticated()) return null;
    const marker = readPendingShopifyPaymentReturn({ storage, now: now() });
    const currentSiteSlug = normalizeSiteSlug(getCurrentSiteSlug());
    const assignedSiteSlug = normalizeSiteSlug(getAssignedSiteSlug());
    if (!marker || !currentSiteSlug || marker.siteSlug !== currentSiteSlug || (assignedSiteSlug && assignedSiteSlug !== currentSiteSlug)) return null;
    running = true;
    try {
      const result = await reconcilePendingShopifyPayments();
      if (result?.ok) clearPendingShopifyPaymentReturn({ storage });
      return result || null;
    } catch {
      // Keep the harmless marker for a later same-tab ALOVE return. The server
      // remains the only source that can decide whether payment was completed.
      return null;
    } finally {
      running = false;
    }
  }

  const onPageShow = () => { void reconcileIfPending(); };
  target?.addEventListener?.("pageshow", onPageShow);
  return {
    reconcileIfPending,
    dispose() {
      target?.removeEventListener?.("pageshow", onPageShow);
    },
  };
}

function normalizeSiteSlug(value = "") {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? slug : "";
}
