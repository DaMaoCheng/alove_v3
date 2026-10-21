import { listAdminGuestSessions } from "../../services/admin-account-service.js";
import { listAdminSites } from "../../services/admin-site-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { openGuestSessionConversation } from "./admin-guest-session-conversation.js";
import { adminGuestSessionsHtml } from "./admin-guest-sessions-template.js";
import { guestSessionPageState, resetGuestSessionListView } from "./admin-guest-sessions-state.js";
import { bindAdminDateRangeFilter } from "./admin-date-range-filter.js";

export function createAdminGuestSessionsController({ main, topbar, dateState = guestSessionPageState, onShowAccounts, onGuestLoaded, onDateFilterChanged } = {}) {
  let active = false;
  let requestSequence = 0;
  let searchTimer = null;
  let requestedGuestSessionId = "";

  const sharedDateState = () => ({
    dateRange: dateState?.dateRange || "all",
    startDate: dateState?.startDate || "",
    endDate: dateState?.endDate || "",
    datePickerOpen: Boolean(dateState?.datePickerOpen),
  });

  const renderGuestSessions = ({ keepScroll = false, keepFocus = false } = {}) => {
    if (!active || !main?.isConnected) return;
    const scroll = main.querySelector("[data-guest-session-scroll]");
    const scrollTop = keepScroll ? scroll?.scrollTop || 0 : 0;
    main.innerHTML = adminGuestSessionsHtml({ ...guestSessionPageState, ...sharedDateState() });
    if (topbar) main.prepend(topbar);
    bindEvents();
    bindDropdowns(main);
    const search = main.querySelector("[data-guest-session-search]");
    if (keepFocus && search instanceof HTMLInputElement) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
    const nextScroll = main.querySelector("[data-guest-session-scroll]");
    if (nextScroll) nextScroll.scrollTop = scrollTop;
  };

  const loadGuestSessions = async ({ keepScroll = false, keepFocus = false } = {}) => {
    if (!active || !main?.isConnected) {
      active = false;
      requestSequence += 1;
      clearTimeout(searchTimer);
      return;
    }
    const requestId = ++requestSequence;
    guestSessionPageState.loading = true;
    guestSessionPageState.error = "";
    renderGuestSessions({ keepScroll, keepFocus });
    try {
      const [result, sitesResult] = await Promise.all([
        listAdminGuestSessions({ ...guestSessionPageState, ...sharedDateState() }),
        guestSessionPageState.sites.length
          ? Promise.resolve({ items: guestSessionPageState.sites })
          : listAdminSites().catch(() => ({ items: guestSessionPageState.sites })),
      ]);
      if (!active || requestId !== requestSequence || !main.isConnected) return;
      Object.assign(guestSessionPageState, {
        items: result.items || [],
        sites: sitesResult.items || [],
        siteCounts: result.siteCounts || [],
        summary: result.summary || {},
        total: result.total || 0,
        pages: result.pages || 1,
        page: result.page || guestSessionPageState.page,
        limit: result.limit || guestSessionPageState.limit,
        loading: false,
        error: "",
      });
      if (requestedGuestSessionId && result.items?.some((item) => item.id === requestedGuestSessionId)) {
        guestSessionPageState.openId = requestedGuestSessionId;
      }
      requestedGuestSessionId = "";
      onGuestLoaded?.({ total: guestSessionPageState.total, summary: guestSessionPageState.summary });
      onDateFilterChanged?.();
    } catch (error) {
      if (!active || requestId !== requestSequence || !main.isConnected) return;
      guestSessionPageState.loading = false;
      guestSessionPageState.error = error.message || "游客会话读取失败";
    }
    renderGuestSessions({ keepScroll, keepFocus });
  };

  const bindEvents = () => {
    main.querySelector('[data-account-management-view="accounts"]')?.addEventListener("click", onShowAccounts);
    main.querySelectorAll("[data-guest-session-toggle]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target?.closest?.("[data-guest-session-conversation]")) return;
        const id = row.dataset.guestSessionToggle || "";
        guestSessionPageState.openId = guestSessionPageState.openId === id ? "" : id;
        renderGuestSessions({ keepScroll: true });
      });
    });
    main.querySelectorAll("[data-guest-session-conversation]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const guest = guestSessionPageState.items.find((item) => item.id === button.dataset.guestSessionConversation);
        if (guest) openGuestSessionConversation(guest);
      });
    });
    main.querySelectorAll("[data-guest-session-status]").forEach((button) => {
      button.addEventListener("click", () => {
        guestSessionPageState.status = button.dataset.guestSessionStatus || "all";
        resetGuestSessionListView(guestSessionPageState);
        loadGuestSessions();
      });
    });
    main.querySelector('input[name="guestSessionSite"]')?.addEventListener("change", (event) => {
      guestSessionPageState.site = event.target.value || "all";
      resetGuestSessionListView(guestSessionPageState);
      loadGuestSessions();
    });
    bindAdminDateRangeFilter(main, {
      state: dateState,
      onPreset: () => {
        resetGuestSessionListView(guestSessionPageState);
        loadGuestSessions();
      },
      onOpenCustom: () => renderGuestSessions({ keepScroll: true }),
      onCancelCustom: () => renderGuestSessions({ keepScroll: true }),
      onApplyCustom: () => {
        resetGuestSessionListView(guestSessionPageState);
        loadGuestSessions();
      },
    });
    main.querySelectorAll("[data-guest-session-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        guestSessionPageState.page = Number(button.dataset.guestSessionPage || 1);
        guestSessionPageState.openId = "";
        loadGuestSessions();
      });
    });
    main.querySelector("[data-guest-session-search]")?.addEventListener("input", (event) => {
      requestSequence += 1;
      guestSessionPageState.query = event.target.value || "";
      resetGuestSessionListView(guestSessionPageState);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadGuestSessions({ keepFocus: true }), 300);
    });
  };

  return {
    activate({ accountTotal = 0, sites = [], targetGuestSessionId = "" } = {}) {
      active = true;
      requestedGuestSessionId = String(targetGuestSessionId || "").trim().slice(0, 64);
      if (requestedGuestSessionId) {
        guestSessionPageState.query = requestedGuestSessionId;
        guestSessionPageState.page = 1;
        guestSessionPageState.openId = "";
      }
      guestSessionPageState.accountTotal = Number(accountTotal || 0);
      if (Array.isArray(sites) && sites.length) guestSessionPageState.sites = sites;
      // Page construction binds controllers before mountApp attaches the shell.
      // Defer activation until that synchronous mount completes; retain the
      // connection guard in loadGuestSessions for pages already disposed.
      queueMicrotask(() => loadGuestSessions());
    },
    deactivate() {
      active = false;
      requestSequence += 1;
      clearTimeout(searchTimer);
    },
    setAccountTotal(accountTotal) {
      guestSessionPageState.accountTotal = Number(accountTotal || 0);
      if (active) renderGuestSessions({ keepScroll: true });
    },
  };
}
