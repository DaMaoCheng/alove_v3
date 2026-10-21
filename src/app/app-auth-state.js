export function resetProfileState(appState) {
  appState.profile.open = false;
  appState.profile.tab = "profile";
  appState.profile.data = null;
  appState.profile.loading = false;
  appState.profile.saving = false;
  appState.profile.error = "";
  appState.profile.saveMessage = "";
  appState.profile.orders = {
    data: null,
    loading: false,
    error: "",
    detail: null,
    detailLoading: false,
    detailError: "",
  };
}

export function resetGuestChatState(appState, { clearTimer = window.clearTimeout } = {}) {
  if (appState.chat.guest?.limitResetTimer) clearTimer(appState.chat.guest.limitResetTimer);
  appState.chat.guest = {
    ...appState.chat.guest,
    available: false,
    active: false,
    capability: null,
    siteSlug: "",
    mascotCharacterId: "",
    messageLimit: 0,
    messageCount: 0,
    messageWindowResetsAt: "",
    limitResetTimer: null,
  };
  appState.chat.session = null;
  appState.chat.messages = [];
  appState.chat.readyImageToast = null;
  appState.chat.guestPendingRequestByCharacterId = {};
}

export function resetAuthenticatedState(appState, { reason = "expired", clearTimer = window.clearTimeout } = {}) {
  if (reason === "logout") {
    resetProfileState(appState);
    appState.chat.contacts = [];
    appState.chat.unreadByCharacterId = {};
    appState.chat.voiceAutoplayByCharacterId = {};
    appState.chat.sendingByCharacterId = {};
    return;
  }
  if (appState.chat.guest?.limitResetTimer) clearTimer(appState.chat.guest.limitResetTimer);
  appState.characters.current = null;
  appState.chat.session = null;
  appState.chat.messages = [];
  appState.chat.contacts = [];
  appState.chat.unreadByCharacterId = {};
  appState.chat.voiceAutoplayByCharacterId = {};
  appState.chat.sendingByCharacterId = {};
  appState.chat.guestPendingRequestByCharacterId = {};
  appState.chat.draftByCharacterId = {};
  appState.chat.openProductPanel = null;
  appState.chat.readyImageToast = null;
  appState.chat.scrollRestore = null;
  appState.chat.loading = false;
  appState.chat.sending = false;
  appState.chat.error = "";
  resetProfileState(appState);
}
