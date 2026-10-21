# 04. Backend Services and Data

更新时间：2026-07-21

## 1. 后端总体结构

### 启动入口

- `server/server.js`

启动流程：

1. 加载配置。
2. 初始化数据库。
3. 启动记忆任务 runner。
4. 启动主动消息 scheduler。
5. 启动 HTTP 服务。
6. 挂载 WebSocket `/ws/call`。
7. 挂载静态文件服务。

### API 路由入口

- `server/routes.js`

主要 route handler：

- `handleAuthRoute`
- `handleAdminRoute`
- `handleProfileRoute`
- `handleProductSearchRoute`
- `handleHomeRoute`
- `handleDemoProductRoute`
- `handleChatRoute`
- `handleCreatorRoute`
- `handleGuestChatRoute`
- `handleCharacterRoute`
- `handleBillingRoute`

`/api/health` 是轻量健康检查。

## 2. 数据库初始化

主要文件：

- `server/db.js`
- `server/db-core.js`
- `server/db-bootstrap-tables.js`
- `server/db-bootstrap-seeds.js`
- `server/db-column-migrations.js`
- `server/db-schema-utils.js`
- `database/schema.sql`

初始化顺序：

1. 连接 MySQL。
2. 跑 pre-schema 兼容迁移。
3. 执行 `database/schema.sql`。
4. 跑字段迁移。
5. 补充 bootstrap 表。
6. 写入 seed。
7. 做必要回填和清理。

重要规则：

- seed 多处使用 `ON DUPLICATE KEY UPDATE id = id` 或只在空值时补默认。
- 目标是避免覆盖后台线上配置。
- 线上发布脚本会保留数据库，不用本地数据库覆盖线上。

## 3. 认证 / 用户 / 账号

### 职责

- 邮箱验证码注册登录。
- Google OAuth。
- 会话签发。
- 当前用户读取。
- 密码重置。
- 登录限速。

### 核心表

- `users`
- `email_verification_codes`
- `oauth_accounts`
- `billing_accounts`

### 核心接口

- `POST /api/auth/email/send-code`
- `POST /api/auth/email/check`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password/reset`
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`

### 关键文件

- `server/auth-routes.js`
- `server/auth-service.js`
- `server/auth-session-service.js`
- `server/auth-user-service.js`
- `server/auth-login-throttle-service.js`
- `server/google-auth-service.js`
- `server/email-code-service.js`
- `server/email-service.js`

### 数据流

注册：

1. 校验邮箱验证码。
2. 解析站点和邀请码。
3. 写入 `users`。
4. 写入 `billing_accounts`。
5. 自动激活站点 mascot。
6. 写入 auth token 和过期时间。
7. 设置 HttpOnly cookie。

登录：

1. 校验邮箱和密码。
2. 检查账号状态。
3. 刷新 auth token。
4. 设置 HttpOnly cookie。
5. 返回用户展示信息。

游客承接：

1. 邮箱注册、邮箱登录或 Google 回调从 HttpOnly guest cookie 读取 guest token。
2. 同站点时在认证事务内锁定 guest、用户和目标会话，转移或稳定合并历史；跨站已有账号保留登录结果但不迁移，跨站新账号整体回滚。
3. 成功后撤销 guest cookie；文字索引与摘要通过可恢复异步任务补建，游客商品、图片、AI 语音、附件和通话审计记录保留在目标会话/账号归属下。

### 安全约束

- 浏览器认证 cookie-only。
- 不再把 token 返回 JSON 给前端。
- 后端只读 cookie token，不接受 Bearer。
- 登录失败文案统一。
- 登录有邮箱/IP 内存限速。
- Google OAuth 有 state cookie 校验。
- guest-bearing 邮箱认证请求校验 Origin/Referer；客户端不能提交 guest/session 内部 ID。

## 4. 站点路由 / 多站点

### 职责

- 根据访问路径、IP、地区、默认站点解析站点。
- 管理站点配置。
- 管理地区归属。
- 管理站点前台和商品源。

### 核心表

- `sites`
- `geo_regions`
- `site_geo_regions`
- `users.site_id`
- `mascot_settings`
- `sites.site_url`
- `sites.site_logo_url`
- `sites.shopify_login_enabled`

### 核心接口

- `GET /api/site/resolve`
- `GET /api/site/branding?siteSlug=<slug>`
- `GET /api/admin/sites`
- `POST /api/admin/sites`
- `PATCH /api/admin/sites/:id`
- `PATCH /api/admin/sites/:id/default`
- `GET /api/admin/geo-regions/search`

### 关键文件

- `server/geo-site-resolver-service.js`
- `server/registration-site-service.js`
- `server/site-region-binding-service.js`
- `server/admin-site-service.js`
- `server/admin-site-product-source-service.js`
- `server/site-branding-service.js`

### 站点与角色语言初始化

- `server/chat-language-preference-service.js` 是新会话输出语言的唯一优先级入口，正式账号和游客会话都调用同一个解析函数。
- 管理员创建、后台维护及系统预置角色的新会话优先使用可信站点 `default_language`；角色资料内保存的语言只作站点语言缺失时的兜底，因此管理员无需为同一角色复制多语言版本。
- 用户创建且 `source_type=user` 的角色优先使用创建时选择并写入角色资料的语言，站点默认语言只作兜底，不能覆盖用户选择。
- 已有会话保存自己的 `preferred_language`；正式用户已有激活偏好和用户在聊天中明确提出的语言切换继续按现有规则生效。
- 该服务只决定模型、TTS 与实时通话的输出语言，不翻译角色人设、商品、知识库或其他业务数据。

### 数据流

1. 路径/注册参数/邀请码/IP/默认站点进入解析。
2. 得到 `site_id` 和 `slug`。
3. 用站点限制角色、商品源、mascot、首页轮播和用户归属。
4. 用户侧按 slug 读取公开品牌白名单；`site_url` 为空时可从同站点 active 可信商品缓存的公开 URL 推导 storefront origin。

### 边界

- 邀请码注册要求邀请码所属站点与当前站点一致。
- 普通用户不能自由跨站点访问站点特定角色。
- Geo IP 查询跳过私网 IP。
- 公开品牌只包含 `siteId/name/slug/siteUrl/logoUrl` 及安全布尔值 `hasProductAccessToken/shopifyLoginEnabled`；无效或停用站点返回 404，不回退默认站，也不暴露 Shopify Admin 配置。无前缀入口使用的 Geo/default 站点解析返回相同品牌与开关字段，避免首次登录页丢失站点授权入口状态。

## 5. 角色 / Mascot / 激活

### 职责

- 公开角色列表。
- 角色详情。
- 普通用户创建角色。
- 用户激活角色。
- 注册后自动激活站点 mascot。
- 站点 mascot 切换保护。

### 核心表

- `ai_characters`
- `character_categories`
- `user_character_activations`
- `chat_sessions`
- `mascot_settings`

### 核心接口

- `GET /api/characters`
- `GET /api/characters/:id`
- `POST /api/characters`
- `POST /api/characters/:id/activate`
- `POST /api/characters/polish`
- `POST /api/characters/generate-avatar`

### 关键文件

- `server/character-routes.js`
- `server/character-public-service.js`
- `server/character-service.js`
- `server/character-creation-service.js`
- `server/character-admin-service.js`
- `server/character-owner-constraint.js`
- `server/character-activation-service.js`
- `server/mascot-activation-service.js`
- `server/mascot-site-guard-service.js`

### 数据流

1. 用户注册或手动激活角色。
2. 写入或更新 `user_character_activations`。
3. 找到或创建 `chat_sessions`。
4. 前端进入对应聊天页。

### 边界

- creator 角色按站点过滤。
- 同一 `owner_uid` 最多有一个未归档 creator 角色；业务层负责友好错误，`ai_characters.active_creator_marker` 与唯一索引负责并发兜底。
- archived creator 不占用名额；存在替代角色时恢复旧角色由数据库确定性拒绝。普通非 creator 角色不受该索引限制。
- 普通后台编辑不能更换 creator 的 owner，也不能在 creator 与普通分类之间转换；owner 失效或站点停用不阻止归档，但恢复时重新校验 owner、站点和唯一性。
- 唯一性迁移遇到历史重复数据会中止启动且不自动清理，发布前需先做线上只读重复审计。
- mascot 只展示当前站点绑定角色或模板 fallback。
- 站点切换会停用旧 mascot 并激活新 mascot。
- stale mascot 继续发消息时，会返回系统提示而不是正常 AI 回复。

## 6. 聊天 / AI 回复 / 记忆

### 职责

- 联系人列表。
- 消息读取。
- 用户文本消息。
- AI 回复。
- 商品气泡。
- 记忆索引。
- 摘要任务。

### 核心表

- `chat_sessions`
- `chat_messages`
- `chat_message_index`
- `user_memory_records`
- `user_memory_links`
- `conversation_summaries`
- `memory_jobs`
- `ai_reply_logs`
- `guest_sessions`
- `guest_image_entitlements`

### 核心接口

- `GET /api/chat/contacts`
- `GET /api/characters/:id/messages`
- `POST /api/characters/:id/messages`
- `POST /api/characters/:id/messages/reply`
- `GET /api/characters/:id/quick-replies`
- `GET /api/guest/capability`
- `GET /api/guest/session`
- `POST /api/guest/messages`
- `POST /api/guest/uploads/chat`
- `DELETE /api/guest/uploads/chat/:attachmentId`
- `POST /api/guest/voices`
- `POST /api/guest/voices/:messageId/reply`

### 关键文件

- `server/chat-routes.js`
- `server/chat-service.js`
- `server/chat-text-message-service.js`
- `server/chat-query-service.js`
- `server/chat-message-store.js`
- `server/chat-reply-orchestrator-service.js`
- `server/ai-reply-service.js`
- `server/chat-prompt-service.js`
- `server/chat-prompt-layers.js`
- `server/chat-memory-service.js`
- `server/guest-chat-service.js`
- `server/guest-auth-claim-service.js`
- `server/guest-claim-context-job-service.js`

### 回复数据流

1. 用户消息入库。
2. 写入索引。
3. 投递记忆/摘要 job。
4. 单独触发 reply。
5. 拉取短期历史、长期记忆、商品上下文、知识库、人设。
6. AI 生成结构化回复。
7. 可插入商品卡。
8. 写入文本回复。
9. 生成 TTS voice asset。
10. 更新 session。

### 边界

- 商品卡和补充文本必须同源。
- AI 回复有结构化合约、fallback 和质量规则。
- 普通聊天和主动消息都应走非流式文本生成。
- 错误经全局 API route 捕获并记录 `app_error_logs`。

## 7. 语音 / 实时通话

### 职责

- 语音上传 ASR。
- AI 回复 TTS。
- 实时电话 WebSocket。

### 核心表

- `character_voice_assets`
- `chat_messages`
- `guest_call_sessions`
- `app_error_logs`

### 核心接口

- `POST /api/characters/:id/voices`
- `POST /api/characters/:id/voices/:messageId/reply`
- WebSocket `/ws/call`

### 关键文件

- `server/chat-voice-message-service.js`
- `server/chat-reply-voice-service.js`
- `server/chat-reply-speech-service.js`
- `server/elevenlabs-stt-service.js`
- `server/elevenlabs-tts-service.js`
- `server/call-realtime-service.js`
- `server/call-session-service.js`
- `server/call-turn-service.js`
- `server/call-input-guard-service.js`
- `server/guest-call-usage-service.js`

### 数据流

语音消息：

1. 上传音频。
2. 校验类型、大小、文件头。
3. 调 ElevenLabs STT。
4. 将转写文本作为用户消息入库。
5. 触发 AI 回复。
6. 生成 TTS。

实时通话：

1. WebSocket 鉴权。
2. 前端发送 `start_call`。
3. 音频分 turn 发送。
4. STT 生成 final transcript。
5. 后端生成回复。
6. 返回文本和音频。

### 安全约束

- 用户上传的原始语音只存在于当前请求内，用于完成文件校验和 ASR；服务端不将原始音频写入磁盘、对象存储、voice asset 或聊天消息。
- ASR 完成后仅把转写文本作为普通用户消息保存，并保留轻量的 `voice-asr` 来源标记；AI 回复语音仍按独立的 TTS asset 规则管理。
- WebSocket upgrade 先校验 exact Origin，再接受有效正式登录或有效 guest HttpOnly cookie；失效正式身份不能降级为游客。
- 游客 call 只允许冻结站点前台；成功落库的最终转写通过稳定 call/turn key 占用共享 30 条消息额度，不执行独立分钟额度。持久通话账本继续记录审计时长，并执行 guest/network 单活跃和全局并发限制。
- 同站点认证承接会为全部 call 记录写入 `claimed_user_id` 与 `target_chat_session_id`；进行中的 call 结算实际审计时长并关闭，不按分钟额度封顶。过期清理只删除未承接 call，claimed call 随正式账号审计数据保留。
- WebSocket 单包、音频格式/速率、诊断频率和 Provider 背压均有服务端硬限制；未知 Upgrade 会立即关闭。
- 游客 listening 状态连续 90 秒没有语音输入、连续 2 分钟没有 final transcript，或单个连续 listening turn 超过 4MB 音频时会关闭异常连接。guard 触发的无 final 时长跨 call 持久累计，同游客/网络分别使用 10/20 分钟滚动 24 小时失败输入预算；正常 final 回合不计入，因此不构成整通正常对话时长限制。
- 上次成功 final 后的音频以 `pending_input_milliseconds` 周期落账；成功 final 在消息事务内清零，其他终止路径转入 `guarded_input_milliseconds`。同游客/网络 10 分钟最多启动 10 通，防止阈值前主动断线或进程中断循环绕过。
- pending 输入使用 `pending_input_epoch` 隔离跨 final 的旧 meter 快照；guarded 预算以 `guarded_input_updated_at` 的异常发生时间计算滚动窗口。成功回复后的 `awaiting_resume` 最多保留 90 秒，随后释放活跃通话容量。
- 上传拒绝可执行文件签名、扩展名不匹配和伪造 MIME。
- 语音上传最大 10MB。

## 8. 商品 / 商品源 / 商品埋点

### 职责

- 前台商品搜索。
- 商品详情补齐。
- 后台活动选品。
- 站点商品源配置。
- 商品详情使用统一站点公开品牌。
- 商品气泡埋点。

### 核心表

- `sites.product_api_url`
- `sites.product_source_type`
- `sites.product_access_token_encrypted`
- `sites.shopify_login_enabled`
- `product_analytics_events`
- `chat_messages.product_payload_json`
- `site_product_cache`
- `site_home_product_sections`
- `site_kitshop_sales_cache`
- `sites.site_logo_url`

### 核心接口

- `GET /api/products/search`
- `POST /api/products/resolve`
- `GET /api/admin/promotion-campaigns/products`
- `POST /api/analytics/product-events`
- `GET /api/site/branding?siteSlug=<slug>`

### 关键文件

- `server/product-search-service.js`
- `server/product-search-public-service.js`
- `server/product-search-admin-service.js`
- `server/product-source-service.js`
- `server/product-source-http-service.js`
- `server/product-source-shopify-admin-service.js`
- `server/product-source-shopify-public-service.js`
- `server/product-source-ttmall-service.js`
- `server/product-checkout-resolver-service.js`
- `server/product-analytics-service.js`
- `server/product-search-analytics-receipt-service.js`
- `server/admin-product-analytics-service.js`
- `server/kitshop-service.js`
- `server/kitshop-shelf-builder.js`
- `server/shopify-order-sales-service.js`
- `server/site-branding-service.js`

### 数据流

1. 站点 slug 解析为站点。
2. 读取站点商品源。
3. 站点绑定 Shopify Admin 商品源时，Kitshop、搜索、推荐、游客商品卡、活动选品和详情刷新均由服务端可信商品目录读取器使用加密 token；token 不下发客户端。
   站点绑定 TTMall 时，同一入口复用统一商品源 facade；服务端以网站 ID 自动换取短期 JWT，并读取搜索、单品详情、首页楼层、网站信息和尺码表。JWT 只保存在进程内存中。普通搜索只补齐必要数量的商品详情；带年龄硬条件时补齐本次全部候选，避免第 17 个以后的商品因缺少尺码数据被误判为不存在。
4. 商品统一执行 `ACTIVE + onlineStoreUrl` 可见规则；独立站主题中的登录显隐不改变 Alove 商品目录。
5. 搜索结果归一化为统一商品结构。Shopify Admin 商品读取先以本站已配置币种查询 Shopify Markets，只在该币种唯一匹配一个 active `MarketRegionCountry` 时，将 Shopify 返回的实际国家代码传入 `contextualPricing`；每个 variant 的现价、划线价和币种都取该市场返回的 `amount/currencyCode`，产品展示最低价从全部已读取 variant 的市场现价确定。不得用 `shop.currencyCode`、`variant.price` 或 `variant.compareAtPrice` 把基础商店币种/基础价格伪装成当前市场价；无匹配或多国歧义时不猜测价格。
6. 商品点击、曝光、详情、跳转写入 analytics；Chat 事件必须关联当前用户实际会话中的商品消息，角色/owner/站点/商品由服务端反查。Search 与 Kitshop 的曝光、点击、详情和跳转使用服务端随当前商品响应签发的短时 HMAC 回执，回执绑定用户、站点、商品和入口；不接受前端指定来源。服务端商品触发事件不接受客户端提交；同一正式账号、入口、商品、事件在 30 分钟窗口去重，并使用数据库 advisory lock 缩小并发重复窗口；当前没有声明数据库级 exactly-once。游客不写入正式用户商品 analytics。
7. 选择尺码后使用同一可信商品源 resolve checkout URL；失败时保留原商品快照。
8. Kitshop 每 4 小时或管理员手动刷新时，通过 Shopify `read_orders` 只读聚合最近 60 天订单；普通登录请求先返回缓存并在需要时调度后台刷新，同一站点通过进程内 single-flight 和数据库 advisory lock 避免重复同步。订单及 line item 均完整分页，整次销量同步限制在 30 秒内；只保存商品销量排名、订单汇总数、同步状态和混排种子，不保存订单、邮箱、地址或客户资料。
   TTMall 当前没有接入订单销量接口，不执行 Shopify order service；其第一层沿用首页接口首个有效楼层，`Best Sellers` 从其余公开楼层不重复补足并稳定混排。
9. `Best Sellers` 选择最近 30 天净销量前五、最近 60 天最多五个未重复热销商品，再从首页其他栏目随机补足到最多 15 件，并在同一销量快照内保持稳定顺序。
10. 商品详情按商品稳定 `siteSlug` 读取当前站点品牌；历史消息无需复制或迁移 Logo。显式 Logo 失败时前端继续尝试站点 favicon、商品 URL favicon和 globe。

### 安全约束

- Shopify Admin token 只在服务端解密并用于只读查询，不进入 URL、响应、日志或浏览器状态。
- TTMall 临时 JWT 不落库、不回显、不进入错误文本或日志；401 时最多刷新一次。API、storefront 与 CDN 主机执行 HTTPS/SSRF 公网校验，请求拒绝跟随重定向；Token 和网站信息缓存有一小时最长 TTL 与 64 个来源上限。
- TTMall 商品价格是以上游 USD 裸价及 `/v1/website` 返回的 `exchange_rate` 换算成当前站点币种；USD 使用 1:1。未返回目标币种汇率时价格留空，禁止把裸价格直接改币种标签。TTMall 未提供变体购物车时统一详情面板使用 `purchaseMode=product_detail` 跳转可信公开商品页。
- 游客商品接口继续执行站点开关、Origin、网络额度和商品字段清洗；能够读取可信目录不等于获得 Admin 权限。
- 普通正式账号的商品 Search、Resolve 与 Kitshop 固定到 active 的账号所属站点；管理员可跨站。所有入口使用严格站点解析，不允许无效/停用站点回退默认站。正式账号商品请求按账号和站点执行 10 分钟窗口额度与最多 2 个同时在途请求；Search、Resolve、Kitshop 和聊天商品消息均剥离内部 `sourceItem` 和精确 `inventoryQuantity`。新聊天商品消息保存前清洗，旧消息由读取映射清洗。
- HTTP 商品源有 SSRF 防护。
- 拒绝 localhost、私网、`.local/.internal`、认证 URL。
- Shopify Admin token 加密落库且不回显。
- 订单销量只统计已支付、部分支付或部分退款订单的 `currentQuantity`；测试、取消、全额退款和已移除数量不计入。
- Shopify 订单读取失败时保留旧销量快照；没有旧快照时只使用首页其他公开商品，不得回退成点击热度并伪装为销量。

## 8.1 Creator 个人统计

### 职责

- 为当前 creator 账号读取本人唯一 creator 角色的 7/30/90 天表现。
- 返回会话、商品触发、独立站跳转、跳转率、自然日趋势、受众留存和可信商品 Top 5。
- 使用当前周期之前的等长周期计算环比；任一比率无定义时不伪造环比。

### 核心接口与文件

- `GET /api/creator/analytics?range=7d|30d|90d`
- `server/creator-routes.js`
- `server/creator-analytics-service.js`

### 可信边界

- 只接受 creator 登录态；账号、站点和 owner 来自服务端 session/数据库，客户端不能指定。
- 查询先解析当前账号、当前站点中唯一未归档 creator 角色，所有指标固定到该 `character_id`；无角色时返回合法空数据，不跨账号回退。
- 正式会话要求 `chat_sessions.internal_uid IS NOT NULL`，用户消息要求 `sender_type=user + delivery_status=sent`；未承接游客不进入统计。
- Product triggers/Store visits 必须通过 `product_analytics_events.message_id -> chat_messages -> chat_sessions -> ai_characters` 反查，并要求事件用户等于会话用户、商品快照站点一致。
- 趋势先按角色和总周期限定数据，再一次扫描完成自然日分桶；不逐日发起 N+1 查询。
- 发布脚本在切换 `current` 和重启服务前运行 `scripts/creator-character-owner-audit.mjs`；发现同一 owner 有多个未归档 creator 角色时中止发布，不自动归档或删除生产数据。

## 9. 广告活动

### 职责

- 后台创建促销活动。
- 匹配主动消息上下文。
- 发送广告文本和商品气泡。
- 投递去重。

### 核心表

- `promotion_campaigns`
- `promotion_campaign_deliveries`
- `mascot_ad_deliveries`
- `mascot_ad_delivery_targets`
- `chat_messages`

### 核心接口

- `GET /api/admin/promotion-campaigns`
- `POST /api/admin/promotion-campaigns`
- `PATCH /api/admin/promotion-campaigns/:id`
- `GET /api/admin/promotion-campaigns/products`

### 关键文件

- `server/promotion-campaign-service.js`
- `server/promotion-campaign-match-service.js`
- `server/promotion-campaign-query-service.js`
- `server/promotion-campaign-write-service.js`
- `server/chat-proactive-message-service.js`
- `server/admin-mascot-campaign-service.js`
- `server/mascot-campaign-delivery-job-service.js`

### 数据流

1. 活动按站点、状态、时间筛选。
2. 根据角色范围、关键词、商品标题、最近消息打分。
3. 预留 campaign delivery。
4. 写广告文本。
5. 写商品气泡。
6. 完成 delivery。

手动前台投放从后台选择指定活动后立即建立持久化任务，按小批次处理同站点前台会话。每个目标仍需通过活动去重和账号/站点/前台/会话校验；管理员手动投放不进入账号级自动主动消息额度，也不受上一条主动消息未回复门禁影响。进程中断后的 running job 会恢复，消息 source ref 用目标 ID 保证提交后重放不重复。

### 边界

- 同账号同活动唯一投递。
- 商品快照优先于运行时拼凑。
- 发送失败会回滚 reserved delivery。

## 9.1 折扣码登记

### 职责

- 登记独立站已有的站点码和 creator 码。
- 为后台提供列表、搜索、归属和状态筛选，以及新建/编辑。
- 不调用 Shopify 折扣创建、修改或删除接口。

### 核心表

- `discount_codes`

字段边界：`site_id`、`ownership_type`、`creator_uid`、`offer_description`、`validity_mode`、`starts_at`、`ends_at`、`is_enabled`、`notes` 和审计时间；`(site_id, code)` 唯一约束使用数据库当前大小写不敏感排序规则。

`Current locally`：新增 Shopify 规则快照字段 `shopify_discount_id`、`shopify_discount_type`、`shopify_status`、`shopify_rule_json`、`shopify_synced_at`。管理员搜索只用于候选展示；创建和编辑时服务端必须按当前站点重新调用 `codeDiscountNodeByCode`，数据库不接受前端提交的优惠类型、力度、门槛或有效期。Shopify 不可读、code 不存在或结构未知时写入失败关闭。

商品详情使用规则快照前执行 15 分钟 TTL。候选读取覆盖当前 owner 的 enabled 记录，不先用旧的 `starts_at/ends_at` 永久排除，从而允许 Shopify 提前开始或延长优惠在 TTL 后恢复。快照过期或 `SCHEDULED` 到达 `starts_at` 时按 `site + code` 合并并发刷新。

刷新写回使用记录 ID、站点、code 与旧 `shopify_synced_at` 乐观锁；并发编辑导致零行更新时不返回未落库结果。Provider 失败时本次不返回该优惠，输出不含 token 的结构化 warning，并对相同 `site + code` 冷却 60 秒。搜索端点要求促销写权限，并使用 15 秒查询缓存和管理员级频率限制保护 Shopify GraphQL 配额。

### 核心文件和接口

- `server/discount-code-normalizers.js`：枚举、时间、布尔值和派生状态。
- `server/shopify-discount-catalog-service.js`：站点隔离的 Shopify 折扣候选搜索、exact code 查询和规则白名单映射。
- `server/discount-code-snapshot-service.js`：快照 TTL、scheduled 到点刷新、并发合并和失败关闭。
- `server/discount-code-service.js`：active 站点/creator 关系校验、Shopify 二次核验、CRUD 和列表筛选。
- `server/discount-code-eligibility-service.js`：按角色归属返回可用 code；只有确定可计算的规则附带 `pricingPreview`。
- `server/admin-discount-code-routes.js`：管理员权限与 HTTP 响应。
- `GET/POST/PATCH /api/admin/discount-codes`、`GET /api/admin/discount-codes/options` 与 `GET /api/admin/discount-codes/shopify-search`。

写入需要 `admin:promotions:write`；creator 归属必须同站点 active creator 且存在未归档 creator 角色。`scheduled / active / expired / disabled` 只在读取 DTO 中派生，不持久化展示状态；没有订单归因前不生成或展示使用次数。

## 10. 主动消息

### 职责

- 定时扫描账号。
- 按账号级额度触达。
- 角色轮换。
- quiet hours。
- 广告接入。
- 失败回滚。

### 核心表

- `proactive_message_deliveries`
- `memory_jobs`
- `chat_sessions`
- `chat_messages`
- `promotion_campaign_deliveries`

### 关键文件

- `server/proactive-message-scheduler-service.js`
- `server/proactive-message-job-service.js`
- `server/proactive-message-delivery-service.js`
- `server/proactive-message-gate-service.js`
- `server/proactive-message-context-service.js`
- `server/chat-proactive-message-service.js`

### 当前规则

- 每天每账号 1 到 2 次共享额度。
- 第 1 条是 daily required。
- 第 2 条需要用户在上一条主动消息后回复过。
- 只允许 `mascot` / `creator`。
- queued/running 去重按账号。
- 自动匹配的广告和普通主动消息共用账号额度；管理员从前台管理显式启动的手动广告不使用该额度。

### 并发保护

`proactive_message_deliveries` 使用唯一键：

`internal_uid + delivery_date + slot_index`

防止并发重复发送。

## 11. 知识库

### 职责

- 后台 AI 拆分知识库。
- 知识库 CRUD。
- 站点/角色绑定。
- 聊天回复检索引用。

### 核心表

- `knowledge_bases`
- `knowledge_sections`
- `knowledge_base_bindings`

### 核心接口

- `GET /api/admin/knowledge-bases`
- `POST /api/admin/knowledge-bases`
- `GET /api/admin/knowledge-bases/:id`
- `PATCH /api/admin/knowledge-bases/:id`
- `DELETE /api/admin/knowledge-bases/:id`

### 关键文件

- `server/admin-knowledge-service.js`
- `server/admin-knowledge-write-service.js`
- `server/knowledge-retrieval-service.js`
- `server/knowledge-scope-service.js`
- `server/knowledge-ai-service.js`

### 数据流

1. 后台提交原始文本。
2. Knowledge AI 生成 outline/section。
3. 写入 base、sections、bindings。
4. 聊天时按 character/site/scope 找可用知识库。
5. 用精准/模糊关键词匹配。
6. 命中后检索 section。
7. 注入 prompt 给 AI。

### 边界

- scope 支持 global、site、targeted。
- 删除知识库会清理 bindings 和 sections。
- AI 只生成结构化 JSON，失败会抛出明确错误。

## 12. 后台 / 审计 / 静态和上传

### 职责

- 后台管理 API。
- 操作日志。
- 错误日志。
- 静态资源服务。
- 上传安全。

### 核心表

- `admin_operation_logs`
- `app_error_logs`
- `ai_reply_logs`

### 关键文件

- `server/admin-routes.js`
- `server/route-utils.js`
- `server/app-error-log-service.js`
- `server/admin-operation-log-service.js`
- `server/static-file-service.js`
- `server/upload-security.js`
- `server/upload-policies.js`

### 安全约束

- 后台 API 统一要求 admin。
- 写操作按 scope 细分。
- 静态服务只开放必要目录。
- 阻断 `server/`、`database/`、`docs/`、`logs/`、`scripts/`、`node_modules/` 等路径。

## 13. 支付/充值当前状态

### 当前功能状态

- 余额读取保留。
- 后台资产展示保留。
- 前台充值下单接口返回 `403`。
- 直接充值结算接口返回 `403`。

### 原因

当前没有接真实支付回调验签、订单真实性校验、金额校验，所以充值写余额链路已休眠。

### 恢复前必须补齐

- 真实支付订单创建。
- 第三方支付回调验签。
- 订单状态校验。
- 金额校验。
- 幂等处理。
- 退款/异常状态处理。
