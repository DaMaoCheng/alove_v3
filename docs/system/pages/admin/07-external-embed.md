# 后台：站外嵌入

状态：`Current / Local verified`。本页只完成本地实现与接口链路自检，尚未部署服务器或更新 GitHub。

## 1. 页面身份

- 入口：`/admin?view=externalEmbeds`。
- 适用账号：`admin`；读取需要后台身份，保存需要 `admin:sites:write`。
- 目标：为每个 active ALOVE 站点维护一个可安装到第三方独立站的轻量聊天引导挂件。
- 不做：不嵌入完整聊天页、不配置第三方 CTA、不读取外站 DOM、不写入订单或支付数据。

## 2. 字段与控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 关联站点 | active 站点下拉 | 是；默认首个 active 站点 | 服务端 active 站点 | 决定配置和游客聊天归属 | 无配置站点显示草稿；停用站点不在列表 | 切换后读回该站独立配置 | `sites` |
| 外部站点 HTTPS 地址 | 根域名文本 | 是 | 默认从站点管理的 `site_url` 提取其 HTTPS Origin；仍可手动覆盖；本地测试仅允许 localhost | 精确限定能读取公开配置的 Origin | 不能含路径、参数、账号、内网或非 HTTPS 生产地址 | 保存 `external_origin` | `site_external_embeds` |
| 对外状态 | 草稿/发布下拉 | 草稿默认 | `draft`、`published` | 控制外站能否读取 | 发布需要游客聊天开启和公开已发布前台 | 发布后生成安装代码 | `embed_status` |
| 挂件图标 | 上传按钮/恢复前台头像 | 否；空值回退前台头像 | 复用头像裁剪和上传结果 | 外站透明启动图；仅加载失败时回退主题色圆形 A | 上传失败明确提示；图片地址最终由服务端校验 | 保存图标 URL 或恢复前台回退 | `launcher_image_url`、前台头像 |
| 新消息角标 | 开关 | 开启默认 | 独立固定显示 `1` | 模拟新消息提醒 | 与图标上传无耦合 | 外站独立显示/隐藏红色角标 | `show_badge` |
| 标题/说明文字颜色 | 受限文字编辑器；选中文字后输入 `#RRGGBB`，可恢复默认 | 否；默认继承文字颜色 | 标题≤96、说明≤500；仅不重叠的起止位置与 6 位 HEX 颜色 | 控制指定文字片段颜色 | 不保存 HTML/CSS/链接；非法颜色、越界或重叠位置被丢弃 | 右侧预览即时变化；保存后外站展示相同片段颜色 | `title_rich_text`、`description_rich_text` |
| 标题/BETA/说明/按钮文字 | 受限文字编辑、开关、文本 | 标题、说明、按钮必填 | 标题≤96、BETA≤24、说明≤500、按钮≤64 | 控制引导卡内容 | 最终服务端做长度和空值校验 | 外站下一次读取后展示最新文案 | `title` 等 |
| 主题色/底色/文字色/圆角 | 三个色板与数字 | 有默认值 | `#RRGGBB`、圆角 0–32px | 控制限定视觉风格 | 不允许任意 CSS | 实时预览并保存受控变量 | 主题字段 |
| 桌面/手机右下偏移 | 四个数字输入 | 各有默认值 | 桌面右 0–160、下 0–240；手机右 0–120、下 0–240 | 避开商店既有客服按钮 | 服务端限幅 | loader 在对应断点采用值；预览显示桌面值 | 位置字段 |
| 安装代码 | 只读文本框 + 复制 | 仅发布后可用 | GTM 兼容的动态注入脚本；包含不透明 public ID 和版本化 loader URL | 交给外站技术同事放入 `</body>` 前一次，或粘贴到 GTM“自定义 HTML” | 草稿不生成有效代码 | 保存后的后续样式修改无需重新安装 | `public_id` |

## 3. 确定性边界与状态

- 每个站点至多一条配置；重复保存是更新，不产生多份安装代码。
- 无配置的 active 站点由服务端返回完整草稿配置；后台模板不保留第二份业务默认值。数据库旧行的已保存文案不会因默认值升级被改写。
- 首次配置、未填 Origin 或遗留 `0.0.0.1`/localhost 临时地址时，会回退到本站 `site_url` 的 HTTPS Origin；保存了有效公网 Origin 的站点始终保留手动值，不做批量迁移或覆盖。
- CTA 由服务端固定推导为当前站点有效前台的游客聊天页，新标签打开并保留商城页；后台不提供任意 URL 输入框。
- 公共接口只返回启动图、角标、位置、受控主题、文案和 CTA，不返回外站 Origin、商品源、用户、Token 或后台 ID。
- 标题和说明的颜色不是特殊品牌规则：只会按管理员保存的受限颜色片段渲染；旧配置没有片段时统一继承文字颜色。
- 外站 loader 使用 Shadow DOM 隔离样式、纯文本插入远程文案、无凭据 CORS、Esc/关闭按钮和焦点返回启动器；卡片为非阻塞 dialog，不阻断商城页面。
- 长文案可换行并受视口高度限制；重复安装同一 public ID 不会重复渲染启动器。

## 4. 代码关联

- 前端：`src/features/admin-console/admin-console-external-embeds-template.js`、`admin-external-embeds-controller.js`、`admin-external-embed-avatar-controls.js`、`src/services/admin-external-embed-service.js`。
- 后端：`server/external-embed-service.js`、`admin-external-embed-routes.js`、`public-external-embed-routes.js`。
- 数据与静态资源：`server/db-bootstrap-external-embed-tables.js`、`embed/v1.js`。
- 接口：`GET/PUT /api/admin/external-embeds`、`GET /api/embed/config?embed=<publicId>`。
