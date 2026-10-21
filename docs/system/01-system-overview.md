# 01. System Overview

更新时间：2026-07-13

## 1. 项目定位

`alove-page-rebuild` 是 AIOVE 当前活跃的新前端重建项目。

这个项目不是旧项目的简单换皮，而是：

- 前端按新 UI 和新体验重新搭建；
- 后端能力按页面需要逐步迁移；
- 数据库优先复用旧项目已有结构和数据；
- 旧项目 `companion-core` 只作为能力来源、接口来源和历史逻辑参考。

真实源码目录：

`/Users/cheng/Projects/alove-workspace/alove-page-rebuild`

旧项目参考目录：

`/Users/cheng/Projects/alove-workspace/companion-core`

## 2. 系统核心概念

### 2.1 用户账号

系统里主要有三类账号：

- `personal`
  - 普通用户。
  - 可以登录、聊天、创建普通私密/公开角色、激活角色、使用商品推荐。
- `creator`
  - 主播/创作者账号。
  - 可作为网红角色的绑定账号。
  - 首页侧栏提供 Creator Workspace，个人统计在本地已接入真实只读接口。
- `admin`
  - 管理员。
  - 可以进入 Admin Console。
  - 可以管理账号、站点、角色、前台、轮播、广告活动、知识库、错误日志等。

账号归属站点由 `users.site_id` 保存。用户首次注册/登录时会根据站点路由、IP/地区或默认站点分流。管理员也可以在后台修改用户归属站点。

### 2.2 站点

系统支持多站点。

当前主要站点：

- `gogoalshop`
  - 默认站点。
  - 站点 ID：`site_gg`
- `footballkituk`
  - FKK 站点。
  - 站点 ID：`site_fkk`

站点能力包括：

- 站点 slug 路由；
- 默认语言；
- 目标地区；
- 绑定前台 mascot；
- 商品源配置；
- 首页轮播过滤；
- creator 角色过滤；
- 用户归属。

站点路由格式：

```txt
/:siteSlug/login
/:siteSlug/register
/:siteSlug/forgot-password
/:siteSlug/discover
/:siteSlug/search
/:siteSlug/create
/:siteSlug/chat?agent=<characterId>
```

未带站点前缀时，前端会先请求 `/api/site/resolve`，再进入对应站点路径。

### 2.3 角色

角色主表是 `ai_characters`。

主要角色类型：

- `mascot`
  - 前台角色。
  - 由站点绑定或默认模板提供。
  - 新用户注册后会激活对应站点前台。
- `creator`
  - 网红角色。
  - 通常绑定 creator 账号和站点。
  - 可以参与主动消息和商品推荐。
- 通用角色
  - 不绑定具体站点。
  - 可以公开或私密。
  - 后台通用角色页管理。
- 用户私密角色
  - 普通用户在 Create 页面创建。
  - 默认私密，用户可以选择公开。

角色状态：

- `published`
  - 已上架/可正常展示和聊天。
- `archived`
  - 已下架。
  - 对话记录保留，但聊天输入、通话按钮等需要禁用。
- `draft`
  - 草稿或未发布。

### 2.4 聊天会话

聊天由以下数据组成：

- `user_character_activations`
  - 用户激活了哪些角色。
- `chat_sessions`
  - 用户和角色的会话。
- `chat_messages`
  - 对话消息，包括文本、附件、商品卡、系统提示等。
- `character_voice_assets`
  - AI 回复或主动消息生成的语音资产。

发送消息链路：

1. 前端发送用户消息到 `POST /api/characters/:id/messages`。
2. 后端写入用户消息。
3. 前端延迟触发 `POST /api/characters/:id/messages/reply`。
4. 后端组织上下文、角色人设、商品信息、知识库、记忆。
5. AI 生成回复。
6. 写入角色文字消息。
7. 生成语音并关联到消息。

### 2.5 商品推荐

商品推荐主要用于：

- Chat 商品气泡；
- Chat 商品详情；
- Search 页商品搜索；
- 广告活动选品；
- 商品点击/跳转统计。

商品源配置在 `sites` 表中：

- `product_api_url`
- `product_source_type`
- `product_shop_domain`
- `product_api_version`
- `product_access_token_encrypted`
- `shopify_login_enabled`

当前 Shopify Admin token 加密落库，不回显到前端。站点绑定 Admin 商品源时，搜索、推荐、活动选品和详情刷新由后端可信商品目录读取器使用 token；浏览器和接口响应始终不接触 token。`shopify_login_enabled` 只控制登录页站点授权按钮，不影响上述商品链路。

### 2.6 广告活动

广告活动由后台 `广告活动` 页面创建。

核心能力：

- 选择站点；
- 选择商品；
- 设置关键词；
- 设置角色范围；
- 设置开始/结束时间；
- 设置折扣码；
- 设置主动文案；
- 在主动消息命中时发送广告文字和商品气泡。

同一个账号同一个活动只会投递一次。

### 2.7 主动消息

主动消息当前规则：

- 只允许 `mascot` 和 `creator` 参与；
- 每个账号每天 1 到 2 次；
- 多角色共享账号级额度；
- 第 1 次是每日必达 slot；
- 第 2 次需要用户在上一条主动消息后回复过；
- 如果账号有多个可主动触达角色，会尽量轮换；
- 自动主动消息匹配到广告活动时，也占用同一账号级主动消息额度；管理员从前台管理显式启动的手动广告不使用该额度，另按活动/账号去重和手动投放任务状态管理。

关键表：

- `proactive_message_deliveries`
- `promotion_campaign_deliveries`
- `memory_jobs`
- `chat_messages`

### 2.8 知识库

知识库用于给 AI 回复提供参考。

知识库范围：

- `global`
  - 全局通用，所有角色可用。
- `site`
  - 指定站点可用。
- `targeted`
  - 指定对象/角色可用。

知识库检索不是每次都读所有内容，而是先根据角色和站点找可用知识库，再用精准/模糊关键词命中，命中后才检索 section 并注入回复上下文。

## 3. 页面地图

### 3.1 用户侧页面

- 登录：`/:siteSlug/login`
- 注册：`/:siteSlug/register`
- 忘记密码：`/:siteSlug/forgot-password`
- 广场/首页：`/:siteSlug/discover`
- 搜索：`/:siteSlug/search`
- Kitshop：`/:siteSlug/kitshop`
- 创建角色：`/:siteSlug/create`
- 聊天：`/:siteSlug/chat?agent=<characterId>`
- 404：`/:siteSlug/404`

### 3.2 用户侧弹窗/面板

- 个人资料弹窗
- 邀请码 Tab
- 商品详情面板
- 实时通话弹窗
- 创建角色头像裁剪/生成弹窗
- 角色激活确认弹窗
- 用户反馈弹窗

### 3.3 后台管理页面

后台入口：

`/admin?view=<key>`

主要 view：

- `overview`：概览
- `creatorCharacters`：网红角色
- `commonCharacters`：通用角色
- `sites`：站点管理
- `mascot`：前台管理
- `carousel`：首页轮播
- `kitshop`：Kitshop 管理
- `promotionCampaigns`：广告活动
- `kb`：知识库
- `feedback`：用户反馈
- `accounts`：账号与游客会话
- `logs`：错误日志

静态待办 view：

- `leads`：商家线索（待）
- `codes`：折扣码登记与管理（Current / Local verified，尚未部署线上）
- `payments`：交易支付（待）
- `costs`：成本与利润（待）

## 4. 权限模型

前端权限：

- `discover/search/kitshop/create/chat`：登录用户可访问；站点开启游客能力时，游客也可浏览这些页面并按游客边界使用当前前台 Chat。
- `creator`：`creator` 或 `admin` 可访问，但入口当前隐藏。
- `admin`：仅 `admin` 可访问。
- 无权限访问受限页面时，前端显示 404。

后端权限：

- 普通 API 通过 `requireAuth` 判断登录。
- 后台 API 统一通过 `requireAdmin`。
- 后台写操作进一步按 scope 判断，如：
  - `admin:accounts:write`
  - `admin:sites:write`
  - `admin:characters:write`
  - `admin:knowledge:write`
  - `admin:promotions:write`

当前没有“后台权限管理 UI”。

## 5. 当前重要边界

- `Creator Workspace` 页面代码还在，但入口临时隐藏。
- `Kitshop` 入口当前在本地开启并接真实 API；线上状态需按当前 release 核验。
- 充值/支付接口保留但休眠，不能作为真实支付链路。
- Google OAuth 代码已接入，但线上真实链路需要检查服务器访问 Google API 的状态。
- 管理后台部分待办页是静态内容，不是完整功能。
- `api/health` 只是轻量健康检查，不代表数据库、AI、商品、语音全部可用。
