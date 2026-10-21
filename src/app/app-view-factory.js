import { createAdminConsolePage } from "../features/admin-console/admin-console-page.js";
import { createAppShell } from "../features/app-shell/app-shell.js";
import { createCallModal } from "../features/call-modal/call-modal.js";
import { createCallProductOverlay } from "../features/call-modal/call-product-overlay.js";
import { createCharacterPage } from "../features/create-character/create-character-page.js";
import { createChatPage } from "../features/chat/chat-page.js";
import { consumeVoiceAutoplayIds } from "./chat-voice-autoplay-state.js";
import { createCreatorWorkspacePage } from "../features/creator-workspace/creator-workspace-page.js";
import { createDiscoverPage } from "../features/discover/discover-page.js";
import { createKitshopPage } from "../features/kitshop/kitshop-page.js";
import { createNotFoundPage } from "../features/not-found/not-found-page.js";
import { createProfileModal } from "../features/profile-modal/profile-modal.js";
import { createSearchPage } from "../features/search/search-page.js";
import { createForgotPasswordPage } from "../pages/auth/forgot-password-page.js";
import { createRegisterPage } from "../pages/auth/register-page.js";
import { createLoginPage } from "../pages/login/login-page.js";
import { canAccessView } from "./access-control.js";
import { resolveAppShellContacts } from "./guest-sidebar-state.js";

export function createCurrentView({ currentView, appState, actions }) {
  const pageLanguage = appState.site.pageLanguage || "English";
  if (!canAccessView(currentView, appState.session.accountType)) {
    return createAppShell({
      view: "not-found",
      agent: appState.agent,
      accountType: appState.session.accountType,
      user: appState.session,
      contacts: appState.chat.contacts,
      pageLanguage,
      onNavigate: actions.navigateApp,
      onOpenProfile: actions.openProfile,
      content: createNotFoundPage({ onNavigate: actions.navigateApp, pageLanguage }),
    });
  }

  if (currentView === "not-found") {
    return createAppShell({
      view: currentView,
      agent: appState.agent,
      accountType: appState.session.accountType,
      user: appState.session,
      contacts: appState.chat.contacts,
      pageLanguage,
      onNavigate: actions.navigateApp,
      onOpenProfile: actions.openProfile,
      content: createNotFoundPage({ onNavigate: actions.navigateApp, pageLanguage }),
    });
  }

  if (currentView === "creator") {
    return createCreatorWorkspacePage({
      user: appState.session,
      onBack: actions.navigateApp,
    });
  }

  if (currentView === "admin") {
    const adminPage = createAdminConsolePage({
      activeView: appState.adminView,
      user: appState.session,
      onAdminViewChange: actions.setAdminView,
      onOpenAccount: actions.openAdminAccount,
      onOpenGuestSession: actions.openAdminGuestSession,
      onTargetConsumed: actions.consumeAdminTarget,
      targetAccountId: appState.adminAccountTargetId,
      targetGuestSessionId: appState.adminGuestTargetId,
      onOpenProfile: actions.openProfile,
      onBack: actions.navigateApp,
    });
    appendOverlayContent(adminPage, appState, actions);
    return adminPage;
  }

  if (["discover", "kitshop", "search", "create", "chat"].includes(currentView)) {
    const shell = createAppShell({
      view: currentView,
      agent: appState.agent,
      accountType: appState.session.accountType,
      user: appState.session,
      guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
      contacts: resolveAppShellContacts(appState),
      pageLanguage,
      onNavigate: actions.navigateApp,
      onOpenProfile: actions.openProfile,
      content: createAppContent({ currentView, appState, actions }),
    });
    appendOverlayContent(shell, appState, actions);
    return shell;
  }

  if (currentView === "register") {
    return createRegisterPage({
      onNavigate: actions.navigate,
      onSubmit: actions.handleRegisterSubmit,
      onGoogleLogin: actions.handleGoogleLogin,
      onCheckEmail: actions.handleCheckRegisterEmail,
      onSendCode: actions.handleSendCode,
      pageLanguage,
    });
  }

  if (currentView === "forgot-password") {
    return createForgotPasswordPage({
      onNavigate: actions.navigate,
      onSubmit: actions.handleForgotPasswordSubmit,
      onSendCode: actions.handleSendCode,
      pageLanguage,
    });
  }

  return createLoginPage({
    onNavigate: actions.navigate,
    onSubmit: actions.handleLoginSubmit,
    onGoogleLogin: actions.handleGoogleLogin,
    siteBranding: appState.site.branding,
    pageLanguage,
  });
}

function createAppContent({ currentView, appState, actions }) {
  if (currentView === "create") {
    return createCharacterPage({
      createState: appState.create,
      user: appState.session,
      guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
      onNavigate: actions.navigate,
      onChange: actions.setCreateField,
      onAvatarSelected: actions.handleCreateAvatarSelected,
      onAvatarRemove: actions.handleCreateAvatarRemove,
      onAvatarGenerate: actions.handleGenerateCreateAvatar,
      onSubmit: actions.handleCreateCharacterSubmit,
      onPolish: actions.handlePolishBackstory,
      pageLanguage: appState.site.pageLanguage || "English",
    });
  }

  if (currentView === "search") {
    return createSearchPage({
      characters: appState.characters.items,
      query: appState.search.query,
      recent: appState.search.recent,
      siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop",
      pageLanguage: appState.site.pageLanguage || "English",
      guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
      guestMascotCharacterId: appState.chat.guest?.mascotCharacterId || "",
      onQueryChange: actions.setSearchQuery,
      onClearRecent: actions.clearRecentSearches,
      onCancel: actions.navigateApp,
      onNavigate: actions.navigateApp,
    });
  }

  if (currentView === "kitshop") {
    return createKitshopPage({
      siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop",
      pageLanguage: appState.site.pageLanguage || "English",
      guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
      onNavigate: actions.navigateApp,
    });
  }

  if (currentView === "chat") {
    return createChatPage({
      agent: appState.agent,
      character: appState.characters.current,
      messages: appState.chat.messages,
      quickReplies: appState.chat.quickRepliesByCharacterId[appState.agent] || [],
      pendingAttachments: appState.chat.pendingAttachmentsByCharacterId[appState.agent] || [],
      openProductPanel: appState.chat.openProductPanel,
      draftText: appState.chat.draftByCharacterId[appState.agent] || "",
      readyImageToast: appState.chat.readyImageToast,
      scrollRestore: appState.chat.scrollRestore,
      siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop",
      pageLanguage: appState.site.pageLanguage || "English",
      voiceAutoPlayMessageIds: consumeVoiceAutoplayIds(appState, appState.agent, appState.chat.messages),
      loading: appState.chat.loading,
      sending: Boolean(appState.chat.sendingByCharacterId[appState.agent]),
      error: appState.chat.error,
      guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
      guest: appState.chat.guest,
      imageQuota: appState.chat.imageQuota,
      onNavigate: actions.navigateApp,
      onOpenCall: actions.openCall,
      onOpenOrders: () => actions.openProfile("orders"),
      onSendMessage: actions.handleChatMessageSubmit,
      onDraftChange: actions.setChatDraft,
      onAttachFile: actions.handleChatAttachmentSubmit,
      onRemovePendingAttachment: actions.removePendingChatAttachment,
      onSendVoice: actions.handleChatVoiceSubmit,
      onProductPanelChange: actions.handleProductPanelChange,
      onChatImageToastConsumed: actions.consumeChatImageReadyToast,
      onChatScrollRestored: actions.consumeChatScrollRestore,
      onPendingChatImageRendered: (characterId) => actions.scheduleChatImageStatusPoll?.(characterId, { immediate: true }),
    });
  }

  return createDiscoverPage({
    pageLanguage: appState.site.pageLanguage || "English",
    activeCategory: appState.category,
    characters: appState.characters.items,
    categories: appState.characters.categories,
    carouselItems: appState.carousel.items,
    activatedCharacterIds: appState.chat.contacts.map((contact) => contact.characterId).filter(Boolean),
    loading: appState.characters.loading,
    error: appState.characters.error,
    guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
    guestMascotCharacterId: appState.chat.guest?.mascotCharacterId || "",
    onCategoryChange: actions.setCategory,
    onNavigate: actions.navigateApp,
    onActivate: actions.handleActivateCharacter,
  });
}

function appendOverlayContent(root, appState, actions) {
  if (appState.profile.open) {
    root.append(createProfileModal({
      tab: appState.profile.tab,
      onClose: actions.closeProfile,
      onTabChange: actions.setProfileTab,
      onNavigate: actions.navigateApp,
      onSave: actions.handleProfileSave,
      onLogout: actions.handleLogout,
      user: appState.session,
      profileState: appState.profile,
      pageLanguage: appState.site.pageLanguage || "English",
    }));
  }

  if (appState.call.open) {
    root.append(createCallModal({
      agent: appState.agent,
      character: appState.characters.current,
      seconds: appState.call.seconds,
      muted: appState.call.muted,
      paused: appState.call.paused,
      status: appState.call.status,
      turnStatus: appState.call.turnStatus,
      liveText: appState.call.liveText,
      liveSpeaker: appState.call.liveSpeaker,
      latencyText: appState.call.latencyText,
      error: appState.call.error,
      sessionId: appState.call.sessionId,
      hasCallProducts: Array.isArray(appState.call.products) && appState.call.products.length > 0,
      hasHiddenProducts: appState.call.hasHiddenProducts,
      pageLanguage: appState.site.pageLanguage || "English",
      onStartCall: actions.startCall,
      onClose: actions.closeCall,
      onTogglePause: actions.toggleCallPause,
      onShopClick: actions.handleCallShopClick,
    }));
    if (appState.call.productOverlayOpen && Array.isArray(appState.call.products) && appState.call.products.length) {
      root.append(createCallProductOverlay({
        products: appState.call.products,
        index: appState.call.productIndex,
        siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop",
        pageLanguage: appState.site.pageLanguage || "English",
        guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
        onRestrictedCheckout: actions.handleRestrictedCallCheckout,
        onClose: actions.closeCallProductOverlay,
        onIndexChange: actions.setCallProductIndex,
        onProductChange: actions.handleCallProductChange,
      }));
    }
  }
}
