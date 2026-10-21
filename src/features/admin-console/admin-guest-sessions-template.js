import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { accountSiteFilterItems } from "./admin-account-sites.js";
import { accountManagementSwitchHtml } from "./admin-account-management-switch.js";
import { adminDateRangeFilterHtml, adminDateRangeLabel } from "./admin-date-range-filter.js";
import {
  escapeAdminTableAttr as escapeAttr,
  escapeAdminTableHtml as escapeHtml,
  formatNumber,
  formatSourcePage,
} from "./admin-console-utils.js";

const GUEST_STATUSES = Object.freeze([
  ["all", "全部"],
  ["active", "活跃中"],
  ["limit", "额度已满"],
  ["converted", "已转注册"],
  ["expired", "已过期"],
]);

export function adminGuestSessionsHtml({
  items = [],
  summary = {},
  page = 1,
  pages = 1,
  total = 0,
  limit = 10,
  openId = "",
  query = "",
  status = "all",
  site = "all",
  dateRange = "all",
  startDate = "",
  endDate = "",
  datePickerOpen = false,
  sites = [],
  siteCounts = [],
  accountTotal = 0,
  loading = false,
  error = "",
} = {}) {
  const safePage = Math.max(1, Number(page || 1));
  const safePages = Math.max(1, Number(pages || 1));
  const safeTotal = Number(total || 0);
  const rangeFrom = safeTotal ? (safePage - 1) * Number(limit || 10) + 1 : 0;
  const rangeTo = safeTotal ? Math.min(safeTotal, rangeFrom + items.length - 1) : 0;
  const dateScope = adminDateRangeLabel(dateRange);

  return `
    <div class="admin-body accounts-page guest-sessions-page">
      ${accountManagementSwitchHtml("guests", {
        accountCount: accountTotal,
        guestCount: summary.totalGuestSessions,
        guestSessionsWithUserMessages: summary.guestSessionsWithUserMessages,
      })}
      <div class="kpi-row accounts-kpis">
        <div class="kpi"><div class="kpi-k">有效游客会话</div><div class="kpi-v">${formatNumber(summary.validGuestSessions)}</div><div class="kpi-d">当前未过期 · ${dateScope}</div></div>
        <div class="kpi"><div class="kpi-k">筛选范围内参与聊天</div><div class="kpi-v">${formatNumber(summary.participatedToday)}</div><div class="kpi-d">有消息或通话的会话</div></div>
        <div class="kpi"><div class="kpi-k">筛选范围内转注册</div><div class="kpi-v">${formatNumber(summary.claimedToday)}</div><div class="kpi-d">认证承接成功 · ${dateScope}</div></div>
      </div>
      <div class="admin-actions">
        <div class="seg">${GUEST_STATUSES.map(([value, label]) => `<button class="${status === value ? "active" : ""}" type="button" data-guest-session-status="${value}">${label}</button>`).join("")}</div>
        <div class="account-site-filter">${selectDropdownHtml({
          name: "guestSessionSite",
          value: site,
          placeholder: "站点筛选",
          items: accountSiteFilterItems(sites, siteCounts).filter(([value]) => value !== "unassigned"),
          className: "account-site-dd",
        })}</div>
        ${adminDateRangeFilterHtml({ name: "guestDateRange", value: dateRange, startDate, endDate, open: datePickerOpen })}
        <div class="admin-search">${ICONS.search}<input data-guest-session-search placeholder="搜索游客 ID / 前台角色 / 转化账号..." value="${escapeAttr(query)}" /></div>
      </div>
      <div class="account-bulk-row guest-context-row">
        <div class="account-select-actions"><span><strong>游客会话</strong> 按浏览器身份独立保存，不会创建正式账号</span></div>
        <span class="guest-retention-note">会话有效期以服务端数据为准</span>
      </div>
      <div class="panel account-panel">
        <div class="data-table accounts guest-accounts">
          <div class="dt-head"><span>游客会话</span><span>所属站点</span><span>前台角色</span><span>对话角色数</span><span>用户消息</span><span>自拍</span><span>状态</span><span>最后活跃</span><span></span></div>
          <div class="dt-scroll" data-guest-session-scroll>${guestRowsHtml({ items, openId, loading, error })}</div>
        </div>
        <div class="dt-pager">
          <span class="dt-pager-info">显示 ${rangeFrom}-${rangeTo}，共 ${safeTotal} 条</span>
          <div class="dt-pager-btns">
            <button class="pg-btn" type="button" data-guest-session-page="${safePage - 1}" ${safePage <= 1 ? "disabled" : ""}>上一页</button>
            ${paginationButtonsHtml(safePage, safePages)}
            <button class="pg-btn" type="button" data-guest-session-page="${safePage + 1}" ${safePage >= safePages ? "disabled" : ""}>下一页</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function guestRowsHtml({ items, openId, loading, error }) {
  if (loading) return `<div class="log-empty">正在加载游客会话...</div>`;
  if (error) return `<div class="log-empty">${escapeHtml(error)}</div>`;
  if (!items.length) return `<div class="log-empty">暂无游客会话</div>`;
  return items.map((guest) => guestRowHtml(guest, openId)).join("");
}

function guestRowHtml(guest, openId) {
  const open = openId === guest.id;
  return `
    <div class="dt-row acc-row ${open ? "open" : ""}" data-guest-session-toggle="${escapeAttr(guest.id)}">
      <span class="dt-cell name guest-session-id"><span>游客 #${escapeHtml(guest.displayId || guest.id)}<small>${escapeHtml(guest.id)}</small></span><i class="acc-caret">${ICONS.chevron}</i></span>
      <span><i class="pill site">${escapeHtml(guest.siteName || guest.siteId || "-")}</i></span>
      <span>${escapeHtml(guest.characterName || "-")}</span>
      <span class="guest-count">${formatNumber(guest.characterConversationCount)} 个<small>有用户消息才计入</small></span>
      <span class="guest-count">${formatNumber(guest.userMessageCount)} 条<small>${formatNumber(guest.productMessageCount)} 个商品</small></span>
      <span class="${guestImageTone(guest.imageEntitlementStatus)}">${escapeHtml(guestImageLabel(guest.imageEntitlementStatus))}</span>
      <span><i class="pill guest-status-${escapeAttr(guest.status || "active")}">${escapeHtml(guest.statusLabel || "活跃中")}</i></span>
      <span class="guest-count">${escapeHtml(formatDate(guest.lastActiveAt))}<small>${escapeHtml(guestClaimLabel(guest))}</small></span>
      <span class="dt-act"><a>${open ? "收起" : "展开"}</a></span>
    </div>
    ${open ? guestDetailHtml(guest) : ""}
  `;
}

function guestDetailHtml(guest) {
  const groups = [
    ["基础信息", [["会话 ID", guest.id], ["所属站点", siteDetail(guest)], ["前台角色", guest.characterName || "-"], ["来源页面", formatSourcePage(guest)], ["创建时间", formatDate(guest.createdAt)], ["最后活跃", formatDate(guest.lastActiveAt)], ["最近访问设备", guest.lastDevice || "-"], ["最近 IP", formatLastIp(guest)], ["最近访问 IP 时间", formatDate(guest.lastIpAt)], ["会话状态", guest.statusLabel || "-"]]],
    ["使用数据", [["对话角色数", `${formatNumber(guest.characterConversationCount)} 个（仅统计用户实际发言）`], ["用户消息", `${formatNumber(guest.userMessageCount)} 条`], ["语音输入", `${formatNumber(guest.voiceInputCount)} 条`], ["附件", `${formatNumber(guest.attachmentMessageCount)} 个`], ["商品消息", `${formatNumber(guest.productMessageCount)} 个`], ["实时通话", `${formatNumber(guest.callCount)} 通 / ${formatDuration(guest.callDurationMilliseconds)}`], ["通话回合", `${formatNumber(guest.callTurnCount)} 回合`], ["自拍资格", guestImageLabel(guest.imageEntitlementStatus)], ["单角色额度", `每个角色 ${formatNumber(guest.messageLimit || 30)} 条 / 24 小时`], ["过期时间", formatDate(guest.expiresAt)]]],
    ["匿名访问关联", visitorContinuityRows(guest)],
    ["认证承接", [["当前结果", guestClaimLabel(guest)], ["账号状态", guest.status === "converted" ? "已承接到正式账号" : "未创建正式账号"], ["承接时间", formatDate(guest.claimedAt)], ["身份范围", "当前浏览器"], ["跨设备共享", "不支持"]]],
  ];
  return `
    <div class="acc-detail">
      ${groups.map(([title, rows]) => `<div class="acc-group"><div class="acc-group-t">${escapeHtml(title)}</div>${rows.map(([key, value]) => `<div class="acc-df"><span class="acc-dk">${escapeHtml(key)}</span><span class="acc-dv">${escapeHtml(value || "-")}</span></div>`).join("")}</div>`).join("")}
      <div class="acc-detail-act"><button class="btn btn-primary sm" type="button" data-guest-session-conversation="${escapeAttr(guest.id)}">${ICONS.chat} 查看对话</button></div>
    </div>
  `;
}

function visitorContinuityRows(guest) {
  const visitor = guest.visitorContinuity;
  const rows = visitor?.visitorId ? [
    ["匿名浏览器标记", visitor.visitorId],
    ["关联依据", "同一浏览器标记，不代表同一个人"],
    ["本站关联会话", `${formatNumber(visitor.sessionCount)} 个`],
    ["首次记录访问", formatDate(visitor.firstSeenAt)],
    ["最近记录访问", formatDate(visitor.lastSeenAt)],
    ["最近会话处理", visitorOutcomeLabel(visitor.lastOutcome)],
    ["处理原因", visitorReasonLabel(visitor.lastReason)],
    ["关联游客 ID", (visitor.linkedGuestIds || []).slice(0, 20).join("、") || "-"],
  ] : [["匿名浏览器标记", "未记录（历史数据不追溯归并）"]];
  const candidates = (guest.continuityCandidates || []).slice(0, 3);
  rows.push(["疑似关联（不代表同一人）", candidates.length
    ? candidates.map((item) => `${item.guestId}：${(item.evidence || []).join("、")}`).join("；")
    : "暂无足够关联证据"]);
  rows.push(["关联参考范围", "有限时间范围内的近期记录；最近来源页面和 IP 不一定代表首次进入时的信息"]);
  return rows;
}

function visitorOutcomeLabel(value) {
  return ({ created: "创建游客会话", reused: "复用游客会话", invalid: "游客凭证不可用" })[value] || "未记录";
}

function visitorReasonLabel(value) {
  return ({
    guest_cookie_missing: "请求未携带游客凭证（无法据此判断是否无痕）",
    guest_unrecognized: "游客凭证未匹配到记录",
    guest_inactive: "原游客会话已停用或已转注册",
    guest_expired: "原游客会话已过期",
    guest_site_mismatch: "游客凭证与当前站点不匹配",
    guest_site_disabled: "站点当前未开放游客聊天",
    guest_unusable_for_site: "游客凭证无效、过期或不适用于当前站点",
    guest_cookie_valid: "有效游客凭证，复用原会话",
  })[value] || "未记录";
}

function guestImageLabel(status) {
  if (status === "consumed") return "已使用";
  if (status === "reserved") return "生成中";
  if (status === "available") return "未使用";
  if (status === "missing") return "数据缺失";
  return "状态异常";
}

function guestImageTone(status) {
  if (status === "consumed") return "guest-selfie-used";
  if (status === "available") return "guest-selfie-available";
  return "guest-selfie-warning";
}

function guestClaimLabel(guest) {
  if (guest.status === "converted") return guest.claimedAccount || "已转注册";
  if (guest.status === "claiming") return "认证中";
  return "未注册";
}

function siteDetail(guest) {
  const label = guest.siteName || guest.siteId || "-";
  return guest.siteSlug ? `${label} /${guest.siteSlug}` : label;
}

function paginationButtonsHtml(page, pages) {
  const candidates = new Set([1, pages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pages));
  return Array.from(candidates).sort((left, right) => left - right).map((value, index, list) => {
    const gap = index > 0 && value - list[index - 1] > 1 ? `<span class="pg-ellipsis">...</span>` : "";
    return `${gap}<button class="pg-btn ${page === value ? "active" : ""}" type="button" data-guest-session-page="${value}">${value}</button>`;
  }).join("");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatLastIp(guest = {}) {
  const ip = String(guest.lastIp || "").trim();
  if (!ip) return "-";
  const region = String(guest.lastIpRegion || "未知地区").trim() || "未知地区";
  return `${region} · ${ip}`;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
}
