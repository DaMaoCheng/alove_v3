import { listAdminAccounts, listAdminGuestSessions } from "../../services/admin-account-service.js";
import { listAdminSites } from "../../services/admin-site-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { adminAccountsHtml } from "./admin-console-accounts-template.js";
import { createAdminAccountsBulkActions } from "./admin-accounts-bulk-actions.js";
import { bindAdminAccountsListActions } from "./admin-accounts-list-actions.js";
import { accountPageState, pruneSelectionToCurrentItems } from "./admin-accounts-state.js";
import { createAdminGuestSessionsController } from "./admin-guest-sessions-controller.js";

export function bindAdminAccounts(shell, { targetAccountId = "", targetGuestSessionId = "", onTargetConsumed = null } = {}) {
  const main = shell.querySelector("#adminMain");
  if (!main) return;
  let requestedAccountId = String(targetAccountId || "").trim().slice(0, 64);
  let requestedGuestSessionId = String(targetGuestSessionId || "").trim().slice(0, 64);
  if (requestedAccountId) {
    Object.assign(accountPageState, {
      query: requestedAccountId,
      type: "all",
      site: "all",
      dateRange: "all",
      startDate: "",
      endDate: "",
      page: 1,
      openId: "",
    });
  }
  const topbar = main.querySelector(".admin-top");
  let guestController = null;
  if (requestedGuestSessionId) accountPageState.managementView = "guests";
  if (requestedAccountId) accountPageState.managementView = "accounts";
  let activeManagementView = accountPageState.managementView;
  let accountRequestSequence = 0;
  let guestTotalRequestSequence = 0;
  let accountSummaryRequestSequence = 0;

  const renderAccounts = ({ keepScroll = false, keepFocus = false } = {}) => {
    if (activeManagementView !== "accounts") return;
    const scroll = main.querySelector("[data-account-scroll]");
    const scrollTop = keepScroll ? scroll?.scrollTop || 0 : 0;
    main.innerHTML = adminAccountsHtml(accountPageState);
    if (topbar) main.prepend(topbar);

    const bulkActions = createAdminAccountsBulkActions({
      state: accountPageState,
      renderAccounts,
      reloadAccounts: loadAccounts,
      escapeHtml,
    });
    bindAdminAccountsListActions({
      main,
      state: accountPageState,
      renderAccounts,
      loadAccounts,
      bulkActions,
    });
    bindDropdowns(main);
    main.querySelector('[data-account-management-view="guests"]')?.addEventListener("click", () => {
      activeManagementView = "guests";
      accountPageState.managementView = "guests";
      accountRequestSequence += 1;
      guestController?.activate({
        accountTotal: Number(accountPageState.summary?.totalAccounts || 0),
        sites: accountPageState.sites,
        targetGuestSessionId: requestedGuestSessionId,
      });
    });

    const search = main.querySelector("[data-account-search]");
    if (keepFocus && search instanceof HTMLInputElement) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
    const nextScroll = main.querySelector("[data-account-scroll]");
    if (nextScroll) nextScroll.scrollTop = scrollTop;
  };

  const loadAccounts = async ({ keepScroll = false, keepFocus = false } = {}) => {
    if (activeManagementView !== "accounts") return;
    const requestId = ++accountRequestSequence;
    accountPageState.loading = true;
    accountPageState.error = "";
    renderAccounts({ keepScroll, keepFocus });
    try {
      const [result, sitesResult] = await Promise.all([
        listAdminAccounts(accountPageState),
        listAdminSites().catch(() => ({ items: accountPageState.sites })),
      ]);
      if (activeManagementView !== "accounts" || requestId !== accountRequestSequence || !main.isConnected) return;
      Object.assign(accountPageState, {
        items: result.items || [],
        sites: sitesResult.items || [],
        siteCounts: result.siteCounts || [],
        summary: result.summary || {},
        total: result.total || 0,
        pages: result.pages || 1,
        page: result.page || accountPageState.page,
        limit: result.limit || accountPageState.limit,
        loading: false,
        error: "",
      });
      if (requestedAccountId && result.items?.some((item) => item.id === requestedAccountId)) {
        accountPageState.openId = requestedAccountId;
      }
      pruneSelectionToCurrentItems(accountPageState);
      guestController?.setAccountTotal(Number(accountPageState.summary?.totalAccounts || 0));
      if (requestedAccountId) {
        requestedAccountId = "";
        onTargetConsumed?.();
      }
    } catch (error) {
      if (activeManagementView !== "accounts" || requestId !== accountRequestSequence || !main.isConnected) return;
      accountPageState.loading = false;
      accountPageState.error = error.message || "账号数据读取失败";
    }
    renderAccounts({ keepScroll, keepFocus });
    refreshGuestTotal();
  };

  const refreshGuestTotal = async () => {
    const requestId = ++guestTotalRequestSequence;
    try {
      const result = await listAdminGuestSessions({ ...accountPageState, page: 1, limit: 1 });
      if (requestId !== guestTotalRequestSequence || !main.isConnected) return;
      accountPageState.guestTotal = Number(result.summary?.totalGuestSessions ?? result.total ?? 0);
      accountPageState.guestSessionsWithUserMessages = Number(result.summary?.guestSessionsWithUserMessages ?? 0);
      if (activeManagementView === "accounts") {
        const conversationCount = main.querySelector("[data-account-guest-conversation-count]");
        const totalCount = main.querySelector("[data-account-guest-total-count]");
        if (conversationCount) conversationCount.textContent = accountPageState.guestSessionsWithUserMessages.toLocaleString("zh-CN");
        if (totalCount) totalCount.textContent = `/${accountPageState.guestTotal.toLocaleString("zh-CN")}`;
      }
    } catch (error) {
      console.warn("[aiove] guest account count failed", error);
    }
  };

  const refreshAccountSummary = async () => {
    const requestId = ++accountSummaryRequestSequence;
    try {
      const result = await listAdminAccounts({ ...accountPageState, page: 1, limit: 1 });
      if (requestId !== accountSummaryRequestSequence || !main.isConnected) return;
      accountPageState.summary = result.summary || accountPageState.summary;
      guestController?.setAccountTotal(Number(accountPageState.summary?.totalAccounts || 0));
    } catch (error) {
      console.warn("[aiove] account summary refresh failed", error);
    }
  };

  guestController = createAdminGuestSessionsController({
    main,
    topbar,
    dateState: accountPageState,
    onShowAccounts: () => {
      guestController?.deactivate();
      activeManagementView = "accounts";
      accountPageState.managementView = "accounts";
      loadAccounts();
    },
    onGuestLoaded: ({ total, summary }) => {
      if (requestedGuestSessionId) {
        requestedGuestSessionId = "";
        onTargetConsumed?.();
      }
      accountPageState.guestTotal = Number(summary?.totalGuestSessions ?? total ?? 0);
      accountPageState.guestSessionsWithUserMessages = Number(summary?.guestSessionsWithUserMessages ?? 0);
    },
    onDateFilterChanged: refreshAccountSummary,
  });

  if (activeManagementView === "guests") {
    guestController.activate({
      accountTotal: Number(accountPageState.summary?.totalAccounts || 0),
      sites: accountPageState.sites,
      targetGuestSessionId: requestedGuestSessionId,
    });
  } else {
    loadAccounts();
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}
