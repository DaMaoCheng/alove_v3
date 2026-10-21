import { getAdminProductAnalyticsOverview } from "../../services/product-analytics-service.js";
import { adminOverviewHtml } from "./admin-console-overview-template.js";

const overviewState = {
  range: "7d",
  site: "all",
  summary: {},
  sourceBreakdown: [],
  products: [],
  sites: [],
  productQuery: "",
  productPage: 1,
  productPageSize: 10,
  productSortKey: "clicks",
  productSortDirection: "desc",
  loading: true,
  error: "",
};

export function bindAdminOverview(shell) {
  const main = shell.querySelector("#adminMain");
  if (!main) return;

  const render = ({ restoreProductSearchFocus = false, productSearchSelectionStart = null, productSearchSelectionEnd = null } = {}) => {
    const topbar = main.querySelector(".admin-top");
    main.innerHTML = adminOverviewHtml(overviewState);
    if (topbar) main.prepend(topbar);
    bindEvents();
    if (restoreProductSearchFocus) {
      restoreProductSearchInputFocus(main, {
        selectionStart: productSearchSelectionStart,
        selectionEnd: productSearchSelectionEnd,
      });
    }
  };

  const load = async () => {
    overviewState.loading = true;
    overviewState.error = "";
    render();
    try {
      const result = await getAdminProductAnalyticsOverview({
        range: overviewState.range,
        site: overviewState.site,
      });
      Object.assign(overviewState, {
        summary: result.summary || {},
        sourceBreakdown: result.sourceBreakdown || [],
        products: result.products || [],
        sites: result.sites || [],
        range: result.range || overviewState.range,
        site: result.site || overviewState.site,
        loading: false,
        error: "",
      });
    } catch (error) {
      overviewState.loading = false;
      overviewState.error = error.message || "商品统计读取失败";
    }
    render();
  };

  const bindEvents = () => {
    main.querySelectorAll("[data-analytics-range] [data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        overviewState.range = button.dataset.range || "7d";
        overviewState.productPage = 1;
        load();
      });
    });
    main.querySelector("[data-analytics-site]")?.addEventListener("change", (event) => {
      overviewState.site = event.target.value || "all";
      overviewState.productPage = 1;
      load();
    });
    main.querySelector("[data-product-rank-search]")?.addEventListener("input", (event) => {
      overviewState.productQuery = event.target.value || "";
      overviewState.productPage = 1;
      render({
        restoreProductSearchFocus: true,
        productSearchSelectionStart: event.target.selectionStart,
        productSearchSelectionEnd: event.target.selectionEnd,
      });
    });
    main.querySelectorAll("[data-product-rank-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        const sortKey = button.dataset.productRankSort || "clicks";
        if (overviewState.productSortKey === sortKey) {
          overviewState.productSortDirection = overviewState.productSortDirection === "asc" ? "desc" : "asc";
        } else {
          overviewState.productSortKey = sortKey;
          overviewState.productSortDirection = "desc";
        }
        overviewState.productPage = 1;
        render();
      });
    });
    main.querySelectorAll("[data-product-rank-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextPage = Number(button.dataset.productRankPage || 1);
        if (!Number.isFinite(nextPage) || nextPage < 1) return;
        overviewState.productPage = nextPage;
        render();
      });
    });
  };

  load();
}

function restoreProductSearchInputFocus(main, { selectionStart = null, selectionEnd = null } = {}) {
  const input = main.querySelector("[data-product-rank-search]");
  if (!input) return;
  input.focus();
  const start = Number.isInteger(selectionStart) ? selectionStart : input.value.length;
  const end = Number.isInteger(selectionEnd) ? selectionEnd : start;
  input.setSelectionRange(start, end);
}
