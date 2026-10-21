import { listAdminFeedback, markAdminFeedbackDone } from "../../services/admin-feedback-service.js";
import { listAdminSites } from "../../services/admin-site-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";
import { adminFeedbackHtml, adminFeedbackPanelHtml } from "./admin-feedback-template.js";

const feedbackPageState = {
  items: [],
  page: 1,
  pages: 1,
  total: 0,
  limit: 20,
  status: "all",
  query: "",
  site: "all",
  sites: [],
  expandedId: "",
  loading: true,
  error: "",
};

export function bindAdminFeedback(shell, { onOpenAccount, onOpenGuestSession } = {}) {
  const main = shell.querySelector("#adminMain") || shell;
  if (!main) return;

  const renderPage = () => {
    const topbar = main.querySelector(".admin-top");
    main.innerHTML = adminFeedbackHtml(feedbackPageState);
    if (topbar) main.prepend(topbar);
    bindFilterEvents();
    bindPanelEvents();
    bindDropdowns(main);
  };

  const renderPanel = () => {
    const panel = main.querySelector("[data-admin-feedback-panel]");
    if (!panel) {
      renderPage();
      return;
    }
    panel.innerHTML = adminFeedbackPanelHtml(feedbackPageState);
    bindPanelEvents();
  };

  const loadFeedback = async ({ scrollTop = false, initial = false } = {}) => {
    feedbackPageState.loading = true;
    feedbackPageState.error = "";
    feedbackPageState.limit = 20;
    if (initial) renderPage();
    else renderPanel();
    try {
      const [result, sitesResult] = await Promise.all([
        listAdminFeedback(feedbackPageState),
        listAdminSites().catch(() => ({ items: feedbackPageState.sites })),
      ]);
      const items = Array.isArray(result.items) ? result.items : [];
      Object.assign(feedbackPageState, {
        items,
        sites: Array.isArray(sitesResult.items) ? sitesResult.items : [],
        page: Number(result.page || feedbackPageState.page || 1),
        pages: Number(result.pages || 1),
        total: Number(result.total || 0),
        limit: Number(result.limit || 20),
        loading: false,
        error: "",
      });
      if (!items.some((item) => item.id === feedbackPageState.expandedId)) {
        feedbackPageState.expandedId = "";
      }
    } catch (error) {
      feedbackPageState.loading = false;
      feedbackPageState.error = error.message || "反馈列表读取失败，请稍后再试";
    }
    if (initial) renderPage();
    else renderPanel();
    if (scrollTop) main.querySelector("[data-admin-feedback-list]")?.scrollTo({ top: 0 });
  };

  const bindFilterEvents = () => {
    let feedbackSearchTimer = null;
    main.querySelector('input[name="feedbackSite"]')?.addEventListener("change", (event) => {
      feedbackPageState.site = event.target.value || "all";
      feedbackPageState.page = 1;
      feedbackPageState.expandedId = "";
      loadFeedback({ scrollTop: true });
    });
    main.querySelector("[data-feedback-search]")?.addEventListener("input", (event) => {
      feedbackPageState.query = event.target.value || "";
      feedbackPageState.page = 1;
      feedbackPageState.expandedId = "";
      clearTimeout(feedbackSearchTimer);
      feedbackSearchTimer = setTimeout(() => loadFeedback({ scrollTop: true }), 300);
    });
    main.querySelector("[data-feedback-reset]")?.addEventListener("click", () => {
      Object.assign(feedbackPageState, {
        status: "all",
        query: "",
        site: "all",
        page: 1,
        expandedId: "",
      });
      renderPage();
      loadFeedback({ scrollTop: true });
    });
  };

  const bindPanelEvents = () => {
    main.querySelectorAll("[data-feedback-done]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const feedbackId = button.dataset.feedbackDone || "";
        if (!feedbackId) return;
        button.textContent = "处理中...";
        button.classList.add("is-disabled");
        try {
          const result = await markAdminFeedbackDone(feedbackId);
          window.dispatchEvent(new CustomEvent("aiove:feedback-status-updated"));
          if (feedbackPageState.status === "new") {
            await loadFeedback({ scrollTop: false });
            showToast("反馈已处理");
            return;
          }
          feedbackPageState.items = feedbackPageState.items.map((item) => item.id === feedbackId ? (result.item || { ...item, status: "done" }) : item);
          showToast("反馈已处理");
          renderPanel();
        } catch (error) {
          button.textContent = "已处理";
          button.classList.remove("is-disabled");
          feedbackPageState.error = error.message || "反馈状态更新失败";
          renderPanel();
        }
      });
    });
    main.querySelectorAll("[data-feedback-account]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenAccount?.(button.dataset.feedbackAccount || "");
      });
    });
    main.querySelectorAll("[data-feedback-guest]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenGuestSession?.(button.dataset.feedbackGuest || "");
      });
    });
    main.querySelectorAll("[data-feedback-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        feedbackPageState.page = Number(button.dataset.feedbackPage || 1);
        loadFeedback({ scrollTop: true });
      });
    });
    main.querySelectorAll("[data-feedback-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const feedbackId = button.dataset.feedbackToggle || "";
        feedbackPageState.expandedId = feedbackPageState.expandedId === feedbackId ? "" : feedbackId;
        renderPanel();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        button.click();
      });
    });
  };

  loadFeedback({ initial: true });
}
