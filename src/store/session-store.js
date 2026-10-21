const STORAGE_KEY = "aiove_session";

export function createSessionStore() {
  let state = readSessionState();

  function setSession(nextSession) {
    const nextUserId = nextSession?.userId || nextSession?.internalUserId || nextSession?.user?.id || "";
    const isSameUser = !nextUserId || !state.userId || String(nextUserId) === String(state.userId);
    state = {
      ...state,
      authenticated: true,
      userId: nextUserId || (isSameUser ? state.userId : ""),
      accountType: normalizeAccountType(nextSession?.accountType || nextSession?.user?.accountType || (isSameUser ? state.accountType : "personal")),
      email: nextSession?.email || nextSession?.user?.email || (isSameUser ? state.email : ""),
      nickname: nextSession?.nickname || nextSession?.user?.nickname || (isSameUser ? state.nickname : ""),
      avatarUrl: nextSession?.avatarUrl || nextSession?.user?.avatarUrl || (isSameUser ? state.avatarUrl : ""),
      siteId: nextSession?.siteId || nextSession?.user?.siteId || (isSameUser ? state.siteId : ""),
      siteSlug: nextSession?.siteSlug || nextSession?.user?.siteSlug || (isSameUser ? state.siteSlug : ""),
      siteName: nextSession?.siteName || nextSession?.user?.siteName || (isSameUser ? state.siteName : ""),
    };
    persistSessionState(state);
    return getState();
  }

  function setBalance(balance) {
    state = {
      ...state,
      balance: Number.isFinite(Number(balance)) ? Number(balance) : state.balance,
    };
    persistSessionState(state);
    return getState();
  }

  function clearSession() {
    state = createEmptySessionState();
    window.localStorage?.removeItem(STORAGE_KEY);
    return getState();
  }

  function getState() {
    return { ...state };
  }

  return {
    getState,
    setSession,
    setBalance,
    clearSession,
  };
}

function readSessionState() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return createEmptySessionState();
    return normalizeSessionState(JSON.parse(raw));
  } catch {
    return createEmptySessionState();
  }
}

function persistSessionState(state) {
  window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createEmptySessionState() {
  return {
    authenticated: false,
    userId: "",
    balance: 0,
    accountType: "personal",
    email: "",
    nickname: "",
    avatarUrl: "",
    siteId: "",
    siteSlug: "",
    siteName: "",
  };
}

function normalizeSessionState(raw = {}) {
  return {
    authenticated: raw?.authenticated === true,
    userId: String(raw?.userId || "").trim(),
    balance: Number.isFinite(Number(raw?.balance)) ? Number(raw.balance) : 0,
    accountType: normalizeAccountType(raw?.accountType),
    email: String(raw?.email || "").trim(),
    nickname: String(raw?.nickname || "").trim(),
    avatarUrl: String(raw?.avatarUrl || "").trim(),
    siteId: String(raw?.siteId || "").trim(),
    siteSlug: String(raw?.siteSlug || "").trim(),
    siteName: String(raw?.siteName || "").trim(),
  };
}

function normalizeAccountType(value = "personal") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["personal", "creator", "admin"].includes(normalized) ? normalized : "personal";
}
