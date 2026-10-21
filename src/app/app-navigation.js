import { getInitialAgentFromPath, getInitialViewFromPath, pathForView, requiresAuth, resolveAuthorizedView } from "./access-control.js";
import { isAuthView, normalizeAppView } from "./app-state.js";
import { collapseSidebarRail, collapseSidebarRailAfterMountIfExpanded } from "../features/app-shell/sidebar-rail.js";
import { pathForAdminView, resolveAdminViewFromSearch } from "../features/admin-console/admin-view-routing.js";
import { defaultSitePathFor, getSiteSlugFromPath, resolveCurrentSiteSlug, resolveEffectiveSiteSlug, shouldRedirectToDefaultSite } from "./site-routing.js";
import { applySiteLanguage } from "./site-language-state.js";

export function initializeSiteRoute(appState, { replace = false } = {}) {
  const siteSlug = resolveCurrentSiteSlug(window.location.pathname);
  appState.site.currentSlug = siteSlug;
  applySiteLanguage(appState, appState.site.branding?.slug === siteSlug ? appState.site.branding.language : "English");
  if (shouldRedirectToDefaultSite(window.location.pathname)) {
    const nextPath = defaultSitePathFor(window.location.pathname, window.location.search);
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.replaceState({ view: getInitialViewFromPath(nextPath), siteSlug }, "", nextPath);
    }
  } else if (replace && getSiteSlugFromPath(window.location.pathname)) {
    window.history.replaceState({ view: getInitialViewFromPath(), siteSlug }, "", `${window.location.pathname}${window.location.search}`);
  }
}

export function syncCurrentSiteFromLocation(appState) {
  const siteSlug = getSiteSlugFromPath(window.location.pathname);
  appState.site.currentSlug = resolveEffectiveSiteSlug({
    currentSlug: siteSlug || appState.site.currentSlug,
    visitorSiteSlug: appState.site.defaultSlug,
    assignedSiteSlug: appState.site.assignedSiteSlug,
    accountType: appState.session.accountType,
  });
  applySiteLanguage(appState, appState.site.branding?.slug === appState.site.currentSlug ? appState.site.branding.language : "English");
  return appState.site.currentSlug;
}

export function applySessionSite(appState) {
  const assignedSlug = String(appState.session.siteSlug || "").trim();
  appState.site.assignedSiteId = appState.session.siteId || "";
  appState.site.assignedSiteSlug = assignedSlug;
  appState.site.assignedSiteName = appState.session.siteName || "";
  appState.site.currentSlug = resolveEffectiveSiteSlug({
    currentSlug: getSiteSlugFromPath(window.location.pathname) || appState.site.currentSlug,
    visitorSiteSlug: appState.site.defaultSlug,
    assignedSiteSlug: assignedSlug,
    accountType: appState.session.accountType,
  });
  applySiteLanguage(appState, appState.site.branding?.slug === appState.site.currentSlug ? appState.site.branding.language : "English");
  return appState.site.currentSlug;
}

export function getSafeInitialView(appState) {
  initializeSiteRoute(appState, { replace: true });
  syncAdminViewFromLocation(appState);
  const initialView = normalizeAppView(getInitialViewFromPath());
  if (requiresAuth(initialView)) {
    return appState.session.authenticated || canUseGuestView(appState, initialView) ? resolveViewForSession(appState, initialView) : "login";
  }
  return resolveViewForSession(appState, initialView);
}

export function resolveViewForSession(appState, view) {
  if (requiresAuth(view) && !appState.session.authenticated && !canUseGuestView(appState, view)) {
    return "login";
  }
  return resolveAuthorizedView(view, appState.session.accountType);
}

export function canUseGuestView(appState, view) {
  return ["discover", "search", "kitshop", "chat"].includes(view) && appState.chat?.guest?.active === true;
}

export function pushViewPath(appState, view, replace = false) {
  const nextPath = view === "admin"
    ? pathForAdminView(appState.adminView, { accountId: appState.adminAccountTargetId, guestSessionId: appState.adminGuestTargetId })
    : pathForView(view, {
      agent: view === "chat" ? appState.agent : "",
      siteSlug: appState.site.currentSlug || appState.site.defaultSlug,
    });
  if (`${window.location.pathname}${window.location.search}` === nextPath) {
    return;
  }
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ view, siteSlug: appState.site.currentSlug }, "", nextPath);
}

export function createNavigationActions({
  appState,
  getCurrentView,
  setCurrentView,
  mountApp,
  closeOverlays,
  loadCharactersForView,
} = {}) {
  function navigate(view) {
    closeOverlays();
    syncCurrentSiteFromLocation(appState);
    const nextView = resolveViewForSession(appState, normalizeAppView(view));
    clearSearchQueryForView(appState, nextView);
    setCurrentView(nextView);
    pushViewPath(appState, nextView);
    mountApp();
    collapseSidebarForChatAfterMount(nextView);
    loadCharactersForView(nextView);
  }

  function navigateApp(view, agent) {
    if (agent) {
      appState.agent = agent;
    }

    document.body.classList.remove("drawer-open");
    closeOverlays();
    syncCurrentSiteFromLocation(appState);
    const nextView = resolveViewForSession(appState, normalizeAppView(view));
    clearSearchQueryForView(appState, nextView);
    setCurrentView(nextView);
    pushViewPath(appState, nextView);
    mountApp();
    collapseSidebarForChatAfterMount(nextView);
    loadCharactersForView(nextView, agent);
  }

  function restoreAuthorizedRoute({ replace = false } = {}) {
    syncCurrentSiteFromLocation(appState);
    applySessionSite(appState);
    const routeView = normalizeAppView(getInitialViewFromPath());
    const currentView = getCurrentView();
    const authorizedView = isAuthView(currentView) && isAuthView(routeView)
      ? "discover"
      : resolveViewForSession(appState, routeView);
    if (authorizedView === "admin") syncAdminViewFromLocation(appState);

    if (authorizedView !== currentView) {
      clearSearchQueryForView(appState, authorizedView);
      setCurrentView(authorizedView);
    }
    pushViewPath(appState, authorizedView, replace);
    collapseSidebarForChat(authorizedView);
    return authorizedView;
  }

  function handlePopState() {
    closeOverlays();
    syncCurrentSiteFromLocation(appState);
    const routeView = normalizeAppView(getInitialViewFromPath());
    const requestedAgent = getInitialAgentFromPath();
    const nextAgent = resolveGuestChatAgent(appState, routeView, requestedAgent);
    const guestMascotId = nextAgent && nextAgent !== requestedAgent ? nextAgent : "";
    if (nextAgent) {
      appState.agent = nextAgent;
    }
    const nextView = resolveViewForSession(appState, routeView);
    if (guestMascotId) pushViewPath(appState, "chat", true);
    if (nextView === "admin") syncAdminViewFromLocation(appState);
    clearSearchQueryForView(appState, nextView);
    setCurrentView(nextView);
    mountApp();
    collapseSidebarForChatAfterMount(nextView);
    loadCharactersForView(nextView, appState.agent);
  }

  return {
    navigate,
    navigateApp,
    restoreAuthorizedRoute,
    handlePopState,
  };
}

export function resolveGuestChatAgent(appState, view, requestedAgent = "") {
  if (appState.chat?.guest?.active === true && !appState.session.authenticated && view === "chat") {
    return String(requestedAgent || appState.chat.guest.mascotCharacterId || "");
  }
  return String(requestedAgent || "");
}

function collapseSidebarForChat(view) {
  if (view !== "chat") return;
  collapseSidebarRail();
}

function clearSearchQueryForView(appState, nextView) {
  if (!appState?.search) return;
  appState.search.query = "";
  if (nextView !== "search") document.body.classList.remove("product-open");
}

function collapseSidebarForChatAfterMount(view) {
  if (view !== "chat") return;
  collapseSidebarRailAfterMountIfExpanded();
}

function syncAdminViewFromLocation(appState) {
  if (getInitialViewFromPath() !== "admin") return;
  appState.adminView = resolveAdminViewFromSearch(window.location.search);
  const params = new URLSearchParams(window.location.search || "");
  appState.adminAccountTargetId = appState.adminView === "accounts"
    ? String(params.get("accountId") || "").trim().slice(0, 64)
    : "";
  appState.adminGuestTargetId = appState.adminView === "accounts"
    ? String(params.get("guestSessionId") || "").trim().slice(0, 64)
    : "";
}
