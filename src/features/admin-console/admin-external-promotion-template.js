import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function externalPromotionMountHtml() {
  return '<section class="panel external-promotion-panel" data-external-promotion-host><h3>活动礼盒</h3><p>正在读取独立活动草稿…</p></section>';
}
export function externalPromotionEditorHtml(item, draft, siteName) {
  const number = (label, name, max) => field(label, `<input name="${name}" type="number" min="0" max="${max}" value="${escapeAttr(draft[name])}" />`);
  return `<div class="panel-head"><div><h3>活动礼盒 · ${escapeHtml(siteName)}</h3><p>独立于聊天头像；编辑和保存草稿不会改变外站当前展示。</p></div><span class="pill ${item.published ? "on" : "mid"}" data-promotion-status>${item.published ? "活动已发布" : "活动未启用"}</span></div>
    <div class="external-promotion-layout">
    <form class="agent-form" data-promotion-form>
      <div class="agent-form-grid">
        ${field("入口图标", '<input name="launcherImageUrl" maxlength="512" value="'+escapeAttr(draft.launcherImageUrl)+'" required />', "礼盒会间歇轻晃，展开的活动图片保持静态。")}
        ${field("图标说明", '<input name="label" maxlength="96" value="'+escapeAttr(draft.label)+'" required />')}
        ${field("弹窗静态图片", '<input name="popupImageUrl" maxlength="512" value="'+escapeAttr(draft.popupImageUrl)+'" required /><div class="external-embed-avatar-actions"><button class="btn btn-ghost xs" type="button" data-promotion-upload>上传活动图</button><input type="file" accept="image/png,image/jpeg,image/webp" data-promotion-file hidden /></div>', "PNG / JPG / WebP，最大 3MB，保留原图比例，不做头像裁剪。")}
        ${field("自动避让", '<label class="site-toggle-row"><input name="autoAvoid" type="checkbox" '+(draft.autoAvoid ? "checked" : "")+' /><span>排在现有右下角悬浮入口上方</span></label>')}
        ${number("桌面右边距 px", "desktopRightPx", 160)}${number("桌面下边距 px", "desktopBottomPx", 640)}
        ${number("手机右边距 px", "mobileRightPx", 120)}${number("手机下边距 px", "mobileBottomPx", 640)}
      </div>
      <div class="external-embed-error" data-promotion-error hidden></div>
      <div class="agent-form-actions"><button class="btn btn-primary sm" type="submit" data-promotion-action="save_draft">保存草稿</button><button class="btn btn-ghost sm" type="button" data-promotion-action="publish">发布当前草稿</button><button class="btn btn-ghost sm" type="button" data-promotion-action="disable" ${item.published ? "" : "disabled"}>停用活动</button></div>
      <p class="hint" data-promotion-note>先检查右侧真实动效；发布才会更新已安装的活动挂件。</p>
      <div class="external-embed-install-panel"><h4>独立活动安装代码</h4><textarea readonly spellcheck="false" data-promotion-snippet aria-label="活动礼盒安装代码">${escapeHtml(item.installerSnippet || "发布后生成独立活动安装代码；未发布时外站不展示。")}</textarea><button type="button" class="btn btn-ghost sm" data-promotion-copy ${item.installerSnippet ? "" : "disabled"}>复制安装代码</button></div>
    </form>
    <div class="external-promotion-preview"><div class="panel-head"><h4>真实动效预览</h4><div class="seg" aria-label="活动预览设备"><button type="button" class="active" data-promotion-device="desktop">桌面</button><button type="button" data-promotion-device="mobile">手机</button></div></div><p class="hint">礼盒晃动、点击展开与收起、自动避让均使用正式挂件代码。</p><div class="external-promotion-frame" data-promotion-frame-wrap><iframe src="/embed/promotion-preview.html" title="活动礼盒真实预览" data-promotion-frame></iframe></div><button class="btn btn-ghost sm" type="button" data-promotion-open>打开独立测试页</button><p class="hint">预览包含模拟客服和返回顶部角标；真实站点的特殊组件仍需安装前核验。</p></div>
    </div>`;
}
function field(label, control, note = "") {
  control = control.replace("<input ", `<input aria-label="${escapeAttr(label)}" `);
  return `<div class="agent-field"><span>${escapeHtml(label)}</span>${control}${note ? `<small class="agent-field-note">${escapeHtml(note)}</small>` : ""}</div>`;
}
