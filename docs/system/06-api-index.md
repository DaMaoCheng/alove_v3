# 06. API Index

更新时间：2026-07-21

本文档按业务域整理主要 API。

## 1. Health

### `GET /api/health`

用途：

- 轻量健康检查。

返回：

- `ok`
- `status`
- `service`

边界：

- 不代表数据库、AI、商品、语音全部可用。

## 2. Site

### `GET /api/site/resolve`

用途：

- 根据访问请求/IP/Cloudflare header/默认站点解析站点。

使用方：

- 前端启动时未带站点前缀的路由。

返回补充：

- `siteUrl`
- `logoUrl`
- `hasProductAccessToken`
- `shopifyLoginEnabled`

边界：

- 返回的两个 Shopify 字段仅为安全布尔值，不包含 Token；无前缀入口通过该接口完成站点分流后，登录页与明确站点品牌接口使用相同的按钮显示条件。

### `GET /api/site/branding`

用途：

- 按明确 `siteSlug` 读取用户侧安全站点品牌，供登录页、Kitshop 和商品详情共用。
- 额外返回不含密钥内容的 `hasProductAccessToken` 与 `shopifyLoginEnabled` 布尔值；登录页仅在二者都为 `true` 时展示 Shopify 预留入口，绝不返回 Token 明文或密文。

常见 query：

- `siteSlug`

返回：

- `siteId`
- `name`
- `slug`
- `siteUrl`
- `logoUrl`
- `hasProductAccessToken`
- `shopifyLoginEnabled`

边界：

- 只允许 active 站点；无效 slug、保留路径或停用站点返回 404，不回退默认站。
- 不返回 Shopify Admin 域名、token、商品源、地区绑定、用户数或后台备注。
- `site_url` 为空时，可从同站点 active 可信商品缓存的公开商品 URL 推导 origin。

## 3. Auth

### `POST /api/auth/email/send-code`

用途：

- 发送注册或忘记密码验证码。

常见 body：

- `email`
- `scene`

### `POST /api/auth/email/check`

用途：

- 检查邮箱是否可用。

### `POST /api/auth/register`

用途：

- 注册账号。

常见 body：

- `email`
- `password`
- `displayName`
- `emailCode`
- `inviteCode`
- `siteSlug`

### `POST /api/auth/login`

用途：

- 邮箱密码登录。

### `POST /api/auth/logout`

用途：

- 清除登录态。

### `GET /api/auth/me`

用途：

- 读取当前登录用户。

### `POST /api/auth/forgot-password/reset`

用途：

- 用邮箱验证码重置密码。

### `GET /api/auth/google/start`

用途：

- 发起 Google OAuth。

常见 query：

- `siteSlug`

### `GET /api/auth/google/callback`

用途：

- Google OAuth 回调。

## 4. Profile

### `GET /api/profile`

用途：

- 读取个人资料。

### `PATCH /api/profile`

用途：

- 更新个人资料。

常见 body：

- `displayName`
- `favoriteClub`

## 5. Billing

### `GET /api/balance`

用途：

- 读取当前用户余额。

### `POST /api/payments/alipay/create`

当前状态：

- 休眠，返回 `403`。

### `POST /api/recharge`

当前状态：

- 休眠，返回 `403`。

## 6. Characters

### `GET /api/characters`

用途：

- 前台角色列表。

常见 query：

- `category`
- `siteSlug`

### `GET /api/characters/:id`

用途：

- 角色详情。

### `POST /api/characters`

用途：

- 用户创建角色。

### `POST /api/characters/:id/activate`

用途：

- 激活角色并创建/读取聊天会话。

### `POST /api/characters/polish`

用途：

- AI 润色角色背景故事。

### `POST /api/characters/generate-avatar`

用途：

- AI 生成角色头像。

## 7. Avatar Uploads

### `POST /api/uploads/avatar/moderate`

用途：

- 上传头像前审核。

### `POST /api/uploads/avatar`

用途：

- 保存头像上传。

### `DELETE /api/uploads/avatar`

用途：

- 删除临时头像。

## 8. Chat

### `GET /api/chat/contacts`

用途：

- 读取当前用户通讯录/联系人。

常见 query：

- `siteSlug`

### `GET /api/characters/:id/messages`

用途：

- 读取某角色聊天消息。

### `POST /api/characters/:id/messages`

用途：

- 写入用户文本消息。

### `POST /api/characters/:id/messages/reply`

用途：

- 触发 AI 回复。

常见 body：

- `sinceMessageId`
- `productTrigger`

### `GET /api/characters/:id/quick-replies`

用途：

- 读取角色快捷用语。

## 9. Guest Chat

### `GET /api/guest/capability`

用途：读取指定站点是否开启游客聊天及其当前前台；不创建 guest session。

### `GET /api/guest/session`

用途：通过 HttpOnly guest cookie 创建/恢复当前站点前台会话并读取历史、额度和图片状态。

边界：要求公开应用 Origin/Referer；已登录用户不得使用；站点、前台和内部 guest/session ID 均由服务端冻结。

### `POST /api/guest/messages`

用途：发送游客文字或已上传附件消息，按服务端规则生成文字、无优惠商品卡或一次图片任务。

边界：文字、语音输入、附件消息和实时通话最终转写共用 30 条/滚动 24 小时；文字、语音输入和附件另受 10 条/10 分钟限制，实时通话不受该短时限制。所有入口使用稳定幂等键；促销和其他角色不开放。

### `POST /api/guest/uploads/chat`

用途：在读取完整请求体前预留游客附件上传预算，以稳定 `X-Client-Upload-Id` 上传并恢复受保护附件。

边界：复用正式附件类型/大小/内容校验；站点、前台、guest 与网络额度由服务端校验；并发、接管、进程中断和历史临时文件由 attempt fencing 与清理状态机收敛。

### `DELETE /api/guest/uploads/chat/:attachmentId`

用途：删除当前 guest 尚未发送的受保护附件。

### `POST /api/guest/voices`

用途：接收 16kHz mono PCM16 WAV 游客语音，完成 ASR 并先写入用户转写消息。

### `POST /api/guest/voices/:messageId/reply`

用途：为已成功写入的游客语音转写消息生成或恢复 AI 文字与语音回复。

## 10. Chat Uploads and Voice

### `POST /api/characters/:id/attachments`

用途：

- 上传聊天附件并写入附件消息。

### `GET /api/uploads/chat/:fileName`

用途：

- 鉴权下载聊天附件。
- 只允许附件所在聊天会话的当前登录用户访问。
- 响应使用 `Cache-Control: no-store`。

### `POST /api/characters/:id/voices`

用途：

- 上传用户语音，服务端 ASR 后写入消息。

### `GET /api/uploads/voice/ai/:fileName`

用途：

- 鉴权下载 AI 会话语音。
- 只允许语音所在聊天会话的当前登录用户访问。
- 响应使用 `Cache-Control: no-store`。

### `GET /api/uploads/voice/:fileName`

用途：

- 鉴权下载用户会话语音。
- 预设音色样例仍走公开静态路径 `/uploads/voice/presets/...`。

### `POST /api/characters/:id/voices/:messageId/reply`

用途：

- 给语音消息触发 AI 语音回复。

## 11. Realtime Call

### `WebSocket /ws/call`

用途：

- 实时语音通话。

主要消息类型：

- `start_call`
- `audio_chunk`
- `audio_probe`
- `resume_listening`
- `end_call`

## 12. Home

### `GET /api/home/carousel`

用途：

- 读取当前站点首页轮播。

常见 query：

- `siteSlug`

## 13. Products

### `GET /api/products/search`

用途：

- 按当前站点可信商品目录执行前台商品搜索。

价格边界：

- Shopify Admin 商品源先按本站已配置币种在 Shopify Markets 中找到唯一 active 国家，再用其实际 country code 请求 `contextualPricing`；每个 variant 的 `price.amount/currencyCode` 和 `compareAtPrice.amount/currencyCode` 是响应中唯一可用的展示价格来源，不能取 Shopify 基础商店的 `shop.currencyCode`、`variant.price` 或 `variant.compareAtPrice`。没有唯一市场匹配时，接口不猜测价格。
- 普通正式账号只能请求 active 的所属站点；管理员可跨站；所有显式站点严格解析且不能回退默认站。游客必须通过 Alove Origin/Referer、站点开关和网络额度。正式账号按账号与站点执行窗口额度和最多 2 个同时在途请求。
- 响应不包含内部 `sourceItem` 或 Shopify 精确 `inventoryQuantity`。

常见 query：

- `siteSlug`
- `query`
- `limit`

边界：

- Shopify Admin token 只由服务端商品读取器使用，不进入请求 URL、响应或浏览器。
- 只返回 `ACTIVE` 且有 Online Store URL 的商品；独立站主题对游客的显隐不参与 Alove 目录过滤。
- 当前前端通常限制为 2 个结果。

### `POST /api/products/resolve`

用途：

- 从当前站点同一可信商品目录补齐商品详情、实时价格、库存、购买链接和购物车链接。

价格边界：

- 与 Search 使用同一市场价映射；同一商品的展示最低价从已读取的 variant contextual price 计算，前端不得自行换币或重新标注币种。

常见 body：

- `siteSlug`
- `product`
- `characterId`（可选；只有具备可信角色上下文的 Chat/实时通话使用）
- `messageId`（可选；与 `characterId` 同时提交，由服务端反查商品消息、会话和账号归属）

边界：

- Shopify Admin 商品源不会在 resolve 阶段降级成未登录公共 storefront 搜索。
- 权限、Origin 和账号商品额度与 Search 相同；普通账号不能通过提交其他 `siteSlug` 读取跨站目录。
- 必须命中同一商品身份；失败时返回原商品快照且 `resolvedFromSource=false`。
- 正式用户同时提交可信 `characterId + messageId` 时，响应商品可带当前角色实时有效的安全 `discountOffers` DTO；mascot 只返回同站点 `site` 码，Creator 只返回同站点、同 owner 的 `creator` 码。
- Search、Kitshop 或缺少角色上下文的 resolve 不隐式选择角色，不返回角色折扣码。游客响应会深层剥离 `discountOffers`、旧 code、优惠说明和权益字段。
- 折扣码不进入共享商品缓存或历史商品 payload。

### `POST /api/products/checkout-link`

用途：

- 根据正式用户当前选择，为可信 Shopify variant 生成明确覆盖旧折扣状态的购买链接。

常见 body：

- `siteSlug`
- `characterId`
- `messageId`
- `discountOfferId`
- `selectedSizeIndex`
- `product`

边界：

- 服务端重新解析可信商品、站点、变体和角色折扣资格；不信任前端提交的 code、ownership 或 owner。
- 目标 URL 必须属于当前站点允许 origin；有变体时必须是当前可售尺码的可信 cart URL。
- 服务端使用 Shopify Admin `codeDiscountNodeByCode` 核验码；仅 `ACTIVE` 返回 `mode: "discount_link"` 和带当前码的 cart permalink。该状态只表示折扣码可进入结账校验，不代表 Shopify 最终一定接受，适用商品、客户资格、最低金额和使用次数等仍由结账页判定。
- 假码、过期、停用、缺少 `read_discounts` 或 Shopify 核验异常时返回 `mode: "standard_link"`，URL 使用空 `discount=` 明确清除浏览器内旧折扣。
- 前端未选择折扣码时不请求该接口，但可信 variant cart 同样附加空 `discount=`，保证取消选择后不继承旧码。

## 14. Product Analytics

### `POST /api/analytics/product-events`

用途：

- 记录商品曝光、点击、详情打开、跳转等事件。

常见 body：

- `eventType`
- `siteId`
- `siteSlug`
- `characterId`
- `messageId`
- `productId`
- `productTitle`
- `productUrl`
- `catalogReceipt`（Search 或 Kitshop 的曝光、点击、详情、跳转必填；旧 `searchReceipt` 仍兼容）

边界：

- `product_bubble_triggered` 只由服务端写入，客户端提交返回 400。
- Chat 客户端事件必须关联当前用户会话中的有效商品消息；角色、owner、站点和商品快照由服务端反查，不信任 body 同名字段。
- Search 与 Kitshop 的曝光、点击、详情打开和 CTA 必须提交当前商品响应签发的 `catalogReceipt`；回执有效期 30 分钟并绑定当前用户、站点、商品与入口，篡改、跨用户、跨站、跨入口或过期回执返回 400。旧 Search `searchReceipt` 仅为兼容字段。
- 普通/creator 账号仍要求回执站点等于账号站点；Admin 可消费服务端为本人签发的合法跨站回执。
- Chat `product_detail_cta_click` 按 `eventType + user + message` 去重；Search/Kitshop 按 `eventType + user + source + product` 在 30 分钟窗口去重。

## 15. Creator Analytics

### `GET /api/creator/analytics`

用途：

- 读取当前 creator 账号本人角色的表现看板数据。

常见 query：

- `range=7d|30d|90d`，缺省为 `30d`；非法枚举返回 400。

返回：

- `summary`：Conversations、Product triggers、Store visits、Visit rate。
- `comparison`：与前一等长周期相比的方向和百分比。
- `trend`：站点时区自然日连续序列。
- `audience`：Unique/New/Returning chatters、Return rate、Avg. messages。
- `topProducts`：当前角色同站点可信商品 Top 5。

权限：

- 未登录 401；personal/admin 403；creator 只能读取本人、本人站点和服务端解析角色。

## 16. Admin Analytics

### `GET /api/admin/analytics/product-overview`

用途：

- 管理后台概览商品漏斗和排行。

常见 query：

- `range`
- `site`

权限：

- admin。

## 17. Admin Accounts

### `GET /api/admin/accounts`

用途：

- 后台账号列表。
- 列表项包含 `sourcePageUrl`、`sourcePageTitle`、`sourcePageType`、`sourceProductId` 和 `sourceCapturedAt`；正式账号取最近一次已承接游客会话的已验证来源，没有来源时为空。

常见 query：

- `page`
- `limit`
- `query`
- `type`
- `site`

### `POST /api/admin/accounts`

用途：

- 创建后台账号。

### `PATCH /api/admin/accounts/site`

用途：

- 批量修改账号站点。

### `PATCH /api/admin/accounts/:id/status`

用途：

- 修改账号状态。

### `PATCH /api/admin/accounts/:id/profile`

用途：

- 修改账号资料。

### `PATCH /api/admin/accounts/:id/password`

用途：

- 重置账号密码。

### `GET /api/admin/accounts/:id/conversations`

用途：

- 查看账号对话列表。

### `GET /api/admin/accounts/:id/conversations/:conversationId`

用途：

- 查看某段对话详情。

### `GET /api/admin/accounts/guests`

用途：

- 后台游客会话列表。
- 列表项包含清洗后的来源页面字段；没有有效来源时为空，不返回 `external_source_context_json` 原文或 handoff token。

### `GET /api/admin/accounts/guests/:guestSessionId/conversations`

用途：

- 查看游客角色对话列表。

### `GET /api/admin/accounts/guests/:guestSessionId/conversations/:conversationId`

用途：

- 查看游客某段对话详情。
- 消息顺序按 `chat_messages.display_order` 对齐聊天前台；发送时间和消息 ID 仅作为稳定并列排序。

## 18. Reporting API

### `GET /api/reporting/accounts`

用途：按账号读取只读报表数据。需要报告 Token 的 `accounts:read` 权限；支持 `page`、`limit`、`startDate`、`endDate`。

### `GET /api/reporting/accounts/:id/conversations`

用途：读取指定账号的对话列表。需要 `accounts:read` 与 `conversations:read`，并受 Token 站点范围限制。

### `GET /api/reporting/accounts/:id/conversations/:conversationId`

用途：读取指定账号的一段对话；增加 `messages:read` 后返回消息正文和结构化消息载荷，否则只返回会话摘要。

### `GET /api/reporting/guests` 和 `GET /api/reporting/guests/:guestSessionId/conversations/:conversationId`

用途：读取游客会话及其对话，分别需要 `guests:read`、`conversations:read` 和可选的 `messages:read`。账号与游客 IP 字段均表示当前保存的最近一次 IP，不代表每条消息的独立来源 IP。

所有 Reporting API 请求使用：

```http
Authorization: Bearer <REPORT_API_TOKEN>
Accept: application/json
```

Token 通过后台“数据 API”页面创建；原始 Token 只在创建成功响应中显示一次，数据库只保存哈希和前缀。

## 19. Admin Characters

### `GET /api/admin/characters`

用途：

- 后台角色列表。

常见 query：

- `type=creator`
- `type=common`
- `query`

### `POST /api/admin/characters`

用途：

- 后台创建角色。

### `PATCH /api/admin/characters/:id/settings`

用途：

- 后台编辑角色设置。

## 18. Admin Sites

### `GET /api/admin/sites`

用途：

- 后台站点列表。

### `POST /api/admin/sites`

用途：

- 新增站点。
- `logoUrl` 可空；非空必须是 HTTP(S)。
- slug 与 `admin/api/login/register/discover/chat` 等系统保留路径冲突时返回 400。

### `PATCH /api/admin/sites/:id`

用途：

- 编辑站点。
- 未提交 `logoUrl` 时保留原值；显式空字符串表示清空并启用 favicon fallback。

### `PATCH /api/admin/sites/:id/default`

用途：

- 设为默认站点。

### `GET /api/admin/geo-regions/search`

用途：

- 搜索地区。

## 19. Admin Mascot

### `GET /api/admin/mascot`

用途：

- 前台管理数据。

### `POST /api/admin/mascot`

用途：

- 新建前台。

### `PATCH /api/admin/mascot/template`

用途：

- 保存通用前台模板。

### `PATCH /api/admin/mascot/:id`

用途：

- 编辑前台角色。

### `PATCH /api/admin/mascot/sites/:siteId`

用途：

- 保存站点前台绑定。

人设字段：

- `personaPrompt`：可选；显式提交时更新绑定角色的 `persona_prompt`。
- `speakingStyle`：可选；显式提交时更新绑定角色的 `speaking_style` 并同步角色 `profile_json.style`。
- 未提交上述字段时，仅保存其他前台配置，不重写角色人设或语气。

### `POST /api/admin/mascot/sites/:siteId/ads`

用途：

- 为当前站点选择的有效活动创建真实前台广告投放任务。

边界：

- 需要 `admin:promotions:write`；服务端重新校验站点、活动状态、时间和角色范围。
- 同一站点同一活动已有进行中任务时返回原任务，不重复创建。

### `GET /api/admin/mascot/sites/:siteId/ads/campaigns`

用途：

- 返回当前站点可由前台立即发送的有效广告活动。

### `GET /api/admin/mascot/sites/:siteId/ads/:deliveryId`

用途：

- 读取真实投放任务的总数、已处理、成功、失败和完成状态。

### `PATCH /api/admin/mascot/sites/:siteId/disable`

用途：

- 停用站点前台。

## 20. Admin Carousel

### `GET /api/admin/carousel`

用途：

- 轮播列表。

### `POST /api/admin/carousel/upload`

用途：

- 上传轮播图片。

### `POST /api/admin/carousel`

用途：

- 创建轮播项。

### `PATCH /api/admin/carousel/:id`

用途：

- 编辑轮播项。

## 21. Admin Promotion Campaigns

### `GET /api/admin/promotion-campaigns`

用途：

- 广告活动列表。

常见 query：

- `status`
- `site`
- `query`

### `GET /api/admin/promotion-campaigns/products`

用途：

- 后台活动选品搜索。

边界：

- 从当前站点可信商品目录读取最多 50 个候选，完成名称/SKU 过滤后最多返回 8 个。
- 只返回 `ACTIVE` 且有 Online Store URL 的商品。
- `query` 按后台确定性输入原文查询，不执行聊天语义改写；从 Kitshop 复制的完整商品标题必须可以命中同一可信目录中的对应商品。

常见 query：

- `siteId`
- `query`
- `limit`

### `POST /api/admin/promotion-campaigns`

用途：

- 创建广告活动。
- 当 `status=active` 且 `endsAt` 已到或早于服务端当前时间时返回校验错误；其他状态允许保存历史结束时间。

### `PATCH /api/admin/promotion-campaigns/:id`

用途：

- 编辑广告活动。
- 和新建使用相同时间校验，不能把已到期活动保存为 `active`。

## 22. Admin Discount Codes

### `GET /api/admin/discount-codes`

用途：

- 返回后台折扣码登记列表。

常见 query：

- `query`：code、优惠说明、网红昵称或邮箱。
- `site`、`ownershipType`、`status`：站点、前台/网红归属和 `scheduled|active|expired|disabled`。

权限：admin 只读。

### `GET /api/admin/discount-codes/options`

用途：

- 返回 active 站点和可登记的 creator 账号/角色选项。

边界：

- creator 必须为 active creator、属于自身站点并拥有未归档 creator 角色；不返回 token 或订单数据。

### `GET /api/admin/discount-codes/shopify-search`

用途：

- 按当前 active 站点实时搜索 Shopify 已有折扣码候选。

常见 query：

- `siteId`：必填，决定 Shopify Admin 商品源和 token。
- `query`：至少 2 个字符，最多 64 字符。

边界：

- 需要管理员身份；站点 token 只在服务端解密和使用，不进入响应。
- 返回 code、Shopify 状态、只读优惠摘要和白名单规则，不返回客户名单、订单或 token。
- 搜索结果不是写入凭证；创建或编辑时服务端会按 exact code 再查询 Shopify。

### `POST /api/admin/discount-codes`

用途：

- 创建折扣码登记。

权限与校验：

- 需要 `admin:promotions:write`。
- 请求只提交站点、已选 code、归属、启用状态和内部备注。
- 服务端通过当前站点 Shopify Admin API 精确读取 code，自动填写优惠说明、类型、状态、门槛和有效期快照；不能由前端伪造。
- 同站点 code 忽略大小写唯一；站点归属会清空 creator；Shopify 未找到或读取失败时拒绝保存。

### `PATCH /api/admin/discount-codes/:id`

用途：

- 编辑折扣码登记，支持切换站点/code/归属和启用状态；每次保存重新读取 Shopify 规则。

返回状态：

- DTO 中综合人工启用、Shopify 状态和时间派生 `scheduled`、`active`、`expired` 或 `disabled`。
- Shopify 原始状态和必要规则以快照字段保存，前端不直接写这些字段。

## 23. Admin Knowledge Bases

### `GET /api/admin/knowledge-bases`

用途：

- 知识库列表。

### `POST /api/admin/knowledge-bases`

用途：

- 创建知识库。

### `GET /api/admin/knowledge-bases/:id`

用途：

- 知识库详情。

### `PATCH /api/admin/knowledge-bases/:id`

用途：

- 编辑知识库。

### `DELETE /api/admin/knowledge-bases/:id`

用途：

- 删除知识库。

## 23. Admin Logs

### `GET /api/admin/error-logs`

用途：

- 查看错误日志。

常见 query：

- `level`
- `source`
- `startDate`
- `endDate`
- `page`
- `limit`

## 24. Client Error Reporting

### `POST /api/client-errors/report`

用途：

- 前端上报客户端错误。

权限：

- 当前要求登录。

## 25. Demo Products

### `GET /api/demo/products`

用途：

- 内部 demo 商品源。

边界：

- 线上正式商品搜索不应依赖 demo 商品源。

## 26. Kitshop

### `GET /api/kitshop`

用途：

- 读取当前站点 Kitshop 货架与可信商品。
- 普通账号固定 active 所属站点且无效站点不回退；管理员可跨站；游客要求 Alove Origin/Referer、站点游客开关与网络额度。正式账号使用同一窗口额度和在途上限，响应不包含精确 Admin 库存。

常见 query：

- `siteSlug`
- `guest=1`

权限与边界：

- 正式用户需要登录。
- 游客仅在对应站点开启游客能力时可读，并返回 guest-safe 商品结果。
- `cache.salesLastSyncedAt` 表示最近一次成功的 Best Sellers 销量快照时间，`cache.salesStatus` 为 `ready/stale/unavailable`。
- `cache.needsRefresh/cache.canRefresh` 供登录链路判断是否需要在后台首次或定时刷新；普通页面响应不等待 Shopify 订单接口。

## 27. User Feedback

### `POST /api/feedback`

用途：

- 登录用户或游客提交 Subject、Details 和当前页面路径。

权限与边界：

- 登录用户沿用当前账号、邮箱和站点；游客必须携带合法 `contactEmail`，不创建临时账号。
- 游客请求必须来自 Alove 的有效 Origin/Referer；有有效 guest session 时使用其冻结站点，否则从 Referer 的站内路径解析 active 站点。表单 `pagePath` 只作定位记录，不参与站点归属判断。
- 请求体最大 16KB，并受重复内容和频率限制：同一正式账号或游客联系邮箱 10 分钟最多 5 条，同一 IP 10 分钟最多 20 条。

## 28. Admin Kitshop

### `GET /api/admin/kitshop`

用途：

- 读取站点商品缓存、栏目、同步摘要和分页商品。

常见 query：

- `site`
- `productPage`
- `productLimit`

### `POST /api/admin/kitshop/refresh`

用途：

- 刷新指定站点商品、首页栏目和最近 60 天 Shopify 销量快照，并生成新的 Best Sellers 去重混排顺序。

权限：

- `admin:kitshop:write`

## 29. Admin Feedback

### `GET /api/admin/feedback`

用途：

- 分页读取和筛选用户反馈。

常见 query：

- `page`
- `limit`
- `status`
- `query`
- `site`

### `PATCH /api/admin/feedback/:id/status`

用途：

- 更新反馈处理状态；当前页面只使用 `done`。

权限：

- `admin:feedback:write`

## 30. Admin External Embeds

### `GET /api/admin/external-embeds`

用途：读取 active 站点、其有效公开前台与站外挂件配置。

### `PUT /api/admin/external-embeds/:siteId`

用途：创建或更新该站点唯一的一条站外挂件配置。

权限：

- `admin:sites:write`

边界：

- 外站地址只能为根 Origin；生产环境仅接受 HTTPS 公网域名。
- published 状态要求 active 站点启用游客聊天，且存在公开、已发布的前台角色。
- CTA 不接收外部 URL，始终由服务端生成同站游客聊天链接。

## 31. Public External Embed

### `GET /api/embed/config?embed=<publicId>`

用途：供安装在第三方站点的版本化 loader 读取安全展示配置。

返回：

- 启动图、角标、位置、受控颜色/圆角和引导弹窗文案。
- 服务端推导的游客聊天 CTA。

边界：

- 仅已发布配置可读取；请求 `Origin` 必须和后台保存的外站 Origin 完全一致。
- 成功响应只返回精确 `Access-Control-Allow-Origin`、`Vary: Origin` 与 `Cache-Control: no-store`，且不携带登录凭据。
- 不返回外站 Origin、站点商品源、账户、Token、后台备注或管理 ID。
