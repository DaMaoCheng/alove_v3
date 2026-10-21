import { getAdminAccountConversation, listAdminAccountConversations } from "../../services/admin-account-service.js";
import { accountConversationModalHtml } from "./admin-console-accounts-template.js";

let accountConversationState = {
  account: null,
  query: "",
  view: "list",
  selectedConversation: null,
  conversations: [],
  loading: false,
  error: "",
  expandedCharacter: "",
  owner: "account",
};

let conversationLoaders = {
  list: listAdminAccountConversations,
  detail: getAdminAccountConversation,
};

let conversationSearchTimer = null;
let accountConversationRequestSequence = 0;

export function openAccountConversations(account) {
  openConversationModal({
    account,
    owner: "account",
    listConversations: listAdminAccountConversations,
    getConversation: getAdminAccountConversation,
  });
}

// Both account and guest-session pages use this exact controller/template. The
// caller only supplies its scoped data endpoints, so list/search/detail behavior
// cannot drift into a second bespoke guest modal.
export function openConversationModal({ account, owner = "account", listConversations, getConversation } = {}) {
  accountConversationRequestSequence += 1;
  conversationLoaders = {
    list: listConversations || listAdminAccountConversations,
    detail: getConversation || getAdminAccountConversation,
  };
  accountConversationState = {
    account,
    query: "",
    view: "list",
    selectedConversation: null,
    conversations: [],
    loading: true,
    error: "",
    expandedCharacter: "",
    owner,
  };
  renderAccountConversations();
  document.body.classList.add("account-convo-open");
  loadAccountConversations();
}

export function updateOpenAccountConversationAccount(account) {
  if (!account || accountConversationState.account?.id !== account.id) return;
  accountConversationState = { ...accountConversationState, account };
}

function renderAccountConversations() {
  const host = accountConversationHost();
  host.innerHTML = accountConversationModalHtml(accountConversationState);
  bindAccountConversationEvents(host);
}

async function loadAccountConversations() {
  const accountId = accountConversationState.account?.id;
  if (!accountId) return;
  const requestId = ++accountConversationRequestSequence;
  accountConversationState.loading = true;
  accountConversationState.error = "";
  renderAccountConversations();
  try {
    const result = await conversationLoaders.list(accountId, { query: accountConversationState.query });
    if (!isCurrentAccountConversation(requestId, accountId)) return;
    accountConversationState = { ...accountConversationState, conversations: result.items || [], loading: false, error: "" };
  } catch (error) {
    if (!isCurrentAccountConversation(requestId, accountId)) return;
    accountConversationState = { ...accountConversationState, conversations: [], loading: false, error: error.message || "对话读取失败" };
  }
  renderAccountConversations();
}

function bindAccountConversationEvents(host) {
  host.querySelectorAll("[data-account-convo-close]").forEach((element) => {
    element.addEventListener("click", closeAccountConversations);
  });
  host.querySelector("[data-convo-back]")?.addEventListener("click", () => {
    accountConversationState = { ...accountConversationState, view: "list", selectedConversation: null };
    renderAccountConversations();
  });
  host.querySelector("[data-convo-query]")?.addEventListener("input", (event) => {
    accountConversationState = {
      ...accountConversationState,
      query: event.target.value || "",
      expandedCharacter: "",
    };
    clearTimeout(conversationSearchTimer);
    conversationSearchTimer = setTimeout(loadAccountConversations, 300);
  });
  host.querySelectorAll("[data-convo-group]").forEach((row) => {
    row.addEventListener("click", () => {
      const name = row.dataset.convoGroup || "";
      accountConversationState = {
        ...accountConversationState,
        expandedCharacter: accountConversationState.expandedCharacter === name ? "" : name,
      };
      renderAccountConversations();
    });
  });
  host.querySelectorAll("[data-convo-open]").forEach((row) => {
    row.addEventListener("click", async () => {
      const accountId = accountConversationState.account?.id;
      const conversationId = row.dataset.convoOpen || "";
      if (!accountId || !conversationId) return;
      accountConversationState = { ...accountConversationState, view: "detail", selectedConversation: null, loading: true, error: "" };
      renderAccountConversations();
      const requestId = ++accountConversationRequestSequence;
      try {
        const result = await conversationLoaders.detail(accountId, conversationId);
        if (!isCurrentAccountConversation(requestId, accountId)) return;
        accountConversationState = { ...accountConversationState, view: "detail", selectedConversation: result.item, loading: false, error: "" };
      } catch (error) {
        if (!isCurrentAccountConversation(requestId, accountId)) return;
        accountConversationState = { ...accountConversationState, view: "list", selectedConversation: null, loading: false, error: error.message || "对话详情读取失败" };
      }
      renderAccountConversations();
    });
  });
}

function closeAccountConversations() {
  accountConversationRequestSequence += 1;
  clearTimeout(conversationSearchTimer);
  document.body.classList.remove("account-convo-open");
  const host = document.getElementById("accountConvoHost");
  if (host?.dataset.conversationOwner === accountConversationState.owner) host.remove();
}

function accountConversationHost() {
  let host = document.getElementById("accountConvoHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "accountConvoHost";
    host.className = "account-convo-host";
    document.body.appendChild(host);
  }
  host.dataset.conversationOwner = accountConversationState.owner || "account";
  host.dataset.accountId = accountConversationState.account?.id || "";
  return host;
}

function isCurrentAccountConversation(requestId, accountId) {
  const host = document.getElementById("accountConvoHost");
  return requestId === accountConversationRequestSequence
    && accountConversationState.account?.id === accountId
    && host?.dataset.conversationOwner === accountConversationState.owner
    && host?.dataset.accountId === accountId;
}
