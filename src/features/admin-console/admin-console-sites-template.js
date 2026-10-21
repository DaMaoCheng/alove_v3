import { ICONS } from "../../icons/icons.js";
import { escapeAttr, escapeHtml, formatNumber } from "./admin-console-utils.js";
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from "../../../shared/payment-methods.js";
import { languageDropdownHtml, resolveAdminLanguageState } from "./admin-character-editor-fields.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";

const PAYMENT_METHOD_MAP = new Map(PAYMENT_METHOD_OPTIONS.map((option) => [option.key, option]));

export function adminSitesHtml() {
  return `
    <div class="admin-body admin-sites-page">
      <div class="admin-actions">
        <div class="seg"><button class="active" type="button">全部站点</button></div>
        <button class="btn btn-primary sm" type="button" data-site-new>${ICONS.plus} 新增站点</button>
      </div>
      <div class="panel">
        <div class="data-table admin-sites-table" data-sites-table>
          ${adminSitesTableHtml({ loading: true })}
        </div>
      </div>
      <p class="admin-hint">站点路径用于后续形成网址后缀，例如 /global。用户绑定站点后，登录会回到自己的站点。</p>
    </div>
  `;
}

export function adminSitesTableHtml({ items = [], loading = false, error = "" } = {}) {
  if (loading) return `<div class="log-empty">正在加载站点...</div>`;
  if (error) return `<div class="log-empty">${escapeHtml(error)}</div>`;
  return `
    <div class="dt-head"><span>站点</span><span>路径</span><span>目标地区</span><span>用户数</span><span>前台</span><span>网红角色</span><span>默认站点</span><span></span></div>
    ${items.length ? items.map((site) => siteRowHtml(site)).join("") : `<div class="log-empty">暂无站点</div>`}
  `;
}

export function adminSiteEditorHtml(site = null, { regions = [], mascots = [] } = {}) {
  const item = site || {
    name: "",
    slug: "",
    siteUrl: "",
    logoUrl: "",
    defaultLanguage: "English",
    status: "active",
    isDefault: false,
    mascotCharacterId: "",
    mascotName: "",
    productApiUrl: "",
    productSourceType: "",
    productShopDomain: "",
    productApiVersion: "2026-04",
    productTtmallApiBaseUrl: "",
    productTtmallWebsiteId: "",
    hasProductAccessToken: false,
    shopifyLoginEnabled: true,
    paymentMethods: [],
    commerceEnabled: true,
    guestChatEnabled: false,
    description: "",
    regionIds: [],
    regions: [],
  };
  const languageState = resolveAdminLanguageState({ language: item.defaultLanguage });
  const isNew = !site?.id;
  return `
    <div class="dialog-scrim" data-site-close></div>
    <div class="dlg common-character-modal site-editor-modal" role="dialog" aria-modal="true" data-site-modal>
      <button class="dlg-x" type="button" aria-label="Close" data-site-close>${ICONS.close}</button>
      <div class="site-editor-head-row">
        <div class="dlg-body"><h3>${isNew ? "新增站点" : "编辑站点"}</h3><p>${isNew ? "创建一个新的独立站点分组" : escapeHtml(item.name)}</p></div>
        <div class="character-editor-meta site-editor-meta">
          <div class="character-editor-owner"><b>${escapeHtml(item.mascotName || "未设置前台")}</b><small>${escapeHtml(item.mascotCharacterId || "未绑定 ID")}</small></div>
          <span class="character-id-tag">${escapeHtml(item.id || "新站点")}</span>
        </div>
      </div>
        <form class="agent-form" data-site-form data-site-id="${escapeAttr(item.id || "")}">
          <div class="agent-form-grid">
            ${renderField("站点名称", `<input name="name" value="${escapeAttr(item.name)}" placeholder="AIOVE Global" required />`)}
            ${renderField("路径 slug", `<input name="slug" value="${escapeAttr(item.slug)}" placeholder="global" required />`)}
            ${renderField("网站链接", `<input name="siteUrl" value="${escapeAttr(item.siteUrl)}" placeholder="https://alove.fans/global" />`)}
            ${renderField("站点 Logo", `<input name="logoUrl" value="${escapeAttr(item.logoUrl)}" placeholder="https://example.com/logo.png" /><small class="agent-field-note">留空时自动读取网站 favicon</small>`)}
            ${renderField("默认语言", languageDropdownHtml({
              ...languageState,
              fieldName: "defaultLanguage",
              codeFieldName: "defaultLanguageCode",
            }))}
            <div class="agent-field" style="grid-column:1 / -1;"><span>目标地区</span>${siteRegionPickerHtml(item.regionIds || [], regions)}</div>
            ${siteMascotPickerHtml(item.mascotCharacterId, mascots)}
            ${guestChatToggleField(item.guestChatEnabled)}
            ${commerceToggleField(item.commerceEnabled)}
            ${productSourceFieldsHtml(item)}
            ${shopifyLoginToggleField(item.shopifyLoginEnabled)}
            <label class="agent-field" style="grid-column:1 / -1;"><span>说明</span><textarea name="description" rows="3" placeholder="站点用途、流量来源或运营备注">${escapeHtml(item.description)}</textarea></label>
          </div>
          <div class="agent-form-actions">
            <button class="btn btn-primary sm" type="submit" data-site-save>保存设置</button>
            <button class="btn btn-ghost sm" type="button" data-site-close>取消</button>
            <span class="hint" data-site-save-tip>${isNew ? "填写站点信息后保存" : `站点 ID：${escapeHtml(item.id)}`}</span>
          </div>
        </form>
    </div>
  `;
}

function productSourceFieldsHtml(item) {
  const sourceType = item.productSourceType
    || (String(item.productApiUrl || "").startsWith("shopify-admin://") ? "shopify_admin" : "")
    || (String(item.productApiUrl || "").startsWith("ttmall://") ? "ttmall" : "");
  const apiVersion = item.productApiVersion || "2026-04";
  return `
    <div class="site-product-source-fields">
      <span class="site-product-api-version" data-product-source-shopify ${sourceType !== "shopify_admin" ? "hidden" : ""}>API版本：${escapeHtml(apiVersion)}</span>
      <div class="site-product-source-grid">
        <div class="site-product-source-type">${renderField("商品源类型", `<select name="productSourceType" data-product-source-type><option value="">未配置</option><option value="shopify_admin" ${sourceType === "shopify_admin" ? "selected" : ""}>Shopify Admin API</option><option value="ttmall" ${sourceType === "ttmall" ? "selected" : ""}>TTMall</option></select>`)}</div>
        <div class="site-product-source-config-field" data-product-source-shopify ${sourceType !== "shopify_admin" ? "hidden" : ""}>${renderField("店铺域名", `<input name="productShopDomain" value="${escapeAttr(item.productShopDomain || shopifyDomainFromProductApi(item.productApiUrl))}" placeholder="例：fbed87-94.myshopify.com" />`)}</div>
        <div class="site-product-source-config-field" data-product-source-shopify ${sourceType !== "shopify_admin" ? "hidden" : ""}>${renderField("只读 Token", `<input name="productAccessToken" type="password" value="" autocomplete="new-password" placeholder="${item.hasProductAccessToken ? "已配置，留空则不修改" : "例：shpca_..."}" />`)}</div>
        <div class="site-product-source-config-field" data-product-source-ttmall ${sourceType !== "ttmall" ? "hidden" : ""}>${renderField("API Base URL", `<input name="productTtmallApiBaseUrl" value="${escapeAttr(item.productTtmallApiBaseUrl || "")}" placeholder="例：https://api.example.com" />`)}</div>
        <div class="site-product-source-config-field" data-product-source-ttmall ${sourceType !== "ttmall" ? "hidden" : ""}>${renderField("网站 ID", `<input name="productTtmallWebsiteId" inputmode="numeric" value="${escapeAttr(item.productTtmallWebsiteId || "")}" placeholder="例：4" />`)}</div>
      </div>
      ${paymentMethodsPickerHtml(item.paymentMethods || [])}
      <input name="productApiUrl" type="hidden" value="${escapeAttr(item.productApiUrl || "")}" />
      <input name="productApiVersion" type="hidden" value="${escapeAttr(apiVersion)}" />
    </div>
  `;
}

function paymentMethodsPickerHtml(value = []) {
  const selectedMethods = normalizePaymentMethods(value);
  const selected = new Set(selectedMethods);
  const selectedOptions = selectedMethods.map((key) => PAYMENT_METHOD_MAP.get(key)).filter(Boolean);
  const optionButtons = PAYMENT_METHOD_OPTIONS.map((option) => paymentMethodOptionHtml(option, selected.has(option.key))).join("");
  return `
    <div class="agent-field site-payment-method-field">
      <span>支付方式</span>
      <div class="site-payment-method-picker" data-site-payment-picker>
        <input type="hidden" name="paymentMethods" value="${escapeAttr(Array.from(selected).join(","))}" data-site-payment-value />
        <input type="hidden" name="paymentMethodsTouched" value="0" data-site-payment-touched />
        <div class="site-payment-method-trigger" role="button" tabindex="0" data-site-payment-trigger aria-expanded="false">
          <span class="site-payment-method-tags" data-site-payment-tags>${selectedOptions.length ? selectedOptions.map(paymentMethodTagHtml).join("") : `<span class="muted">未配置，产品详情不展示支付方式</span>`}</span>
          <span class="site-payment-method-caret" aria-hidden="true">${ICONS.chevron}</span>
        </div>
        <div class="site-payment-method-menu" data-site-payment-menu hidden>
          <div class="site-region-search">${ICONS.search}<input type="search" placeholder="搜索支付方式，例如 Visa、PayPal、Klarna" data-site-payment-search /></div>
          <div class="site-payment-method-options" data-site-payment-options>${optionButtons}</div>
        </div>
      </div>
    </div>
  `;
}

function paymentMethodTagHtml(option = {}) {
  return `<button type="button" data-site-payment-remove="${escapeAttr(option.key)}"><img src="${escapeAttr(option.icon)}" alt="" /><span>${escapeHtml(option.label)}</span><i>×</i></button>`;
}

function paymentMethodOptionHtml(option = {}, active = false) {
  return `<button class="site-payment-method-option ${active ? "is-active" : ""}" type="button" data-site-payment-option="${escapeAttr(option.key)}" data-search="${escapeAttr(`${option.key} ${option.label}`.toLowerCase())}"><img src="${escapeAttr(option.icon)}" alt="" /><span>${escapeHtml(option.label)}</span><small>${active ? "已选" : ""}</small></button>`;
}

function siteRowHtml(site) {
  return `
    <div class="dt-row" data-site-id="${escapeAttr(site.id)}">
      <span class="dt-cell name">${site.siteUrl ? `<a class="site-name-link" href="${escapeAttr(site.siteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.name)}</a>` : escapeHtml(site.name)}${site.isDefault ? ' <i class="pill mid">默认</i>' : ""}</span>
      <span><code>/${escapeHtml(site.slug)}</code></span>
      <span>${siteRegionTagsHtml(site.regions || [])}</span>
      <span>${formatNumber(site.userCount)}</span>
      <span>${siteMascotCellHtml(site)}</span>
      <span>${formatNumber(site.creatorCount)}</span>
      <span>${site.isDefault ? "-" : `<button class="btn btn-ghost xs" type="button" data-site-default="${escapeAttr(site.id)}">设为默认</button>`}</span>
      <span class="dt-act"><a data-site-edit="${escapeAttr(site.id)}">编辑</a></span>
    </div>
  `;
}

function shopifyDomainFromProductApi(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "shopify-admin:" ? url.hostname : "";
  } catch {
    return "";
  }
}

function siteMascotCellHtml(site) {
  const mascotName = String(site.mascotName || "").trim();
  const mascotId = String(site.mascotCharacterId || "").trim();
  if (!mascotName && !mascotId) return `<span class="muted">未设置</span>`;
  return `<span class="site-mascot-cell"><b>${escapeHtml(mascotName || "未命名前台")}</b><small>${escapeHtml(mascotId || "未绑定 ID")}</small></span>`;
}

function renderField(label, control) {
  return `<label class="agent-field"><span>${escapeHtml(label)}</span>${control}</label>`;
}

function siteMascotPickerHtml(value = "", mascots = []) {
  const currentId = String(value || "").trim();
  const options = mascotPickerOptions(mascots, currentId);
  return `
    <label class="agent-field site-mascot-picker-field">
      <span>前台角色 ID</span>
      <div class="site-mascot-picker" data-site-mascot-picker>
        <div class="site-mascot-input-wrap">
          <input name="mascotCharacterId" type="search" value="${escapeAttr(currentId)}" placeholder="输入角色 ID 筛选或从下拉选择" autocomplete="off" data-site-mascot-input aria-autocomplete="list" aria-expanded="false" />
          <button class="site-mascot-trigger" type="button" data-site-mascot-trigger aria-label="展开前台角色列表" aria-expanded="false">${ICONS.chevron}</button>
        </div>
        <div class="site-mascot-menu" data-site-mascot-menu hidden>
          <div class="site-mascot-options" data-site-mascot-options>
            ${options.map((mascot) => `<button class="site-mascot-option ${mascot.id === currentId ? "is-active" : ""}" type="button" data-site-mascot-option="${escapeAttr(mascot.id)}" data-search="${escapeAttr(`${mascot.id} ${mascot.name}`.toLowerCase())}">${characterAvatarHtml({ name: mascot.name || mascot.id, imageUrl: mascot.avatarUrl, className: "site-mascot-option-avatar" })}<span class="site-mascot-option-copy"><b>${escapeHtml(mascot.name || "未命名前台")}</b><small>${escapeHtml(mascot.id)}</small></span></button>`).join("")}
          </div>
          <div class="site-mascot-empty" data-site-mascot-empty hidden>未找到匹配前台，可直接保留输入的角色 ID。</div>
        </div>
      </div>
      <small class="agent-field-note">可输入已知角色 ID；下拉只展示现有前台角色。</small>
    </label>
  `;
}

function mascotPickerOptions(mascots = [], currentId = "") {
  const byId = new Map();
  [...(Array.isArray(mascots) ? mascots : []), { id: currentId, name: "当前绑定" }].forEach((item) => {
    const id = String(item?.id || "").trim();
    if (!id || byId.has(id)) return;
    byId.set(id, { id, name: String(item?.name || "").trim(), avatarUrl: String(item?.avatarUrl || "").trim() });
  });
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id));
}

function guestChatToggleField(enabled = false) {
  return `
    <div class="agent-field site-toggle-field">
      <span>游客聊天</span>
      <label class="site-toggle-row">
        <input class="site-toggle-input" name="guestChatEnabled" type="checkbox" ${enabled ? "checked" : ""} />
        <span class="site-toggle-track" aria-hidden="true"><span class="site-toggle-thumb"></span></span>
        <span class="site-toggle-copy">允许未登录访客使用本站前台聊天</span>
        <button class="btn btn-ghost sm site-guest-link-copy" type="button" data-site-guest-link-copy ${enabled ? "" : "disabled"}>复制游客链接</button>
      </label>
    </div>
  `;
}

function shopifyLoginToggleField(enabled = true) {
  return `
    <div class="agent-field site-toggle-field">
      <span>站点授权登录</span>
      <label class="site-toggle-row">
        <input class="site-toggle-input" name="shopifyLoginEnabled" type="checkbox" ${enabled ? "checked" : ""} />
        <span class="site-toggle-track" aria-hidden="true"><span class="site-toggle-thumb"></span></span>
        <span class="site-toggle-copy">在登录页显示本站 Shopify 授权登录按钮</span>
      </label>
    </div>
  `;
}

function commerceToggleField(enabled = true) {
  return `
    <div class="agent-field site-toggle-field">
      <span>在线购买</span>
      <label class="site-toggle-row">
        <input class="site-toggle-input" name="commerceEnabled" type="checkbox" ${enabled !== false ? "checked" : ""} />
        <span class="site-toggle-track" aria-hidden="true"><span class="site-toggle-thumb"></span></span>
        <span class="site-toggle-copy">允许在 ALOVE 内加购并进入结算</span>
      </label>
    </div>
  `;
}

function siteRegionPickerHtml(selectedIds = [], regions = []) {
  const selected = new Set((selectedIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const selectedRegions = regions.filter((region) => selected.has(region.id));
  const options = regions.map((region) => {
    const active = selected.has(region.id);
    return `<button class="site-region-option ${active ? "is-active" : ""}" type="button" data-site-region-option="${escapeAttr(region.id)}" data-search="${escapeAttr(regionSearchText(region))}"><span>${escapeHtml(regionPathLabel(region, regions))}</span><small>${escapeHtml(region.code || "")}</small></button>`;
  }).join("");
  return `
    <div class="site-region-picker" data-site-region-picker>
      <input type="hidden" name="regionIds" value="${escapeAttr(Array.from(selected).join(","))}" data-site-region-value />
      <div class="site-region-trigger" role="button" tabindex="0" data-site-region-trigger aria-expanded="false">
        <span class="site-region-tags" data-site-region-tags>${selectedRegions.length ? selectedRegions.map((region) => regionTagHtml(region, regions)).join("") : `<span class="muted">未指定，使用默认站点兜底</span>`}</span>
        <span class="site-region-caret" aria-hidden="true">${ICONS.chevron}</span>
      </div>
      <div class="site-region-menu" data-site-region-menu hidden>
        <div class="site-region-search">${ICONS.search}<input type="search" placeholder="搜索中文 / 英文 / 代码，例如 英国、UK、北京" data-site-region-search /></div>
        <div class="site-region-options" data-site-region-options>${options || `<div class="log-empty">暂无地区数据</div>`}</div>
      </div>
    </div>
  `;
}

function siteRegionTagsHtml(regions = []) {
  if (!regions.length) return `<span class="muted">未指定</span>`;
  return `<span class="site-region-table-tags">${regions.slice(0, 3).map((region) => `<i>${escapeHtml(regionLabel(region))}</i>`).join("")}${regions.length > 3 ? `<i>+${regions.length - 3}</i>` : ""}</span>`;
}

function regionTagHtml(region, regions) {
  return `<button type="button" data-site-region-remove="${escapeAttr(region.id)}">${escapeHtml(regionPathLabel(region, regions))}<span>×</span></button>`;
}

function regionPathLabel(region, regions = []) {
  const chain = [];
  let current = region;
  const byId = new Map(regions.map((item) => [item.id, item]));
  while (current?.id) {
    chain.unshift(regionLabel(current));
    current = byId.get(current.parentId);
  }
  return chain.join(" / ") || regionLabel(region);
}

function regionLabel(region = {}) {
  return region.nameZh || region.nameEn || region.code || region.id || "-";
}

function regionSearchText(region = {}) {
  return [region.id, region.code, region.nameZh, region.nameEn, ...(region.aliases || [])].join(" ").toLowerCase();
}
