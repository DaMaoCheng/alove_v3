import { trackEvent } from "../analytics/track.js";
import { getInitialViewFromPath, normalizeAccountType, requiresAuth } from "./access-control.js";
import { isAuthView, normalizeAppView } from "./app-state.js";
import { resolveEffectiveSiteSlug } from "./site-routing.js";
import { applySiteLanguage } from "./site-language-state.js";
import { collapseSidebarRailAfterMountIfExpanded } from "../features/app-shell/sidebar-rail.js";
import { checkEmailAvailability, getCurrentUser, login, logout, register, resetPassword, sendForgotPasswordCode, sendRegisterCode } from "../services/auth-service.js";
import { getRawErrorMessage, getUserFacingErrorMessage } from "../utils/user-facing-error.js";
import { showToast } from "../features/shared-ui/toast.js";
import { resetAuthenticatedState, resetGuestChatState, resetProfileState } from "./app-auth-state.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function syncSessionState(appState, sessionStore) {
  const session = sessionStore.getState();
  appState.session = {
    authenticated: Boolean(session.authenticated),
    userId: session.userId || "",
    accountType: normalizeAccountType(session.accountType),
    email: session.email || "",
    nickname: session.nickname || "",
    avatarUrl: session.avatarUrl || "",
    balance: Number.isFinite(Number(session.balance)) ? Number(session.balance) : 0,
    siteId: session.siteId || "",
    siteSlug: session.siteSlug || "",
    siteName: session.siteName || "",
  };
}

export function createSessionActions({
  appState,
  sessionStore,
  getCurrentView,
  setCurrentView,
  mountApp,
  closeOverlays,
  navigate,
  pushViewPath,
  restoreAuthorizedRoute,
  refreshBalance,
  loadCharacters,
  loadChatContacts,
  loadCharactersForView,
  onAuthRecovered,
  onSiteChanged,
} = {}) {
  async function handleLoginSubmit(formData) {
    trackEvent("login_submit", {
      method: "email",
      has_username: Boolean(formData.username),
      has_password: Boolean(formData.password),
      remember_me: formData.rememberMe,
    });

    try {
      const result = await login(withCurrentSite(formData));
      await applyAuthenticatedSession(result, { resetProfileBefore: true, resetGuest: true });
      await refreshBalance();
      await loadCharacters();
      trackEvent("login_success", {
        user_id: result.userId || "",
      });
      await routeAfterAuthSuccess({
        isNewUser: false,
        preferredCharacterId: result.guestClaim?.claimed ? result.guestClaim.characterId : "",
      });
      if (result.guestClaim?.status === "site_mismatch" && result.guestClaim?.message) {
        showToast(result.guestClaim.message);
      }
      return { ok: true };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      const userMessage = authErrorMessage(error);
      trackEvent("login_failed", {
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, error: userMessage };
    }
  }

  async function handleRegisterSubmit(formData) {
    trackEvent("register_submit", {
      method: "email",
      has_display_name: Boolean(formData.displayName),
      has_email: Boolean(formData.email),
      has_code: Boolean(formData.code),
      has_password: Boolean(formData.password),
      has_confirm_password: Boolean(formData.confirmPassword),
      has_invite_code: Boolean(formData.inviteCode),
    });

    try {
      const result = await register(withCurrentSite(formData));
      await applyAuthenticatedSession(result, { resetProfileBefore: true, resetGuest: true });
      await refreshBalance();
      await loadCharacters();
      trackEvent("register_success", {
        user_id: result.userId || "",
        has_redirect_url: Boolean(result.redirectUrl),
      });
      await routeAfterAuthSuccess({
        isNewUser: true,
        preferredCharacterId: result.guestClaim?.claimed ? result.guestClaim.characterId : "",
      });
      return { ok: true };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      const userMessage = authErrorMessage(error);
      trackEvent("register_failed", {
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, error: userMessage };
    }
  }

  async function handleForgotPasswordSubmit(formData) {
    const copy = createSiteCopy(appState.site.pageLanguage);
    trackEvent("forgot_password_submit", {
      method: "email",
      has_email: Boolean(formData.email),
      has_code: Boolean(formData.code),
      has_password: Boolean(formData.password),
      has_confirm_password: Boolean(formData.confirmPassword),
    });

    try {
      await resetPassword(formData);
      trackEvent("forgot_password_success", {
        has_email: Boolean(formData.email),
      });
      window.setTimeout(() => {
        navigate("login");
      }, 1200);
      return { ok: true, message: copy.t("auth.resetAndSignIn") };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      const userMessage = authErrorMessage(error);
      trackEvent("forgot_password_failed", {
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, error: userMessage };
    }
  }

  function handleGoogleLogin() {
    trackEvent("login_google_click", {
      source: getCurrentView(),
    });
    const siteSlug = appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop";
    window.location.href = `/api/auth/google/start?siteSlug=${encodeURIComponent(siteSlug)}`;
  }

  async function handleSendCode({ target, email }) {
    trackEvent("auth_code_send_click", {
      target,
    });

    try {
      if (target === "forgot_password_email") {
        await sendForgotPasswordCode({ email });
      } else {
        await sendRegisterCode({ email });
      }
      trackEvent("auth_code_send_success", {
        target,
      });
      return { ok: true };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      const userMessage = authErrorMessage(error);
      trackEvent("auth_code_send_failed", {
        target,
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, error: userMessage };
    }
  }

  async function handleCheckRegisterEmail({ email }) {
    const copy = createSiteCopy(appState.site.pageLanguage);
    trackEvent("register_email_check", {
      has_email: Boolean(email),
    });

    try {
      const result = await checkEmailAvailability({ email });
      trackEvent("register_email_check_success", {
        available: Boolean(result.available),
      });
      return {
        ok: true,
        available: Boolean(result.available),
        error: result.available ? "" : copy.t("auth.emailRegistered"),
      };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      const userMessage = authErrorMessage(error);
      trackEvent("register_email_check_failed", {
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, available: false, error: userMessage };
    }
  }

  async function handleLogout() {
    trackEvent("logout_click", {
      source: getCurrentView(),
    });

    try {
      await logout();
      trackEvent("logout_success", {
        source: getCurrentView(),
      });
    } catch (error) {
      trackEvent("logout_failed", {
        reason: error.message,
        status: error.status || 0,
      });
    } finally {
      sessionStore.clearSession();
      syncSessionState(appState, sessionStore);
      closeOverlays();
      resetAuthenticatedState(appState, { reason: "logout" });
      setCurrentView("login");
      pushViewPath("login", true);
      mountApp();
    }
  }

  async function hydrateExistingSession() {
    try {
      const result = await getCurrentUser();
      if (!result?.user?.id) {
        sessionStore.clearSession();
        syncSessionState(appState, sessionStore);
        resetProfileState(appState);
        if (requiresAuth(normalizeAppView(getInitialViewFromPath())) && !appState.chat?.guest?.available) {
          setCurrentView("login");
          pushViewPath("login", true);
          mountApp();
        }
        return { authenticated: false, view: getCurrentView() };
      }
      const previousUserId = appState.session.userId || sessionStore.getState().userId || "";
      const nextSession = {
        userId: result.user.id,
        accountType: result.user.accountType,
        email: result.user.email,
        nickname: result.user.nickname,
        avatarUrl: result.user.avatarUrl || "",
        siteId: result.user.siteId || "",
        siteSlug: result.user.siteSlug || "",
        siteName: result.user.siteName || "",
      };
      await applyAuthenticatedSession(nextSession, {
        resetProfileAfter: Boolean(previousUserId && previousUserId !== result.user.id),
      });
      if (isAuthView(getCurrentView())) {
        await refreshBalance();
        await loadCharacters();
        const routeView = normalizeAppView(getInitialViewFromPath());
        if (requiresAuth(routeView)) {
          const authorizedView = restoreAuthorizedRoute({ replace: true });
          mountApp();
          void loadChatContacts?.();
          loadCharactersForView(authorizedView);
          return { authenticated: true, view: authorizedView };
        }
        const routedView = await routeAfterAuthSuccess({ isNewUser: false, replace: true });
        return { authenticated: true, view: routedView };
      }
      const authorizedView = restoreAuthorizedRoute({ replace: true });
      mountApp();
      void refreshBalance();
      void loadCharacters();
      void loadChatContacts?.();
      loadCharactersForView(authorizedView);
      return { authenticated: true, view: authorizedView };
    } catch {
      sessionStore.clearSession();
      syncSessionState(appState, sessionStore);
      resetProfileState(appState);
      if (requiresAuth(normalizeAppView(getInitialViewFromPath())) && !appState.chat?.guest?.available) {
        setCurrentView("login");
        pushViewPath("login", true);
        mountApp();
      }
      return { authenticated: false, view: getCurrentView() };
    }
  }

  async function routeAfterAuthSuccess({ isNewUser = false, replace = false, preferredCharacterId = "" } = {}) {
    await loadChatContacts?.();
    const targetContact = selectAuthLandingContact(appState.chat.contacts, { isNewUser, preferredCharacterId });
    const targetCharacterId = String(targetContact?.characterId || "").trim();
    if (!targetCharacterId) {
      navigate("discover");
      return "discover";
    }
    appState.agent = targetCharacterId;
    setCurrentView("chat");
    pushViewPath("chat", replace);
    mountApp();
    collapseSidebarRailAfterMountIfExpanded();
    loadCharactersForView("chat", targetCharacterId);
    return "chat";
  }

  function selectAuthLandingContact(contacts = [], { isNewUser = false, preferredCharacterId = "" } = {}) {
    const rows = Array.isArray(contacts) ? contacts : [];
    const preferred = String(preferredCharacterId || "").trim();
    if (preferred) {
      const match = rows.find((item) => String(item?.characterId || "").trim() === preferred);
      if (match) return match;
    }
    if (isNewUser) return rows[0] || null;
    return rows[0] || null;
  }

  async function applyAuthenticatedSession(session, { resetProfileBefore = false, resetProfileAfter = false, resetGuest = false } = {}) {
    if (resetProfileBefore) resetProfileState(appState);
    sessionStore.setSession(session);
    syncSessionState(appState, sessionStore);
    if (resetProfileAfter) resetProfileState(appState);
    if (resetGuest) resetGuestChatState(appState);
    onAuthRecovered?.();
    await applySiteFromSessionOrLocation();
  }

  function withCurrentSite(formData) {
    return {
      ...formData,
      siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop",
    };
  }

  async function applySiteFromSessionOrLocation() {
    const previousSlug = appState.site.currentSlug;
    appState.site.assignedSiteId = appState.session.siteId || "";
    appState.site.assignedSiteSlug = appState.session.siteSlug || "";
    appState.site.assignedSiteName = appState.session.siteName || "";
    appState.site.currentSlug = resolveEffectiveSiteSlug({
      currentSlug: appState.site.currentSlug,
      visitorSiteSlug: appState.site.defaultSlug,
      assignedSiteSlug: appState.session.siteSlug,
      accountType: appState.session.accountType,
    });
    if (previousSlug !== appState.site.currentSlug) {
      applySiteLanguage(appState, "English");
      appState.site.branding = null;
      await onSiteChanged?.(appState.site.currentSlug);
    } else {
      applySiteLanguage(appState, appState.site.branding?.language || "English");
    }
  }

  function authErrorMessage(error) {
    return getUserFacingErrorMessage(error, {
      pageLanguage: appState.site?.pageLanguage || "English",
      fallbackType: "auth",
    });
  }

  return {
    handleLoginSubmit,
    handleRegisterSubmit,
    handleForgotPasswordSubmit,
    handleCheckRegisterEmail,
    handleGoogleLogin,
    handleSendCode,
    handleLogout,
    hydrateExistingSession,
  };
}
