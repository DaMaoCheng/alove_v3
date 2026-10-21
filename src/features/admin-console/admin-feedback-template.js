import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { accountSiteLabel } from "./admin-account-sites.js";
import { escapeAttr, escapeHtml, formatNumber, paginationButtonsHtml } from "./admin-console-utils.js";

export function adminFeedbackHtml(state = {}) {
  const safeState = normalizeFeedbackState(state);
  return `
    <div class="admin-body feedback-page">
      <div class="admin-actions feedback-actions-bar">
        <div class="admin-search feedback-search">${ICONS.search}<input type="search" data-feedback-search placeholder="搜索账号 / 名称 / 主题 / 内容..." value="${escapeAttr(safeState.query)}" /></div>
        ${feedbackSiteDropdownHtml(safeState.site, safeState.sites)}
        <button class="btn btn-ghost sm" type="button" data-feedback-reset>重置</button>
      </div>
      <div class="panel feedback-panel" data-admin-feedback-panel>${adminFeedbackPanelHtml(safeState)}</div>
    </div>
  `;
}

export function adminFeedbackPanelHtml(state = {}) {
  const safeState = normalizeFeedbackState(state);
  return `
    <div class="feedback-list" data-admin-feedback-list>
      ${safeState.loading ? feedbackLoadingHtml() : safeState.error ? feedbackErrorHtml(safeState.error) : feedbackRowsHtml(safeState)}
    </div>
    ${feedbackPagerHtml(safeState)}
  `;
}

function feedbackRowsHtml(state) {
  if (!state.items.length) {
    return `<div class="feedback-empty">暂无用户反馈</div>`;
  }

  return `
    <div class="feedback-head">
      <span class="feedback-t">时间</span>
      <span class="feedback-status-head">状态</span>
      <span class="feedback-account">账号</span>
      <span class="feedback-name">名称</span>
      <span class="feedback-site-head">站点</span>
      <span class="feedback-subject">主题</span>
      <span class="feedback-content">内容</span>
      <span></span>
    </div>
    ${state.items.map((item) => feedbackRowHtml(item, state.expandedId === item.id)).join("")}
  `;
}

function feedbackRowHtml(item, expanded) {
  const time = formatTimeParts(item.createdAt);
  const site = accountSiteLabel(item);
  const account = feedbackAccountLabel(item);
  const userName = item.userName || "-";
  const content = item.content || "-";
  const showDoneAction = String(item.status || "").trim().toLowerCase() !== "done";
  return `
    <div class="feedback-row ${expanded ? "is-expanded" : ""}" role="button" tabindex="0" data-feedback-toggle="${escapeAttr(item.id)}" aria-expanded="${expanded ? "true" : "false"}">
      <span class="feedback-t"><b>${escapeHtml(time.time)}</b><small>${escapeHtml(time.date)}</small></span>
      <span class="feedback-status-cell"><i class="pill ${escapeAttr(statusClass(item.status))}">${escapeHtml(statusLabel(item.status))}</i></span>
      <span class="feedback-account" title="${escapeAttr(account)}">${escapeHtml(account)}</span>
      <span class="feedback-name" title="${escapeAttr(userName)}">${escapeHtml(userName)}</span>
      <span><i class="pill site" title="${escapeAttr(site)}">${escapeHtml(site)}</i></span>
      <span class="feedback-subject" title="${escapeAttr(item.subject)}">${escapeHtml(item.subject || "-")}</span>
      <span class="feedback-content" title="${escapeAttr(content)}">${escapeHtml(content)}</span>
      <span class="dt-act feedback-action">${showDoneAction ? `<a data-feedback-done="${escapeAttr(item.id)}">已处理</a>` : ""}</span>
    </div>
    ${expanded ? feedbackDetailHtml(item) : ""}
  `;
}

function feedbackDetailHtml(item) {
  const groups = [
    ["反馈内容", [
      ["账号", feedbackAccountLabel(item)],
      ["内容", item.content || "-"],
    ]],
    ["记录信息", [
      ["IP", formatFeedbackIp(item)],
      ["页面路径", item.pagePath || "-"],
      ["浏览器信息", item.userAgent || "-"],
      ["更新时间", formatFullTime(item.updatedAt)],
      ["反馈 ID", item.id],
    ]],
  ];

  return `
    <div class="feedback-detail acc-detail">
      ${groups.map(([title, rows]) => `
        <div class="acc-group">
          <div class="acc-group-t">${escapeHtml(title)}</div>
          ${rows.map(([key, value]) => `
            <div class="acc-df">
              <span class="acc-dk">${escapeHtml(key)}</span>
              <span class="acc-dv ${key === "内容" || key === "浏览器信息" ? "feedback-detail-value" : ""}" title="${escapeAttr(value)}">${escapeHtml(value)}</span>
            </div>
          `).join("")}
        </div>
      `).join("")}
      ${item.internalUid ? `<div class="acc-detail-act"><button class="btn btn-primary sm" type="button" data-feedback-account="${escapeAttr(item.internalUid)}">定位会话</button></div>` : item.guestSessionId && item.guestSessionExists ? `<div class="acc-detail-act"><button class="btn btn-primary sm" type="button" data-feedback-guest="${escapeAttr(item.guestSessionId)}">定位会话</button></div>` : item.guestSessionId ? `<div class="acc-detail-act"><button class="btn btn-ghost sm" type="button" disabled aria-disabled="true">会话已清理</button></div>` : ""}
    </div>
  `;
}

function formatFeedbackIp(item = {}) {
  const ip = String(item.clientIp || "").trim();
  if (!ip) return "-";
  const region = String(item.clientIpRegion || "未知地区").trim() || "未知地区";
  return `${region} · ${ip}`;
}

function feedbackAccountLabel(item = {}) {
  return item.userEmail || item.internalUid || "-";
}

function feedbackPagerHtml(state) {
  const page = Math.max(1, Number(state.page || 1));
  const pages = Math.max(1, Number(state.pages || 1));
  const limit = Math.max(1, Number(state.limit || 20));
  const itemCount = Number(state.items?.length || 0);
  const total = Math.max(Number(state.total || 0), itemCount);
  const rangeFrom = total && itemCount ? (page - 1) * limit + 1 : 0;
  const rangeTo = total && itemCount ? Math.min(total, rangeFrom + itemCount - 1) : 0;
  return `
    <div class="dt-pager feedback-pager">
      <span class="dt-pager-info">显示 ${formatNumber(rangeFrom)}-${formatNumber(rangeTo)}，共 ${formatNumber(total)} 条</span>
      <div class="dt-pager-btns">
        <button class="pg-btn" type="button" data-feedback-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
        ${paginationButtonsHtml(page, pages, "data-feedback-page")}
        <button class="pg-btn" type="button" data-feedback-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button>
      </div>
    </div>
  `;
}

function feedbackSiteDropdownHtml(value, sites) {
  return selectDropdownHtml({
    name: "feedbackSite",
    value,
    placeholder: "全部站点",
    items: feedbackSiteFilterItems(sites),
    className: "feedback-site-dd",
  });
}

function feedbackSiteFilterItems(sites = []) {
  return [
    ["all", "全部站点"],
    ...normalizeSites(sites).map((site) => [site.id, site.name]),
    ["unassigned", "未指定"],
  ];
}

function feedbackLoadingHtml() {
  return `<div class="feedback-empty">正在加载反馈...</div>`;
}

function feedbackErrorHtml(message) {
  return `<div class="feedback-empty">${escapeHtml(message || "反馈列表读取失败，请稍后再试")}</div>`;
}

function normalizeFeedbackState(state = {}) {
  return {
    items: Array.isArray(state.items) ? state.items : [],
    loading: Boolean(state.loading),
    error: state.error || "",
    page: Number(state.page || 1),
    pages: Number(state.pages || 1),
    total: Number(state.total || 0),
    limit: Number(state.limit || 20),
    status: state.status === "new" ? "new" : "all",
    query: String(state.query || ""),
    site: String(state.site || "all"),
    sites: Array.isArray(state.sites) ? state.sites : [],
    expandedId: String(state.expandedId || ""),
  };
}

function normalizeSites(sites = []) {
  return (Array.isArray(sites) ? sites : [])
    .map((site) => ({
      id: String(site?.id || "").trim(),
      name: String(site?.name || site?.id || "").trim(),
    }))
    .filter((site) => site.id && site.name);
}

function statusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "done") return "DONE";
  if (value === "new") return "NEW";
  return value ? value.toUpperCase() : "NEW";
}

function statusClass(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "new") return "on";
  if (value === "done") return "done";
  return "done";
}

function formatTimeParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { time: "--:--", date: "----/--/--" };
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const day = date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replaceAll("/", "-");
  return { time, date: day };
}

function formatFullTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${formatTimeParts(value).date} ${formatTimeParts(value).time}`;
}
