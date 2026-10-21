# 03. Admin Console

更新时间：2026-07-17

后台入口：

`/admin?view=<key>`

前端入口文件：

- `src/features/admin-console/admin-console-page.js`
- `src/features/admin-console/admin-console-data.js`
- `src/features/admin-console/admin-console-content.js`
- `src/features/admin-console/admin-view-routing.js`

后端统一入口：

- `server/admin-routes.js`

逐页面字段、控件、默认值、服务端校验和状态见 [页面与字段规范](./pages/README.md)。

权限边界：

- 前端：只有 `accountType === "admin"` 显示后台入口。
- 后端：所有后台 API 先经过 `requireAdmin()`。
- 写操作还会检查具体 scope。
- 当前没有后台权限管理 UI。

## 1. 概览

### 入口

`/admin?view=overview`

默认后台页。

### 用途

查看正式账号从对话商品、Search 结果与 Kitshop 货架进入的统一商品漏斗和按入口拆分的商品排行；游客浏览不计入该统计。

### 页面内容

- 时间范围：
  - 今天
  - 7 天
  - 30 天
- 站点筛选。
- 第一行 KPI 卡片：
  - 商品曝光
  - 商品点击（含点击率）
  - 详情打开（含打开率）
  - Buy now 跳转（含跳转率）
- 第二行入口拆分卡片：
  - 对话商品
  - 搜索结果
  - Kitshop 货架
- 商品点击排行表：
  - 商品
  - 入口
  - 站点
  - 曝光
  - 点击
  - CTR
  - 详情
  - 跳转
  - 跳转率

### 操作

- 切换时间范围。
- 切换站点。
- 搜索商品排行。
- 点击列标题排序。
- 翻页。

### 接口

- `GET /api/admin/analytics/product-overview?range=&site=`

### 相关文件

- `src/features/admin-console/admin-console-overview-template.js`
- `src/features/admin-console/admin-overview-controller.js`
- `src/services/product-analytics-service.js`
- `server/admin-analytics-routes.js`
- `server/product-analytics-service.js`

## 2. 网红角色

### 入口

`/admin?view=creatorCharacters`

### 用途

管理绑定 creator 账号和站点的网红角色。

### 表格字段

- 角色
- 角色 ID
- 对应账号
- 所属站点
- 状态
- 知识库
- 对话数
- 收入

### 弹窗字段

- 头像上传/AI 生成
- 角色名称
- 绑定账号
- 所属站点
- 上架状态
- 可见性
- 性格
- 音色
- 默认语言
- 开场白
- 背景故事
- AI 润色

### 操作

- 新建网红角色。
- 编辑网红角色。
- 下架角色。
- 按站点筛选。
- 搜索名称、ID、账号。
- 从知识库列跳转知识库管理。

### 接口

- `GET /api/admin/characters?type=creator`
- `POST /api/admin/characters`
- `PATCH /api/admin/characters/:id/settings`
- `GET /api/admin/sites`
- `GET /api/admin/accounts?type=creator`
- `GET /api/admin/knowledge-bases`

### 规则与边界

- 写入需要 `admin:characters:write`。
- 绑定账号必须是 active creator 账号。
- creator 账号必须绑定 active 站点。
- 一个 creator 账号只能绑定一个未归档网红角色。
- 网红角色按站点展示。

### 相关文件

- `src/features/admin-console/admin-creator-characters-controller.js`
- `src/features/admin-console/admin-console-creator-characters-template.js`
- `src/features/admin-console/admin-character-editor-creator-template.js`
- `src/features/admin-console/admin-creator-account-picker.js`
- `server/admin-character-routes.js`
- `server/character-admin-service.js`

## 3. 通用角色

### 入口

`/admin?view=commonCharacters`

### 用途

管理不绑定站点、全站可见的普通 AI 角色。

### 表格字段

- 角色
- 角色 ID
- 创建者
- 分类
- 状态
- 可见性
- 知识库
- 对话数

### 弹窗字段

- 头像
- 名称
- 角色定位
- 分类
- 简介只读
- 性格
- 音色
- 语言
- 上架状态
- 可见性
- 开场白
- 背景故事

### 操作

- 新建通用角色。
- 编辑通用角色。
- 上架。
- 下架。
- 搜索。
- 跳转知识库。

### 接口

- `GET /api/admin/characters?type=common`
- `POST /api/admin/characters`
- `PATCH /api/admin/characters/:id/settings`

### 规则与边界

- 写入需要 `admin:characters:write`。
- 私密角色不显示上下架按钮。
- 简介通常由 AI 生成，编辑弹窗中只展示不编辑。
- 知识库绑定统一在知识库页面管理，角色页只展示。

### 相关文件

- `src/features/admin-console/admin-common-characters-controller.js`
- `src/features/admin-console/admin-console-common-characters-template.js`
- `src/features/admin-console/admin-character-editor-common-template.js`
- `src/features/admin-console/admin-character-knowledge-display.js`

## 4. 站点管理

### 入口

`/admin?view=sites`

### 用途

管理多站点、地区归属、默认站点、前台角色、商品源。

### 表格字段

- 站点
- 路径
- 目标地区
- 用户数
- 前台
- 网红角色
- 默认站点

### 弹窗字段

- 站点名称
- 路径 slug
- 网站链接
- 站点 Logo URL（可空；留空使用 favicon fallback）
- 默认语言
- 目标地区
- 前台角色 ID（可搜索下拉）
- 游客聊天滑动开关
- 商品源类型
- 店铺域名
- 只读 Token
- TTMall API Base URL
- TTMall 网站 ID
- 站点授权登录滑动开关
- 支付方式多选
- 说明

### 操作

- 新增站点。
- 编辑站点。
- 设置默认站点。
- 搜索目标地区。
- 多选目标地区。
- 配置 Shopify Admin 或 TTMall 商品源。

### 接口

- `GET /api/admin/sites`
- `POST /api/admin/sites`
- `PATCH /api/admin/sites/:id`
- `PATCH /api/admin/sites/:id/default`
- `GET /api/admin/geo-regions/search?query=`
- 用户侧只读：`GET /api/site/branding?siteSlug=<slug>`

### 规则与边界

- 写入需要 `admin:sites:write`。
- 默认语言复用现有角色语言库的受控选项；保存后成为该站点用户端页面与新聊天会话的初始化语言。当前完整页面翻译包为 English / Chinese (Mandarin)，其他语言页面回退 English，但 AI 会使用已配置语言。
- Shopify 店铺域名必须是 `xxx.myshopify.com`。
- TTMall API Base URL 必须是公开 HTTPS 根地址，网站 ID 必须是正整数；临时 JWT 由服务端自动获取，不要求管理员输入。
- 站点 Logo 只接受 HTTP(S)；公开品牌响应仅返回名称、slug、公开网站和 Logo，不返回商品源凭据。
- 商品 token 加密落库，不回显。
- 登录页站点按钮必须同时满足已配置 Token 与“站点授权登录”开关开启；关闭开关不清空 Token，不影响商品读取。
- API 版本默认由配置决定，当前常用 `2026-04`。
- 非 Shopify 源会拦截明显危险后台 URL。
- UI 当前主要通过按钮设置默认站点，没有独立站点状态切换控件。

### 相关文件

- `src/features/admin-console/admin-console-sites-template.js`
- `src/features/admin-console/admin-sites-controller.js`
- `src/features/admin-console/admin-sites-editor.js`
- `src/features/admin-console/admin-sites-region-picker.js`
- `src/features/admin-console/admin-sites-product-source-picker.js`
- `server/admin-site-routes.js`
- `server/admin-site-product-source-service.js`

## 5. 前台管理

### 入口

`/admin?view=mascot`

### 用途

管理通用前台模板、各站点专属前台、未绑定前台和前台广告投放记录。

### 表格字段

- 前台
- 绑定站点
- 默认语言
- 知识库
- 商品库 API
- 可触达用户
- 已发广告

### 弹窗字段

- 头像
- 名称
- 绑定站点
- 人设
- 语气
- 问候语
- 知识库只读展示

### 操作

- 编辑通用模板。
- 新建前台。
- 编辑站点前台。
- 编辑未绑定前台。
- 停用站点前台。
- 选择当前站点有效活动并启动真实前台广告投放，查看发送中进度和最终成功/失败数。

### 接口

- `GET /api/admin/mascot`
- `POST /api/admin/mascot`
- `PATCH /api/admin/mascot/template`
- `PATCH /api/admin/mascot/:id`
- `PATCH /api/admin/mascot/sites/:siteId`
- `POST /api/admin/mascot/sites/:siteId/ads`
- `GET /api/admin/mascot/sites/:siteId/ads/campaigns`
- `GET /api/admin/mascot/sites/:siteId/ads/:deliveryId`
- `PATCH /api/admin/mascot/sites/:siteId/disable`

### 规则与边界

- 前台配置写入需要 `admin:mascot:write`；启动广告投放需要 `admin:promotions:write`。
- 编辑器中的“人设”和“语气”分别写入绑定前台角色的 `persona_prompt` 和 `speaking_style`；未编辑该字段时，保存其他前台配置不会重写它们。历史 `mascot_settings.tone` 仅作兼容保存，不进入聊天 prompt。
- 停用站点前台会禁用 mascot setting，归档对应角色，并让站点回到 `mascot_template`。
- 广告活动由服务端按站点、active 状态、开始/结束时间和 `all|mascot` 角色范围筛选；提交时再次校验。
- 后台任务只处理同站点 active 正式账号中已激活当前前台且有正式活跃会话的目标；发送复用活动文字、商品气泡、前台语音和活动去重。管理员手动投放不检查、不占用自动主动消息额度。
- 同一站点同一活动同时只允许一个进行中任务；进度和结果来自持久化逐用户状态，不由前端模拟。
- 前台知识库只展示，绑定/解绑在知识库页面完成。

### 相关文件

- `src/features/admin-console/admin-console-mascot-template.js`
- `src/features/admin-console/admin-mascot-controller.js`
- `src/features/admin-console/admin-mascot-ad-preview.js`
- `src/features/admin-console/admin-mascot-avatar-ai-controls.js`
- `server/admin-mascot-routes.js`
- `server/admin-mascot-write-service.js`
- `server/admin-mascot-campaign-service.js`
- `server/mascot-campaign-delivery-job-service.js`

## 6. 首页轮播

### 入口

`/admin?view=carousel`

### 用途

配置 Discover 首页轮播图。

### 表格字段

- 轮播图
- 绑定站点
- 点击目标
- 排序
- 状态

### 弹窗字段

- 图片上传/裁剪
- 标题
- 小标签
- 绑定站点
- 描述
- 按钮文字
- 点击类型
- 点击目标
- 排序
- 状态

### 操作

- 新增轮播。
- 编辑轮播。
- 上传并裁剪 16:9 图片。
- 选择点击目标角色或 URL。

### 接口

- `GET /api/admin/carousel`
- `POST /api/admin/carousel`
- `PATCH /api/admin/carousel/:id`
- `POST /api/admin/carousel/upload`

### 规则与边界

- 写入/上传需要 `admin:carousel:write`。
- 图片地址只允许 `assets/`、`/uploads/`、`http(s)`。
- 上传受 carousel upload policy 限制。
- 后端支持 `startsAt/endsAt`，当前编辑弹窗没有排期字段。
- 点击类型是进入角色聊天时，目标选择会按绑定站点过滤角色。

### 相关文件

- `src/features/admin-console/admin-console-carousel-template.js`
- `src/features/admin-console/admin-carousel-controller.js`
- `src/features/admin-console/admin-carousel-image-cropper.js`
- `server/admin-carousel-routes.js`
- `server/home-carousel-service.js`

## 7. 广告活动

### 入口

`/admin?view=promotionCampaigns`

### 用途

配置主动消息中的商品广告活动。

### 表格字段

- 活动
- 站点
- 角色范围
- 商品
- 统计
- 时间
- 状态

### 弹窗字段

- 标题
- 站点
- 角色范围
- 状态
- 商品选择
- 折扣码
- 关键词
- 优先级
- 开始时间
- 结束时间
- 主动文案

### 操作

- 筛选站点。
- 筛选状态。
- 搜索活动或商品。
- 新增活动。
- 编辑活动。
- 按站点商品源搜索商品并保存快照。

### 接口

- `GET /api/admin/promotion-campaigns`
- `POST /api/admin/promotion-campaigns`
- `PATCH /api/admin/promotion-campaigns/:id`
- `GET /api/admin/promotion-campaigns/products?siteId=&query=&limit=`

### 规则与边界

- 写入需要 `admin:promotions:write`。
- 后台选品可以使用站点 Shopify Admin 只读 token。
- Shopify Admin token 仅由服务端可信商品目录读取器使用，不进入后台页面、前台页面或接口响应。
- 当前没有主动消息后台配置页。
- 当前没有用户关闭主动消息的前端开关。

### 相关文件

- `src/features/admin-console/admin-console-promotion-campaigns-template.js`
- `src/features/admin-console/admin-promotion-campaigns-controller.js`
- `src/features/admin-console/admin-promotion-campaigns-editor.js`
- `server/admin-promotion-routes.js`
- `server/product-search-admin-service.js`

## 8. 知识库

### 入口

`/admin?view=kb`

### 用途

管理知识文档、分类、优先级、适用范围和绑定对象。

### 表格字段

- 文档
- 分类
- 范围
- 优先级
- 绑定数
- 更新时间

### 弹窗字段

- 名称
- 分类
- 精准关键词
- 模糊关键词
- 优先级
- 适用范围
- 指定对象
- 指定站点
- 简介
- 知识内容

### 适用范围

- 全局通用
- 指定站点
- 指定对象

选择一个范围后，不显示其他范围的选择字段。

### 操作

- 新建知识库。
- 编辑知识库。
- 删除知识库。
- 搜索。
- 分类筛选。
- 指定对象下拉搜索。
- 指定站点下拉选择。

### 接口

- `GET /api/admin/knowledge-bases`
- `POST /api/admin/knowledge-bases`
- `GET /api/admin/knowledge-bases/:id`
- `PATCH /api/admin/knowledge-bases/:id`
- `DELETE /api/admin/knowledge-bases/:id`

### 规则与边界

- 写入需要 `admin:knowledge:write`。
- 创建/编辑/删除会写 `admin_operation_logs`。
- 新建可能调用 AI 生成简介、目录和片段，预计 1 到 2 分钟。
- 编辑会用手动内容重建片段。
- 角色页和前台页只展示知识库，不做绑定操作。

### 相关文件

- `src/features/admin-console/admin-knowledge-controller.js`
- `src/features/admin-console/admin-knowledge-template.js`
- `src/features/admin-console/admin-knowledge-editor.js`
- `src/features/admin-console/admin-knowledge-editor-template.js`
- `src/features/admin-console/admin-knowledge-target-picker.js`
- `server/admin-knowledge-routes.js`
- `server/admin-knowledge-write-service.js`

## 9. 账号管理

### 入口

`/admin?view=accounts`

### 用途

管理普通用户、创作者和运营账号，并以独立顶层标签审计游客会话。

### KPI/表格字段

- 总账号数
- 创作者数
- 本月封禁数
- 账号
- 邮箱
- 所属站点
- 身份
- 状态
- 注册时间

展开详情包含：

- 基础信息
- 资产信息
- 使用数据

游客会话标签包含：

- 有效游客会话、今日参与聊天、今日转注册 KPI。
- 状态、站点和关键词筛选。
- 游客 ID、冻结站点、前台角色、游客阶段消息数、滚动 24 小时额度、语音输入数、附件消息数、通话次数/时长/回合、自拍资格、状态和最后活跃时间。
- 行内基础信息、使用数据、认证承接信息及只读游客阶段对话弹窗。

### 弹窗

- 新增账号
- 编辑资料
- 重置密码
- 对话记录

### 操作

- 类型筛选。
- 站点筛选。
- 搜索。
- 分页。
- 展开详情。
- 正式账号和游客会话展开详情均显示来源页面；正式账号取最近一次已承接游客会话的已验证来源，没有来源时显示 `-`。
- 查看对话。
- 编辑昵称/身份。
- 重置密码。
- 封禁/解封。
- 批量修改站点。
- 批量修改身份。
- 批量封禁。

### 接口

- `GET /api/admin/accounts`
- `POST /api/admin/accounts`
- `PATCH /api/admin/accounts/site`
- `PATCH /api/admin/accounts/:id/status`
- `PATCH /api/admin/accounts/:id/profile`
- `PATCH /api/admin/accounts/:id/password`
- `GET /api/admin/accounts/:id/conversations`
- `GET /api/admin/accounts/:id/conversations/:conversationId`
- `GET /api/admin/accounts/guests`
- `GET /api/admin/accounts/guests/:guestSessionId/conversation`

### 规则与边界

- 写入需要 `admin:accounts:write`。
- 不能把当前管理员自己改成非 admin。
- 不能封禁当前登录管理员。
- 给别人重置密码会清掉对方 token。
- 游客接口只读且必须经过 `requireAdmin()`；响应不返回 guest token 或 token hash。
- 游客消息通过 `chat_messages.guest_session_id` 保留来源；承接到正式会话后，后台仍只读取游客阶段消息。
- 今日参与聊天按 guest session 去重，只有通话而没有普通消息的游客也会计入一次；游客通话不会创建临时 `users` 账号。
- 游客对话单次最多返回最近 200 条原始消息，过期原始消息继续遵守现有保留期。
- 游客“查看对话”按 `chat_messages.display_order` 对齐前台真实消息顺序；`sent_at` 和消息 ID 只用于并列稳定排序。
- 当前存在一个需要关注的边界：前端“选择所有匹配账号”请求大 limit，但后端列表最大限制是 50，批量全选可能最多只选 50 条。

### 相关文件

- `src/features/admin-console/admin-console-accounts-template.js`
- `src/features/admin-console/admin-accounts-controller.js`
- `src/features/admin-console/admin-account-conversations.js`
- `src/features/admin-console/admin-account-management-switch.js`
- `src/features/admin-console/admin-guest-sessions-controller.js`
- `src/features/admin-console/admin-guest-sessions-template.js`
- `src/features/admin-console/admin-guest-session-conversation.js`
- `src/features/admin-console/admin-accounts-bulk-actions.js`
- `server/admin-account-routes.js`
- `server/admin-guest-session-service.js`
- `server/admin-account-write-service.js`

## 10. 错误日志

### 入口

`/admin?view=logs`

### 用途

查看 AI 回复异常和应用异常。

### 字段与筛选

- 级别
- 开始日期
- 结束日期
- 来源
- 日期
- 报错内容
- 分页

### 接口

- `GET /api/admin/error-logs`

### 规则与边界

- 后台读取需要 admin。
- 客户端错误上报 `/api/client-errors/report` 需要登录后才写入。
- 日志来源聚合 `ai_reply_logs` 和 `app_error_logs`。

### 相关文件

- `src/features/admin-console/admin-console-logs-template.js`
- `src/features/admin-console/admin-logs-controller.js`
- `server/admin-log-routes.js`
- `server/ai-reply-log-service.js`

## 11. 静态待办页面

以下页面仍在导航中标注“待”，当前是静态内容或假数据：

- `view=leads`：商家线索（待）
- `view=payments`：交易支付（待）
- `view=costs`：成本与利润（待）

相关文件：

- `src/features/admin-console/admin-console-static-tabs.js`

### 边界

- `view=leads`、`view=payments`、`view=costs` 当前没有对应真实 service 或后台 route。
- 不应把这些页面当作已完成业务功能。

## 12. 折扣码

### 入口

`/admin?view=codes`

### 用途

登记独立站已经创建的折扣码，供后续权益、活动和订单归因功能使用；本页不调用 Shopify 创建、修改或删除折扣。

### 页面与弹窗

- 列表搜索：按 code、优惠说明、网红昵称或邮箱查询。
- 列表筛选：全部站点、全部归属（前台/网红）、全部状态（生效中/未开始/已过期/已停用）。
- 列表字段：折扣码/优惠、归属、站点、有效期、状态、更新时间、编辑。
- 新建/编辑字段：折扣码、站点、归属、网红账号（网红类型时显示）、优惠说明、有效期、开始时间、结束时间、启用状态、备注。
- 页面不显示使用次数；当前没有可信订单归因数据源。

### 输入与规则

- `code` 必填文本，最长 64 字符，服务端保存为大写；同站点忽略大小写唯一，不同站点可同码。
- `site` 必须从 active 站点下拉选择；站点切换会重置网红账号。
- `ownership` 使用前台/网红单选；网红必须是 active creator、同站点并拥有未归档 creator 角色。
- `validity` 使用无限期/固定期限单选；固定期限显示日期时间选择器，结束时间必须晚于开始时间；无限期清空两列时间。
- `enabled` 使用滑动开关；状态不是手填字段，由服务端按启停和时间派生。
- 写入需要 `admin:promotions:write`；只读列表和选项需要 admin。

### 代码与接口

- 前端：`src/features/admin-console/admin-discount-codes-template.js`、`admin-discount-codes-controller.js`、`admin-discount-code-editor.js`、`src/services/discount-code-service.js`。
- 后端：`server/admin-discount-code-routes.js`、`server/discount-code-service.js`、`server/discount-code-normalizers.js`。
- 接口：`GET /api/admin/discount-codes`、`GET /api/admin/discount-codes/options`、`POST /api/admin/discount-codes`、`PATCH /api/admin/discount-codes/:id`。

## 13. 隐藏/遗留入口

- `agents` 旧页仍有模板和 controller，但不在 `ADMIN_NAV` 路由白名单中；直接访问也会回到 overview。
- `Creator Workspace` 入口已临时隐藏。
- 前台 `Kitshop` 入口当前开启；后台 `Kitshop 管理` 也是实际导航页面。
- Admin Console 入口保留。

## 13. 后台样式文件

主要样式入口：

- `src/features/app-shell/app.css`
- `src/features/app-shell/styles/admin-console.css`

拆分样式：

- `src/features/app-shell/styles/admin-character-editor.css`
- `src/features/app-shell/styles/admin-accounts.css`
- `src/features/app-shell/styles/admin-knowledge.css`
- `src/features/app-shell/styles/admin-mascot.css`
- `src/features/app-shell/styles/admin-overview.css`
- `src/features/app-shell/styles/admin-logs.css`
- `src/features/app-shell/styles/admin-promotion-campaigns.css`
- `src/features/app-shell/styles/admin-discount-codes.css`

## 14. Kitshop 管理

入口：`/admin?view=kitshop`。真实读取站点商品缓存、首页栏目和同步时间；站点下拉选择 active 站点，“刷新当前站点”会同步全部有效首页商品栏目、最近 60 天 Shopify 订单销量快照和新的 Best Sellers 混排种子，仅接收 `ACTIVE` 且已发布到 Online Store 的商品，并需要 `admin:kitshop:write`。商品表服务端分页默认 12 条；商品或销量刷新失败时必须明确提示并保留旧缓存，不能用点击热度伪装销量。

详细字段见 [Kitshop 管理页面规范](./pages/admin/03-commerce-knowledge.md)。

## 15. 用户反馈

入口：`/admin?view=feedback`。真实支持关键词/站点筛选、分页、行展开和把 NEW 标记为 DONE；没有编辑、删除或恢复 NEW 操作。标记处理需要 `admin:feedback:write`。

详细字段见 [用户反馈后台页面规范](./pages/admin/04-feedback-accounts-logs.md)。

## 16. 站外嵌入

入口：`/admin?view=externalEmbeds`。管理员按 active 站点维护一条外嵌挂件配置：外站 Origin、图标、独立新消息角标、引导弹窗文案、三色主题、圆角和桌面/手机右下偏移。标题和说明可选中文字后输入受限的 `#RRGGBB` 颜色代码；系统只保存文字位置和合法颜色，不保存任意富文本 HTML。图标上传复用既有头像审核、裁剪和上传链路；留空时使用当前公开前台头像。

发布不是任意跳转器：站点必须启用游客聊天且存在公开、已发布的有效前台，CTA 才由服务端固定生成该站游客聊天链接。保存 published 配置后页面给出一次性安装代码；外站下次加载会远程读取最新样式和文案，无需再次改外站模板。外站公开读取只对保存的精确 Origin 响应，且不返回商品源、账户、Token 或后台配置。详细字段见 [站外嵌入页面规范](./pages/admin/07-external-embed.md)。
