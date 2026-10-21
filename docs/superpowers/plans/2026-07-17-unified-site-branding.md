# 统一站点品牌配置分批实施方案

执行状态：`Completed locally`（四批已完成；尚未更新服务器和 GitHub）

对应规格：[统一站点品牌配置规格](../specs/2026-07-17-unified-site-branding.md)

## 总体边界

- 本轮只在本地推进，不更新服务器和 GitHub。
- 使用当前工作区作为阶段检查点；开始时 `git status` 干净，不新建平行实现或新依赖。
- Shopify Customer Account OAuth 仍等待技术侧配置；当前仅对已配置 Shopify 只读 Token 且站点授权登录开关开启的站点展示禁用预览，不制造可点击的假登录入口。
- 每批通过专项验证后才进入下一批；失败时回到当前批次修复，不继续叠加。

## 批次 1：数据库与后台唯一配置源

### 要做什么

- 为 `sites` 新增可空 `site_logo_url VARCHAR(512)`。
- 让空库 bootstrap 和已有库幂等 migration 同时具备该字段。
- 后台站点查询、映射、新建、编辑与表单补充 `logoUrl`。
- Logo URL 使用现有站点 URL 规范化规则，只允许公开 HTTP(S) URL；不覆盖旧站点已有配置。

### 具体位置

- `server/db-bootstrap-tables.js`：`createSitesTableIfMissing()`。
- `server/db-column-migrations.js`：`addSiteColumnsIfMissing()`。
- `server/admin-site-mapper.js`：`mapSiteRow()`。
- `server/admin-site-write-service.js`：`createAdminSite()`、`updateAdminSite()`、`normalizeSitePayload()`。
- `src/features/admin-console/admin-console-sites-template.js`：`adminSiteEditorHtml()`。
- `src/features/admin-console/admin-sites-editor.js`：`readSitePayload()`。
- `docs/system/pages/admin/02-sites-mascot-carousel.md`：站点字段说明。

### 验证

- 空值保持 favicon fallback；编辑已有站点不填写 Logo 不影响其他配置。
- 新增/编辑站点可保存并回读 `logoUrl`。
- migration 重复执行不报错，seed 不覆盖管理员配置。

## 批次 2：公共品牌读取与共享解析

### 要做什么

- 新增服务端公共品牌 mapper/resolver，只读取 active 站点并输出白名单字段。
- `site_url` 为空时复用同站点 active 商品缓存的公开 URL 推导 storefront origin，不读取或暴露 Shopify Admin 地址。
- 新增 `GET /api/site/branding?siteSlug=...`；非法、缺失或 inactive 显式站点不回退默认站。
- 现有 IP 站点解析响应同步附带同一品牌字段，避免无前缀首次访问多做一次不必要查询。
- 新增前端带内存缓存的品牌 service 和共享 Logo 解析工具，统一 explicit Logo、站点 favicon、商品 favicon、globe 的优先级。

### 具体位置

- 新增 `server/site-branding-service.js`：公开字段映射与按 slug 查询。
- `server/admin-client-event-routes.js`：公开品牌 GET 路由。
- `server/geo-site-resolver-service.js`：默认/IP 分流查询带出品牌字段并复用 mapper。
- `src/config/api-config.js`：品牌 endpoint。
- 新增 `src/services/site-branding-service.js`：按 slug 读取和缓存。
- 新增 `src/features/shared-ui/site-branding.js`：纯函数 Logo/fallback 解析。

### 验证

- FKK、默认站、非法 slug、inactive 站点和无 Logo 站点接口结果正确。
- 响应不包含 Token、Admin API、OAuth secret、用户数或备注。
- 相同 slug 在一个页面生命周期内共用请求；请求失败可由调用方降级。

## 批次 3：现有消费链路统一

### 要做什么

- App 启动完成路径分流后读取当前品牌并保存到 `appState.site.branding`。
- 登录页接收当前站点品牌；预留 Shopify Customer Account 按钮的通用渲染位置，但只有未来传入真实可用登录 action 时才显示。
- 商品详情不再内置第二份 favicon 规则；先显示同步 fallback，再根据 `siteSlug` 异步刷新为当前站点品牌。
- Kitshop 站点 mapper/游客 sanitizer 返回 `logoUrl`，Kitshop 卡片传递 `siteLogoUrl` 供详情首屏使用；最终仍由共享品牌读取校准。
- 商品气泡本身没有站点 Logo UI，因此不新增无用视觉元素；保留 `siteSlug` 作为动态品牌关联键。

### 具体位置

- `src/app/app-state.js`、`src/app/main.js`、`src/app/app-view-factory.js`：品牌状态装配与页面传参。
- `src/pages/login/login-page.js`、`src/features/app-shell/styles/auth-forms.css`、`src/pages/login/login.css`：品牌化 Shopify 按钮承载。
- `src/features/chat/chat-product-panel-renderer.js`：共享 Logo 解析和动态品牌更新。
- `src/features/chat/chat-product-panel.js`：打开/刷新详情时传递当前 `siteSlug` 并触发品牌同步。
- `server/product-search-site-service.js`、`server/guest-product-sanitizer.js`：安全站点品牌字段。
- `src/features/kitshop/kitshop-page.js`：Kitshop 商品 payload 首屏品牌字段。
- `docs/system/pages/user/01-authentication.md`、`docs/system/pages/user/03-chat-product-call.md`、`docs/system/02-frontend-pages.md`：页面事实与边界。

### 验证

- 修改本地 FKK Logo 后，品牌接口、登录页数据、Kitshop 响应和新/历史商品详情均使用同一配置。
- Logo 404 时退回站点 favicon；品牌接口失败时退回商品 favicon/globe。
- 站点未配置 Shopify 只读 Token 或关闭授权登录开关时按钮不渲染；两项满足但 OAuth action 缺失时按钮显示但禁用，不影响 Google 与邮箱登录。

## 批次 4：完整回归、互评与记录

### 自检

1. 新增统一站点品牌专项：schema、后台 CRUD、公开接口白名单、inactive 拒绝、fallback 优先级和缓存。
2. 更新商品详情专项，断言共享 resolver 和动态品牌读取，不再维护页面私有 favicon 规则。
3. 回归后台站点、站点分流、登录/Google、商品搜索/resolve、正式与游客商品、Kitshop 和系统文档。
4. 重启本地服务，确认 4173 PID 来自当前项目、`/api/health` 正常，并直接请求真实品牌接口。
5. 使用真实页面验证登录页无破坏、Kitshop 商品详情 Logo、无 Logo fallback 和两套主题；若缺管理员登录态，明确记录未完成的页面项。
6. 多 Agent 互评：架构/数据边界、前端消费/fallback、安全与回归范围分别给出阻塞结论。

### 记录

- 完成后更新 `docs/design/01-navigation-and-site-context.md`、`04-commerce-promotions-and-profile.md`、`07-integrations-and-data-governance.md` 的实际状态。
- 更新 `docs/system/` 页面、后端数据和 API 索引。
- 更新 `logs/updates/2026-07-17.md`；本地未发布前不创建“已上线”事实。

## 回退方式

- 页面层可回退为商品 URL favicon；数据库新增可空字段保留不会影响旧代码。
- 公共接口和前端品牌缓存均为只读，不修改用户、商品、聊天或订单数据。
- 不删除 `site_logo_url`，避免破坏已经保存的管理员配置；回退代码后旧版本会自然忽略该字段。

## 本地验收记录

- 批次 1：schema、migration、后台 CRUD、旧客户端省略字段保留和非法 URL 拒绝专项通过。
- 批次 2：active/inactive、公开字段白名单、可信商品 URL 推导 origin 和 fallback 优先级专项通过。
- 批次 3：真实登录页、游客 Kitshop、商品详情动态品牌与错误日志检查通过；无 OAuth action 时品牌按钮存在且为禁用状态，Google/邮箱控件正常；未知显式路径真实验证会替换成 active 站点路径并保留页面/query。
- 批次 4：专项回归、系统文档、部署检查和多 Agent 只读互评结果记录在本地发布文档；所有阻塞项修复后才视为完成。
