import { trackEvent } from "../analytics/track.js";
import { getProfile, getProfileOrderDetail, getProfileOrders, reconcileProfileOrders, updateProfile } from "../services/profile-service.js";
import { getRawErrorMessage, getUserFacingErrorMessage } from "../utils/user-facing-error.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createProfileActions({ appState, sessionStore, syncSessionState, mountApp } = {}) {
  async function loadProfile({ force = false, silent = false } = {}) {
    if (!appState.session.authenticated) return { ok: false, error: "not_authenticated" };
    if (appState.profile.loading) return { ok: true };
    if (appState.profile.data && !force) return { ok: true, profile: appState.profile.data };

    appState.profile.loading = true;
    appState.profile.error = "";
    if (!silent) mountApp();

    try {
      const result = await getProfile();
      appState.profile.data = result.profile;
      syncSessionFromProfile(result.profile);
      appState.profile.error = "";
      return { ok: true, profile: result.profile };
    } catch (error) {
      appState.profile.error = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "profileLoad",
      });
      return { ok: false, error: appState.profile.error };
    } finally {
      appState.profile.loading = false;
      mountApp();
    }
  }

  async function saveProfile(formData) {
    if (appState.profile.saving) return { ok: false };
    appState.profile.saving = true;
    appState.profile.error = "";
    appState.profile.saveMessage = "";
    mountApp();

    try {
      const result = await updateProfile({
        nickname: formData?.nickname || "",
        favoriteClub: formData?.favoriteClub || "",
      });
      appState.profile.data = result.profile;
      syncSessionFromProfile(result.profile);
      appState.profile.saveMessage = createSiteCopy(appState.site?.pageLanguage).t("common.saved");
      trackEvent("profile_save_success", { has_favorite_club: Boolean(result.profile.favoriteClub) });
      return { ok: true, profile: result.profile };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      appState.profile.error = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "profileSave",
      });
      trackEvent("profile_save_failed", { reason: rawReason, status: error.status || 0 });
      return { ok: false, error: appState.profile.error };
    } finally {
      appState.profile.saving = false;
      mountApp();
    }
  }

  async function loadProfileOrders({ force = false } = {}) {
    const ordersState = appState.profile.orders;
    if (!appState.session.authenticated || ordersState.loading) return { ok: false, error: "not_authenticated" };
    if (ordersState.data && !force) return { ok: true, orders: ordersState.data };

    ordersState.loading = true;
    ordersState.error = "";
    mountApp();
    try {
      let result = await getProfileOrders();
      // TTMall order history is a read-only provider request. Only Shopify
      // needs its existing settlement reconciliation before displaying orders.
      if (result?.provider === "shopify") {
        const reconciliation = await reconcilePendingShopifyPayments();
        if (reconciliation?.cartCleared || Number(reconciliation?.reconciled || 0) > 0) result = await getProfileOrders();
      }
      ordersState.data = result;
      return { ok: true, orders: result };
    } catch (error) {
      ordersState.error = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "profileLoad",
      });
      return { ok: false, error: ordersState.error };
    } finally {
      ordersState.loading = false;
      mountApp();
    }
  }

  async function reconcilePendingShopifyPayments() {
    if (!appState.session.authenticated) return { ok: false, error: "not_authenticated" };
    try {
      const result = await reconcileProfileOrders();
      if (result?.cartCleared || Number(result?.reconciled || 0) > 0) {
        appState.profile.orders.data = null;
        appState.profile.orders.detail = null;
        appState.profile.orders.detailError = "";
      }
      return result || { ok: false };
    } catch {
      // A failed background payment check must never prevent the profile or
      // Orders tab from continuing with its normal read-only request.
      return { ok: false };
    }
  }

  async function openProfileOrder(orderId = "") {
    const ordersState = appState.profile.orders;
    if (!orderId || ordersState.detailLoading) return { ok: false };
    ordersState.detail = null;
    ordersState.detailError = "";
    ordersState.detailLoading = true;
    mountApp();
    try {
      const result = await getProfileOrderDetail(orderId);
      ordersState.detail = result.order;
      return { ok: true, order: result.order };
    } catch (error) {
      ordersState.detailError = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "profileLoad",
      });
      return { ok: false, error: ordersState.detailError };
    } finally {
      ordersState.detailLoading = false;
      mountApp();
    }
  }

  function closeProfileOrderDetail() {
    appState.profile.orders.detail = null;
    appState.profile.orders.detailError = "";
    mountApp();
  }

  function syncSessionFromProfile(profile = {}) {
    sessionStore.setSession({
      userId: profile.id || appState.session.userId,
      accountType: profile.accountType || appState.session.accountType,
      email: profile.email || appState.session.email,
      nickname: profile.nickname || profile.displayName || appState.session.nickname,
      avatarUrl: profile.avatarUrl || appState.session.avatarUrl,
    });
    syncSessionState();
  }

  return {
    loadProfile,
    saveProfile,
    loadProfileOrders,
    reconcilePendingShopifyPayments,
    openProfileOrder,
    closeProfileOrderDetail,
  };
}
