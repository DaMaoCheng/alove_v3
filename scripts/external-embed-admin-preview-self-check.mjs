import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = await readFile(resolve("src/features/admin-console/admin-external-embeds-controller.js"), "utf8");
const templateSource = await readFile(resolve("src/features/admin-console/admin-console-external-embeds-template.js"), "utf8");
const styleSource = await readFile(resolve("src/features/app-shell/styles/admin-external-embeds.css"), "utf8");

assert.match(source, /function syncPreview\(form, items(?:\s*=\s*\[\])?, previewMode(?:\s*=\s*"desktop")?\)/, "实时预览必须显式接收当前站点列表和设备模式，不能读取已经离开作用域的局部变量");
assert.match(source, /syncPreview\(form, items, previewMode\)/, "输入、切换和图标回退都必须把当前站点列表与设备模式传给预览函数");
assert.match(source, /bindDropdowns\(host\)/, "异步渲染的站外嵌入表单必须绑定项目统一下拉菜单");
assert.match(source, /\[data-external-embed-site\] \[data-dd-input\]/, "站点切换和实时预览必须读取统一下拉菜单的隐藏值");
assert.match(source, /data-external-embed-preview-mode/, "预览设备切换必须在不丢失表单内容的情况下重绘预览");
assert.match(source, /externalEmbedPreviewCanvasHtml/, "预览重绘必须连同响应式画布尺寸一起更新");
assert.match(templateSource, /selectDropdownHtml/, "站外嵌入页面必须复用项目统一下拉菜单");
assert.match(templateSource, /admin-actions external-embed-actions/, "站外嵌入页面必须复用后台标准操作栏结构");
assert.match(templateSource, /data-external-embed-preview-mode="desktop"/, "预览必须提供桌面切换");
assert.match(templateSource, /data-external-embed-preview-mode="mobile"/, "预览必须提供手机切换");
assert.match(templateSource, /请将下面代码整段复制给技术同事/, "安装代码区域必须明确提示技术同事整段复制");
assert.match(templateSource, /GTM 的“自定义 HTML”/, "安装代码区域必须说明 GTM 自定义 HTML 用法");
assert.match(templateSource, /data-external-embed-snippet/, "安装代码必须通过只读文本框提供可复制原文");
assert.match(templateSource, /data-external-embed-copy/, "安装代码必须提供复制按钮");
assert.match(templateSource, /默认从站点管理的“网站链接”提取；可手动修改。/, "Origin 字段必须说明网站链接自动填写与手动覆盖规则");
assert.match(templateSource, /发布（外站可见）/, "草稿状态的安装代码提示必须指向正确的发布状态");
assert.doesNotMatch(templateSource, /发布（外站不可见）/, "安装代码提示不能把发布状态标成外站不可见");
assert.doesNotMatch(templateSource, /<select/, "站外嵌入页面不能保留孤立的原生下拉菜单");
assert.match(templateSource, /externalEmbedRichTextEditorHtml\(\{ name: "title"/, "标题必须使用受限富文本编辑器");
assert.match(templateSource, /externalEmbedRichTextEditorHtml\(\{ name: "description"/, "说明必须使用受限富文本编辑器");
assert.match(templateSource, /externalEmbedRichTextPopoverHtml\(\)/, "选中文字后必须提供颜色代码浮层");
assert.doesNotMatch(templateSource, /previewTitleHtml/, "不得再按完整标题自动拆分 AIOVE 品牌颜色");
assert.doesNotMatch(templateSource, /function defaultConfig/, "后台草稿默认值必须由服务端提供，不能保留第二份业务默认配置");
assert.match(styleSource, /\.external-embed-preview-card\{[^}]*width:min\(290px,calc\(100vw - 48px\)\)/, "弹窗宽度必须相对浏览器可用宽度计算，不能相对 50px 图标容器收缩");
assert.doesNotMatch(styleSource, /\.external-embed-preview-card\{[^}]*calc\(100% - 30px\)/, "弹窗不能使用图标容器的百分比宽度，否则文本会被压成竖排");
assert.match(styleSource, /\.external-embed-preview-launcher img\{[^}]*object-fit:contain[^}]*background:transparent/, "后台预览的挂件图标必须保留透明背景");
assert.match(styleSource, /\.external-embed-rich-popover\{position:fixed/, "颜色代码工具必须作为紧跟选择文本的小浮层显示");
assert.match(styleSource, /\.external-embed-rich-popover\{[^}]*background:var\(--surface\)/, "颜色代码工具必须使用不透明实底，不能透出底层表单");
assert.match(styleSource, /\.external-embed-preview-title\{white-space:pre-wrap/, "预览标题必须保留受限富文本的文字片段样式");

console.info("[external-embed-admin-preview-self-check] passed");
