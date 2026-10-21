# 网红表现看板与折扣码管理分批实施计划

关联规格：[`../specs/2026-07-20-creator-performance-and-discount-codes.md`](../specs/2026-07-20-creator-performance-and-discount-codes.md)

状态：`In progress`（批次 1、批次 3及批次 2 的个人统计部分已在本地完成并验证；折扣码批次 5、6 已本地完成并验证；后台汇总仍未开始）

## 0. 工作区边界

- 当前 `main` 存在上一期“统一站点品牌 / Shopify 登录预览”的未提交改动，本功能不得改写或回退这些文件中的既有变更。
- 本期暂不创建 Git 分支、commit 或 tag；用户确认发布边界前只保留本地改动。
- 如需修改与上一期重叠的 `src/app/app-view-factory.js`，只允许补充 creator 页面参数，不改品牌和登录逻辑。
- 每批完成后先验证并更新本文状态，再进入下一批；任何批次失败时停在当前批次修复。

## 批次 1：网红个人看板前端

状态：`Completed locally`（2026-07-20）

### 目标

- 恢复 creator 账号首页左侧“Creator dashboard”入口。
- 删除 Creator Workspace 中全部固定人物、收益、分成、提现、销量和折扣使用演示内容。
- 建立可承接真实接口的个人看板 UI 和页面状态，不伪造数据。

### 修改位置

- `src/features/app-shell/app-sidebar.js`
  - creator 账号显示入口；personal 不显示；admin 日常入口仍走后台。
- `src/app/app-view-factory.js`
  - 向 creator 工作台传入当前登录账号；不新增请求逻辑。
- `src/features/creator-workspace/creator-workspace-page.js`
  - 仅负责页面 shell、顶部栏、主题切换、返回和模块装配。
- 新增 `src/features/creator-workspace/creator-dashboard-template.js`
  - 负责范围控件、KPI、趋势、loading/empty/error/ready 模板。
- 新增 `src/features/creator-workspace/creator-dashboard-controller.js`
  - 负责本地范围和趋势指标切换，为后续 service 接口预留单一装配点。
- `src/features/app-shell/styles/creator-workspace.css`
  - 沿用 admin token 和现有响应式断点，删除收益/提现专用样式。

### 本批不做

- 不请求或新增 creator analytics API。
- 不改数据库和统计事件。
- 不改后台概览和折扣码页面。
- 不展示任何演示业务数字。

### 验收

- creator 账号侧栏能看到入口并进入 `/creator`；personal 不显示入口。
- 页面展示 7/30/90 天、四个 KPI、三个趋势指标切换和清晰的待接入/空状态。
- 页面无 Leo Marquez、假美元、收益、提现、销量或折扣使用演示数据。
- 桌面和窄屏下无横向溢出；移动菜单、返回、主题切换可操作。
- Discover、Chat、Kitshop、Admin 入口与权限不受影响。

### 本地验证结果

- 临时 creator 账号登录后，首页侧栏显示唯一 `Creator dashboard` 入口并正确进入同站点 `/creator`；验证后临时账号和登录态已清理。
- 7/30/90 天和三个趋势指标切换会保留选中状态；初始状态明确为 analytics 未接入，没有演示业务数字。
- 用户随后要求先查看完整数据态，因此本地 UI 临时显示带 `Demo data` 标识的确定性样例；该样例只用于页面审阅，批次 3 接入真实接口时整体替换，不能作为接口失败 fallback。
- 本地预览补充 Audience loyalty 和热门产品 Top 5；Audience loyalty 展示新用户、回访用户、回访率和平均消息数，热门产品图片与数字仍属于 `Demo data`，不参与真实商品事件。
- 1280px 桌面与 375px 移动视口均无横向溢出；移动菜单和深浅主题完成真实浏览器验证。
- 语法检查、专项源码检查、系统文档检查、部署检查与 `git diff --check` 结果见本批更新日志。

### 回退点

- 回退新增 creator 模板/控制器及工作台样式，重新隐藏侧栏入口即可；不涉及数据回滚。

## 批次 2：可信统计查询与 API

状态：`Partially completed locally`（2026-07-20；个人 creator 统计、可信产品事件写入边界和个人只读 API 已完成；管理员聚合接口随批次 4 推进）

### 目标

- 建立 creator 个人统计和后台聚合统计的服务端可信查询。
- 先完成接口、权限和数据库真实查询验证，不开放后台新 UI。

### 新增位置

- `server/creator-analytics-service.js`：可信 owner 解析、周期边界、汇总、趋势和排行查询。
- 同一 service 返回个人看板同站点可信热门产品 Top 5，并以稳定 product key 解决同值排序。
- 同一 service 按确定性首次会话时间区分新用户和回访用户，并返回 Unique chatters、Return rate 与 Avg. messages。
- `server/creator-routes.js`：creator 个人只读接口与权限边界。
- `src/services/creator-analytics-service.js`：前端请求、错误合同和响应规范化。

### 必须调整的位置

- `server/admin-analytics-routes.js`：装配管理员 creator analytics 接口；路由只处理参数和响应。
- 服务端 route 装配入口：仅挂载新路由，不写查询逻辑。

### 本批不做

- 不改个人看板为真实数据。
- 不实现折扣码。
- 不修改既有 product overview 指标。

### 验收

- 7d/30d/90d 当前周期与前周期边界正确，趋势日期连续。
- creator 只能读取本人；personal 拒绝；admin 聚合按站点过滤。
- 伪造客户端 owner、角色类型、site、message ID 和 session ID 不会改变归属。
- 会话用户与事件用户不一致、角色非 creator、跨站记录均被排除。
- 查询有必要索引或有明确性能验证，不进行逐行 N+1 查询。
- 热门产品的触发、跳转和图片快照来自同一可信商品归属，跨站商品被排除。

### 回退点

- 移除新路由挂载即可停止接口；无数据迁移。

### 本地验证结果

- 新增 `GET /api/creator/analytics?range=7d|30d|90d`，只接受 creator 登录态；未登录 401、personal/admin 403、非法范围 400。
- 查询固定到当前账号、当前站点及服务端解析出的唯一 creator 角色；多角色脏数据不会混入已选角色。
- Product triggers 与 Store visits 只统计可通过 `event -> product message -> formal session -> creator character` 反查成功的数据；客户端 owner、site、character 字段不决定归属。
- 客户端不能写入服务端 `product_bubble_triggered`；商品事件先校验 message 属于当前用户会话，CTA 按 `event + user + message` 加锁去重。
- 数据库夹具覆盖当前/前一周期、新用户/回访用户、多角色、伪造 owner、错误用户、孤立事件、跨站及冲突站点快照、Top products 和 DST 自然日边界。
- 90 天趋势改为先限定角色和总周期，再一次扫描条件聚合；本地 `EXPLAIN ANALYZE` 确认消息与事件沿会话/消息索引嵌套查找，无 bucket 乘全表扫描。

## 批次 3：个人看板接入真实数据

状态：`Completed locally`（2026-07-20）

### 目标

- 将批次 1 UI 接入批次 2 个人接口。
- 完成 loading、empty、error、ready 和刷新后的稳定行为。

### 修改位置

- `src/features/creator-workspace/creator-dashboard-controller.js`：范围切换时加载数据、竞态防护、错误与重试。
- `src/features/creator-workspace/creator-dashboard-template.js`：渲染真实 KPI、环比和日趋势。
- `src/services/creator-analytics-service.js`：只保留请求职责。
- 可新增 `src/features/shared-ui/line-chart.js`：仅在后台也确定复用时抽成无依赖 SVG 折线图；否则先保持 creator 模块内最小实现。

### 验收

- creator 真实账号仅看到本人 creator 角色数据。
- 快速切换范围时旧响应不能覆盖新选择。
- 前周期为 0、全部为 0、单日数据、接口失败均正确显示。
- 浏览器刷新、主题切换、移动菜单和返回后无状态错乱。

### 回退点

- 控制器回退到批次 1 的未接入状态；接口保持只读且可继续验证。

### 本地验证结果

- 删除 preview data 依赖和 `Demo data` 展示；接口失败进入 error + Retry，不回退假数据。
- 控制器使用请求序号防止 7/30/90 天快速切换时旧响应覆盖新选择。
- 临时 creator 账号真实登录后，30 天页面正确显示 2 Conversations、3 Product triggers、1 Store visit、33.3% Visit rate、受众数据及两个真实商品排行。
- 真实浏览器快速执行 90 天后切回 7 天，最终范围和趋势均保持 7 天；375px 移动端无横向溢出，控制台无 warning/error。
- 临时 creator、受众账号、角色、会话、消息、事件和浏览器登录态已清理。

## Creator 单角色保障补充

状态：`Completed locally`（2026-07-20，未发布）

- `ai_characters` 新增虚拟生成列和 `(owner_uid, active_creator_marker)` 唯一索引，只约束未归档 creator 角色；普通角色和多个已归档 creator 角色不受影响。
- 用户创建和管理员创建保留业务层预检查，并将数据库并发冲突转换为稳定中文业务错误。
- 管理员普通编辑禁止更换现有 creator 的 owner；失效账号或停用站点不会阻止归档，恢复上架时重新执行完整校验。
- 迁移先审计历史重复数据；存在重复未归档 creator 时明确中止，不自动删除或归档运营数据。正式发布前必须先只读检查线上历史数据。
- 自检覆盖并发双写、归档后替代、旧角色恢复冲突、普通角色不受限、管理员换绑拒绝、失效账号/停用站点归档，以及 creator 看板统计回归。
- `npm run check:deployment`、多站点 preflight、HTTP smoke 和本地服务重启后健康检查均通过；本轮未更新服务器或 GitHub。

## 批次 4：后台概览网红统计

### 目标

- 在现有 admin overview 增加 creator performance 区段，不新增一级菜单。
- 提供站点/时间筛选、四项汇总、趋势和排行。

### 新增位置

- `src/features/admin-console/admin-creator-performance-template.js`：独立后台区段模板。
- 复用 `src/services/creator-analytics-service.js`；如 creator 与后台都需要折线图，再新增共享 `line-chart.js`。

### 修改位置

- `src/features/admin-console/admin-console-overview-template.js`：只装配新区段。
- `src/features/admin-console/admin-overview-controller.js`：只协调两个独立数据域，不合并查询和排序逻辑。

### 验收

- 站点和时间范围过滤与服务端一致。
- 排行字段、排序和分页正确；无越权跨站数据。
- 原商品漏斗、商品排行及其筛选不回归。
- creator 页面与后台同一指标抽样结果一致。

### 回退点

- 移除 overview 中的新区段装配；原商品统计接口和 UI 不变。

## 批次 5：折扣码数据库与接口

状态：`Completed locally`（2026-07-21，未部署）

### 目标

- 新增折扣码登记表、幂等迁移、管理员 CRUD、过滤和服务端校验。

### 新增位置

- `server/discount-code-service.js`：查询、写入、唯一性、归属和有效期校验。
- `server/discount-code-normalizers.js`：稳定枚举、输入规范化和派生状态纯函数。
- `server/admin-discount-code-routes.js`：管理员接口。

### 本地验证结果

- migration 重复执行、空库表存在、同站点大小写唯一、site/creator 归属、跨站 creator、固定/无限期、派生状态和列表筛选专项通过。
- 真实 HTTP 覆盖未登录 401、管理员 options、POST/PATCH、duplicate 409、跨站 creator 400 和筛选结果；测试夹具已清理。

### 修改位置

- `database/schema.sql`、`server/db-bootstrap-tables.js`、`server/db-column-migrations.js` 或项目当前数据库迁移落点。
- 服务端管理员路由装配入口。

### 验收

- 空库与已有库迁移通过；重复执行不破坏数据。
- 同站点忽略大小写唯一，不同站点允许同码。
- Site/Creator 归属切换、跨站 creator、inactive creator、Fixed/Indefinite 均由服务端确定性校验。
- 非管理员拒绝；错误不泄露数据库细节。

### 回退点

- 先卸载路由和页面入口；数据表保留避免破坏运营录入，是否删除表需另行确认。

## 批次 6：后台折扣码页面

状态：`Completed locally`（2026-07-21，未部署）

### 目标

- 用真实管理页替换静态“折扣码（待）”，支持列表、过滤、新建和编辑。

### 新增位置

- `src/services/discount-code-service.js`
- `src/features/admin-console/admin-discount-codes-template.js`
- `src/features/admin-console/admin-discount-codes-controller.js`
- `src/features/admin-console/admin-discount-code-editor.js`

### 修改位置

- `src/features/admin-console/admin-console-data.js`：移除“（待）”。
- `src/features/admin-console/admin-console-content.js`：装配真实页面。
- `src/features/admin-console/admin-console-static-tabs.js`：删除折扣码假数据模板。
- 对应 admin 样式文件：只增加折扣码页面所需规则，不塞进综合模板。

### 本地验证结果

- 页面已替换静态待办入口，支持搜索、站点/归属/状态筛选、前台/网红归属、无限期/固定期限、启停和编辑。
- 桌面与 375px 窄屏真实浏览器验证通过；无页面级横向溢出，表格在容器内保持稳定列宽。
- 新增前台无限期码真实保存并回到列表；无可信订单归因前不显示使用次数。
- 新增 UI 源码专项、广告日期公共控件回归、HTTP 自检和 `git diff --check` 已通过。

### 验收

- 站点码、网红码、多码、固定期限、无限期、启停和派生状态完整。
- 表单切换 Site 时清除 creator；Fixed/Indefinite 字段显隐与服务端结果一致。
- 无订单归因时不显示假使用次数。
- 原后台占位页、广告活动 `discount_code` 字符串和其他 admin tab 不受影响。

### 回退点

- 后台入口恢复“（待）”并停用真实页面；后端只读/写接口可同步卸载，登记数据保留。

## 最终回归与真实用户模拟

1. creator 登录：首页侧栏进入看板，切换 7/30/90 天和趋势指标，验证 loading/empty/error/ready。
2. personal 登录：无 creator 入口，直接访问 creator 页面和接口均被拒绝。
3. admin 登录：原概览与商品统计正常；网红汇总按站点、时间筛选，排行与抽样数据一致。
4. 管理员创建站点码、网红码、无限期码和固定期限码；覆盖重复码、跨站 creator、结束早于开始、停用和过期。
5. 检查 Discover、Create、Chat、Kitshop、Profile、账号管理、网红角色管理、广告活动和站点管理相邻链路。
6. 运行专项自检、部署检查、系统文档检查、语法检查、`git diff --check`，并进行桌面与移动真实浏览器验证。
7. 因本功能涉及权限、统计可信性和数据库写入，批次 2、5 及最终发布前按 `review_rules.md` 完成独立互评。

## 文档回写

- 批次 1 完成后更新用户侧 Creator Workspace 页面文档与本计划状态。
- 接口完成后更新 `docs/system/04-backend-services-and-data.md`、`docs/system/06-api-index.md`。
- 折扣码页面完成后更新后台页面字段文档，并将长期设计规则对应项改为 `Current`。
- 每批有业务行为变化时更新 `logs/updates/YYYY-MM-DD.md`；本地完成但未发布时明确标注。
