# 站外 ALOVE 嵌入挂件实施方案

## 目标与边界

- 在管理员后台新增独立的“站外嵌入”页；不把外部站点挂件字段混入既有“站点管理”编辑弹窗。
- 管理员为一个 ALOVE 站点维护一条外嵌配置：启动图、独立未读角标、弹窗文案、受控主题色、桌面/手机位置与状态。
- 点击挂件后展示轻量聊天引导卡；CTA 始终由服务端依据所选站点的有效公开前台生成游客聊天链接，并在新标签页打开。
- ALOVE 输出一段只含不透明挂件 ID 的版本化安装代码。第三方只需在网页 `</body>` 前安装一次；后续运营配置由 ALOVE 远程读取，不再要求改站点代码。
- 不嵌入完整聊天页、不接受任意 CTA URL、不暴露 Token/订单/商品源/后台字段，不进行服务器部署或 GitHub 推送。

## 已确认的产品契约

| 项目 | 本期实现 |
| --- | --- |
| 图标 | 复用现有头像裁剪、压缩和上传链路；圆形启动图，未配置时回退到当前站点公开前台头像。 |
| 角标 | 单独开关，打开时固定显示 `1`；不和图片内容耦合。 |
| 弹窗 | 头像、标题、可选 BETA、小段说明、关闭按钮、主题 CTA；不是全屏聊天窗口。 |
| CTA | 服务端推导 `/{siteSlug}/chat?agent={effectiveMascotId}`；新标签页打开并保留商店页。 |
| 位置 | 桌面和手机各自配置右/下偏移；默认给外站右下角预留空间，避免与 Shopify/LiveChat 按钮重叠。 |
| 样式 | 只提供安全的 accent/surface/text 三色及圆角数值；不允许保存任意 CSS。 |
| 域名 | 每条配置绑定一个 HTTPS 公网 host；公开配置接口仅向这个 Origin 返回 CORS 响应。 |

## 第一批：存储、服务和公开边界

### 新增/修改文件

- 新增 `server/db-bootstrap-external-embed-tables.js`
  - 新建幂等 `createSiteExternalEmbedsTableIfMissing()`。
  - 表 `site_external_embeds` 使用 `site_id` 唯一约束和不透明 `public_id` 唯一约束；保存 host、published 状态、图标、角标、桌面/手机偏移、受控颜色、圆角、文案和时间戳。
- 修改 `server/db-bootstrap-tables.js`、`server/db.js`
  - 导出并在站点/前台 seed 完成后调用上述 migration；不 seed 或覆盖任何已有运营配置。
- 新增 `server/external-embed-service.js`
  - 集中做 payload 规范化、HTTPS 公网 host 校验、色值/偏移/长度限幅、站点与有效公开前台校验、默认值补全、管理员/公开 DTO 映射和安装代码生成。
  - CTA 只从 `site.slug + effective mascot id` 推导；不接受浏览器传来的第三方 URL。
- 新增 `server/admin-external-embed-routes.js`
  - 管理员读取全部站点及嵌入状态、按站点创建/更新配置；写操作复用 `admin:sites:write`。
- 新增 `server/public-external-embed-routes.js`
  - `GET /api/embed/config?embed=<publicId>` 仅对 published 且请求 `Origin` 与已绑定 host 完全匹配的配置返回安全字段；设置精确 `Access-Control-Allow-Origin`、`Vary: Origin`、`Cache-Control: no-store`，无 cookie/凭据。
- 修改 `server/admin-routes.js`、`server/routes.js`
  - 仅装配新路由；现有管理员、聊天、商品路由顺序不改变。
- 修改 `server/static-file-service.js`
  - 将受控 `embed/` 目录加入公开静态白名单，仍保留 no-store 与既有安全响应头。
- 新增 `embed/v1.js`
  - 自己从 script `src` 推导 ALOVE Origin，拉取公开配置，使用 Shadow DOM 渲染固定启动器和小卡。
  - 使用 `textContent` 写文本、固定的 CSS 和受校验 CSS variables；支持图片加载失败 fallback、Esc/关闭/焦点返回、`aria-expanded` 和非阻塞 `role=dialog`。
  - CTA 设置 `target="_blank" rel="noopener noreferrer"`；点击 CTA 立即关闭卡片。

### 验收

1. 重启后的本地数据库自动创建表，重复启动不改写已有配置。
2. 管理员 API 能创建/回读配置；非管理员、非法 host、内网 host、非法颜色、缺少公开前台均被明确拒绝。
3. 公开接口不返回站点商品源、Token、后台备注、用户数据或管理员配置；来自错误 Origin 的浏览器请求不获得 CORS 许可。
4. 安装脚本和公开接口可从独立 HTML 页面加载，CTA 指向正确站点游客聊天页并在新标签页打开。

## 第二批：后台页面与已有上传复用

### 新增/修改文件

- 修改 `src/config/api-config.js`
  - 增加 `admin.externalEmbeds` 端点，不修改现有 endpoint 语义。
- 新增 `src/services/admin-external-embed-service.js`
  - 封装读取/保存请求；页面不直接拼 API URL。
- 新增 `src/features/admin-console/admin-console-external-embeds-template.js`
  - 输出站点选择、配置表单、图标上传、角标开关、文案/主题/位置字段、安装代码复制和不联网的安全预览区域。
- 新增 `src/features/admin-console/admin-external-embeds-controller.js`
  - 负责加载、字段状态、保存、复制、预览；复用 `showToast`、既有 dropdown 和头像上传/cropper API，不重写文件压缩或上传接口。
- 新增 `src/features/admin-console/admin-external-embed-avatar-controls.js`
  - 只把现有 `openAvatarFilePicker`、`handleAvatarFile`、`uploadAvatar` 适配到挂件表单，避免污染角色编辑器选择器。
- 新增 `src/features/app-shell/styles/admin-external-embeds.css`
  - 使用现有后台 panel、form、button tokens；仅新增本页布局和预览样式，包含窄屏折行。
- 修改 `src/features/app-shell/app.css`、`src/features/admin-console/admin-console-data.js`、`admin-console-content.js`、`admin-console-page.js`
  - 加一个顶级 `externalEmbeds` 视图、标题、模板和 controller 绑定；不影响现有导航 key 与站点编辑器。

### 验收

1. 管理员可选择任意 active site，新增/保存/刷新后字段准确回填，敏感字段不会出现。
2. 上传图片经既有裁剪流程后能立即预览，保存后外嵌配置读取到相同 URL。
3. 角标显示独立于图片；关闭后外站无角标。
4. 长语言文案在预览与真实挂件均自动换行，不越出视口；手机/桌面位置分别生效。
5. 未发布配置不会向外站返回，发布后才生成有效安装代码。

## 第三批：自检、真实页面和记录

### 新增/修改文件

- 新增 `scripts/external-embed-service-self-check.mjs`
  - 验证 schema/DTO、host 与输入边界、有效前台/CTA 推导、无敏感字段和 Origin CORS 拒绝分支。
- 新增 `scripts/external-embed-loader-self-check.mjs`
  - 验证 loader 使用 Shadow DOM、安全文本渲染、新标签 CTA、无 credentials、可访问性与移动端样式关键契约。
- 修改 `scripts/self-check-manifest.mjs`
  - 串行加入两个新自检。
- 修改 `docs/system/pages/README.md`、`docs/system/03-admin-console.md`、`docs/system/06-api-index.md`，并新增 `docs/system/pages/admin/07-external-embed.md`
  - 记录真实页面行为、字段、公开 API 和安装边界；不写入实际域名配置、账号或上传资源。
- 新增/更新 `logs/updates/2026-08-30.md` 与 `docs/releases/external-embed-widget-20260830.md`
  - 只在代码、自检和浏览器链路通过后记录本地完成、未部署、未推送的事实。

### 验收顺序

1. `node --check` 覆盖全部新增/修改的 Node 与浏览器 JS。
2. 串行执行新增 target self-check 和关联 admin/站点自检；执行 `git diff --check`。
3. 重启本地服务，确认监听进程来自当前项目、`/api/health` 为 200、新公开配置接口不是 404。
4. 在管理员真实页面创建一条本地测试配置；用独立本地 HTML 页模拟第三方安装代码，验证启动器、角标、打开/关闭、Esc、CTA、新标签、错误 Origin 和移动窄宽度。若浏览器环境策略拒绝本地端口，必须记录该限制，并以运行中服务 HTTP 自检验证可自动化的公开链路。
5. 删除仅为验证建立的测试配置（若占用现有 BS/站点配置则回恢复原数据），保留功能代码与文档。

## 风险、回退和不做事项

- 本期不修改 TTMall 订单/支付、商品同步、站点商品源和既有前台聊天逻辑。
- 外站本身的 CSP 若不允许 `https://alove.fans/embed/v1.js` 或 ALOVE API 连接，技术同事仍需放行这两个来源；这属于外站部署环境配置，不由 ALOVE 后台绕过。
- 外站若已有其他客服浮窗，只通过可编辑的右/下偏移避让，避免不可靠的跨脚本自动探测。
- 回退路径是禁用该站配置或移除安装 snippet；禁用后公开接口不再返回配置，既有后台和 ALOVE 前台均不受影响。

## 实施状态

`Executing locally`：本方案经用户授权后执行。本轮仅本地实现与验证；未部署服务器、未更新 GitHub。

## 第四批：受限文字颜色编辑（2026-08-31）

### 目标与边界

- 标题和说明支持管理员选中文字后输入 `#RRGGBB`；右侧预览即时同步，外站脚本展示同一颜色。
- 不保留“完整标题等于 Chat with AIOVE 时自动拆分双色”的隐式规则；所有颜色均由管理员明确选中后设置。
- 不接入通用富文本编辑器、不保存任意 HTML、CSS、链接、图片或脚本；不改变 CTA、BETA、主题色和既有站点配置语义。

### 修改范围

- `site_external_embeds` 增加 `title_rich_text`、`description_rich_text` 两个可空 JSON 文本列，并用幂等列迁移兼容已存在表。
- 管理端以正文和受限标记数组保存：每项仅含 `start`、`end`、`color`，服务端只接受不重叠且落在文字范围内的 `#RRGGBB`。
- 后台预览与 `embed/v1.js` 只以文本节点和受校验 `span.style.color` 渲染，不拼接远程 HTML。

### 验收与回退

1. 旧配置无标记时，标题和说明完全按默认文字色显示，且不再触发 AIOVE 自动双色。
2. 输入合法颜色后，保存、管理员回读、公开 DTO、预览和真实外站挂件均保留同一片段颜色。
3. 非法颜色、越界位置、重叠位置和非数组内容均被丢弃；正文仍可正常展示。
4. 回退只需清空两个标记列或在后台对文字执行“恢复默认”；旧配置和外站安装代码无需变动。

## 第五批：发布前默认配置收口（2026-08-31）

### 目标与边界

- 让服务端成为后台草稿的唯一业务默认值来源，统一默认标题为 `Chat with AIOVE`。
- 兼容已存在的 `site_external_embeds` 表，只调整该列未来插入时的数据库默认值；不更新、重写或迁移任何已保存站点的标题、富文本标记或更新时间。
- 不改外站公开 DTO、CTA、Origin 校验、图片上传、既有安装代码或其他后台页面；本批只做本地发布前准备，不部署、不推送。

### 修改范围与验收

1. `server/external-embed-service.js` 对无配置站点返回服务端构造的完整草稿 config；已保存站点仍优先读取原字段。
2. `src/features/admin-console/admin-console-external-embeds-template.js` 删除本地业务默认值，直接消费服务端草稿 config。
3. `server/db-bootstrap-external-embed-tables.js` 将新表 DDL 的标题默认值统一为 `Chat with AIOVE`，仅在 information schema 检测到旧默认值时执行固定的 `ALTER COLUMN ... SET DEFAULT`，并复用已有 `db-schema-utils` 列迁移 helper。
4. `external-embed-service-self-check` 断言已有表默认值已收口，并验证临时删除配置后的服务端草稿回读；测试 finally 恢复原配置。
5. 串行执行 schema/service/HTTP 自检，确认既有配置未被覆盖、错误 Origin 仍被拒绝、公开 loader 仍可读取发布配置。
6. 发布归档显式包含 `embed/`，并将 `embed/v1.js` 设为 archive 与 deployment-files 的必需条目；完整 deployment gate 串行执行 service、loader、后台预览三项可离线专项自检。运行中的 HTTP 自检仍保持为本地运行态专项，不塞入静态发布门禁。
7. `db-split-self-check` 将外嵌 schema 注册为独立 bootstrap domain，确保 facade 导出契约和公共迁移 helper 复用始终受发布门禁保护。
