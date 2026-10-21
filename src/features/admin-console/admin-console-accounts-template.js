import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { accountSiteDetail, accountSiteFilterItems, accountSiteLabel } from "./admin-account-sites.js";
import { accountManagementSwitchHtml } from "./admin-account-management-switch.js";
import { adminDateRangeFilterHtml, adminDateRangeLabel } from "./admin-date-range-filter.js";
import {
  escapeAdminTableAttr as escapeAttr,
  escapeAdminTableHtml as escapeHtml,
  formatNumber,
  formatSourcePage,
  paginationButtonsHtml,
} from "./admin-console-utils.js";

const ACCOUNT_TYPES = Object.freeze([
  ["all", "全部"],
  ["personal", "普通用户"],
  ["creator", "创作者"],
  ["admin", "运营"],
]);

export function adminAccountsHtml({
  items = [],
  summary = {},
  page = 1,
  pages = 1,
  total = 0,
  limit = 10,
  openId = "",
  query = "",
  type = "all",
  site = "all",
  dateRange = "all",
  startDate = "",
  endDate = "",
  datePickerOpen = false,
  sites = [],
  siteCounts = [],
  selectedIds = new Set(),
  guestTotal = 0,
  guestSessionsWithUserMessages = 0,
  loading = false,
  error = "",
} = {}) {
  const safePage = Math.max(1, Number(page || 1));
  const safePages = Math.max(1, Number(pages || 1));
  const safeTotal = Number(total || 0);
  const rangeFrom = safeTotal ? (safePage - 1) * Number(limit || 10) + 1 : 0;
  const rangeTo = safeTotal ? Math.min(safeTotal, rangeFrom + items.length - 1) : 0;
  const selectedCount = selectedIds.size;
  const dateScope = adminDateRangeLabel(dateRange);

  return `
    <div class="admin-body accounts-page">
      ${accountManagementSwitchHtml("accounts", {
        accountCount: summary.totalAccounts,
        guestCount: guestTotal,
        guestSessionsWithUserMessages,
      })}
      <div class="kpi-row accounts-kpis">
        <div class="kpi"><div class="kpi-k">总账号数</div><div class="kpi-v">${formatNumber(summary.totalAccounts)}</div><div class="kpi-d">${dateScope}</div></div>
        <div class="kpi"><div class="kpi-k">创作者</div><div class="kpi-v">${formatNumber(summary.creatorAccounts)}</div><div class="kpi-d">${dateScope}</div></div>
        <div class="kpi"><div class="kpi-k">非正常账号</div><div class="kpi-v">${formatNumber(summary.unavailableAccounts)}</div><div class="kpi-d">${dateScope}</div></div>
      </div>
      <div class="admin-actions">
        <div class="seg">${ACCOUNT_TYPES.map(([value, label]) => `<button class="${type === value ? "active" : ""}" type="button" data-account-type="${value}">${label}</button>`).join("")}</div>
        ${accountSiteFilterHtml(site, sites, siteCounts)}
        ${adminDateRangeFilterHtml({ name: "accountDateRange", value: dateRange, startDate, endDate, open: datePickerOpen })}
        <button class="btn btn-primary sm" type="button" data-account-new>${ICONS.plus} 新增账号</button>
        <div class="admin-search">${ICONS.search}<input data-account-search placeholder="搜索用户名 / 邮箱 / 用户 ID..." value="${escapeAttr(query)}" /></div>
      </div>
      <div class="account-bulk-row ${selectedCount ? "is-active" : ""}">
        <div class="account-select-actions"><button type="button" data-account-select-all>选择所有</button><button type="button" data-account-select-page>选择本页</button><button type="button" data-account-select-clear ${selectedCount ? "" : "disabled"}>清除选择</button><span>已选 ${formatNumber(selectedCount)} 个账号</span></div>
        <div class="account-bulk-actions"><button class="btn btn-ghost sm" type="button" data-account-bulk-site ${selectedCount ? "" : "disabled"}>批量修改站点</button><button class="btn btn-ghost sm" type="button" data-account-bulk-role ${selectedCount ? "" : "disabled"}>批量修改身份</button><button class="btn btn-ghost sm danger-btn" type="button" data-account-bulk-ban ${selectedCount ? "" : "disabled"}>批量封禁</button></div>
      </div>
      <div class="panel account-panel">
        <div class="data-table accounts">
          <div class="dt-head"><span></span><span>账号</span><span>邮箱</span><span>所属站点</span><span>身份</span><span>状态</span><span>注册时间</span><span>最后活跃</span><span></span></div>
          <div class="dt-scroll" data-account-scroll>
            ${accountRowsHtml({ items, openId, selectedIds, loading, error })}
          </div>
        </div>
        <div class="dt-pager">
          <span class="dt-pager-info">显示 ${rangeFrom}-${rangeTo}，共 ${safeTotal} 条</span>
          <div class="dt-pager-btns">
            <button class="pg-btn" type="button" data-account-page="${safePage - 1}" ${safePage <= 1 ? "disabled" : ""}>上一页</button>
            ${paginationButtonsHtml(safePage, safePages, "data-account-page")}
            <button class="pg-btn" type="button" data-account-page="${safePage + 1}" ${safePage >= safePages ? "disabled" : ""}>下一页</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function accountConversationModalHtml({
  account = null,
  query = "",
  view = "list",
  selectedConversation = null,
  conversations = [],
  loading = false,
  error = "",
  expandedCharacter = "",
} = {}) {
  const userName = account?.username || account?.email || "用户";
  const body = view === "detail" && selectedConversation
    ? conversationDetailHtml(selectedConversation)
    : conversationListHtml({ userName, query, conversations, loading, error, expandedCharacter });

  return `
    <div class="cm-scrim" data-account-convo-close></div>
    <div class="convo-modal" role="dialog" aria-modal="true">${body}</div>
  `;
}

function accountSiteFilterHtml(site, sites, siteCounts) {
  return `<div class="account-site-filter" data-account-site>${selectDropdownHtml({
    name: "accountSite",
    value: site,
    placeholder: "站点筛选",
    items: accountSiteFilterItems(sites, siteCounts),
    className: "account-site-dd",
  })}</div>`;
}

function accountRowsHtml({ items, openId, selectedIds, loading, error }) {
  if (loading) return `<div class="log-empty">正在加载账号...</div>`;
  if (error) return `<div class="log-empty">${escapeHtml(error)}</div>`;
  if (!items.length) return `<div class="log-empty">暂无账号数据</div>`;
  return items.map((account) => accountRowHtml(account, openId, selectedIds)).join("");
}

function accountRowHtml(account, openId, selectedIds) {
  const open = openId === account.id;
  const selected = selectedIds.has(account.id);
  return `
    <div class="dt-row acc-row ${open ? "open" : ""}" data-account-toggle="${escapeAttr(account.id)}">
      <span class="acc-check-cell"><input type="checkbox" data-account-select="${escapeAttr(account.id)}" ${selected ? "checked" : ""} aria-label="选择账号" /></span>
      <span class="dt-cell name">${accountAvatarHtml(account)}${escapeHtml(account.username || account.email || account.id)}<i class="acc-caret">${ICONS.chevron}</i></span>
      <span class="dt-mail">${escapeHtml(account.email)}</span>
      <span><i class="pill site">${escapeHtml(accountSiteLabel(account))}</i></span>
      <span><i class="pill ${accountRoleTone(account.role)}">${escapeHtml(account.role)}</i></span>
      <span><i class="pill ${accountStatusTone(account.status)}">${escapeHtml(account.status)}</i></span>
      <span>${escapeHtml(formatDate(account.createdAt, "date"))}</span>
      <span class="guest-count">${escapeHtml(formatDate(account.lastActiveAt))}</span>
      <span class="dt-act">${accountStatusActionHtml(account, "link")}</span>
    </div>
    ${open ? accountDetailHtml(account) : ""}
  `;
}

function accountDetailHtml(account) {
  const groups = [
    ["基础信息", [["用户 ID", account.id], ["所属站点", accountSiteDetail(account)], ["来源页面", formatSourcePage(account)], ["注册时间", formatDate(account.createdAt)], ["最后活跃", formatDate(account.lastActiveAt)], ["最后登录设备", account.lastLoginDevice || "-"], ["最近 IP", formatLastIp(account)], ["最近访问 IP 时间", formatDate(account.lastIpAt)], ["账号状态", account.status], ["状态备注", account.statusNote || "-"]]],
    ["资产信息", [["用户余额", `${formatAmount(account.balance)} pt`], ["充值积分余额", `${formatAmount(account.rechargeBalance)} pt`], ["赠送积分余额", `${formatAmount(account.bonusBalance)} pt`], ["累计充值", `¥${formatAmount(account.totalRecharge, 2)}`], ["累计消耗积分", `${formatAmount(account.totalSpentCredits)} pt`]]],
    ["使用数据", [["总对话数", `${formatNumber(account.totalConversations)} 次`], ["近7天对话次数", `${formatNumber(account.recentConversations)} 次`], ["激活角色数", `${formatNumber(account.activeCharacterCount)} 个`], ["创建角色数", `${formatNumber(account.createdCharacterCount)} 个`]]],
  ];

  return `
    <div class="acc-detail">
      ${groups.map(([title, rows]) => `<div class="acc-group"><div class="acc-group-t">${escapeHtml(title)}</div>${rows.map(([key, value]) => `<div class="acc-df"><span class="acc-dk">${escapeHtml(key)}</span><span class="acc-dv">${escapeHtml(value)}</span></div>`).join("")}</div>`).join("")}
      <div class="acc-detail-act"><button class="btn btn-primary sm" type="button" data-account-open="${escapeAttr(account.id)}">${ICONS.chat} 查看对话</button><button class="btn btn-ghost sm" type="button" data-account-edit="${escapeAttr(account.id)}">编辑资料</button><button class="btn btn-ghost sm" type="button" data-account-password="${escapeAttr(account.id)}">重置密码</button>${accountStatusActionHtml(account, "button")}</div>
    </div>
  `;
}

function accountStatusActionHtml(account, variant = "link") {
  const nextStatus = account.status === "正常" ? "banned" : "active";
  const label = account.status === "正常" ? "封禁" : "解封";
  if (variant === "button") {
    const dangerClass = nextStatus === "banned" ? " danger-btn" : "";
    return `<button class="btn btn-ghost sm${dangerClass}" type="button" data-account-status="${escapeAttr(account.id)}" data-next-status="${nextStatus}">${label}账号</button>`;
  }
  const dangerClass = nextStatus === "banned" ? " class=\"danger\"" : "";
  return `<a${dangerClass} data-account-status="${escapeAttr(account.id)}" data-next-status="${nextStatus}">${label}</a>`;
}

function conversationListHtml({ userName, query, conversations, loading, error, expandedCharacter }) {
  return `
    <div class="cv-head">
      <div class="cv-head-mid"><div><div class="cv-h-name">对话记录</div><div class="cv-h-sub">${escapeHtml(userName)} · 共 ${formatNumber(conversations.length)} 段对话</div></div></div>
      <button class="cm-x" type="button" data-account-convo-close aria-label="关闭">${ICONS.close}</button>
    </div>
    <div class="cv-search">${ICONS.search}<input data-convo-query placeholder="搜索角色、对话关键词..." value="${escapeAttr(query)}" /></div>
    <div class="cv-list" data-convo-results>${conversationResultsHtml({ conversations, query, loading, error, expandedCharacter })}</div>
  `;
}

function conversationDetailHtml(conversation) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  return `
    <div class="cv-head">
      <button class="cv-back" type="button" data-convo-back>${ICONS.back}<span>返回</span></button>
      <div class="cv-head-mid">${conversationAvatarHtml(conversation)}<div><div class="cv-h-name">${escapeHtml(conversation.character)}</div><div class="cv-h-sub">${escapeHtml(conversation.role)} · ${escapeHtml(formatDate(conversation.date, "date"))}</div></div></div>
      <button class="cm-x" type="button" data-account-convo-close aria-label="关闭">${ICONS.close}</button>
    </div>
    <div class="cv-thread">
      ${conversation.hasMore ? `<div class="cv-history-note">仅显示最近 200 条游客消息</div>` : ""}
      ${messages.length ? messages.map((message) => `<div class="cv-msg ${message.sender === "user" ? "me" : "ai"}">${message.sender !== "user" ? conversationAvatarHtml(conversation, "cv-msg-av") : ""}<div class="cv-bubble${isReadyConversationImage(message) ? " cv-bubble-image" : ""}">${conversationMessageContentHtml(message)}</div></div>`).join("") : `<div class="cv-empty is-blank">（空）</div>`}
    </div>
  `;
}

function conversationMessageContentHtml(message) {
  if (message.contentType === "product") return conversationProductHtml(message.product, message);
  if (message.contentType === "image_generation" || message.contentType === "mascot_greeting_image" || message.contentType === "mascot_library_image") return conversationImageHtml(message);
  if (message.contentType === "attachment") return conversationAttachmentHtml(message.attachment);
  if (message.contentType === "feedback_action") return conversationFeedbackActionHtml(message.feedbackAction);
  return escapeHtml(message.text || "[非文本消息]");
}

function conversationFeedbackActionHtml(action = {}) {
  const label = String(action?.label || "Click here").trim() || "Click here";
  return `<span class="cv-feedback-action">${ICONS.chat}<span>${escapeHtml(label)}</span></span>`;
}

function conversationProductHtml(product = {}, message = {}) {
  if (!product) return `<span class="cv-non-text">[商品消息]</span>`;
  const image = product.imageUrl ? `<img src="${escapeAttr(product.imageUrl)}" alt="" loading="lazy" />` : `<span class="cv-product-ph">P</span>`;
  const subtitle = product.subtitle ? `<span class="cv-product-sub">${escapeHtml(product.subtitle)}</span>` : "";
  const priceNow = product.priceNow ? `<b>${escapeHtml(product.priceNow)}</b>` : "";
  const priceWas = product.priceWas ? `<s>${escapeHtml(product.priceWas)}</s>` : "";
  const price = priceNow || priceWas ? `<span class="cv-product-price">${priceNow}${priceWas}</span>` : "";
  const name = product.name || message.text || "Product";
  return `
    <div class="cv-product">
      <div class="cv-product-img">${image}</div>
      <div class="cv-product-main">
        <span class="cv-product-name">${escapeHtml(name)}</span>
        ${subtitle}
        ${price}
      </div>
    </div>
  `;
}

function conversationImageHtml(message) {
  const image = message.image || {};
  const status = String(image.status || message.deliveryStatus || "").toLowerCase();
  if (status === "ready" && image.imageUrl) {
    const media = image.mediaType === "video"
      ? `<video src="${escapeAttr(image.imageUrl)}" controls playsinline preload="metadata"></video>`
      : `<img src="${escapeAttr(image.imageUrl)}" alt="" loading="lazy" />`;
    return `
      <div class="cv-image-card" data-chat-image-message-id="${escapeAttr(message.id || "")}">
        ${media}
      </div>
    `;
  }
  const label = status === "failed" || status === "cancelled"
    ? (image.errorMessage || message.text || "图片生成失败")
    : (message.text || "图片生成中");
  return `<span class="cv-non-text">${escapeHtml(label)}</span>`;
}

function isReadyConversationImage(message = {}) {
  const image = message.image || {};
  return ["image_generation", "mascot_greeting_image", "mascot_library_image"].includes(message.contentType)
    && String(image.status || message.deliveryStatus || "").toLowerCase() === "ready"
    && Boolean(image.imageUrl);
}

function conversationAttachmentHtml(attachment = {}) {
  if (!attachment) return `<span class="cv-non-text">[附件消息]</span>`;
  const fileName = attachment.originalName || attachment.name || attachment.fileName || "附件";
  const mimeType = String(attachment.mimeType || attachment.type || "");
  const kind = String(attachment.kind || "").trim();
  const isImage = kind === "image" || mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(fileName);
  const preview = isImage && attachment.url
    ? `<img src="${escapeAttr(attachment.url)}" alt="" loading="lazy" />`
    : `<span class="cv-attach-icon">FILE</span>`;
  return `
    <div class="cv-attachment">
      <div class="cv-attachment-preview">${preview}</div>
      <span>${escapeHtml(fileName)}</span>
    </div>
  `;
}

function conversationResultsHtml({ conversations, query, loading, error, expandedCharacter }) {
  if (loading) return `<div class="cv-empty">正在加载对话...</div>`;
  if (error) return `<div class="cv-empty">${escapeHtml(error)}</div>`;
  if (!conversations.length) return `<div class="cv-empty is-blank">（空）</div>`;
  if (query.trim()) return flatConversationResultsHtml(conversations, query);

  const grouped = conversations.reduce((result, item) => {
    const key = item.character || "未命名角色";
    result[key] = result[key] || [];
    result[key].push(item);
    return result;
  }, {});

  return Object.keys(grouped).map((name) => {
    const list = grouped[name].slice().sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
    const first = list[0];
    const open = expandedCharacter === name;
    return `
      <div class="cv-group ${open ? "open" : ""}">
        <div class="cv-group-h" data-convo-group="${escapeAttr(name)}">
          ${conversationAvatarHtml(first, "cv-av sm")}
          <div class="cv-g-name">${escapeHtml(name)}</div>
          <span class="cv-g-role">${escapeHtml(first.role)}</span>
          <span class="cv-g-count">${list.length} 段</span>
          <i class="cv-caret">${ICONS.chevron}</i>
        </div>
        ${open ? `<div class="cv-sublist">${list.map((item) => conversationItemHtml(item)).join("")}</div>` : ""}
      </div>
    `;
  }).join("");
}

function flatConversationResultsHtml(conversations, query) {
  return `<div class="cv-res-info">找到 ${conversations.length} 条结果</div>${conversations.map((conversation) => `<div class="cv-item flat" data-convo-open="${escapeAttr(conversation.id)}">${conversationAvatarHtml(conversation, "cv-av sm")}<div class="cv-item-main"><span class="cv-res-name">${highlight(conversation.character, query)} <i class="cv-res-role">${highlight(conversation.role, query)}</i></span><span class="cv-snip">${highlight(conversation.latestText || "暂无消息", query)}</span>${conversationSegmentMetaHtml(conversation)}</div><i class="cv-go">${ICONS.chevron}</i></div>`).join("")}`;
}

function conversationItemHtml(item) {
  return `<div class="cv-item" data-convo-open="${escapeAttr(item.id)}"><div class="cv-item-main">${conversationSegmentMetaHtml(item)}<span class="cv-snip">${escapeHtml(item.latestText || "暂无消息")}</span></div><i class="cv-go">${ICONS.chevron}</i></div>`;
}

function conversationSegmentMetaHtml(item) {
  const userMessageCount = Math.max(0, Number(item.userMessageCount || 0));
  return `<span class="cv-date">${escapeHtml(formatDate(item.date, "date"))}<span class="cv-date-sep"> · </span><span class="cv-user-count">${formatNumber(userMessageCount)}条</span></span>`;
}

function accountAvatarHtml(account) {
  const initial = String(account.username || account.email || account.id || "A").trim().slice(0, 1).toUpperCase();
  if (account.avatarUrl) return `<img class="acc-av" src="${escapeAttr(account.avatarUrl)}" alt="" />`;
  return `<span class="acc-av letter">${escapeHtml(initial)}</span>`;
}

function conversationAvatarHtml(conversation, className = "cv-av") {
  const initial = String(conversation.character || "A").trim().slice(0, 1).toUpperCase();
  if (conversation.imageUrl) return `<img class="${escapeAttr(className)}" src="${escapeAttr(conversation.imageUrl)}" alt="" />`;
  return `<span class="${escapeAttr(className)} letter">${escapeHtml(initial)}</span>`;
}

function accountRoleTone(role) {
  if (role === "运营") return "on";
  if (role === "创作者") return "mid";
  return "";
}

function accountStatusTone(status) {
  return status === "正常" ? "on" : "off";
}

function highlight(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  try {
    const pattern = new RegExp(`(${escapeRegExp(escapeHtml(query))})`, "ig");
    return escaped.replace(pattern, "<mark>$1</mark>");
  } catch {
    return escaped;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(value, mode = "datetime") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const options = mode === "date"
    ? { month: "2-digit", day: "2-digit" }
    : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function formatLastIp(account = {}) {
  const ip = String(account.lastIp || "").trim();
  if (!ip) return "-";
  const region = String(account.lastIpRegion || "未知地区").trim() || "未知地区";
  return `${region} · ${ip}`;
}

function formatAmount(value, digits = 3) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
