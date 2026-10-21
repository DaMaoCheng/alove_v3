import { ICONS } from "../../icons/icons.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";

export function adminReportingHtml() {
  return `<div class="admin-body admin-discount-codes-page admin-reporting-page">
    <div class="admin-actions admin-discount-code-toolbar"><span class="hint">创建只读访问凭证，授权读取账号和对话数据。</span>
    <button class="btn btn-primary sm" type="button" data-reporting-create disabled>${ICONS.plus} 创建 API</button></div>
    <div class="panel"><div class="data-table admin-discount-codes-table" data-reporting-list><div class="log-empty">正在加载 API...</div></div></div></div>`;
}

export function reportingListHtml(items, { scopes, sites }) {
  if (!items.length) return `<div class="log-empty">暂无 API，点击「创建 API」设置权限。</div>`;
  const scopeNames = new Map(scopes.map((s) => [s.id, s.label]));
  const siteNames = new Map(sites.map((s) => [s.id, s.name]));
  return `<div class="dt-head"><span>名称 / 标识</span><span>读取权限</span><span>站点范围</span><span>有效期</span><span>状态</span><span>最近调用 / 次数</span><span>操作</span></div>${items.map((item) => `
    <div class="dt-row"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.tokenPrefix)}…</small></span>
    <span>${item.scopes.map((s) => `<small>${escapeHtml(scopeNames.get(s) || s)}</small>`).join("")}</span>
    <span>${item.allSites ? "全部站点" : item.siteIds.map((id) => `<small>${escapeHtml(siteNames.get(id) || id)}</small>`).join("")}</span>
    <span>${escapeHtml(dateLabel(item.expiresAt))}</span><span><i class="pill ${item.status === "active" ? "on" : "off"}">${({ active: "有效", revoked: "已撤销", expired: "已过期" })[item.status] || "不可用"}</i></span>
    <span><small>${escapeHtml(dateLabel(item.lastUsedAt))}</small><small>${Number(item.requestCount) || 0} 次</small></span>
    <span class="dt-act">${item.status === "active" ? `<button class="btn btn-ghost sm" data-reporting-revoke="${escapeAttr(item.id)}">撤销</button>` : "—"}</span></div>`).join("")}`;
}

export function reportingCreateHtml({ scopes, sites }) {
  return modalHtml("创建 API", `<form class="agent-form reporting-create-form" data-reporting-form>
    <label class="agent-field"><span>名称</span><input name="name" maxlength="80" required placeholder="例如：领导数据报表" autocomplete="off" /></label>
    <fieldset class="reporting-choice-field"><legend>读取权限 <small>可多选</small></legend><div class="reporting-choice-grid reporting-scope-grid">${scopes.map((s) => checkHtml("scopes", s.id, s.label)).join("")}</div></fieldset>
    <fieldset class="reporting-choice-field"><legend>站点范围 <small>可多选</small></legend>${checkHtml("allSites", "all", "全部站点", "reporting-all-sites")}
      <div class="reporting-choice-grid reporting-site-grid" data-reporting-sites>${sites.map((s) => checkHtml("siteIds", s.id, s.name)).join("")}</div></fieldset>
    <label class="agent-field"><span>有效期</span>${selectDropdownHtml({ name: "expiresInDays", value: "30", items: [["30", "30 天"], ["90", "90 天"], ["365", "365 天"]], className: "agent-dd" })}</label>
    <div class="agent-form-actions"><button class="btn btn-primary sm" type="submit">确认权限并生成</button><button class="btn btn-ghost sm" type="button" data-reporting-close>取消</button></div>
    <p class="hint" role="status" data-reporting-tip></p></form>`, "reporting-create-modal");
}

export function reportingTokenHtml(token, baseUrl) {
  return modalHtml("API 已创建", `<div class="agent-form"><p class="hint">请立即复制并妥善保存 Token。关闭后将不再显示完整内容。</p>
    <label class="agent-field"><span>Token</span><textarea rows="3" readonly data-reporting-secret>${escapeHtml(token)}</textarea></label>
    <button class="btn btn-primary sm" type="button" data-reporting-copy>复制 Token</button>
    <label class="agent-field"><span>Base URL</span><input readonly value="${escapeAttr(baseUrl)}" /></label>
    <label class="agent-field"><span>请求头</span><textarea rows="2" readonly>Authorization: Bearer &lt;YOUR_TOKEN&gt;\nAccept: application/json</textarea></label>
    <label class="agent-field"><span>请求示例（按所选权限调用）</span><textarea rows="3" readonly>GET /api/reporting/accounts\nGET /api/reporting/accounts/&lt;ACCOUNT_ID&gt;/conversations\nGET /api/reporting/accounts/&lt;ACCOUNT_ID&gt;/conversations/&lt;CONVERSATION_ID&gt;</textarea></label>
    <div class="agent-form-actions"><button class="btn btn-ghost sm" type="button" data-reporting-close>完成</button><span class="hint" role="status" data-reporting-tip></span></div></div>`, "reporting-token-modal");
}

function modalHtml(title, content, className = "") {
  return `<div class="dialog-scrim" data-reporting-close></div><div class="dlg common-character-modal discount-code-editor-modal reporting-modal ${className}" role="dialog" aria-modal="true" aria-labelledby="reportingTitle"><button class="dlg-x" type="button" aria-label="关闭" data-reporting-close>${ICONS.close}</button><div class="dlg-body"><h3 id="reportingTitle">${title}</h3>${content}</div></div>`;
}
function checkHtml(name, value, label, className = "") {
  return `<label class="reporting-check-row ${className}"><input class="reporting-check-input" type="checkbox" name="${name}" value="${escapeAttr(value)}" /><span class="reporting-check-mark" aria-hidden="true"></span><span class="reporting-check-copy">${escapeHtml(label)}</span></label>`;
}
function dateLabel(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未调用";
}
