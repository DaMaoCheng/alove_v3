import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function adminDiscountCodesHtml() {
  return `
    <div class="admin-body admin-discount-codes-page">
      <div class="admin-actions admin-discount-code-toolbar">
        <div class="admin-discount-code-filters">
          <input type="search" placeholder="搜索折扣码、优惠或网红" data-discount-code-query />
          <div data-discount-code-site-filter></div>
          <div data-discount-code-owner-filter></div>
          <div data-discount-code-status-filter></div>
        </div>
        <button class="btn btn-primary sm" type="button" data-discount-code-new>${ICONS.plus} 新增折扣码</button>
      </div>
      <div class="panel">
        <div class="data-table admin-discount-codes-table" data-discount-code-list>
          <div class="log-empty">正在加载折扣码...</div>
        </div>
      </div>
    </div>
  `;
}

export function adminDiscountCodeFiltersHtml({ sites = [], site = "", ownershipType = "", status = "" } = {}) {
  return {
    site: filterDropdown("discountCodeSite", site, "全部站点", [["", "全部站点"], ...sites.map(siteOption)]),
    owner: filterDropdown("discountCodeOwner", ownershipType, "全部归属", [["", "全部归属"], ["site", "前台"], ["creator", "网红"]]),
    status: filterDropdown("discountCodeStatus", status, "全部状态", [
      ["", "全部状态"],
      ["active", "生效中"],
      ["scheduled", "未开始"],
      ["expired", "已过期"],
      ["disabled", "已停用"],
    ]),
  };
}

export function adminDiscountCodeListHtml(items = []) {
  if (!items.length) return `<div class="log-empty">暂无折扣码</div>`;
  return `
    <div class="dt-head"><span>折扣码 / 优惠</span><span>归属</span><span>站点</span><span>有效期</span><span>状态</span><span>更新时间</span><span></span></div>
    ${items.map(discountCodeRowHtml).join("")}
  `;
}

export function adminDiscountCodeEditorModalHtml(item, { sites = [], creators = [] } = {}) {
  const data = item || emptyDiscountCode(sites[0]?.id || "");
  const isNew = !data.id;
  return `
    <div class="dialog-scrim" data-discount-code-close></div>
    <div class="dlg common-character-modal discount-code-editor-modal" role="dialog" aria-modal="true" aria-labelledby="discountCodeEditorTitle">
      <button class="dlg-x" type="button" aria-label="关闭" data-discount-code-close>${ICONS.close}</button>
      <div class="dlg-body">
        <h3 id="discountCodeEditorTitle">${isNew ? "新增折扣码" : "编辑折扣码"}</h3>
        <p>${isNew ? "登记独立站已经创建的折扣码" : escapeHtml(data.code)}</p>
      </div>
      <form class="agent-form" data-discount-code-form>
        <div class="agent-form-grid">
          ${fieldHtml("站点", siteSelectHtml(data.siteId, sites))}
          ${shopifyDiscountPickerHtml(data)}
        </div>
        <div class="discount-code-rule-card" data-discount-code-rule-card>
          ${shopifyDiscountRulePreviewHtml(data)}
        </div>
        <div class="agent-form-grid">
          ${choiceFieldHtml("归属", "ownershipType", data.ownershipType, [["site", "前台"], ["creator", "网红"]])}
        </div>
        <div class="agent-field discount-code-creator-field" data-discount-code-creator-field ${data.ownershipType === "creator" ? "" : "hidden"}>
          <span>网红账号</span>
          <div data-discount-code-creator-select>${creatorSelectHtml(data.creatorUid, data.siteId, creators)}</div>
          <small class="agent-field-note">只显示当前站点中状态正常、且已创建网红角色的账号。</small>
        </div>
        ${fieldHtml("备注", `<textarea name="notes" rows="3" maxlength="1000" placeholder="仅供后台管理使用，可不填">${escapeHtml(data.notes)}</textarea>`)}
        <div class="agent-field site-toggle-field">
          <span>启用状态</span>
          <label class="site-toggle-row">
            <input class="site-toggle-input" name="isEnabled" type="checkbox" ${data.isEnabled ? "checked" : ""} />
            <span class="site-toggle-track" aria-hidden="true"><span class="site-toggle-thumb"></span></span>
            <span class="site-toggle-copy">允许该折扣码按 Shopify 规则生效</span>
          </label>
        </div>
        <div class="agent-form-actions">
          <button class="btn btn-primary sm" type="submit" data-discount-code-save>保存折扣码</button>
          <button class="btn btn-ghost sm" type="button" data-discount-code-close>取消</button>
          <span class="hint" data-discount-code-save-tip>${escapeHtml(data.id || "只读取并登记 Shopify 折扣码，不会修改独立站优惠")}</span>
        </div>
      </form>
    </div>
  `;
}

export function shopifyDiscountSearchResultsHtml(items = []) {
  if (!items.length) return `<div class="discount-code-shopify-empty">没有找到匹配的 Shopify 折扣码</div>`;
  return items.map((item) => `
    <button type="button" role="option" aria-selected="false" class="discount-code-shopify-option" data-discount-code-shopify-option="${escapeAttr(item.code)}">
      <span>
        <b>${escapeHtml(item.code)}</b>
        <small>${escapeHtml(discountSearchResultMeta(item))}</small>
      </span>
      <em class="${shopifyStatusClass(item.shopifyStatus)}">${escapeHtml(shopifyStatusLabel(item.shopifyStatus))}</em>
    </button>
  `).join("");
}

export function shopifyDiscountRulePreviewHtml(item = {}) {
  if (!item?.code) {
    return `<div class="discount-code-rule-empty">从搜索结果中选择折扣码后，这里会显示 Shopify 的真实优惠规则。</div>`;
  }
  if (!item.shopifyDiscountId) {
    return `<div class="discount-code-rule-empty">这是一条旧登记。请重新搜索并选择该 Shopify 折扣码，保存时会同步真实规则。</div>`;
  }
  const rule = item.shopifyRule && typeof item.shopifyRule === "object" ? item.shopifyRule : item.rule || {};
  return `
    <div class="discount-code-rule-head">
      <div><b>${escapeHtml(item.code)}</b><small>${escapeHtml(item.offerDescription || "-")}</small></div>
      <i class="${shopifyStatusClass(item.shopifyStatus)}">${escapeHtml(shopifyStatusLabel(item.shopifyStatus))}</i>
    </div>
    <div class="discount-code-rule-grid">
      <span><small>优惠类型</small><b>${escapeHtml(discountRuleValueLabel(item.shopifyDiscountType, rule))}</b></span>
      <span><small>使用门槛</small><b>${escapeHtml(minimumRequirementLabel(rule.minimumRequirement))}</b></span>
      <span><small>有效期</small><b>${escapeHtml(shopifyValidityLabel(item))}</b></span>
      <span><small>价格预览</small><b>${rule.pricePreviewEligible ? "支持预计折后价" : "结账页确认"}</b></span>
    </div>
  `;
}

export function creatorSelectHtml(value, siteId, creators = []) {
  const options = creators.filter((creator) => creator.siteId === siteId);
  return selectDropdownHtml({
    name: "creatorUid",
    value: options.some((creator) => creator.id === value) ? value : "",
    placeholder: options.length ? "请选择网红账号" : "当前站点暂无可用网红账号",
    items: options.map((creator) => [creator.id, creatorOptionLabel(creator)]),
    className: "agent-dd",
  });
}

function discountCodeRowHtml(item) {
  return `
    <div class="dt-row" data-discount-code-id="${escapeAttr(item.id)}">
      <span class="dt-cell name"><b class="code-chip">${escapeHtml(item.code)}</b><small>${escapeHtml(item.offerDescription || "-")}</small></span>
      <span>${ownerHtml(item)}</span>
      <span><b>${escapeHtml(item.siteName || item.siteId || "-")}</b><small>${escapeHtml(item.siteSlug ? `/${item.siteSlug}` : "")}</small></span>
      <span>${validityHtml(item)}</span>
      <span><i class="pill ${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</i></span>
      <span>${escapeHtml(formatDateTime(item.updatedAt))}</span>
      <span class="dt-act"><a data-discount-code-edit="${escapeAttr(item.id)}">编辑</a></span>
    </div>
  `;
}

function ownerHtml(item) {
  if (item.ownershipType !== "creator") return `<b>前台</b><small>站点专享</small>`;
  const account = item.creatorNickname || item.creatorEmail || item.creatorUid || "网红账号";
  const character = item.characterName || item.creatorEmail || "";
  return `<b>${escapeHtml(account)}</b><small>${escapeHtml(character)}</small>`;
}

function validityHtml(item) {
  if (item.validityMode !== "fixed") return `<b>无限期</b><small>未设置结束时间</small>`;
  return `<b>${escapeHtml(formatDateTime(item.startsAt))}</b><small>至 ${escapeHtml(formatDateTime(item.endsAt))}</small>`;
}

function statusLabel(status) {
  return { active: "生效中", scheduled: "未开始", expired: "已过期", disabled: "已停用" }[status] || "未知";
}

function statusClass(status) {
  if (status === "active") return "on";
  if (status === "scheduled") return "mid";
  return "off";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const timePart = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${datePart} ${timePart}`;
}

function fieldHtml(label, controlHtml) {
  return `<label class="agent-field"><span>${escapeHtml(label)}</span>${controlHtml}</label>`;
}

function choiceFieldHtml(label, name, value, items) {
  return `
    <fieldset class="agent-field discount-code-choice-field">
      <legend>${escapeHtml(label)}</legend>
      <div class="discount-code-choice">
        ${items.map(([optionValue, optionLabel]) => `
          <label><input type="radio" name="${escapeAttr(name)}" value="${escapeAttr(optionValue)}" ${value === optionValue ? "checked" : ""} /><span>${escapeHtml(optionLabel)}</span></label>
        `).join("")}
      </div>
    </fieldset>
  `;
}

function siteSelectHtml(value, sites) {
  return selectDropdownHtml({ name: "siteId", value, items: sites.map(siteOption), className: "agent-dd" });
}

function filterDropdown(name, value, placeholder, items) {
  return selectDropdownHtml({ name, value, placeholder, items, className: "agent-dd" });
}

function siteOption(site) {
  return [site.id, `${site.name} /${site.slug}`];
}

function shopifyDiscountPickerHtml(data = {}) {
  const matched = Boolean(data.shopifyDiscountId && data.code);
  return `
    <label class="agent-field discount-code-shopify-picker"><span>Shopify 折扣码</span>
      <input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="discountCodeShopifyResults" name="code" maxlength="64" value="${escapeAttr(data.code)}" placeholder="输入至少 2 个字符搜索" autocomplete="off" aria-label="Shopify 折扣码" data-discount-code-shopify-query required />
      <input type="hidden" value="${escapeAttr(matched ? data.code : "")}" data-discount-code-shopify-selected />
      <div class="discount-code-shopify-selected" data-discount-code-shopify-selected-label ${matched ? "" : "hidden"}>${escapeHtml(matched ? `${data.code} · 已匹配 Shopify` : "")}</div>
      <div class="discount-code-shopify-results" id="discountCodeShopifyResults" role="listbox" data-discount-code-shopify-results hidden></div>
    </label>
  `;
}

function discountSearchResultMeta(item = {}) {
  const rule = item.shopifyRule && typeof item.shopifyRule === "object" ? item.shopifyRule : item.rule || {};
  return [
    item.offerDescription || discountTypeLabel(item.shopifyDiscountType),
    discountRuleValueLabel(item.shopifyDiscountType, rule),
    shopifyValidityLabel(item),
  ].filter(Boolean).join(" · ");
}

function discountRuleValueLabel(type, rule = {}) {
  const value = Number(rule.value);
  if (type === "percentage" && Number.isFinite(value)) return `${value}%`;
  if (type === "fixed_amount" && Number.isFinite(value)) {
    return `${rule.currencyCode || ""} ${value}`.trim();
  }
  return discountTypeLabel(type);
}

function discountTypeLabel(type) {
  return {
    percentage: "百分比折扣",
    fixed_amount: "固定金额折扣",
    free_shipping: "免运费",
    bxgy: "买 X 送 Y",
    app: "App 折扣",
    unsupported: "复杂优惠",
  }[type] || "等待读取";
}

function minimumRequirementLabel(requirement) {
  if (!requirement || typeof requirement !== "object") return "无门槛";
  if (requirement.type === "subtotal") return `满 ${[requirement.currencyCode, requirement.value].filter(Boolean).join(" ")}`;
  if (requirement.type === "quantity") return `满 ${requirement.value} 件`;
  return "结账页确认";
}

function shopifyValidityLabel(item) {
  if (!item.endsAt) return item.startsAt ? `${formatDateTime(item.startsAt)} 起` : "无限期";
  return `${formatDateTime(item.startsAt)} 至 ${formatDateTime(item.endsAt)}`;
}

function shopifyStatusLabel(status) {
  return {
    ACTIVE: "生效中",
    SCHEDULED: "未开始",
    EXPIRED: "已过期",
  }[String(status || "").toUpperCase()] || "状态未知";
}

function shopifyStatusClass(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "ACTIVE") return "pill on";
  if (normalized === "SCHEDULED") return "pill mid";
  return "pill off";
}

function creatorOptionLabel(creator) {
  const account = creator.nickname || creator.email || creator.id;
  return creator.characterName ? `${account} / ${creator.characterName}` : account;
}

function emptyDiscountCode(siteId) {
  return {
    id: "",
    code: "",
    siteId,
    ownershipType: "site",
    creatorUid: "",
    offerDescription: "",
    validityMode: "indefinite",
    startsAt: "",
    endsAt: "",
    isEnabled: true,
    notes: "",
    shopifyDiscountType: "",
    shopifyStatus: "",
    shopifyRule: {},
  };
}
