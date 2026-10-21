import { listAdminErrorLogs } from "../../services/admin-log-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { adminLogsHtml, adminLogsPanelHtml } from "./admin-console-logs-template.js";

const logPageState = {
  items: [],
  page: 1,
  pages: 1,
  total: 0,
  limit: 20,
  level: "all",
  source: "all",
  startDate: "",
  endDate: "",
  filters: {},
  loading: true,
  error: "",
};

export function bindAdminLogs(shell) {
  const main = shell.querySelector("#adminMain") || shell;
  if (!main) return;

  const renderPage = () => {
    const topbar = main.querySelector(".admin-top");
    main.innerHTML = adminLogsHtml(logPageState);
    if (topbar) main.prepend(topbar);
    bindFilterEvents();
    bindPanelEvents();
    bindDropdowns(main);
  };

  const renderPanel = () => {
    const panel = main.querySelector("[data-admin-log-panel]");
    if (!panel) {
      renderPage();
      return;
    }
    panel.innerHTML = adminLogsPanelHtml(logPageState);
    bindPanelEvents();
  };

  const loadLogs = async ({ scrollTop = false, initial = false } = {}) => {
    logPageState.loading = true;
    logPageState.error = "";
    logPageState.limit = 20;
    if (initial) renderPage();
    else renderPanel();
    try {
      const result = await listAdminErrorLogs({ ...logPageState, limit: 20 });
      const items = Array.isArray(result.items) ? result.items : [];
      const total = Math.max(Number(result.total || 0), items.length);
      const limit = 20;
      Object.assign(logPageState, {
        items,
        page: Number(result.page || logPageState.page || 1),
        pages: Number(result.pages || Math.max(1, Math.ceil(total / limit))),
        total,
        limit,
        filters: result.filters || logPageState.filters || {},
        loading: false,
        error: "",
      });
    } catch (error) {
      logPageState.loading = false;
      logPageState.error = error.message || "日志读取失败，请稍后再试";
    }
    renderPanel();
    if (scrollTop) main.querySelector("[data-admin-log-list]")?.scrollTo({ top: 0 });
  };

  const bindFilterEvents = () => {
    main.querySelector('input[name="logLevel"]')?.addEventListener("change", (event) => {
      logPageState.level = event.target.value || "all";
      logPageState.page = 1;
      loadLogs({ scrollTop: true });
    });
    main.querySelector('input[name="logSource"]')?.addEventListener("change", (event) => {
      logPageState.source = event.target.value || "all";
      logPageState.page = 1;
      loadLogs({ scrollTop: true });
    });
    main.querySelector("[data-log-start]")?.addEventListener("change", (event) => {
      logPageState.startDate = event.target.value || "";
      logPageState.page = 1;
      loadLogs({ scrollTop: true });
    });
    main.querySelector("[data-log-end]")?.addEventListener("change", (event) => {
      logPageState.endDate = event.target.value || "";
      logPageState.page = 1;
      loadLogs({ scrollTop: true });
    });
    main.querySelector("[data-log-reset]")?.addEventListener("click", () => {
      Object.assign(logPageState, {
        level: "all",
        source: "all",
        startDate: "",
        endDate: "",
        page: 1,
      });
      renderPage();
      loadLogs({ scrollTop: true });
    });
  };

  const bindPanelEvents = () => {
    main.querySelectorAll("[data-log-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        logPageState.page = Number(button.dataset.logPage || 1);
        loadLogs({ scrollTop: true });
      });
    });
  };

  loadLogs({ initial: true });
}
