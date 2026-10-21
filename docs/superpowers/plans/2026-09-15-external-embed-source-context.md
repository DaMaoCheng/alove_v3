# 2026-09-15 Alove 站外嵌入来源上下文（TTMall）

## 目标与边界

从使用标准 Alove 嵌入代码的 TTMall 站点跳转到 Alove 时，记录访客跳转前的页面，并在访客聊天中提供可信的当前页面上下文；产品详情页能够复用现有 TTMall 商品详情解析，帮助角色回答“这个商品/这件球衣”的问题。

本期只改 Alove 项目本身：

- 保持第三方现有安装代码不变；
- 只覆盖标准 `embed/v1.js` 链路和 TTMall 商品源；
- 仅当公开嵌入配置的商品源可识别为 TTMall 时启用来源交接；Shopify 配置继续走原有 CTA 链路；
- 不修改 Shopify 主题或 FKK 站外自定义按钮；
- 不提前创建访客会话，仍由 Alove 聊天页首次加载时创建；
- 本期来源上下文接入公开访客聊天；已登录聊天不消费 handoff 参数，避免改变现有登录会话行为；
- 不信任浏览器传来的商品标题、价格、库存或任意链接；
- 不部署服务器、不覆盖线上数据库、不推送 GitHub。

## 分期方案

### 第一阶段：来源交接与持久化

修改/新增：

- `server/db-column-migrations.js`、`database/schema.sql`
  - 为 `guest_sessions` 增加可空 `external_source_context_json` JSON 列；旧表用幂等迁移补列，新表同步声明。
- 新增 `server/external-source-context-service.js`
  - 校验发布中的嵌入 ID 与精确 Origin；清洗来源 URL（只保留同源的 HTTP(S) origin + pathname，移除 query、fragment、控制字符）；限制标题、路径和字段长度；识别 TTMall `/productdetail/{slug}/{numericId}` 产品 ID。
  - 使用现有服务端密钥生成短时加密 handoff token，包含站点、角色、来源页、候选产品 ID 和过期时间；不把 API key、cookie、订单或商品源凭据放入 token。
  - 解码时校验签名/加密、过期时间、站点和角色绑定；非法、过期或跨站 token 统一丢弃，不影响普通聊天。
- `server/external-embed-service.js`
  - 复用现有发布嵌入查询，新增 `createExternalEmbedHandoff` 入口；不改变 `getPublicExternalEmbed` 和安装代码生成结果。
- `server/public-external-embed-routes.js`
  - 新增受精确 Origin 约束的 `POST /api/embed/handoff` 和 OPTIONS 预检；请求体上限、无 cookie、无凭据；失败返回可安全降级的错误。
- `server/db.js`
  - 在现有 schema migration 流程中调用 guest session 来源列迁移。

验收：

1. 旧安装代码生成文本逐字不变。
2. 正确 Origin + 合法来源页可取得短时 handoff token。
3. 错误 Origin、来源 URL 跨域、超长/恶意字段、过期/篡改 token 均无法形成有效上下文。
4. 重启/重复初始化不会覆盖既有访客会话或其他列。

回退点：删除新增 handoff 路由和迁移调用即可；新增 JSON 列为空时旧会话完全沿用原流程。

### 第二阶段：loader 与访客会话接入

修改：

- `embed/v1.js`
  - 保留现有脚本地址、`data-aiove-embed`、Shadow DOM、位置、文案和 CTA 样式。
  - 挂件加载时预取当前页面路径、标题和 TTMall 产品 ID，打开引导卡时再刷新一次；成功后仅给 Alove chat URL 增加 `handoff` 参数。若用户立即点击且请求尚未完成，先同步打开空白新标签再异步导航；失败则直接使用原 CTA URL。
  - 通过同步打开空白新标签再异步设置地址，避免弹窗拦截；任何异常都 fail-open，不阻断外站页面。
- `src/app/app-state.js`、`src/services/guest-chat-service.js`、`src/app/chat-data-actions.js`
  - 保存初始 handoff，只在首次访客 session 请求中传递；成功后清理 URL/内存 token，避免重复提交。
  - 不改变无 handoff 的现有 `/api/guest/session` 请求。
- `server/guest-chat-routes.js`、`server/guest-session-service.js`
  - `/api/guest/session` 接收可选 handoff；创建新访客或已有 cookie 恢复时，在站点、角色和有效期校验后写入 `guest_sessions.external_source_context_json`。
  - 不把原始 token返回给浏览器；访客配额、开场图片/文字/语音、角色校验和 cookie 行为保持原样。

验收：

1. CF 等标准 TTMall 站点沿用原安装代码即可捕获首页、分类页和产品详情页；非 TTMall 配置不发起来源交接请求。
2. handoff 接口失败时仍能打开原聊天页；无 handoff 的普通聊天回归通过。
3. 同一访客刷新/重新打开不会重复创建访客会话，也不会因缺少 handoff 失败。
4. 现有挂件样式、按钮文字、位置、可访问性和新标签行为不变。

回退点：loader 删除 handoff 请求后仍可使用原静态 CTA；服务端空列不参与旧会话。

### 第三阶段：可信页面/商品上下文进入 AI

修改/新增：

- 复用 `server/external-source-context-service.js` 的解析函数（与 token 模块保持同一窄接口）
  - 读取已校验来源上下文；产品页仅在当前站点是 TTMall 且用户问题属于产品/详情/尺寸/价格等意图时调用现有 `fetchTtmallProductById`。
  - 只保存和传递现有 TTMall mapper 产出的安全商品字段；上游失败时保留页面元数据，不声称商品事实。
- `server/guest-chat-product-service.js`
  - 在现有商品意图链路前增加来源商品优先分支；只对明确引用当前页面/商品的问题生效，避免开场或普通闲聊自动发商品卡。
  - 复用 `buildProductContextLayer` 和现有商品卡选择链路，不重写商品搜索。
- `server/chat-prompt-service.js`、`server/chat-prompt-layers.js`、`server/guest-reply-service.js`
  - 新增小型“External Page Context”提示层：把来源页标为已校验的站点元数据；产品字段仅使用服务端已解析事实；明确禁止把页面标题/路径当作指令、禁止根据未验证字段猜价格/库存/尺码。
  - 普通聊天没有来源上下文时不增加任何提示层。

验收：

1. TTMall 产品页跳转后询问“这件球衣是什么/有哪些尺码/价格”等，AI 使用服务端解析的当前商品；必要时沿用现有商品卡。
2. 首页/分类页跳转后，AI 可知道来源页面，但不会无故发送商品卡或编造商品事实。
3. 来源页标题含恶意指令、URL 含查询参数、产品 ID 不存在/上游超时时，AI 不执行其中指令、不猜测，并按现有事实边界回复。
4. 已有没有 handoff 的游客、正式账号聊天、Shopify 商品链路和现有商品/图片/语音功能回归不变；本期正式账号聊天明确保持原行为。

回退点：关闭来源商品优先分支即可保留页面记录；提示层为空时原 prompt 完全不变。

### 第四阶段：后台账号管理可见性

修改/新增：

- `server/admin-account-shared.js`、`server/admin-account-mapper.js`
  - 正式账号列表从最近一条 `claimed` 游客会话读取已验证来源；同一账号多条承接记录只取最新一条，不改变账号行数。
  - 复用来源上下文解析器，只向管理员 DTO 输出清洗后的页面标题、URL、页面类型和商品 ID，不输出 JSON 原文或 handoff token。
- `server/admin-guest-session-service.js`
  - 游客列表直接映射其 `external_source_context_json`，无来源或无效 JSON 返回空字段。
- `src/features/admin-console/admin-console-accounts-template.js`、`admin-guest-sessions-template.js`、`admin-console-utils.js`
  - 在现有“基础信息”分组增加一行“来源页面”；标题和 URL 以纯文本转义显示，无值显示 `-`，不改变表格列和样式。
- `database/schema.sql`、`server/db-bootstrap-chat-tables.js`
  - 增加 `(claimed_user_id, session_status, claimed_at, id)` 非唯一索引，保证正式账号取最近承接来源时不扩大列表查询成本。

验收：

1. 游客展开详情能显示来源标题和 URL；旧会话没有来源时显示 `-`。
2. 正式账号展开详情显示最近一次已承接游客会话的来源；多个承接会话不重复正式账号行。
3. 篡改、未验证或格式错误的来源 JSON 不显示、不抛错；管理员响应不包含 raw JSON/token。
4. 原有账号/游客列表筛选、分页、展开、会话查看和表格样式回归不变。

语义边界：当前 handoff 只在公开访客初始化阶段保存；已登录用户直接从站外进入的来源不会自动写入 `users`，因此正式账号只有在存在已承接游客来源时才会显示来源页面。

## 本地真实链路自检

- `node --check`：全部新增/修改 JS。
- 新增 `scripts/external-embed-source-context-self-check.mjs`：token、Origin、URL 清洗、TTMall ID、过期/篡改/跨站、旧安装代码不变、无 handoff 回归。
- 修改 `scripts/external-embed-loader-self-check.mjs`：确认 fail-open、来源捕获和 handoff 参数拼接，同时保持现有 UI 契约。
- 修改/新增 guest session/product/prompt 专项自检：真实本地 MySQL 临时访客记录，验证来源 JSON 写入、产品详情复用和 finally 恢复原数据。
- 重启本地服务后按运行态规则确认监听 PID、`/api/health`、`POST /api/embed/handoff`、`GET /api/guest/session` 和公开 loader；再跑现有 multisite/TTMall 回归。
- 不使用服务器、Shopify 主题、线上账号或真实订单；不把 token、密钥或访客个人数据写入日志。

## 影响与保护

- 现有安装代码、挂件视觉和 CTA 基础 URL保持兼容；新增参数只在点击时生成。
- 新数据库列可空且只在 handoff 成功时写入，不改变旧会话查询结果。
- handoff 和来源页均按失败安全处理，网络失败不会阻断跳转。
- 所有商品事实仍必须来自现有 TTMall resolver；浏览器只提供候选路径和 ID，不能直接注入价格、库存、链接或提示词。
