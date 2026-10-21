import { ICONS } from "../../icons/icons.js";
import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml, formatNumber } from "./admin-console-utils.js";

export function adminKitshopHtml(state = {}) {
  const safeState = normalizeState(state);
  return `
    <div class="admin-body admin-kitshop-page">
      <div class="admin-actions admin-kitshop-actions">
        ${siteDropdownHtml(safeState.siteId, safeState.sites)}
        <button class="btn btn-primary sm" type="button" data-admin-kitshop-refresh ${!safeState.site ? "disabled" : ""}>${ICONS.refresh} 刷新当前站点</button>
        <span class="hint">第一层跟随独立站首页首个有效栏目；Best Sellers 按近 30/60 天销量与其他首页商品混排，最多 15 件且不重复。</span>
      </div>
      <div data-admin-kitshop-panel>${adminKitshopPanelHtml(safeState)}</div>
    </div>
  `;
}

export function adminKitshopPanelHtml(state = {}) {
  const safeState = normalizeState(state);
  if (safeState.loading) return `<div class="panel"><div class="log-empty">正在加载 Kitshop 数据...</div></div>`;
  if (safeState.error) return `<div class="panel"><div class="log-empty">${escapeHtml(safeState.error)}</div></div>`;
  if (!safeState.site) return `<div class="panel"><div class="log-empty">暂无可用站点</div></div>`;

  return `
    ${safeState.refreshMessage ? `<div class="kitshop-admin-alert">${escapeHtml(safeState.refreshMessage)}</div>` : ""}
    <div class="kitshop-admin-grid">
      ${metricCard("缓存商品", safeState.summary.activeProducts, `${safeState.summary.inactiveProducts} 个已下架缓存`)}
      ${metricCard("首页栏目", safeState.summary.activeSections, `${safeState.summary.totalSections} 个识别记录`)}
      ${metricCard("商品同步", formatDateTime(safeState.summary.lastProductSyncedAt), "缓存最后更新时间")}
      ${metricCard("栏目同步", formatDateTime(safeState.summary.lastSectionSyncedAt), "首页栏目最后更新时间")}
    </div>
    <div class="panel kitshop-admin-rules">
      <div class="kitshop-admin-rule"><b>Recommended</b><span>${escapeHtml(safeState.rules.recommended || "-")}</span></div>
      <div class="kitshop-admin-rule"><b>Best Sellers</b><span>${escapeHtml(safeState.rules.bestSellers || "-")}</span></div>
      <div class="kitshop-admin-rule"><b>刷新规则</b><span>${escapeHtml(safeState.rules.refresh || "-")}</span></div>
    </div>
    <div class="panel kitshop-admin-panel">
      <div class="kitshop-admin-section-head"><h3>首页商品栏目识别</h3><span>${formatNumber(safeState.sections.length)} 条</span></div>
      <div class="kitshop-admin-section-list">
        ${safeState.sections.length ? safeState.sections.map(sectionRowHtml).join("") : `<div class="log-empty">暂无首页栏目识别结果</div>`}
      </div>
    </div>
    <div data-admin-kitshop-product-panel>${adminKitshopProductPanelHtml(safeState)}</div>
  `;
}

export function adminKitshopProductPanelHtml(state = {}) {
  const safeState = normalizeState(state);
  return `
    <div class="panel kitshop-admin-panel">
      <div class="kitshop-admin-section-head"><h3>商品缓存</h3><span>第 ${formatNumber(safeState.productPagination.page)} / ${formatNumber(safeState.productPagination.pages)} 页 · 共 ${formatNumber(safeState.productPagination.total)} 条</span></div>
      <div class="kitshop-admin-products">
        ${safeState.products.length ? productTableHtml(safeState.products) : `<div class="log-empty">暂无商品缓存</div>`}
      </div>
      ${productPagerHtml(safeState.productPagination, safeState.products.length, safeState.productLoading)}
    </div>
  `;
}

function siteDropdownHtml(value, sites = []) {
  return selectDropdownHtml({
    name: "kitshopSite",
    value,
    placeholder: "选择站点",
    items: normalizeSites(sites).map((site) => [site.id, `${site.name} /${site.slug}`]),
    className: "kitshop-admin-site-dd",
  });
}

function metricCard(label, value, detail) {
  return `
    <div class="kpi kitshop-admin-kpi">
      <div class="kpi-k">${escapeHtml(label)}</div>
      <div class="kpi-v">${escapeHtml(String(value ?? "-"))}</div>
      <div class="kpi-d">${escapeHtml(detail || "")}</div>
    </div>
  `;
}

function sectionRowHtml(section = {}) {
  const statusClass = section.status === "active" ? "on" : "off";
  const handles = [...(section.collectionHandles || []), ...(section.productHandles || [])].filter(Boolean).join(", ") || "-";
  return `
    <div class="kitshop-admin-section-row">
      <span><b>${escapeHtml(section.title || section.sectionKey || "未命名栏目")}</b><small>${escapeHtml(section.sectionKey || "-")}</small></span>
      <span>${escapeHtml(section.sectionType || "-")}</span>
      <span title="${escapeAttr(handles)}">${escapeHtml(handles)}</span>
      <span>${formatNumber(section.productCount || 0)} 个商品</span>
      <span>${formatNumber(section.sourceRank || 0)}</span>
      <span><i class="pill ${statusClass}">${escapeHtml(section.status || "active")}</i></span>
      <span>${escapeHtml(formatDateTime(section.lastSyncedAt))}</span>
    </div>
  `;
}

function productTableHtml(products = []) {
  return `
    <div class="kitshop-admin-product-head">
      <span>商品</span><span>价格</span><span>库存</span><span>排序</span><span>状态</span><span>同步时间</span><span></span>
    </div>
    ${products.map(productRowHtml).join("")}
  `;
}

function productPagerHtml(pagination = {}, itemCount = 0, loading = false) {
  const page = Math.max(1, Number(pagination.page || 1));
  const pages = Math.max(1, Number(pagination.pages || 1));
  const limit = Math.max(1, Number(pagination.limit || 12));
  const total = Math.max(Number(pagination.total || 0), Number(itemCount || 0));
  const rangeFrom = total && itemCount ? (page - 1) * limit + 1 : 0;
  const rangeTo = total && itemCount ? Math.min(total, rangeFrom + itemCount - 1) : 0;
  return `
    <div class="dt-pager kitshop-admin-product-pager">
      <span class="dt-pager-info">显示 ${formatNumber(rangeFrom)}-${formatNumber(rangeTo)}，共 ${formatNumber(total)} 条</span>
      <div class="dt-pager-btns">
        <button class="pg-btn" type="button" data-admin-kitshop-product-page="${page - 1}" ${page <= 1 || loading ? "disabled" : ""}>上一页</button>
        ${paginationButtonsHtml(page, pages, loading)}
        <button class="pg-btn" type="button" data-admin-kitshop-product-page="${page + 1}" ${page >= pages || loading ? "disabled" : ""}>下一页</button>
      </div>
    </div>
  `;
}

function paginationButtonsHtml(page, pages, loading = false) {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => pageButtonHtml(index + 1, page, loading)).join("");
  }
  const candidates = new Set([1, pages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pages));
  return Array.from(candidates).sort((left, right) => left - right).map((value, index, list) => {
    const gap = index > 0 && value - list[index - 1] > 1 ? `<span class="pg-ellipsis">...</span>` : "";
    return `${gap}${pageButtonHtml(value, page, loading)}`;
  }).join("");
}

function pageButtonHtml(value, page, loading = false) {
  return `<button class="pg-btn ${page === value ? "active" : ""}" type="button" data-admin-kitshop-product-page="${value}" ${loading ? "disabled" : ""}>${value}</button>`;
}

function productRowHtml(product = {}) {
  const imageUrl = normalizeAssetUrl(product.imageUrl || "/assets/jersey_product.png");
  const statusClass = product.status === "active" ? "on" : "off";
  const price = [product.priceNow, product.priceWas].filter(Boolean).join(" / ") || "-";
  const stock = product.available === false ? "不可售" : product.stock || (product.available === true ? "可售" : "-");
  return `
    <div class="kitshop-admin-product-row">
      <span class="kitshop-admin-product-title">
        <span class="kitshop-admin-thumb"><img src="${escapeAttr(imageUrl)}" alt="" loading="lazy" /></span>
        <span><b title="${escapeAttr(product.title)}">${escapeHtml(product.title || "未命名商品")}</b><small title="${escapeAttr(product.externalProductKey)}">${escapeHtml(product.externalProductKey || product.subtitle || "-")}</small></span>
      </span>
      <span title="${escapeAttr(price)}">${escapeHtml(price)}</span>
      <span>${escapeHtml(stock)}</span>
      <span>${formatNumber(product.sourceRank || 0)}</span>
      <span><i class="pill ${statusClass}">${escapeHtml(product.status || "active")}</i></span>
      <span>${escapeHtml(formatDateTime(product.lastSyncedAt))}</span>
      <span class="dt-act">${product.url ? `<a href="${escapeAttr(product.url)}" target="_blank" rel="noopener noreferrer">打开</a>` : ""}</span>
    </div>
  `;
}

function normalizeState(state = {}) {
  const sites = Array.isArray(state.sites) ? state.sites : [];
  const site = state.site || null;
  return {
    sites,
    site,
    siteId: String(state.siteId || site?.id || sites[0]?.id || ""),
    summary: {
      activeProducts: Number(state.summary?.activeProducts || 0),
      inactiveProducts: Number(state.summary?.inactiveProducts || 0),
      totalProducts: Number(state.summary?.totalProducts || 0),
      activeSections: Number(state.summary?.activeSections || 0),
      totalSections: Number(state.summary?.totalSections || 0),
      lastProductSyncedAt: state.summary?.lastProductSyncedAt || null,
      lastSectionSyncedAt: state.summary?.lastSectionSyncedAt || null,
    },
    products: Array.isArray(state.products) ? state.products : [],
    productPagination: {
      page: Number(state.productPagination?.page || 1),
      pages: Number(state.productPagination?.pages || 1),
      total: Number(state.productPagination?.total || state.products?.length || 0),
      limit: Number(state.productPagination?.limit || 12),
    },
    sections: Array.isArray(state.sections) ? state.sections : [],
    rules: state.rules || {},
    loading: Boolean(state.loading),
    error: state.error || "",
    refreshMessage: state.refreshMessage || "",
    productLoading: Boolean(state.productLoading),
  };
}

function normalizeSites(sites = []) {
  return (Array.isArray(sites) ? sites : [])
    .map((site) => ({
      id: String(site?.id || "").trim(),
      name: String(site?.name || site?.id || "").trim(),
      slug: String(site?.slug || "").trim(),
    }))
    .filter((site) => site.id && site.name);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const day = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replaceAll("/", "-");
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
}
