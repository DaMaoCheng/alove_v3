import { updateProfileModal } from "../features/profile-modal/profile-modal.js";
import { resolveAdminViewFromSearch } from "../features/admin-console/admin-view-routing.js";
import { accountPageState, resetAccountListView } from "../features/admin-console/admin-accounts-state.js";
import { guestSessionPageState, resetGuestSessionListView } from "../features/admin-console/admin-guest-sessions-state.js";

export function createMainUiActions({
  appState,
  profileActions,
  mountApp,
  pushAdminPath,
  getCurrentView,
}) {
  function openProfile(tab = "profile") {
    appState.profile.open = true;
    appState.profile.tab = normalizeProfileTab(tab);
    mountApp();
    void profileActions.loadProfile({ silent: true });
    if (appState.profile.tab === "orders") void profileActions.loadProfileOrders({ force: true });
  }

  function closeProfile() {
    appState.profile.open = false;
    mountApp();
  }

  function setProfileTab(tab) {
    const nextTab = normalizeProfileTab(tab);
    appState.profile.tab = nextTab;
    if (nextTab === "orders") void profileActions.loadProfileOrders({ force: true });
  }

  function mountProfileAware() {
    if (appState.profile.open && renderProfileOverlay(appState)) {
      return;
    }
    mountApp();
  }

  function mountAppPreservingMainScroll() {
    const main = document.querySelector(".main-scroll");
    const scrollTop = main?.scrollTop || 0;
    mountApp();
    const nextMain = document.querySelector(".main-scroll");
    if (nextMain) nextMain.scrollTop = scrollTop;
  }

  function setCategory(category) {
    appState.category = category;
    mountApp();
  }

  function setSearchQuery(query) {
    appState.search.query = String(query || "");
    if (getCurrentView() === "search") return;
    mountAppPreservingMainScroll();
  }

  function clearRecentSearches() {
    appState.search.recent = [];
    mountAppPreservingMainScroll();
  }

  function setAdminView(view) {
    if (appState.adminView === "accounts") {
      accountPageState.query = "";
      accountPageState.managementView = "accounts";
      guestSessionPageState.query = "";
      resetAccountListView();
      resetGuestSessionListView();
    }
    appState.adminView = resolveAdminViewFromSearch(`?view=${encodeURIComponent(view || "")}`);
    appState.adminAccountTargetId = "";
    appState.adminGuestTargetId = "";
    pushAdminPath();
    mountApp();
  }

  function openAdminAccount(accountId = "") {
    const targetId = String(accountId || "").trim().slice(0, 64);
    if (!targetId) return;
    appState.adminView = "accounts";
    appState.adminAccountTargetId = targetId;
    appState.adminGuestTargetId = "";
    pushAdminPath();
    mountApp();
  }

  function openAdminGuestSession(guestSessionId = "") {
    const targetId = String(guestSessionId || "").trim().slice(0, 64);
    if (!targetId) return;
    appState.adminView = "accounts";
    appState.adminAccountTargetId = "";
    appState.adminGuestTargetId = targetId;
    pushAdminPath();
    mountApp();
  }

  function consumeAdminTarget() {
    if (getCurrentView() !== "admin" || appState.adminView !== "accounts") return;
    if (!appState.adminAccountTargetId && !appState.adminGuestTargetId) return;
    appState.adminAccountTargetId = "";
    appState.adminGuestTargetId = "";
    pushAdminPath(true);
  }

  return {
    openProfile,
    closeProfile,
    setProfileTab,
    mountProfileAware,
    mountAppPreservingMainScroll,
    setCategory,
    setSearchQuery,
    clearRecentSearches,
    setAdminView,
    openAdminAccount,
    openAdminGuestSession,
    consumeAdminTarget,
  };
}

function renderProfileOverlay(appState) {
  const currentHost = document.querySelector(".profile-host");
  if (!currentHost) {
    return false;
  }

  return updateProfileModal(currentHost, {
    tab: appState.profile.tab,
    user: appState.session,
    profileState: appState.profile,
    pageLanguage: appState.site.pageLanguage || "English",
  });
}

function normalizeProfileTab(tab) {
  return tab === "invite" ? "invite" : tab === "orders" ? "orders" : tab === "billing" ? "billing" : "profile";
}
