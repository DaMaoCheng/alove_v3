import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";
import { adminDateTimeFieldHtml } from "./admin-datetime-field.js";

export function adminPromotionCampaignsHtml() {
  return `
    <div class="admin-body admin-promotion-campaigns-page">
      <div class="admin-actions admin-promotion-toolbar">
        <div class="admin-promotion-filters">
          <input type="search" placeholder="搜索活动或商品" data-promotion-campaign-query />
          <div data-promotion-campaign-site-filter></div>
          <div data-promotion-campaign-status-filter></div>
        </div>
        <button class="btn btn-primary sm" type="button" data-promotion-campaign-new>${ICONS.plus} 新增活动</button>
      </div>
      <div class="panel">
        <div class="data-table admin-promotion-campaigns-table" data-promotion-campaign-list>
          <div class="log-empty">正在加载活动...</div>
        </div>
      </div>
    </div>
  `;
}

export function adminPromotionCampaignFiltersHtml({ sites = [], site = "", status = "" } = {}) {
  return {
    site: selectDropdownHtml({
      name: "promotionCampaignSite",
      value: site,
      placeholder: "全部站点",
      items: [["", "全部站点"], ...sites.map((item) => [item.id, `${item.name} /${item.slug}`])],
      className: "agent-dd",
    }),
    status: selectDropdownHtml({
      name: "promotionCampaignStatus",
      value: status,
      placeholder: "全部状态",
      items: [
        ["", "全部状态"],
        ["active", "进行中"],
        ["draft", "草稿"],
        ["paused", "暂停"],
        ["archived", "归档"],
      ],
      className: "agent-dd",
    }),
  };
}

export function adminPromotionCampaignListHtml(items = []) {
  if (!items.length) return `<div class="log-empty">暂无活动</div>`;
  return `
    <div class="dt-head"><span>活动</span><span>站点</span><span>角色范围</span><span>商品</span><span>统计</span><span>时间</span><span>状态</span><span></span></div>
    ${items.map((item) => rowHtml(item)).join("")}
  `;
}

export function adminPromotionCampaignEditorModalHtml(item, { sites = [] } = {}) {
  const isNew = !item?.id;
  return `
    <div class="dialog-scrim" data-promotion-campaign-close></div>
    <div class="dlg common-character-modal promotion-campaign-editor-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-promotion-campaign-close>${ICONS.close}</button>
      <div class="dlg-body"><h3>${isNew ? "新增广告活动" : "编辑广告活动"}</h3><p>${isNew ? "设置活动时间、角色范围和主动发送文案" : escapeHtml(item.title || "未命名活动")}</p></div>
      ${adminPromotionCampaignEditorHtml(item, { sites })}
    </div>
  `;
}

export function adminPromotionCampaignEditorHtml(item, { sites = [] } = {}) {
  const data = item || createEmptyCampaign();
  return `
    <form class="agent-form" data-promotion-campaign-form>
      <div class="agent-form-grid">
        ${fieldHtml("活动标题", `<input name="title" maxlength="128" value="${escapeAttr(data.title || "")}" required />`)}
        ${fieldHtml("站点", siteSelectHtml(data.siteId || "", sites))}
      </div>
      <div class="agent-form-grid">
        ${fieldHtml("角色范围", selectHtml("roleTarget", data.roleTarget || "all", [["all", "全部"], ["mascot", "前台"], ["creator", "网红"]]))}
        ${fieldHtml("状态", selectHtml("status", data.status || "draft", [["draft", "草稿"], ["active", "进行中"], ["paused", "暂停"], ["archived", "归档"]]))}
      </div>
      <div class="agent-form-grid">
        ${productPickerHtml(data)}
        ${fieldHtml("折扣码", `<input name="discountCode" maxlength="64" value="${escapeAttr(data.discountCode || "")}" placeholder="例如 MILAN10" />`)}
      </div>
      <div class="agent-form-grid">
        ${fieldHtml("关键词", `<input name="keywords" maxlength="255" value="${escapeAttr((data.keywords || []).join(", "))}" placeholder="ac, milan, shirt" />`)}
        ${fieldHtml("优先级", `<input name="priority" type="number" min="1" max="9999" value="${escapeAttr(data.priority || 100)}" />`)}
      </div>
      <div class="agent-form-grid">
        ${fieldHtml("开始时间", adminDateTimeFieldHtml("startsAt", data.startsAt, "开始时间"))}
        ${fieldHtml("结束时间", adminDateTimeFieldHtml("endsAt", data.endsAt, "结束时间"))}
      </div>
      ${fieldHtml("主动文案", `<textarea name="messageText" rows="4" maxlength="1000" required>${escapeHtml(data.messageText || "")}</textarea>`)}
      <div class="agent-form-actions">
        <button class="btn btn-primary sm" type="submit" data-promotion-campaign-save>保存活动</button>
        <button class="btn btn-ghost sm" type="button" data-promotion-campaign-close>取消</button>
        <span class="hint" data-promotion-campaign-save-tip>${escapeHtml(data.id ? data.id : "保存后才会开始参与主动消息匹配")}</span>
      </div>
    </form>
  `;
}

function rowHtml(item) {
  return `
    <div class="dt-row" data-promotion-campaign-id="${escapeAttr(item.id)}">
      <span class="dt-cell name"><b>${escapeHtml(item.title || "未命名活动")}</b><small>${escapeHtml(item.messageText || "")}</small></span>
      <span><b>${escapeHtml(item.siteName || item.siteId || "-")}</b><small>${escapeHtml(item.siteSlug ? `/${item.siteSlug}` : "")}</small></span>
      <span>${escapeHtml(roleLabel(item.roleTarget))}</span>
      <span><b>${escapeHtml(item.productTitle || "-")}</b><small>${escapeHtml([item.productId, item.discountCode].filter(Boolean).join(" / ") || item.productUrl || "")}</small></span>
      <span class="promotion-campaign-stats">${statsHtml(item.stats)}</span>
      <span>${escapeHtml(timeLabel(item))}</span>
      <span><i class="pill ${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</i></span>
      <span class="dt-act"><a data-promotion-campaign-edit="${escapeAttr(item.id)}">编辑</a></span>
    </div>
  `;
}

function statsHtml(stats = {}) {
  return `
    <b>${formatPercent(stats.ctr)} 点击率 / ${formatPercent(stats.ctaClickRate)} 跳转率</b>
    <small>发送 ${formatNumber(stats.sentCount)} / 曝光 ${formatNumber(stats.bubbleImpressions)} / 点击 ${formatNumber(stats.bubbleClicks)}</small>
    <small>打开 ${formatNumber(stats.detailOpens)} / 跳转 ${formatNumber(stats.ctaClicks)}</small>
  `;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? String(number) : "0";
}

function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0%";
  return `${Math.round(number * 1000) / 10}%`;
}

function fieldHtml(label, controlHtml) {
  return `<label class="agent-field"><span>${escapeHtml(label)}</span>${controlHtml}</label>`;
}

function productPickerHtml(data = {}) {
  return `
    <label class="agent-field promotion-product-picker"><span>商品</span>
      <input type="search" data-promotion-product-query value="${escapeAttr(data.productTitle || "")}" placeholder="输入商品名称或 SKU" autocomplete="off" />
      <input type="hidden" name="productId" value="${escapeAttr(data.productId || "")}" data-promotion-product-id />
      <input type="hidden" name="productTitle" value="${escapeAttr(data.productTitle || "")}" data-promotion-product-title />
      <input type="hidden" name="productUrl" value="${escapeAttr(data.productUrl || "")}" data-promotion-product-url />
      <input type="hidden" name="productSnapshot" value="${escapeAttr(JSON.stringify(data.productSnapshot || null))}" data-promotion-product-snapshot />
      <div class="promotion-product-selected" data-promotion-product-selected ${data.productTitle ? "" : "hidden"}>${escapeHtml(data.productTitle || "")}</div>
      <div class="promotion-product-results" data-promotion-product-results hidden></div>
    </label>
  `;
}

export function adminPromotionProductResultsHtml(items = []) {
  if (!items.length) return `<div class="promotion-product-empty">没有找到商品</div>`;
  return items.map((item) => `
    <div class="promotion-product-option" data-promotion-product-option="${escapeAttr(JSON.stringify(item))}">
      <img src="${escapeAttr(item.imageUrl || "/assets/jersey_product.png")}" alt="" />
      <span><b>${escapeHtml(item.name || "未命名商品")}</b><small>${escapeHtml([item.sku || item.id, item.price].filter(Boolean).join(" / "))}</small></span>
      ${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer" data-promotion-product-link>打开</a>` : ""}
    </div>
  `).join("");
}

function siteSelectHtml(value, sites = []) {
  return selectDropdownHtml({
    name: "siteId",
    value,
    items: sites.map((site) => [site.id, `${site.name} /${site.slug}`]),
    className: "agent-dd",
  });
}

function selectHtml(name, value, items) {
  return selectDropdownHtml({ name, value, items, className: "agent-dd" });
}

function createEmptyCampaign() {
  return {
    title: "",
    siteId: "",
    roleTarget: "all",
    productId: "",
    productTitle: "",
    productUrl: "",
    productSnapshot: null,
    discountCode: "",
    messageText: "",
    keywords: [],
    priority: 100,
    status: "draft",
    startsAt: "",
    endsAt: "",
  };
}

function statusLabel(status) {
  if (status === "active") return "进行中";
  if (status === "paused") return "暂停";
  if (status === "archived") return "归档";
  return "草稿";
}

function statusClass(status) {
  if (status === "active") return "on";
  if (status === "draft") return "mid";
  return "off";
}

function roleLabel(roleTarget) {
  if (roleTarget === "mascot") return "前台";
  if (roleTarget === "creator") return "网红";
  return "全部";
}

function timeLabel(item) {
  const start = shortTime(item.startsAt);
  const end = shortTime(item.endsAt);
  if (!start && !end) return "不限时间";
  return `${start || "立即"} - ${end || "长期"}`;
}

function shortTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
