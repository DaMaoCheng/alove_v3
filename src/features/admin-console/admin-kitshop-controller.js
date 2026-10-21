import { getAdminKitshop, refreshAdminKitshop } from "../../services/admin-kitshop-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";
import { adminKitshopHtml, adminKitshopPanelHtml, adminKitshopProductPanelHtml } from "./admin-kitshop-template.js";

const kitshopState = {
  sites: [],
  site: null,
  siteId: "",
  summary: {},
  products: [],
  productPagination: {
    page: 1,
    pages: 1,
    total: 0,
    limit: 12,
  },
  sections: [],
  rules: {},
  loading: true,
  productLoading: false,
  refreshing: false,
  error: "",
  refreshMessage: "",
};

export function bindAdminKitshop(shell) {
  const main = shell.querySelector("#adminMain") || shell;
  if (!main) return;

  const renderPage = () => {
    const topbar = main.querySelector(".admin-top");
    main.innerHTML = adminKitshopHtml(kitshopState);
    if (topbar) main.prepend(topbar);
    bindActions();
    bindPanelEvents();
    bindDropdowns(main);
  };

  const renderPanel = () => {
    const panel = main.querySelector("[data-admin-kitshop-panel]");
    if (!panel) {
      renderPage();
      return;
    }
    panel.innerHTML = adminKitshopPanelHtml(kitshopState);
    bindPanelEvents();
  };

  const renderProductPanel = ({ scrollTop = false } = {}) => {
    const panel = main.querySelector("[data-admin-kitshop-product-panel]");
    if (!panel) {
      renderPanel();
      return;
    }
    panel.innerHTML = adminKitshopProductPanelHtml(kitshopState);
    bindPanelEvents();
    if (scrollTop) {
      panel.querySelector(".kitshop-admin-products")?.scrollTo({ top: 0, left: 0 });
    }
  };

  const applyResult = (result = {}) => {
    Object.assign(kitshopState, {
      sites: result.sites || [],
      site: result.site || null,
      siteId: result.site?.id || kitshopState.siteId || result.sites?.[0]?.id || "",
      summary: result.summary || {},
      products: result.products || [],
      productPagination: result.productPagination || {},
      sections: result.sections || [],
      rules: result.rules || {},
      loading: false,
      productLoading: false,
      error: "",
    });
  };

  const applyProductResult = (result = {}) => {
    Object.assign(kitshopState, {
      products: result.products || [],
      productPagination: result.productPagination || {},
      productLoading: false,
      error: "",
    });
  };

  const load = async ({ initial = false } = {}) => {
    kitshopState.loading = true;
    kitshopState.error = "";
    if (initial) renderPage();
    else renderPanel();
    try {
      applyResult(await getAdminKitshop({
        site: kitshopState.siteId,
        productPage: kitshopState.productPagination.page,
        productLimit: kitshopState.productPagination.limit,
      }));
    } catch (error) {
      kitshopState.loading = false;
      kitshopState.error = error.message || "Kitshop 管理数据读取失败";
    }
    if (initial) renderPage();
    else renderPanel();
  };

  const loadProductPage = async (page = 1) => {
    if (kitshopState.productLoading) return;
    kitshopState.productLoading = true;
    kitshopState.productPagination.page = page;
    kitshopState.refreshMessage = "";
    renderProductPanel();
    try {
      applyProductResult(await getAdminKitshop({
        site: kitshopState.siteId,
        productPage: kitshopState.productPagination.page,
        productLimit: kitshopState.productPagination.limit,
      }));
      renderProductPanel({ scrollTop: true });
    } catch (error) {
      kitshopState.productLoading = false;
      kitshopState.error = error.message || "商品缓存读取失败";
      showToast(kitshopState.error);
      renderProductPanel();
    }
  };

  const refresh = async () => {
    if (!kitshopState.siteId || kitshopState.refreshing) return;
    kitshopState.refreshing = true;
    kitshopState.productPagination.page = 1;
    kitshopState.refreshMessage = "正在刷新当前站点商品缓存...";
    renderPanel();
    const refreshButton = main.querySelector("[data-admin-kitshop-refresh]");
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "刷新中...";
    }
    try {
      const result = await refreshAdminKitshop({ site: kitshopState.siteId });
      applyResult(result);
      const warning = result.refresh?.warning || result.refresh?.error || "";
      const refreshFailed = result.refresh?.ok === false || result.refresh?.refreshed !== true;
      const message = warning || (refreshFailed ? "未获取到新的公开商品，已保留现有缓存" : "当前站点商品缓存已刷新");
      kitshopState.refreshMessage = message;
      showToast(message);
    } catch (error) {
      kitshopState.error = error.message || "刷新 Kitshop 缓存失败";
      showToast(kitshopState.error);
    } finally {
      kitshopState.refreshing = false;
      renderPage();
    }
  };

  const bindActions = () => {
    main.querySelector('input[name="kitshopSite"]')?.addEventListener("change", (event) => {
      kitshopState.siteId = event.target.value || "";
      kitshopState.productPagination.page = 1;
      kitshopState.refreshMessage = "";
      load();
    });
    main.querySelector("[data-admin-kitshop-refresh]")?.addEventListener("click", refresh);
  };

  const bindPanelEvents = () => {
    main.querySelectorAll("[data-admin-kitshop-product-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        loadProductPage(Number(button.dataset.adminKitshopProductPage || 1));
      });
    });
  };

  load({ initial: true });
}
