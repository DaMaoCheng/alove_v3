import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";
import { externalEmbedRichTextEditorHtml, externalEmbedRichTextPopoverHtml, richTextHtml } from "./admin-external-embed-rich-text.js";

export function adminExternalEmbedsHtml() {
  return `
    <div class="admin-body admin-external-embeds-page" data-external-embeds-page>
      <div class="panel external-embed-loading" data-external-embed-host>正在读取站点配置...</div>
    </div>
  `;
}

export function adminExternalEmbedsEditorHtml({ items = [], selectedSiteId = "", previewMode = "desktop" } = {}) {
  const selected = items.find((item) => item.siteId === selectedSiteId) || items[0] || null;
  if (!selected) return `<div class="panel external-embed-empty">暂无可配置的 active 站点。</div>`;
  const config = selected.config;
  const published = config.status === "published";
  const snippet = published ? config.installerSnippet : "发布后将生成安装代码";
  return `
    <div class="admin-actions external-embed-actions">
      <label class="external-embed-site-select" data-external-embed-site><span>关联站点</span>${selectDropdownHtml({ name: "siteId", value: selected.siteId, placeholder: "选择站点", items: items.map((item) => [item.siteId, `${item.siteName} · /${item.siteSlug}`]), className: "agent-dd external-embed-site-dd" })}</label>
      <span class="pill ${published ? "on" : "mid"}">${published ? "已发布" : "草稿"}</span>
      <span class="hint external-embed-site-meta"><b>${escapeHtml(selected.mascotName || "未绑定前台")}</b> · ${selected.canPublish ? "游客聊天可用，可发布" : escapeHtml(selected.publishBlockReason)}</span>
    </div>
    <div class="external-embed-layout">
      <form class="panel agent-form external-embed-form" data-external-embed-form data-external-embed-site-id="${escapeAttr(selected.siteId)}">
        <div class="panel-head external-embed-form-head"><div><h3>站外挂件设置</h3><p>外站只读取已发布的安全展示配置。</p></div></div>
        <section class="external-embed-form-section">
          ${sectionHead("入口", "设置显示在外站右下角的图标与角标。")}
          <div class="agent-form-grid">
          ${field("外部站点 HTTPS 地址", `<input name="externalOrigin" value="${escapeAttr(config.externalOrigin)}" placeholder="https://www.bestsoccerstore.cc" required />`, "默认从站点管理的“网站链接”提取；可手动修改。只填写域名根地址；发布时会按 Origin 严格校验。")}
          ${field("对外状态", selectDropdownHtml({ name: "status", value: config.status, items: [["draft", "草稿（外站不可见）"], ["published", "发布（外站可见）"]], className: "agent-dd" }))}
          <div class="agent-field external-embed-avatar-field"><span>挂件图标</span><div class="external-embed-avatar-row"><div class="external-embed-avatar-preview" data-external-embed-avatar-preview>${avatarHtml(config.launcherImageUrl || selected.mascotAvatarUrl)}</div><div><input data-external-embed-avatar-file type="file" accept="image/jpeg,image/png,image/webp" hidden /><input name="launcherImageUrl" data-external-embed-launcher-image type="hidden" value="${escapeAttr(config.launcherImageUrl)}" /><div class="external-embed-avatar-actions"><button class="btn btn-ghost xs" type="button" data-external-embed-avatar-upload>上传图标</button><button class="btn btn-ghost xs" type="button" data-external-embed-avatar-remove>恢复前台头像</button></div><small class="agent-field-note">复用现有头像裁剪；留空时自动使用当前前台头像。</small></div></div></div>
          <div class="agent-field site-toggle-field"><span>新消息角标</span><label class="site-toggle-row"><input class="site-toggle-input" name="showBadge" type="checkbox" ${config.showBadge ? "checked" : ""} /><span class="site-toggle-track" aria-hidden="true"><span class="site-toggle-thumb"></span></span><span class="site-toggle-copy">独立显示红色 “1” 角标</span></label></div>
          </div>
        </section>
        <section class="external-embed-form-section">
          ${sectionHead("弹窗内容", "点击图标后显示；访客链接由本站已发布前台自动生成。")}
          <div class="agent-form-grid">
          ${field("标题", externalEmbedRichTextEditorHtml({ name: "title", value: config.title, marks: config.titleRichText, maxLength: 96 }), "选中文字后可输入 #RRGGBB；未设置颜色时使用文字颜色。")}
          <div class="agent-field site-toggle-field"><span>BETA 标签</span><label class="site-toggle-row"><input class="site-toggle-input" name="showBeta" type="checkbox" ${config.showBeta ? "checked" : ""} /><span class="site-toggle-track" aria-hidden="true"><span class="site-toggle-thumb"></span></span><span class="site-toggle-copy">在标题旁显示标签</span></label></div>
          ${field("BETA 文案", `<input name="betaText" maxlength="24" value="${escapeAttr(config.betaText || "BETA")}" />`)}
          ${field("按钮文字", `<input name="ctaText" maxlength="64" value="${escapeAttr(config.ctaText)}" required />`)}
          ${field("说明", externalEmbedRichTextEditorHtml({ name: "description", value: config.description, marks: config.descriptionRichText, maxLength: 500, multiline: true }), "选中文字后可输入 #RRGGBB；会自动换行，实际展示宽度不超过访客浏览器。", "wide")}
          <div class="agent-field wide"><span>访客链接</span><div class="external-embed-derived-link">由本站已发布前台自动生成；不允许填写第三方跳转地址。</div></div>
          </div>
        </section>
        <section class="external-embed-form-section">
          ${sectionHead("主题与位置", "桌面与手机端分别使用对应的右侧和底部间距。")}
          <div class="agent-form-grid">
          ${colorField("主题色", "accentColor", config.accentColor)}
          ${colorField("卡片底色", "surfaceColor", config.surfaceColor)}
          ${colorField("文字颜色", "textColor", config.textColor)}
          ${numberField("圆角", "cornerRadiusPx", config.cornerRadiusPx, 0, 32, "px")}
          ${numberField("桌面右边距", "desktopRightPx", config.desktopRightPx, 0, 160, "px")}
          ${numberField("桌面下边距", "desktopBottomPx", config.desktopBottomPx, 0, 240, "px")}
          ${numberField("手机右边距", "mobileRightPx", config.mobileRightPx, 0, 120, "px")}
          ${numberField("手机下边距", "mobileBottomPx", config.mobileBottomPx, 0, 240, "px")}
          </div>
        </section>
        ${externalEmbedRichTextPopoverHtml()}
        <div class="external-embed-error" data-external-embed-error hidden></div>
        <div class="agent-form-actions"><button class="btn btn-primary sm" type="submit" data-external-embed-save>保存设置</button><span class="hint">发布后外站下次加载即读取最新配置。</span></div>
      </form>
      <aside class="external-embed-side">
        <section class="panel external-embed-preview-panel"><div class="panel-head"><h3>展示预览</h3><div class="seg external-embed-preview-modes" aria-label="预览设备"><button class="${previewMode === "desktop" ? "active" : ""}" type="button" data-external-embed-preview-mode="desktop">桌面</button><button class="${previewMode === "mobile" ? "active" : ""}" type="button" data-external-embed-preview-mode="mobile">手机</button></div></div>${externalEmbedPreviewCanvasHtml(config, selected, previewMode)}</section>
        <section class="panel external-embed-install-panel"><div class="panel-head"><h3>安装代码</h3><span class="panel-tag">一次安装</span></div><p>请将下面代码整段复制给技术同事，放到外站 <code>&lt;/body&gt;</code> 前，或粘贴到 GTM 的“自定义 HTML”；不要手动删除 <code>data-aiove-embed</code>。</p><textarea readonly spellcheck="false" aria-label="站外挂件安装代码" data-external-embed-snippet>${escapeHtml(snippet)}</textarea><button class="btn btn-ghost sm" type="button" data-external-embed-copy ${published ? "" : "disabled"}>${ICONS.copy || ""} 复制安装代码</button><small>${published ? "修改本页并保存后，无需再次安装。" : "获取方式：将“对外状态”切换为“发布（外站可见）”，点击“保存设置”后，此处会生成可复制的安装代码。"}</small></section>
      </aside>
    </div>
  `;
}

export function externalEmbedPreviewHtml(config, site) {
  return previewHtml(config, site);
}

export function externalEmbedPreviewCanvasHtml(config, site, previewMode = "desktop") {
  const mode = normalizePreviewMode(previewMode);
  return `<div class="external-embed-preview-canvas is-${mode}" data-external-embed-preview style="--preview-canvas-min-height:${previewCanvasMinHeight(config, mode)}px">${previewHtml(config, site, mode)}</div>`;
}

function previewHtml(config, site, previewMode = "desktop") {
  const mode = normalizePreviewMode(previewMode);
  const imageUrl = config.launcherImageUrl || site.mascotAvatarUrl || "";
  const right = mode === "mobile" ? config.mobileRightPx : config.desktopRightPx;
  const bottom = mode === "mobile" ? config.mobileBottomPx : config.desktopBottomPx;
  const maxRight = mode === "mobile" ? 120 : 160;
  const style = `--preview-accent:${safeColor(config.accentColor, "#00E95C")};--preview-surface:${safeColor(config.surfaceColor, "#101312")};--preview-text:${safeColor(config.textColor, "#FFFFFF")};--preview-radius:${bounded(config.cornerRadiusPx, 22, 0, 32)}px;--preview-right:${bounded(right, 24, 0, maxRight)}px;--preview-bottom:${bounded(bottom, 84, 0, 240)}px`;
  return `<div class="external-embed-preview-widget" style="${style}"><section class="external-embed-preview-card"><button type="button" aria-label="关闭">×</button>${imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="" />` : `<i>A</i>`}<div><h4><span class="external-embed-preview-title">${richTextHtml(config.title || "", config.titleRichText)}</span>${config.showBeta ? `<em>${escapeHtml(config.betaText || "BETA")}</em>` : ""}</h4><p>${richTextHtml(config.description || "", config.descriptionRichText)}</p><a>${escapeHtml(config.ctaText || "Start chat")}</a></div></section><div class="external-embed-preview-launcher ${imageUrl ? "has-image" : "is-fallback"}">${imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="" />` : "A"}${config.showBadge ? "<b>1</b>" : ""}</div></div>`;
}

function field(label, control, note = "", wide = "") { return `<label class="agent-field ${wide}"><span>${escapeHtml(label)}</span>${control}${note ? `<small class="agent-field-note">${escapeHtml(note)}</small>` : ""}</label>`; }
function sectionHead(title, description) { return `<div class="external-embed-section-head"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(description)}</p></div>`; }
function colorField(label, name, value) { return field(label, `<span class="external-embed-color"><input name="${name}" type="color" value="${escapeAttr(safeColor(value, "#00E95C"))}" /><output data-external-embed-color-output>${escapeHtml(safeColor(value, "#00E95C"))}</output></span>`); }
function numberField(label, name, value, min, max, suffix) { return field(label, `<span class="external-embed-number"><input name="${name}" type="number" min="${min}" max="${max}" value="${bounded(value, min, min, max)}" /><small>${suffix}</small></span>`); }
function avatarHtml(url) { return url ? `<img src="${escapeAttr(url)}" alt="挂件图标预览" />` : "A"; }
function safeColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toUpperCase() : fallback; }
function bounded(value, fallback, min, max) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback; }
function normalizePreviewMode(value) { return value === "mobile" ? "mobile" : "desktop"; }
function previewCanvasMinHeight(config, mode) { const bottom = bounded(mode === "mobile" ? config.mobileBottomPx : config.desktopBottomPx, 84, 0, 240); return Math.max(mode === "mobile" ? 580 : 480, bottom + 416); }
