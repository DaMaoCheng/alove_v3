import { escapeAttr, escapeHtml, formatNumber, paginationButtonsHtml } from "./admin-console-utils.js";
import { ICONS } from "../../icons/icons.js";

const RANGE_ITEMS = [
  ["today", "今天"],
  ["7d", "7天"],
  ["30d", "30天"],
];

export function adminOverviewHtml(state = {}) {
  const viewState = {
    range: state.range || "7d",
    site: state.site || "all",
    summary: state.summary || {},
    sourceBreakdown: Array.isArray(state.sourceBreakdown) ? state.sourceBreakdown : [],
    products: Array.isArray(state.products) ? state.products : [],
    sites: Array.isArray(state.sites) ? state.sites : [],
    productQuery: state.productQuery || "",
    productPage: Math.max(1, Number(state.productPage || 1)),
    productPageSize: Math.max(1, Number(state.productPageSize || 10)),
    productSortKey: state.productSortKey || "clicks",
    productSortDirection: state.productSortDirection || "desc",
    loading: state.loading !== false,
    error: state.error || "",
  };

  return `
    <div class="admin-body admin-overview-page">
      <div class="admin-actions">
        <div class="seg" data-analytics-range>
          ${RANGE_ITEMS.map(([value, label]) => `<button class="${viewState.range === value ? "active" : ""}" type="button" data-range="${escapeAttr(value)}">${escapeHtml(label)}</button>`).join("")}
        </div>
        <label class="admin-select-field">
          <select class="admin-select" data-analytics-site aria-label="站点">
            <option value="all"${viewState.site === "all" ? " selected" : ""}>全部站点</option>
            ${viewState.sites.map((site) => `<option value="${escapeAttr(site.id || site.slug)}"${viewState.site === (site.id || site.slug) ? " selected" : ""}>${escapeHtml(site.name || site.slug || site.id)}</option>`).join("")}
          </select>
        </label>
      </div>
      ${viewState.error ? `<div class="panel"><div class="log-empty">${escapeHtml(viewState.error)}</div></div>` : productOverviewContentHtml(viewState)}
    </div>
  `;
}

export function productOverviewContentHtml(state = {}) {
  if (state.loading) {
    return `<div class="panel"><div class="log-empty">正在加载商品统计...</div></div>`;
  }
  return `
    <div class="panel product-funnel-panel">
      <div class="panel-head"><h3>商品漏斗</h3><span class="panel-tag">${rangeLabel(state.range)} · ${siteLabel(state)}</span></div>
      <div class="kpi-row product-kpi-row">
        ${kpiHtml("商品曝光", state.summary.impressions, "对话、搜索与 Kitshop")}
        ${kpiHtml("商品点击", state.summary.clicks, `点击率 ${formatPercent(state.summary.ctr)}`, { primary: true })}
        ${kpiHtml("详情打开", state.summary.detailOpens, `打开率 ${formatPercent(state.summary.detailOpenRate)}`)}
        ${kpiHtml("Buy now 跳转", state.summary.ctaClicks, `跳转率 ${formatPercent(state.summary.ctaClickRate)}`, { primary: true })}
      </div>
      <div class="product-source-row">
        ${sourceKpiHtml(state.sourceBreakdown, "chat", "对话商品")}
        ${sourceKpiHtml(state.sourceBreakdown, "search", "搜索结果")}
        ${sourceKpiHtml(state.sourceBreakdown, "kitshop", "Kitshop 货架")}
      </div>
    </div>
    <div class="panel admin-product-rank-panel">
      <div class="panel-head admin-product-rank-head">
        <h3>商品点击排行</h3>
        <div class="admin-panel-tools">
          <label class="admin-search admin-panel-search">
            ${ICONS.search}
            <input type="search" placeholder="搜索商品或站点" value="${escapeAttr(state.productQuery || "")}" data-product-rank-search />
          </label>
        </div>
      </div>
      ${productRankSectionHtml(state)}
    </div>
  `;
}

function productRankSectionHtml(state = {}) {
  const products = sortedProducts(filteredProducts(state.products, state.productQuery), state.productSortKey, state.productSortDirection);
  if (!products.length) {
    return `<div class="data-table admin-product-rank-table admin-product-rank-scroll">${productRankTableHtml([], state)}</div>`;
  }
  const pageInfo = productPaginationInfo(products.length, state.productPage, state.productPageSize);
  const pageItems = paginatedProducts(products, pageInfo.page, pageInfo.pageSize);
  return `
    <div class="data-table admin-product-rank-table admin-product-rank-scroll">
      ${productRankTableHtml(pageItems, state)}
    </div>
    ${productRankPagerHtml(pageInfo)}
  `;
}

function productRankTableHtml(products = [], state = {}) {
  const query = state.productQuery || "";
  if (!products.length) return `<div class="log-empty">${String(query || "").trim() ? "暂无匹配商品" : "暂无商品点击数据"}</div>`;
  return `
    <div class="dt-head">
      ${sortHeaderHtml("商品", "productTitle", state)}
      ${sortHeaderHtml("站点", "site", state)}
      ${sortHeaderHtml("来源", "source", state)}
      ${sortHeaderHtml("曝光", "impressions", state)}
      ${sortHeaderHtml("点击", "clicks", state)}
      ${sortHeaderHtml("CTR", "ctr", state)}
      ${sortHeaderHtml("详情", "detailOpens", state)}
      ${sortHeaderHtml("跳转", "ctaClicks", state)}
      ${sortHeaderHtml("跳转率", "ctaClickRate", state)}
    </div>
    ${products.map((product) => `
      <div class="dt-row">
        <span class="dt-cell name">${product.productUrl ? `<a class="site-name-link" href="${escapeAttr(product.productUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(product.productTitle || "Unknown product")}</a>` : escapeHtml(product.productTitle || "Unknown product")}</span>
        <span>${escapeHtml(product.siteSlug || product.siteId || "-")}</span>
        <span>${escapeHtml(sourceLabel(product.source))}</span>
        <span>${formatNumber(product.impressions)}</span>
        <span>${formatNumber(product.clicks)}</span>
        <span>${formatPercent(product.ctr)}</span>
        <span>${formatNumber(product.detailOpens)}</span>
        <span>${formatNumber(product.ctaClicks)}</span>
        <span>${formatPercent(product.ctaClickRate)}</span>
      </div>
    `).join("")}
  `;
}

function productRankPagerHtml({ page, pages, total, rangeFrom, rangeTo }) {
  return `
    <div class="dt-pager product-rank-pager">
      <span class="dt-pager-info">显示 ${formatNumber(rangeFrom)}-${formatNumber(rangeTo)}，共 ${formatNumber(total)} 条</span>
      <div class="dt-pager-btns">
        <button class="pg-btn" type="button" data-product-rank-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
        ${paginationButtonsHtml(page, pages, "data-product-rank-page")}
        <button class="pg-btn" type="button" data-product-rank-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button>
      </div>
    </div>
  `;
}

function sortHeaderHtml(label, key, state = {}) {
  const active = state.productSortKey === key;
  const direction = active ? state.productSortDirection || "desc" : "";
  const mark = active ? (direction === "asc" ? "↑" : "↓") : "";
  return `<button class="dt-sort${active ? " active" : ""}" type="button" data-product-rank-sort="${escapeAttr(key)}" aria-label="${escapeAttr(`${label}排序`)}">${escapeHtml(label)}${mark ? `<span>${mark}</span>` : ""}</button>`;
}

function filteredProducts(products = [], query = "") {
  const keyword = String(query || "").trim().toLowerCase();
  if (!keyword) return products;
  return products.filter((product) => [
    product.productTitle,
    product.productUrl,
    product.siteSlug,
    product.siteId,
  ].filter(Boolean).join(" ").toLowerCase().includes(keyword));
}

function sortedProducts(products = [], sortKey = "clicks", sortDirection = "desc") {
  const direction = sortDirection === "asc" ? 1 : -1;
  return [...products].sort((left, right) => compareProductRank(left, right, sortKey) * direction);
}

function paginatedProducts(products = [], page = 1, pageSize = 10) {
  const start = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  return products.slice(start, start + Math.max(1, pageSize));
}

function productPaginationInfo(total = 0, page = 1, pageSize = 10) {
  const safeTotal = Math.max(0, Number(total || 0));
  const safePageSize = Math.max(1, Number(pageSize || 10));
  const pages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page || 1)), pages);
  const rangeFrom = safeTotal ? (safePage - 1) * safePageSize + 1 : 0;
  const rangeTo = safeTotal ? Math.min(safeTotal, rangeFrom + safePageSize - 1) : 0;
  return { page: safePage, pages, pageSize: safePageSize, total: safeTotal, rangeFrom, rangeTo };
}

function compareProductRank(left = {}, right = {}, sortKey = "clicks") {
  if (sortKey === "productTitle") return compareText(left.productTitle, right.productTitle);
  if (sortKey === "site") return compareText(left.siteSlug || left.siteId, right.siteSlug || right.siteId);
  if (sortKey === "source") return compareText(sourceLabel(left.source), sourceLabel(right.source));
  return compareNumber(left[sortKey], right[sortKey]);
}

function compareText(left = "", right = "") {
  return String(left || "").localeCompare(String(right || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function compareNumber(left, right) {
  const leftValue = Number(left || 0);
  const rightValue = Number(right || 0);
  return leftValue - rightValue;
}

function kpiHtml(key, value, detail, options = {}) {
  const className = options.primary ? "kpi product-kpi-primary" : "kpi";
  const displayValue = options.percent ? formatPercent(value) : formatNumber(value);
  const detailHtml = detail ? `<div class="kpi-d">${escapeHtml(detail)}</div>` : "";
  return `<div class="${className}"><div class="kpi-k">${escapeHtml(key)}</div><div class="kpi-v">${displayValue}</div>${detailHtml}</div>`;
}

function sourceKpiHtml(sourceBreakdown = [], source = "", title = "") {
  const metrics = sourceBreakdown.find((item) => item?.source === source) || {};
  return `<div class="product-source-kpi">
    <div class="product-source-kpi-head"><span>${escapeHtml(title)}</span><b>${escapeHtml(sourceLabel(source))}</b></div>
    <div class="product-source-kpi-metrics">
      <span>曝光 <strong>${formatNumber(metrics.impressions)}</strong></span>
      <span>点击 <strong>${formatNumber(metrics.clicks)}</strong></span>
      <span>详情 <strong>${formatNumber(metrics.detailOpens)}</strong></span>
      <span>跳转 <strong>${formatNumber(metrics.ctaClicks)}</strong></span>
    </div>
    <div class="product-source-kpi-rates">点击率 ${formatPercent(metrics.ctr)} · 跳转率 ${formatPercent(metrics.ctaClickRate)}</div>
  </div>`;
}

function sourceLabel(value = "") {
  return ({ chat: "对话", search: "搜索", kitshop: "Kitshop" })[String(value || "").toLowerCase()] || "对话";
}

function formatPercent(value) {
  if (value == null) return "—";
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0%";
  return `${(numeric * 100).toFixed(numeric < 0.1 ? 1 : 0)}%`;
}

function rangeLabel(value = "") {
  return RANGE_ITEMS.find(([key]) => key === value)?.[1] || "7天";
}

function siteLabel(state = {}) {
  if (!state.site || state.site === "all") return "全部站点";
  const site = (state.sites || []).find((item) => state.site === item.id || state.site === item.slug);
  return site?.name || state.site;
}
