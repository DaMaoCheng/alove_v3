import { CAROUSEL_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { ICONS } from "../../icons/icons.js";
import { characterAvatarHtml, normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function adminCarouselHtml() {
  return `
    <div class="admin-body">
      <div class="admin-actions">
        <button class="btn btn-primary sm" type="button" data-carousel-new>${ICONS.plus} 新增轮播图</button>
        <span class="hint">用排序数字控制展示顺序，数字越小越靠前。</span>
      </div>
      <div class="panel">
        <div class="data-table admin-carousel-table" data-carousel-list>
          <div class="log-empty">正在加载轮播图...</div>
        </div>
      </div>
      <div data-carousel-modal-host></div>
    </div>
  `;
}

export function adminCarouselListHtml(items = []) {
  if (!items.length) {
    return `<div class="log-empty">暂无轮播图</div>`;
  }

  const rows = items.map((item) => {
    const statusClass = item.status === "published" ? "on" : item.status === "archived" ? "off" : "mid";
    const imageUrl = normalizeAssetUrl(item.imageUrl || "/assets/banner_hero.png");
    const targetLabel = resolveCtaLabel(item);
    return `
      <div class="dt-row carousel-row" data-carousel-id="${escapeAttr(item.id)}">
        <span class="dt-cell carousel-table-title"><span class="carousel-table-media"><img class="carousel-table-thumb" src="${escapeAttr(imageUrl)}" alt="" /></span><span><b>${escapeHtml(item.title || "未命名轮播")}</b><small>${escapeHtml(item.subtitle || item.eyebrow || "-")}</small></span></span>
        <span>${siteCellHtml(item)}</span>
        <span class="carousel-table-target" title="${escapeAttr(targetLabel)}">${escapeHtml(targetLabel)}</span>
        <span>${escapeHtml(item.displayOrder || 0)}</span>
        <span><i class="pill ${statusClass}">${escapeHtml(resolveCarouselStatusLabel(item.status))}</i></span>
        <span class="dt-act"><a data-carousel-edit="${escapeAttr(item.id)}">编辑</a></span>
      </div>
    `;
  }).join("");

  return `
    <div class="dt-head"><span>轮播图</span><span>绑定站点</span><span>点击目标</span><span>排序</span><span>状态</span><span></span></div>
    ${rows}
  `;
}

export function adminCarouselEditorModalHtml(item, { sites = [], characters = [] } = {}) {
  const isCreate = !item?.id;
  return `
    <div class="dialog-scrim" data-carousel-editor-close></div>
    <div class="dlg common-character-modal carousel-editor-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-carousel-editor-close>${ICONS.close}</button>
      <div class="dlg-body"><h3>${isCreate ? "新增轮播图" : "编辑轮播图"}</h3><p>${isCreate ? "创建新的首页轮播图" : escapeHtml(item.title || "未命名轮播")}</p></div>
      ${adminCarouselEditorHtml(item, { sites, characters })}
    </div>
  `;
}

export function adminCarouselEditorHtml(item, { sites = [], characters = [] } = {}) {
  const data = item || createEmptyCarouselItem();
  const imageUrl = normalizeAssetUrl(data.imageUrl || "");
  const previewClass = imageUrl ? "carousel-image-preview" : "carousel-image-preview is-empty";
  const previewImage = imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="" data-carousel-image-preview />` : `${ICONS.image || ""}<img src="" alt="" data-carousel-image-preview hidden />`;
  return `
    <form class="carousel-form agent-form" data-carousel-form>
      <div class="agent-field carousel-image-field">
        <span>轮播图片</span>
        <div class="carousel-image-uploader">
          <div class="${previewClass}">${previewImage}</div>
          <div class="carousel-image-actions">
            <button class="btn btn-ghost sm" type="button" data-carousel-image-upload>${ICONS.image || ICONS.cam} 上传图片</button>
            <small>选择后会进入 16:9 裁剪，点击保存时上传。</small>
          </div>
        </div>
        <input name="imageUrl" type="hidden" value="${escapeAttr(imageUrl)}" data-carousel-image-url required />
        <input name="pendingImagePreview" type="hidden" value="" data-carousel-pending-blob />
        <input name="pendingImageName" type="hidden" value="" data-carousel-pending-name />
        <input data-carousel-image-file type="file" accept="${CAROUSEL_UPLOAD_POLICY.accept}" hidden />
      </div>
      <div class="agent-form-grid">
        ${renderField("标题", `<input name="title" maxlength="128" value="${escapeAttr(data.title || "")}" required />`)}
        ${renderField("小标签", `<input name="eyebrow" maxlength="64" value="${escapeAttr(data.eyebrow || "")}" />`)}
      </div>
      ${renderField("绑定站点", renderSiteDropdown(data.siteId || "", sites))}
      ${renderField("描述", `<textarea name="subtitle" rows="3" maxlength="500">${escapeHtml(data.subtitle || "")}</textarea>`)}
      <div class="agent-form-grid">
        ${renderField("按钮文字", `<input name="ctaText" maxlength="64" value="${escapeAttr(data.ctaText || "")}" />`)}
        ${renderField("点击类型", renderSelectDropdown("ctaType", data.ctaType || "none", [
          ["none", "无按钮"],
          ["character", "进入角色聊天"],
          ["url", "打开链接"],
        ]))}
      </div>
      ${renderField("点击目标", renderCtaTargetControl(data, { sites, characters }))}
      <div class="agent-form-grid">
        ${renderField("排序", `<input name="displayOrder" type="number" min="0" max="9999" value="${escapeAttr(data.displayOrder || 100)}" />`)}
        ${renderField("状态", renderSelectDropdown("status", data.status || "draft", [
          ["draft", "草稿"],
          ["published", "已上架"],
          ["archived", "已下架"],
        ]))}
      </div>
      <div class="agent-form-actions">
        <button class="btn btn-primary sm" type="submit" data-carousel-save>${ICONS.spark} 保存轮播</button>
        <span class="hint" data-carousel-save-tip>保存后会影响首页轮播展示。</span>
      </div>
    </form>
  `;
}

function createEmptyCarouselItem() {
  return {
    id: "",
    title: "",
    subtitle: "",
    eyebrow: "",
    imageUrl: "",
    siteId: "",
    ctaText: "",
    ctaType: "none",
    ctaTarget: "",
    displayOrder: 100,
    status: "draft",
  };
}

function renderField(label, controlHtml) {
  return `<div class="agent-field"><span>${label}</span>${controlHtml}</div>`;
}

function renderSelectDropdown(name, value, items) {
  return selectDropdownHtml({
    name,
    value,
    items,
    className: "agent-dd",
  });
}

function renderSiteDropdown(value, sites = []) {
  return selectDropdownHtml({
    name: "siteId",
    value,
    placeholder: "全部站点",
    items: [["", "全部站点"], ...sites.map((site) => [site.id, `${site.name} /${site.slug}`])],
    className: "agent-dd",
  });
}

function renderCtaTargetControl(data, { sites = [], characters = [] } = {}) {
  const selectedTarget = String(data.ctaTarget || "").trim();
  const selectedCharacter = findCharacterById(characters, selectedTarget);
  const selectedLabel = selectedCharacter ? characterOptionLabel(selectedCharacter) : selectedTarget;
  const targetCharacters = characters.filter(isCarouselTargetCharacter);
  return `
    <input name="ctaTarget" type="hidden" maxlength="512" value="${escapeAttr(selectedTarget)}" data-carousel-cta-target />
    <div class="carousel-character-target" data-carousel-character-target>
      <div class="carousel-character-current" data-carousel-character-current>${selectedLabel ? characterChipHtml(selectedLabel) : `<span>未选择角色</span>`}</div>
      <input type="search" data-carousel-character-search placeholder="搜索前台或网红名称 / ID" autocomplete="off" />
      <div class="carousel-character-menu" data-carousel-character-menu>
        ${targetCharacters.map((character) => characterTargetOptionHtml(character, sites)).join("")}
      </div>
    </div>
    <input data-carousel-url-target maxlength="512" value="${escapeAttr(data.ctaType === "url" ? selectedTarget : "")}" placeholder="${escapeAttr(resolveCtaPlaceholder("url"))}" />
  `;
}

function characterTargetOptionHtml(character, sites = []) {
  const categoryId = character?.category?.id || "";
  const siteId = character?.siteId || "";
  const site = sites.find((item) => item.id === siteId);
  const kind = categoryId === "mascot" ? "前台" : "网红";
  return `
    <button class="carousel-character-option" type="button"
      data-carousel-character-option="${escapeAttr(character.id || "")}"
      data-name="${escapeAttr(character.name || "")}"
      data-site-id="${escapeAttr(siteId)}"
      data-category-id="${escapeAttr(categoryId)}"
      data-search="${escapeAttr(`${character.name || ""} ${character.id || ""} ${character.roleTitle || ""}`.toLowerCase())}">
      ${characterAvatarHtml({ name: character.name || character.id, imageUrl: character.avatarUrl, className: "carousel-character-avatar" })}
      <span class="carousel-character-option-text">
        <b>${escapeHtml(character.name || character.id || "未命名角色")}</b>
        <small>${escapeHtml(`${kind} · ${character.id || ""}${site ? ` · ${site.name}` : ""}`)}</small>
      </span>
    </button>
  `;
}

function isCarouselTargetCharacter(character) {
  const categoryId = character?.category?.id || "";
  return categoryId === "mascot" || categoryId === "creator";
}

function characterChipHtml(label) {
  return `<i>${escapeHtml(label)}</i>`;
}

function findCharacterById(characters = [], characterId = "") {
  const id = String(characterId || "").trim();
  return characters.find((character) => character.id === id) || null;
}

function characterOptionLabel(character) {
  return `${character.name || character.id || "未命名角色"} · ${character.id || ""}`;
}

function siteCellHtml(item) {
  if (!item.siteId) return `<span class="muted-dash">全部站点</span>`;
  return `<span class="carousel-site-cell"><b>${escapeHtml(item.siteName || item.siteId)}</b><small>${escapeHtml(item.siteSlug ? `/${item.siteSlug}` : item.siteId)}</small></span>`;
}

function resolveCarouselStatusLabel(status) {
  if (status === "published") return "已上架";
  if (status === "archived") return "已下架";
  return "草稿";
}

function resolveCtaLabel(item) {
  if (item.ctaType === "character") return `进入角色：${item.ctaTargetName || item.ctaTarget || "未设置角色"}`;
  if (item.ctaType === "url") return `打开链接：${item.ctaTarget || "未设置链接"}`;
  return "无按钮";
}

function resolveCtaPlaceholder(type) {
  if (type === "character") return "填写角色 ID，例如 striker";
  if (type === "url") return "填写完整链接，例如 https://example.com";
  return "无按钮时无需填写";
}
