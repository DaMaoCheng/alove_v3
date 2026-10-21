import { ICONS } from "../../icons/icons.js";
import { AVATAR_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { characterAvatarHtml, normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { characterKnowledgeTagsHtml } from "./admin-character-knowledge-display.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function adminMascotHtml({ template = null, sites = [], unboundMascots = [], knowledgeBases = [], loading = true, error = "" } = {}) {
  return `
    <div class="admin-body">
      ${adminMascotBodyHtml({ template, sites, unboundMascots, knowledgeBases, loading, error })}
    </div>
  `;
}

export function adminMascotBodyHtml({ template = null, sites = [], unboundMascots = [], knowledgeBases = [], loading = true, error = "" } = {}) {
  const activeTemplate = template || createFallbackTemplate();
  const siteRows = loading
    ? `<div class="log-empty">正在加载前台设置...</div>`
    : error
      ? `<div class="log-empty">${escapeHtml(error)}</div>`
      : createMascotRowsHtml(sites, unboundMascots, knowledgeBases);
  return `
      <p class="admin-hint">底层一个<b>通用模板</b>，每个站可在模板基础上细分本站的<b>形象</b>；知识库绑定统一在知识库页面管理。商品库 API 从站点管理读取，广告投放按绑定站点触达。</p>

      <div class="panel mtpl-panel">
        <div class="mtpl-h">
          <div><h3>通用模板</h3><p class="mtpl-sub">所有站点的默认底版，各站可在此基础上覆盖。</p></div>
          <button class="btn btn-ghost sm" type="button" data-mascot-edit-template>编辑模板</button>
        </div>
        <div class="mtpl-grid">
          ${mascotIdentityHtml(activeTemplate)}
          ${mascotFieldHtml("问候语", activeTemplate.greeting)}
          ${mascotKnowledgeHtml(activeTemplate, "span2", knowledgeBases)}
        </div>
      </div>

      <div class="msec-h msec-h-row"><span>各站细分</span><button class="btn btn-primary sm" type="button" data-mascot-new>${ICONS.plus} 新建前台</button></div>
      <div class="panel">
        <div class="data-table admin-mascot-table">
          <div class="dt-head"><span class="mascot-name-col">前台</span><span class="mascot-site-col">绑定站点</span><span class="mascot-language-col">默认语言</span><span class="mascot-kb-col">知识库</span><span class="mascot-api-col">商品库 API</span><span class="mascot-number-col">可触达用户</span><span class="mascot-number-col">已发广告</span><span class="mascot-action-col"></span></div>
          ${siteRows}
        </div>
      </div>
  `;
}

function createMascotRowsHtml(sites, unboundMascots, knowledgeBases) {
  const overrideSites = sites.filter((site) => site.mascot?.source !== "通用模板");
  const rows = [
    ...overrideSites.map((site) => mascotSiteRowHtml(site, knowledgeBases)),
    ...unboundMascots.map((mascot) => unboundMascotRowHtml(mascot, knowledgeBases)),
  ];
  return rows.length ? rows.join("") : `<div class="log-empty">暂无前台配置</div>`;
}

function mascotSiteRowHtml(site, knowledgeBases) {
  const mascot = site.mascot || createFallbackTemplate();
  const usesOverride = mascot.source !== "通用模板";
  const disableButton = usesOverride
    ? `<a class="danger" data-mascot-disable="${escapeAttr(site.id)}">停用</a>`
    : "";
  const apiState = site.productApiUrl
    ? `<i class="pill on">已连接</i>`
    : `<i class="pill off">未配置</i>`;
  return `
    <div class="dt-row" data-site-id="${escapeAttr(site.id)}">
      <span class="dt-cell name mascot-name-col">${mascotAvatarHtml(mascot)}<span class="mascot-table-name"><b title="${escapeAttr(mascot.name || "-")}">${escapeHtml(mascot.name || "-")}</b></span></span>
      <span class="mascot-site-col"><b title="${escapeAttr(site.name)}">${escapeHtml(site.name)}</b><small class="mono" title="/${escapeAttr(site.slug)}">/${escapeHtml(site.slug)}</small></span>
      <span class="mascot-language-col">${escapeHtml(site.defaultLanguage || "-")}</span>
      <span class="mascot-kb-col">${characterKnowledgeTagsHtml({ character: { ...mascot, siteId: site.id }, knowledgeBases })}</span>
      <span class="mascot-api-col">${apiState}</span>
      <span class="mascot-number-col">${Number(site.userCount || 0).toLocaleString("zh-CN")}</span>
      <span class="mascot-number-col" data-mascot-sent-ad-count>${Number(site.sentAdCount || 0).toLocaleString("zh-CN")}</span>
      <span class="dt-act mascot-action-col"><a data-mascot-edit-site="${escapeAttr(site.id)}">编辑</a><a data-mascot-ad="${escapeAttr(site.id)}">发广告</a>${disableButton}</span>
    </div>
  `;
}

function unboundMascotRowHtml(mascot, knowledgeBases) {
  return `
    <div class="dt-row" data-mascot-id="${escapeAttr(mascot.id)}">
      <span class="dt-cell name mascot-name-col">${mascotAvatarHtml(mascot)}<span class="mascot-table-name"><b title="${escapeAttr(mascot.name || "-")}">${escapeHtml(mascot.name || "-")}</b><small>未绑定</small></span></span>
      <span class="mascot-site-col"><b>未绑定站点</b><small class="mono">-</small></span>
      <span class="mascot-language-col">-</span>
      <span class="mascot-kb-col">${characterKnowledgeTagsHtml({ character: mascot, knowledgeBases })}</span>
      <span class="mascot-api-col"><i class="pill off">未配置</i></span>
      <span class="mascot-number-col">-</span>
      <span class="mascot-number-col">-</span>
      <span class="dt-act mascot-action-col"><a data-mascot-edit-unbound="${escapeAttr(mascot.id)}">编辑</a></span>
    </div>
  `;
}

function mascotAvatarHtml(mascot) {
  const avatarUrl = normalizeAssetUrl(mascot.avatarUrl);
  if (avatarUrl) return `<img src="${escapeHtml(avatarUrl)}" alt="" />`; 
  return `<span class="letter-avatar">${escapeHtml(String(mascot.name || "K").slice(0, 1).toUpperCase())}</span>`;
}

function mascotIdentityHtml(mascot) {
  const avatarUrl = normalizeAssetUrl(mascot.avatarUrl);
  const avatar = avatarUrl
    ? `<img class="mas-av" src="${escapeHtml(avatarUrl)}" alt="" />`
    : `<span class="mas-av letter">${escapeHtml(String(mascot.name || "K").slice(0, 1).toUpperCase())}</span>`;
  return `
    <div class="mas-row">
      ${avatar}
      <div class="mas-meta"><div class="mas-name">${escapeHtml(mascot.name)}</div></div>
    </div>
  `;
}

function mascotFieldHtml(label, value) {
  return `<div class="mas-field"><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`;
}

function mascotKnowledgeHtml(mascot = {}, extraClass = "", knowledgeBases = []) {
  const content = characterKnowledgeTagsHtml({ character: mascot, knowledgeBases });
  return `<div class="mas-field ${extraClass}"><span>知识库</span><div class="kb-tags">${content}</div></div>`;
}

function createFallbackTemplate() {
  return {
    id: "mascot_template",
    name: "Kit",
    avatarUrl: "/assets/char_coach.png",
    tone: "友好、热情、热爱足球",
    greeting: "Hey! I am Kit, your personal football guide. Ready to explore?",
    cta: "Check out our jersey drops!",
    knowledge: [],
    source: "通用模板",
  };
}

export function mascotEditorModalHtml({ mascot = {}, site = null, mode = "template", sites = [], knowledgeBases = [] } = {}) {
  const isTemplate = mode === "template";
  const isNewSiteMascot = mode === "site-new";
  const isUnbound = mode === "unbound";
  const title = isTemplate ? "编辑通用模板" : isNewSiteMascot ? "新建前台" : isUnbound ? "编辑未绑定前台" : `编辑${site?.name ? ` ${site.name}` : "站点"}前台`;
  const characterId = isNewSiteMascot ? "" : mascot.id || (isTemplate ? "mascot_template" : site?.mascotCharacterId || "");
  const characterIdTag = isNewSiteMascot ? "" : `<div class="character-editor-meta site-editor-meta"><span class="character-id-tag">${escapeHtml(characterId)}</span></div>`;
  const siteValue = isNewSiteMascot ? "" : site?.id || "";
  const avatarPlaceholder = isNewSiteMascot ? "image" : "";
  const displayMascot = { ...mascot, id: characterId, siteId: siteValue };
  return `
    <div class="dialog-scrim" data-mascot-close></div>
    <div class="dlg common-character-modal mascot-editor-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-mascot-close>${ICONS.close}</button>
      <div class="site-editor-head-row">
        <div class="dlg-body"><h3>${escapeHtml(title)}</h3><p>${isTemplate ? "修改所有站点默认继承的前台底版" : "修改当前站点专属前台配置"}</p></div>
        ${characterIdTag}
      </div>
      <form class="agent-form" data-mascot-form data-mascot-mode="${escapeAttr(mode)}" data-mascot-site="${escapeAttr(siteValue)}" data-mascot-initial-persona="${escapeAttr(mascot.personaPrompt || "")}" data-mascot-initial-speaking-style="${escapeAttr(mascot.speakingStyle || "")}">
        <div class="character-editor-head-row mascot-editor-head-row">
          <div class="agent-avatar-preview" data-character-avatar-preview${avatarPlaceholder ? ` data-character-avatar-placeholder="${escapeAttr(avatarPlaceholder)}"` : ""}>${characterAvatarHtml({ name: mascot.name, imageUrl: mascot.avatarUrl, placeholder: avatarPlaceholder })}</div>
          <div class="character-avatar-actions">
            <button class="btn btn-ghost sm" type="button" data-character-avatar-upload>上传头像</button>
            <button class="btn btn-ghost sm cf-aigen" type="button" data-mascot-avatar-generate>${ICONS.spark} AI 生成</button>
            <button class="btn btn-ghost sm character-avatar-remove" type="button" data-character-avatar-remove>删除头像</button>
            <input type="file" accept="${escapeAttr(AVATAR_UPLOAD_POLICY.accept)}" hidden data-character-avatar-file />
            <input type="hidden" name="avatarUrl" value="${escapeAttr(mascot.avatarUrl || "")}" data-character-avatar-value />
          </div>
        </div>
        <div class="agent-form-grid">
          <input type="hidden" name="characterId" value="${escapeAttr(characterId)}" />
          ${renderMascotField("名称", `<input name="name" maxlength="96" value="${escapeAttr(mascot.name || "")}" required />`)}
          ${isTemplate ? "" : renderMascotField("绑定站点", siteSelectHtml(siteValue, sites))}
        </div>
        ${renderMascotField("人设", `<textarea name="personaPrompt" rows="10">${escapeHtml(mascot.personaPrompt || "")}</textarea>`)}
        ${renderMascotField("语气", `<textarea name="speakingStyle" rows="4">${escapeHtml(mascot.speakingStyle || "")}</textarea>`)}
        ${renderMascotField("问候语", `<textarea name="greeting" rows="3" maxlength="512">${escapeHtml(mascot.greeting || "")}</textarea>`)}
        ${mascotGreetingGalleryHtml(characterId)}
        ${renderMascotField("知识库", knowledgeReadonlyHtml({
          character: displayMascot,
          knowledgeBases,
        }))}
        <div class="account-form-error" data-character-editor-error hidden></div>
        <div class="agent-form-actions">
          <button class="btn btn-primary sm" type="submit" data-mascot-save>保存设置</button>
          <button class="btn btn-ghost sm" type="button" data-mascot-close>取消</button>
          <span class="hint" data-mascot-save-tip>保存后会立即更新前台页面。</span>
        </div>
      </form>
    </div>
  `;
}

function mascotGreetingGalleryHtml(characterId = "") {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) {
    return `<div class="agent-field mascot-greeting-gallery-field"><span>问候素材库</span><p class="mascot-greeting-gallery-note">请先保存这个前台，再上传 4 张问候图片和 1 个问候视频。</p></div>`;
  }
  return `
    <section class="agent-field mascot-greeting-gallery-field" data-mascot-greeting-gallery data-mascot-character-id="${escapeAttr(normalizedId)}">
      <span>问候素材库</span>
      <div class="mascot-greeting-gallery-grid" data-mascot-greeting-gallery-items aria-live="polite">
        ${Array.from({ length: 5 }, () => `<div class="mascot-greeting-gallery-card is-loading"><span>正在读取...</span></div>`).join("")}
      </div>
    </section>
  `;
}

export function mascotAdModalHtml(site = {}, { campaigns = [], loading = false } = {}) {
  const reachableUserCount = Number.isFinite(Number(site.userCount))
    ? Math.max(0, Math.trunc(Number(site.userCount)))
    : 0;
  const campaignItems = [["", loading ? "正在加载广告活动..." : campaigns.length ? "请选择广告活动" : "当前没有可发送的广告活动"], ...campaigns.map((campaign) => [
    campaign.id,
    `${campaign.title}${formatCampaignEndLabel(campaign.endsAt)}`,
  ])];
  return `
    <div class="dialog-scrim" data-mascot-close></div>
    <div class="dlg account-form-modal mascot-ad-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-mascot-close>${ICONS.close}</button>
      <div class="dlg-body mascot-ad-heading"><h3>发送广告</h3><span class="mascot-ad-heading-meta">${escapeHtml(site.name || "站点")} / ${reachableUserCount.toLocaleString("zh-CN")} 人</span></div>
      <form class="agent-form mascot-ad-preview-form" data-mascot-ad-form data-mascot-site="${escapeAttr(site.id || "")}" data-mascot-ad-state="ready">
        ${renderMascotField("选择广告活动", selectDropdownHtml({
          name: "campaignId",
          value: "",
          items: campaignItems,
          placeholder: "请选择广告活动",
          className: "agent-dd mascot-ad-campaign-dd",
        }))}
        <div class="agent-form-actions mascot-ad-actions">
          <button class="btn btn-primary sm" type="submit" data-mascot-ad-send disabled>发送</button>
          <button class="btn btn-ghost sm" type="button" data-mascot-close data-mascot-ad-close>取消</button>
          <span class="mascot-ad-progress" data-mascot-ad-progress role="status" aria-live="polite" hidden>0 / 0</span>
          <span class="mascot-ad-result" data-mascot-ad-result role="status" aria-live="polite" hidden><span class="is-success">成功 <b data-mascot-ad-success>0</b></span><span class="is-failed">失败 <b data-mascot-ad-failed>0</b></span><span class="mascot-ad-failure-help" data-mascot-ad-failure-help hidden><button type="button" aria-label="查看失败原因" aria-describedby="mascotAdFailureTooltip">?</button><span class="mascot-ad-failure-tooltip" id="mascotAdFailureTooltip" data-mascot-ad-failure-tooltip role="tooltip"></span></span></span>
        </div>
      </form>
    </div>
  `;
}

function formatCampaignEndLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `（${date.getUTCMonth() + 1}月${date.getUTCDate()}日结束）`;
}

function renderMascotField(label, control) {
  return `<label class="agent-field"><span>${escapeHtml(label)}</span>${control}</label>`;
}

function normalizeIdList(values = []) {
  return Array.from(new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function knowledgeReadonlyHtml({ character = {}, knowledgeBases = [] } = {}) {
  return `
    <input type="hidden" name="knowledgeText" value="${escapeAttr(normalizeIdList(character.knowledge || []).join("\n"))}" />
    <div class="mascot-kb-readonly">
      ${characterKnowledgeTagsHtml({ character, knowledgeBases })}
    </div>
    <p class="knowledge-readonly-hint">绑定/解绑请到知识库页面修改。</p>
  `;
}

function siteSelectHtml(siteId, sites = []) {
  return selectDropdownHtml({
    name: "siteId",
    value: siteId,
    placeholder: "不绑定站点",
    items: [["", "不绑定站点"], ...sites.map((item) => [item.id, `${item.name} /${item.slug}`])],
    className: "agent-dd mascot-site-dd",
  });
}

function knowledgeSelectHtml(selected = [], knowledgeBases = []) {
  const validIds = new Set(knowledgeBases.map((item) => String(item.id)));
  const selectedSet = new Set((selected || []).map(String).filter((id) => validIds.has(id)));
  const options = knowledgeBases.map((item) => {
    const checked = selectedSet.has(String(item.id));
    return `<button class="dd-item ${checked ? "is-active" : ""}" type="button" role="menuitem" data-mascot-kb-option="${escapeAttr(item.id)}"><span class="dd-label">${escapeHtml(item.label || item.id)}</span>${checked ? `<span class="dd-check">${ICONS.check || ""}</span>` : ""}</button>`;
  }).join("");
  const selectedLabels = knowledgeBases.filter((item) => selectedSet.has(String(item.id))).map((item) => item.label || item.id);
  const selectedContent = selectedLabels.length
    ? `<span class="mascot-kb-current-tags">${selectedLabels.map((label) => `<i class="kb-tag">${escapeHtml(label)}</i>`).join("")}</span>`
    : `<span class="muted-dash">-</span>`;
  return `
    <div class="dd dd-select mascot-kb-select" data-mascot-kb-select>
      <input type="hidden" name="knowledgeText" value="${escapeAttr(Array.from(selectedSet).join("\n"))}" data-mascot-kb-value />
      <button class="dd-trigger dd-select-trigger" type="button" data-mascot-kb-trigger>
        <span data-mascot-kb-current>${selectedContent}</span>${ICONS.chevron || ""}
      </button>
      <div class="dd-menu dd-left" role="menu">${options || `<div class="dd-item muted">暂无知识库</div>`}</div>
    </div>
  `;
}
