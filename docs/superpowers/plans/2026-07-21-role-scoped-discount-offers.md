# 角色归属折扣码展示、表达与购买分批实施计划

关联规格：[`../specs/2026-07-21-role-scoped-discount-offers.md`](../specs/2026-07-21-role-scoped-discount-offers.md)

关联基础计划：[`2026-07-20-creator-performance-and-discount-codes.md`](./2026-07-20-creator-performance-and-discount-codes.md)

状态：`In progress`（批次 1-4 已在本地完成并验证；批次 5 正在实现带码链接生成，真实 Shopify 应用验证改为后置验收；批次 6 已完成批次 1-4 的回归与文档回写）

## 0. 实施边界与检查点

- 当前工作区存在尚未发布的折扣码管理、提示词和后台页面改动，本计划不得覆盖或回退这些内容。
- 本功能跨越数据库查询、商品详情、AI 提示词和购买跳转，必须分批推进；每批验证通过后才能进入下一批。
- 不修改现有 `discount_codes` 表结构；当前表已经支持一个站点或一个网红登记多个码。
- 不通过 Shopify API 自动创建折扣码。
- 不重做 `promotion_campaigns.discount_code` 活动单码链路。
- 首期只覆盖 Chat 和实时通话中具备明确角色上下文的商品详情；Search、Kitshop 不隐式选择角色。
- 开始编码前记录当前 Git 状态和相关专项自检基线。正式实施预计超过一次提交，应按项目 Git 规则建立阶段性 checkpoint；是否创建独立分支在实施前结合当时工作区状态确认。

## 批次 1：角色可用折扣码服务端模块

状态：`Completed locally`（2026-07-21；未部署）

### 目标

- 建立唯一的“角色可用折扣码”业务模块。
- 把站点、角色类别、creator owner、有效期和游客过滤集中在服务端。
- 为产品详情、AI 和购买链接提供同一接口，避免三条链路分别判断。

### 新增位置

- `server/discount-code-eligibility-service.js`
  - 提供 `resolveCharacterDiscountOffers(db, context)` 深模块接口。
  - 重新查询用户、角色、角色 owner、角色站点和站点状态。
  - 只返回安全 DTO，不返回后台备注和审计字段。
  - 按 `updated_at DESC, code ASC` 稳定排序并忽略大小写去重。

### 复用位置

- `server/discount-code-normalizers.js`
  - 复用现有有效期和派生状态规则；若当前函数只适合管理 DTO，可增加最小纯函数，不复制时间判断。
- `server/discount-code-service.js`
  - 继续只承担管理员 CRUD 和列表，不加入聊天、产品详情或购买职责。

### 核心接口

```js
resolveCharacterDiscountOffers(db, {
  userId,
  characterId,
  siteId,
  now,
  limit,
})
```

接口不信任前端提交的 `ownershipType`、`creatorUid`、`ownerUserId` 或角色类别。

### 本批不做

- 不改产品详情 UI。
- 不改提示词。
- 不生成 Shopify 购买链接。
- 不新增面向前端的公开接口。

### 验收

- 前台角色只返回同站点 `site` 码。
- creator 角色只返回同站点、同 owner 的 `creator` 码。
- 一个对象可返回多个有效码。
- 过期、未开始、停用、跨站、错误 creator 和归属失效全部排除。
- 游客或无正式用户上下文返回空列表或稳定拒绝，不泄露 code。
- 查询无逐码 N+1，使用现有索引或补充明确的查询性能验证。

### 回退点

- 删除新模块和专项自检即可；数据库与现有管理页面不变。

### 本地验证结果

- `node --check` 通过。
- `scripts/discount-code-eligibility-self-check.mjs` 通过：前台多站点码、creator 多码、其他 creator 隔离、过期/停用过滤、跨站 viewer（含省略 `siteId`）、owner 换站失效和夹具清理均覆盖。
- `scripts/admin-discount-codes-self-check.mjs` 通过，确认既有管理员 CRUD 未回归。
- `git diff --check` 通过。
- 独立安全复审未发现阻塞问题；复审前发现的两个 P1 已修复：强制 viewer 站点与角色站点一致，强制 creator owner 站点与角色站点一致。

## 批次 2：产品详情实时折扣码查询

状态：`Completed locally`（2026-07-21；未部署）

### 目标

- 打开角色商品详情时实时读取当前有效折扣码。
- 不把实时折扣码永久写入历史商品快照，避免过期码长期显示。
- 无角色上下文的 Search、Kitshop 不返回角色折扣码。

### 修改位置

- `src/features/chat/chat-product-card.js`
  - 将可信渲染上下文中的 `messageId`、`characterId` 传给产品详情请求。
- `src/features/chat/chat-product-panel.js`
  - 打开产品详情和商品动态刷新时携带角色/消息上下文。
  - 处理折扣码加载中、成功、为空和失败状态；折扣码失败不能阻断商品详情。
- `src/features/call-modal/call-product-overlay.js`
  - 使用当前通话角色传递角色上下文，不从产品对象猜角色。
- `src/services/product-search-service.js`
  - 扩展产品 resolve 请求和响应规范化，接收 `discountOffers`。
- `server/product-search-routes.js`
  - 正式用户且请求带有明确角色上下文时调用资格模块。
  - 游客响应继续走 guest sanitizer，不注入折扣码。
- `server/product-checkout-resolver-service.js`
  - 保持商品解析职责；不要在此复制折扣码 SQL。
- `server/product-response-sanitizer.js`
  - 增加受控 `discountOffers` DTO 白名单。
- `server/guest-product-sanitizer.js`
  - 明确剥离 `discountOffers`、旧 code 和优惠说明。

### 响应约定

```json
{
  "item": {
    "productId": "...",
    "name": "...",
    "discountOffers": []
  }
}
```

折扣码查询失败时返回明确服务端错误，前端可降级为无优惠区域，但不能把旧缓存伪装成当前有效优惠。

### 本批不做

- Search、Kitshop 不增加角色选择器。
- 不实现购买自动带码。
- 不修改活动匹配优先级。

### 验收

- 同一商品在前台角色和 creator 角色下得到不同、正确的折扣码集合。
- 切换角色后，旧列表不残留；并发旧响应不能覆盖新角色结果。
- 刷新历史聊天后，已过期码不再出现。
- Search、Kitshop 请求没有角色上下文时 `discountOffers` 为空。
- 游客接口、页面 dataset、历史 payload 和日志不出现具体码。

### 回退点

- 移除 resolve 响应中的 `discountOffers` 装配；现有商品解析和详情继续工作。

### 本地验证结果

- 本地服务重启后 PID 来自当前项目，`/api/health` 返回 200。
- `scripts/product-discount-offers-http-self-check.mjs` 通过：正式用户多码响应、游客深层无 `discountOffers`/code、错误角色与商品消息不匹配返回 403，临时站点配置、账号、会话、消息和折扣码已清理。
- `scripts/product-route-http-self-check.mjs`、`scripts/guest-product-message-runtime-self-check.mjs`、`scripts/chat-product-response-sanitizer-self-check.mjs`、`scripts/chat-product-panel-binding-self-check.mjs` 通过。
- 角色与商品消息的 `messageId -> chat_messages -> chat_sessions` 反查已加入；共享价格缓存不保存折扣码，面板只保留内存状态。
- 旧的 `chat-product-panel-code-visibility-self-check.mjs` 仍因 HEAD 版本已有的 `product`/`normalizedProduct` 变量名正则不匹配而失败；该失败发生在本批之前，批次 3 改造单码 UI 时同步升级该自检。

## 批次 3：产品详情多码 UI 与单码选择

状态：`Completed locally`（2026-07-21；未部署）

### 目标

- 将现有单码区域改为可展示多个折扣码的列表。
- 每个码可复制，且用户一次只能选中一个码用于购买。
- 兼容现有活动商品单码。

### 修改位置

- `src/features/chat/chat-product-panel-template.js`
  - 将单个 `data-product-panel-code` 改为折扣码列表容器。
- `src/features/chat/chat-product-panel-renderer.js`
  - 规范化和渲染 `discountOffers`。
  - 合并旧 `code` / `discountCode`，并忽略大小写去重。
  - 保持当前产品、尺码和折扣选择状态相互独立。
- `src/features/chat/chat-product-panel.js`
  - 处理复制、选择、切换商品和关闭后的状态清理。
- `src/features/app-shell/styles/chat.css`
  - 沿用现有产品详情视觉、主题 token 和响应式规则。
  - 不建立第二套产品详情样式文件，除非实施时确认现有文件命中复杂度红线。

### 交互规则

- 列表只展示 code 和管理员填写的优惠说明，不自动生成归属标签。
- 每行提供复制按钮和“使用此优惠”选择操作。
- 同时只允许一个码处于选中态。
- 默认不自动叠加多个码。
- 未选择码时购买保持原行为。
- 商品切换、角色切换、面板关闭和码失效后清除选中状态。

### 旧单码兼容

- 没有角色码但存在活动 `product.code` / `product.discountCode` 时继续展示。
- 活动码与角色码重复时只显示一条。
- 活动码不扩散到非活动商品。

### 验收

- 0、1、2、5 个码均正确布局。
- 复制内容与当前行一致；快速点击不会复制其他码。
- 选择状态单选、可切换、切换商品后不串码。
- 中英文、深浅主题、桌面与 375px 移动端无溢出和遮挡。
- 原尺码选择、价格刷新、支付方式、详情链接和购买按钮不回归。

### 回退点

- 恢复单码模板和渲染；服务端资格模块可保留但不对前端返回。

### 本地验证结果

- `node --check`、产品详情旧单码兼容自检、多码归一化自检、面板绑定自检和产品 resolve HTTP 自检均通过。
- 覆盖 0/1/多码、大小写去重、旧活动单码与角色多码合并、复制、单选切换、优惠码失效后清除选中状态、跨站面板状态清理和旧商品详情链路回归。
- 样式沿用现有产品详情 token；移动端 520px 以下改为纵向操作区。仓库 Playwright 依赖在当前环境不可用，因此未完成自动化浏览器层验证；已用源码结构、服务端 HTTP 和现有页面接口回归替代，并记录为环境限制。
- 独立安全复审和前端结构复审均未发现阻塞问题；发现的旧单码丢失、失效选中状态和中文复制提示问题已修复并重新通过专项自检。

## 批次 4：AI 折扣码上下文与人设表达

状态：`Completed locally`（2026-07-21；未部署）

### 目标

- 用户询问折扣时，由后端提供当前角色真实可用码。
- 角色按私有人设自然表达，但不能编造、改写或跨角色使用折扣码。
- 文字、语音和实时通话复用同一资格和提示词规则。

### 修改位置

- `server/chat-prompt-layers.js`
  - 新增 `buildDiscountOffersContextLayer`。
  - 只写如何使用可信数据，不在 prompt 内做资格判断。
- `server/chat-prompt-service.js`
  - 接收并装配 `discountOffersContext`。
- `server/chat-reply-orchestrator-service.js`
  - 在正式用户链路调用资格模块，最多注入 5 个有效码。
- `server/chat-text-message-service.js`
  - 确认文字入口传入同一上下文。
- `server/chat-voice-message-service.js`
  - 确认语音回复不建立第二套折扣码查询。
- 实时通话回复装配位置
  - 复用同一 prompt service；如果当前通话链路绕过该模块，先补装配，不复制规则。
- `server/guest-reply-service.js`
  - 保持现有 guest policy，禁止注入或返回具体码。

### 行为规则

- 普通折扣询问：自然介绍一个后端提供的当前有效码。
- 继续询问：可介绍其他可用码。
- 询问全部：可以列出后端提供的有效码。
- 无有效码：不得暗示存在折扣。
- AI 只能原样使用 code 和优惠说明；不得从说明推导更高折扣、叠加关系或适用商品。
- 商品卡后的短跟进仍不重复列出全部结构化优惠信息。

### 本批不做

- 不让模型决定码是否有效。
- 不让模型查询数据库。
- 不实现领取、核销或使用次数统计。

### 验收

- 前台和 creator 对相同提问返回各自正确归属的码。
- 多码、无码、过期、停用和跨站夹具结果正确。
- AI 输出没有数据库字段、内部 ID、后台备注或未提供的折扣力度。
- 游客文字、语音和通话仍不能获得具体码。
- 原商品推荐、图片请求、知识库、记忆、50 条上下文和语音生成不回归。

### 回退点

- 卸载新提示词层和 orchestrator 装配；产品详情折扣码列表仍可独立工作。

### 本地验证结果

- 正式文字、附件、语音和实时通话统一通过 `buildCharacterReplyGenerationForDb()` 查询资格；游客和主动消息没有注入正式用户折扣上下文。
- Prompt 只注入后端白名单的 `code`、`offerDescription` 和 `endsAt`；不生成或展示额外归属标签。资格已评估但无码时明确禁止复述旧码或编造优惠，未评估的 guest/proactive 不伪装成已查询。
- 新增正式回复确定性输出门禁：折扣语义命中后，由服务端用白名单事实受控组装 text/speechText；普通询问给第一个码、全量询问列出全部、短追问结合近期已提及码返回下一个或无更多。
- 游客折扣意图固定返回注册提示，纯字母裸码、voucher 等绕过已覆盖；普通 UEFA/FIFA、普通金额、球员/球衣“其他”话题不会误伤。
- 新增 `chat-discount-offers-prompt-self-check.mjs` 和 `chat-discount-offer-output-policy-self-check.mjs`，并加入部署门禁/manifest；专项、资格、游客运行时、语法、HTTP 健康和 `git diff --check` 通过。
- 两轮独立安全与架构复审最终均确认无阻塞问题。

## 批次 5：服务端生成带码 Shopify 购买链接

状态：`Completed locally`（2026-07-21；带码链接生成已实现并验证，未部署；真实 Shopify 应用验证后置）

### 验证门结论

- Shopify 官方文档当前确认分享折扣链接使用 `/discount/code?redirect=/new-path`，且一次分享链接只能应用一个有效折扣码；来源：<https://help.shopify.com/en/manual/discounts/managing-discounts#promote-a-discount-using-a-shareable-link-or-qr-code>。
- 本地数据库检查结果：`footballkituk` 与 `gogoalshop` 当前没有登记码；这不阻塞链接生成实现。
- 服务端重新校验角色、站点、商品、变体和折扣归属，并通过 Shopify `read_discounts` 核验当前码状态。仅 `ACTIVE` 生成 `cart?...&discount={code}`；无法确认时生成 `cart?...&discount=` 清除旧折扣。
- 当前选择是每次跳转的唯一依据；切换码、假码、失效码和取消选择均不得继承上一次 Checkout 的折扣状态。

### 目标

- 用户明确选中一个码后，由服务端重新校验并生成购买链接；再次点击已选码取消选择。
- 不能确认有效时生成明确清除折扣状态的链接，不伪装成功，也不沿用旧码。

### 实施范围与后置验证

- 阅读当时有效的 Shopify 官方分享折扣链接文档。
- 使用真码、假码和取消选择顺序验证同一浏览器 Checkout 状态；当前码必须覆盖旧码。
- Shopify 应用需要 `read_discounts`；缺少权限时所有码安全降级为无码链接。

### 新增位置

- `server/product-checkout-routes.js`
  - 新增 `POST /api/products/checkout-link`。
  - 只负责认证、输入大小限制、调用模块和输出。
- `server/shopify-discount-link-service.js`
  - 验证目标 URL origin，生成带当前码或明确清空码的 cart permalink。
- `server/shopify-discount-validation-service.js`
  - 使用 Shopify Admin API 验证当前码存在且状态为 `ACTIVE`；任何不可确认状态均失败关闭。
- `src/services/product-checkout-service.js`
  - 请求服务端最终购买链接和稳定错误。

### 修改位置

- `src/config/api-config.js`
  - 增加 checkout-link endpoint。
- `src/features/chat/chat-product-panel.js`
  - 有选中码时请求最终链接；没有选中码时保持现有购买行为。
- 服务端路由装配入口
  - 只挂载新 route，不写购买业务逻辑。

### 服务端处理顺序

1. 解析当前正式用户。
2. 重新解析当前角色和站点。
3. 重新解析可信商品与购买 URL。
4. 使用资格模块确认 `discountCodeId` 当前仍可用。
5. 验证 URL 属于当前站点允许 origin。
6. 生成 Shopify 分享折扣链接或返回普通链接回退。
7. 返回 `mode: "discount_link" | "standard_link"`、`url` 和用户可理解的稳定状态；不返回或伪造 `applied=true`。

### 本地验收

- 选中一个后端当前有效码后，服务端生成带码链接；真实 Shopify 页面是否应用折扣属于后置验收。
- 未选择码使用空 `discount=` 的可信 variant cart，确保旧折扣被清除。
- 过期、停用、跨角色、跨站和伪造 code ID 被拒绝。
- 外部恶意 URL、协议相对 URL和错误 origin 不被包装。
- 不支持的 URL 类型或 Shopify 核验失败时生成明确无码链接，页面不显示“已应用”。
- 多码不能同时提交。
- 尺码变体 cart permalink 仍指向用户选中的正确变体。

### 本地实现与验证结果

- 新增独立 Shopify 折扣验证服务；商品面板选中码后调用接口，核验失败生成明确清除折扣的链接。
- 专项覆盖 ACTIVE、过期、不存在、权限不足、URL 同源、variant target、再次点击取消选择和空 `discount=`。
- 本地服务重启后新 route 已加载，`/api/health` 和未登录 `POST /api/products/checkout-link`（401）真实 HTTP 验证通过。
- 已用同一临时 cookie 会话复现真码后假码仍继承旧码，并验证 `cart?...&discount=` 会清除旧 allocation。当前 FKK 尚缺 `read_discounts`，补权前所有码安全降级为无码。

### 回退点

- 停用 checkout-link 路由；前端仍使用带空 `discount=` 的可信 variant cart 和复制码，不继承旧折扣。

## 批次 6：完整回归、文档回写与发布准备

状态：`Partially completed locally`（批次 1-5 的 Alove 侧实现和回归已完成；真实 Shopify 带码购买结果及自动化浏览器视觉验收未完成）

### 专项自检

新增或扩展：

- `scripts/discount-code-eligibility-self-check.mjs`
- `scripts/product-discount-offers-http-self-check.mjs`
- `scripts/product-checkout-discount-link-self-check.mjs`（批次 5 未开始，尚不存在）
- `scripts/chat-discount-offers-prompt-self-check.mjs`
- `scripts/chat-discount-offer-output-policy-self-check.mjs`
- 现有 guest product、campaign product、product panel、variant cart 和 prompt context 自检。

### 真实用户模拟

1. 正式用户进入前台 Chat，打开商品详情，看到该站点多个有效码。
2. 正式用户进入 creator Chat，只看到该 creator 多个有效码。
3. 在角色之间切换，旧码不残留。
4. 分别复制多个码，内容准确。
5. 选择一个码并从具体尺码购买，Shopify 显示正确码和正确变体。
6. 打开旧历史消息，过期码不再展示。
7. 游客完成文字、语音、通话、商品详情和接口尝试，均拿不到具体码。
8. Search、Kitshop 产品详情不误展示角色码。
9. 实时通话商品详情使用当前通话角色的码。
10. 活动商品旧单码、前台手动广告、自动活动推荐和商品气泡不回归。
11. 桌面、移动、深色和浅色主题完成浏览器验证。

### 相邻功能回归

- 正式聊天文字、语音、实时通话、附件、图片生成。
- 商品搜索、Kitshop、商品动态价格、尺码、库存和支付方式。
- 广告活动创建、自动匹配和前台手动发送。
- 折扣码后台 CRUD、过滤、无限期/固定期和启停。
- 游客聊天、注册承接和游客商品安全过滤。

### 文档回写

实现后按真实状态更新：

- `docs/design/04-commerce-promotions-and-profile.md`
- `docs/system/pages/admin/06-discount-codes.md`
- `docs/system/pages/user/03-chat-product-call.md`
- `docs/system/08-ai-conversation-request-context.md`
- `docs/system/06-api-index.md`
- `logs/updates/YYYY-MM-DD.md`
- 必要的 `docs/releases/*.md`

本地完成但未部署时必须明确标注 `Current locally`；线上验证完成后才能写成线上 Current。

### 当前回归结果

- 批次 1-4 的资格、产品 resolve、多码 UI、Prompt 和确定性输出专项均已加入 `check:deployment` 与自检清单。
- 完整 `npm run check:deployment` 最终退出 0，覆盖聊天、语音、实时通话、游客、商品、Kitshop、广告活动、后台折扣码 CRUD、多站点 preflight 与本地 HTTP smoke。
- 完整门禁曾发现商品面板支付信息 hydration 携带了不必要的完整商品/角色上下文，已恢复为仅按 `siteSlug` 请求并重新通过 variant cart 等相邻回归。
- `guest-auth-claim-self-check` 曾因历史已知异步索引竞争偶发失败；独立重跑通过，随后完整门禁串行重跑通过。本批未为该历史问题增加无关补丁。
- 当前环境缺少仓库 Playwright 依赖，未完成桌面、移动、深色和浅色主题的自动化浏览器视觉验收，不能把第 11 项真实用户模拟标记完成。
- 本地两个站点均无真实 `discount_codes` 记录；测试夹具已清理，因此第 5 项 Shopify 带码购买和完整计划验收仍未完成。

### 最终发布边界

- 首次发布先完成数据库备份和现有正式聊天/商品基线验证。
- 产品详情和 AI 折扣能力可以先上线；Shopify 自动应用只有通过真实站点验证后才能一起上线。
- 自动应用异常时可独立回退明确清除折扣的 variant cart，不影响折扣码后台、展示和聊天表达。
- 服务器更新、GitHub push、tag 和 release 必须由用户另行明确授权。
