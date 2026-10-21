import { trackEvent } from "../analytics/track.js";
import { getInitialAgentFromPath, getInitialExternalHandoffFromPath } from "./access-control.js";
import { createBillingActions } from "./app-billing-actions.js";
import { createCallActions } from "./app-call-actions.js";
import { createCharacterActions } from "./app-character-actions.js";
import { createChatActions } from "./app-chat-actions.js";
import { createAppCreateActions } from "./app-create-actions.js";
import { createCurrentView } from "./app-view-factory.js";
import { createMainUiActions } from "./app-main-ui-actions.js";
import { createInitialAppState, isAuthView } from "./app-state.js";
import { createNavigationActions, getSafeInitialView, initializeSiteRoute, pushViewPath } from "./app-navigation.js";
import { createProfileActions } from "./app-profile-actions.js";
import { createSessionActions, syncSessionState } from "./app-session-actions.js";
import { createSessionStore } from "../store/session-store.js";
import { createCreateLeaveProtection } from "./create-leave-protection.js";
import { createSiteCopy } from "../i18n/site-copy.js";
import { bindCropperEscClose } from "../features/avatar-cropper/avatar-cropper.js";
import { bindDialogEscClose } from "../features/shared-ui/dialog.js";
import { resolveAdminAccountTargetFromSearch, resolveAdminGuestTargetFromSearch, resolveAdminViewFromSearch } from "../features/admin-console/admin-view-routing.js";
import { createAppBootScreen, finishPageLoading, startPageLoading } from "./app-loading-bar.js";
import { resolveSiteForVisitor } from "../services/site-service.js";
import { getSiteBranding, normalizeSiteBranding } from "../services/site-branding-service.js";
import { getGuestChatCapability } from "../services/guest-chat-service.js";
import { getInitialViewFromPath } from "./access-control.js";
import { getSiteSlugFromPath, shouldRedirectToDefaultSite, shouldReplaceExplicitSiteRoute, sitePathForRejectedSitePath, sitePathForUnprefixedPath } from "./site-routing.js";
import { applySiteBranding } from "./site-language-state.js";
import { initializeThemePreference } from "../pages/login/theme-toggle.js";
import { showToast } from "../features/shared-ui/toast.js";
import { resetAuthenticatedState } from "./app-auth-state.js";
import { disposeView } from "./app-view-lifecycle.js";
import { enforceAgeGate } from "../features/age-gate/age-gate.js";

initializeThemePreference();
const initialAuthNotice = new URL(window.location.href).searchParams.get("authNotice") || "";
const appState = createInitialAppState();
if (!shouldRedirectToDefaultSite(window.location.pathname)) {
  initializeSiteRoute(appState, { replace: true });
}
const sessionStore = createSessionStore();
bindDialogEscClose();
bindCropperEscClose();
const initialAgent = getInitialAgentFromPath();
const initialExternalHandoff = getInitialExternalHandoffFromPath();
if (initialExternalHandoff) {
  appState.chat.guest.sourceHandoff = initialExternalHandoff;
}
if (initialAgent) {
  appState.agent = initialAgent;
}
appState.adminView = resolveAdminViewFromSearch(window.location.search);
appState.adminAccountTargetId = resolveAdminAccountTargetFromSearch(window.location.search);
appState.adminGuestTargetId = resolveAdminGuestTargetFromSearch(window.location.search);

syncSessionState(appState, sessionStore);
let currentView = "login";
let appActions = null;
let authExpiredHandled = false;
let renderedView = null;

const chatActions = createChatActions({
  appState,
  getCurrentView: () => currentView,
  mountApp,
});

const characterActions = createCharacterActions({
  appState,
  mountApp: () => mainUiActions.mountAppPreservingMainScroll(),
  loadChatMessages: chatActions.loadChatMessages,
  loadChatContacts: chatActions.loadChatContacts,
});

const billingActions = createBillingActions({
  appState,
  sessionStore,
  syncSessionState: () => syncSessionState(appState, sessionStore),
  mountApp,
});

const profileActions = createProfileActions({
  appState,
  sessionStore,
  syncSessionState: () => syncSessionState(appState, sessionStore),
  mountApp: () => mainUiActions.mountProfileAware(),
});

const navigationActions = createNavigationActions({
  appState,
  getCurrentView: () => currentView,
  setCurrentView: (view) => {
    currentView = view;
  },
  mountApp,
  closeOverlays,
  loadCharactersForView: characterActions.loadCharactersForView,
});

const leaveProtection = createCreateLeaveProtection({
  appState,
  getCurrentView: () => currentView,
  navigationActions,
  characterActions,
});

const sessionActions = createSessionActions({
  appState,
  sessionStore,
  getCurrentView: () => currentView,
  setCurrentView: (view) => {
    currentView = view;
  },
  mountApp,
  closeOverlays,
  navigate: navigationActions.navigate,
  pushViewPath: (view, replace = false) => pushViewPath(appState, view, replace),
  restoreAuthorizedRoute: navigationActions.restoreAuthorizedRoute,
  refreshBalance: billingActions.refreshBalance,
  loadCharacters: characterActions.loadCharacters,
  loadChatContacts: chatActions.loadChatContacts,
  loadCharactersForView: characterActions.loadCharactersForView,
  onAuthRecovered: resetAuthExpiredGuard,
  onSiteChanged: refreshCurrentSiteBranding,
});

const callActions = createCallActions({
  appState,
  mountApp,
  onNavigate: navigationActions.navigateApp,
  refreshGuestChat: () => chatActions.loadChatMessages(appState.agent),
});

const createActions = createAppCreateActions({
  appState,
  characterActions,
  navigationActions: {
    ...navigationActions,
    navigateApp: leaveProtection.guardedNavigateApp,
  },
  mountAppPreservingMainScroll: () => mainUiActions.mountAppPreservingMainScroll(),
});

const mainUiActions = createMainUiActions({
  appState,
  profileActions,
  mountApp,
  pushAdminPath: (replace = false) => pushViewPath(appState, "admin", replace),
  getCurrentView: () => currentView,
});

appActions = {
  navigate: navigationActions.navigate,
  ...billingActions,
  ...callActions,
  ...characterActions,
  ...chatActions,
  ...createActions,
  ...navigationActions,
  ...profileActions,
  ...sessionActions,
  openProfile: mainUiActions.openProfile,
  closeProfile: mainUiActions.closeProfile,
  setProfileTab: mainUiActions.setProfileTab,
  handleProfileSave: profileActions.saveProfile,
  setCategory: mainUiActions.setCategory,
  setSearchQuery: mainUiActions.setSearchQuery,
  clearRecentSearches: mainUiActions.clearRecentSearches,
  setAdminView: mainUiActions.setAdminView,
  openAdminAccount: mainUiActions.openAdminAccount,
  openAdminGuestSession: mainUiActions.openAdminGuestSession,
  consumeAdminTarget: mainUiActions.consumeAdminTarget,
  navigateApp: leaveProtection.guardedNavigateApp,
};

leaveProtection.bindCreateLeaveProtection();
start();
window.addEventListener("popstate", leaveProtection.guardedHandlePopState);
window.addEventListener("aiove:auth-expired", handleAuthExpired);
window.addEventListener("aiove:ttmall-order-created", () => {
  appState.profile.orders.data = null;
  appState.profile.orders.detail = null;
  appState.profile.orders.detailError = "";
});
window.addEventListener("aiove:navigate", (event) => {
  leaveProtection.guardedNavigateApp(event.detail?.view || "discover", event.detail?.agent);
});
window.addEventListener("aiove:avatar-crop-state", (event) => {
  appState.create.avatarCropping = event.detail?.open === true;
});

async function start() {
  const app = document.getElementById("app");
  if (!app) return;
  document.body.dataset.view = "boot";
  startPageLoading();
  app.replaceChildren(createAppBootScreen());
  await ensureSiteRoute();
  await loadCurrentSiteBranding();
  await enforceAgeGate({
    pageLanguage: appState.site.pageLanguage,
    siteSlug: appState.site.currentSlug || appState.site.defaultSlug,
  });
  await probeGuestCapability();
  currentView = getSafeInitialView(appState);
  const sessionResult = await sessionActions.hydrateExistingSession();
  if (!sessionResult?.authenticated && activateGuestCapability()) {
    currentView = getSafeInitialView(appState);
    if (currentView === "chat") appState.agent = getInitialAgentFromPath() || appState.chat.guest.mascotCharacterId;
    await characterActions.loadCharactersForView(currentView, appState.agent);
  } else if (sessionResult?.authenticated) {
    appState.chat.guest.available = false;
    appState.chat.guest.active = false;
    appState.chat.guest.capability = null;
  }
  if (document.body.dataset.view === "boot") {
    mountApp();
  }
  finishPageLoading();
  if (sessionResult?.authenticated) showAuthNoticeFromLocation();
}

function showAuthNoticeFromLocation() {
  if (initialAuthNotice !== "guest-site-mismatch") return;
  showToast(createSiteCopy(appState.site.pageLanguage).t("auth.guestSiteMismatch"));
  const url = new URL(window.location.href);
  url.searchParams.delete("authNotice");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

async function probeGuestCapability() {
  const initialView = getInitialViewFromPath();
  if (!["login", "register", "forgot-password", "discover", "search", "kitshop", "create", "chat"].includes(initialView)) return;
  try {
    const result = await getGuestChatCapability(appState.site.currentSlug);
    if (!result?.enabled || !result.mascotCharacterId) return;
    appState.chat.guest = {
      ...appState.chat.guest,
      available: true,
      capability: result,
    };
  } catch {
    appState.chat.guest.available = false;
    appState.chat.guest.active = false;
    appState.chat.guest.capability = null;
  }
}

function activateGuestCapability() {
  const result = appState.chat.guest?.capability;
  if (!appState.chat.guest?.available || !result?.enabled || !result?.mascotCharacterId) return false;
  appState.chat.guest = {
    ...appState.chat.guest,
    active: true,
    siteSlug: result.siteSlug || appState.site.currentSlug,
    mascotCharacterId: result.mascotCharacterId,
  };
  if (getInitialViewFromPath() === "chat") {
    appState.agent = result.mascotCharacterId;
    pushViewPath(appState, "chat", true);
  }
  return true;
}

async function ensureSiteRoute() {
  const explicitSlug = getSiteSlugFromPath(window.location.pathname);
  if (explicitSlug) {
    try {
      const branding = await getSiteBranding(explicitSlug);
      if (branding) {
        initializeSiteRoute(appState, { replace: true });
        applySiteBranding(appState, branding);
        return;
      }
    } catch (error) {
      if (!shouldReplaceExplicitSiteRoute(error)) {
        initializeSiteRoute(appState, { replace: true });
        applySiteBranding(appState, null);
        return;
      }
    }
    try {
      await replaceRejectedSiteRoute();
    } catch {
      const fallbackSlug = appState.site.defaultSlug;
      const nextPath = sitePathForRejectedSitePath(fallbackSlug, window.location.pathname, window.location.search);
      window.history.replaceState({ view: getInitialViewFromPath(nextPath), siteSlug: fallbackSlug }, "", nextPath);
      initializeSiteRoute(appState, { replace: true });
    }
    return;
  }
  if (!shouldRedirectToDefaultSite(window.location.pathname)) {
    initializeSiteRoute(appState, { replace: true });
    return;
  }
  try {
    const result = await resolveSiteForVisitor();
    const resolvedSlug = result.siteSlug || appState.site.defaultSlug;
    appState.site.currentSlug = resolvedSlug;
    applySiteBranding(appState, normalizeSiteBranding(result));
    const nextPath = sitePathForUnprefixedPath(resolvedSlug, window.location.pathname, window.location.search);
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.replaceState({ view: getSafeInitialView(appState), siteSlug: resolvedSlug }, "", nextPath);
    }
  } catch {
    initializeSiteRoute(appState, { replace: true });
  }
}

async function replaceRejectedSiteRoute() {
  const result = await resolveSiteForVisitor();
  const resolvedSlug = result.siteSlug || appState.site.defaultSlug;
  appState.site.currentSlug = resolvedSlug;
  applySiteBranding(appState, normalizeSiteBranding(result));
  const nextPath = sitePathForRejectedSitePath(resolvedSlug, window.location.pathname, window.location.search);
  window.history.replaceState({ view: getInitialViewFromPath(nextPath), siteSlug: resolvedSlug }, "", nextPath);
}

async function loadCurrentSiteBranding() {
  const siteSlug = appState.site.currentSlug || appState.site.defaultSlug;
  if (appState.site.branding?.slug === siteSlug
    && typeof appState.site.branding.hasProductAccessToken === "boolean"
    && typeof appState.site.branding.shopifyLoginEnabled === "boolean") return;
  try {
    applySiteBranding(appState, await getSiteBranding(siteSlug));
  } catch {
    applySiteBranding(appState, null);
  }
}

async function refreshCurrentSiteBranding(siteSlug = appState.site.currentSlug) {
  const requestSlug = String(siteSlug || "").trim();
  try {
    const branding = await getSiteBranding(requestSlug);
    if (appState.site.currentSlug !== requestSlug) return;
    applySiteBranding(appState, branding);
  } catch {
    if (appState.site.currentSlug === requestSlug) applySiteBranding(appState, null);
  }
  if (appActions) mountApp();
}

window.addEventListener("aiove:site-branding-updated", (event) => {
  const updatedSlug = String(event.detail?.siteSlug || "").trim();
  if (updatedSlug && updatedSlug === appState.site.currentSlug) refreshCurrentSiteBranding(updatedSlug);
});

function mountApp() {
  const app = document.getElementById("app");
  if (!app || !appActions) {
    return;
  }

  document.body.dataset.view = currentView;

  disposeView(renderedView);
  const nextView = createCurrentView({
    currentView,
    appState,
    actions: appActions,
  });
  app.replaceChildren(nextView);
  renderedView = nextView instanceof DocumentFragment ? null : nextView;

  trackEvent(isAuthView(currentView) ? "auth_page_view" : "app_page_view", {
    view: currentView,
  });
}

function closeOverlays() {
  appState.profile.open = false;
  callActions.stopCall();
}

function handleAuthExpired() {
  if (authExpiredHandled) return;
  authExpiredHandled = true;
  sessionStore.clearSession();
  syncSessionState(appState, sessionStore);
  closeOverlays();
  resetAuthenticatedState(appState, { reason: "expired" });
  currentView = "login";
  pushViewPath(appState, "login", true);
  mountApp();
}

function resetAuthExpiredGuard() {
  authExpiredHandled = false;
}

window.appActions = {
  ...appActions,
  openProfile: mainUiActions.openProfile,
  closeProfile: mainUiActions.closeProfile,
  setProfileTab: mainUiActions.setProfileTab,
};
