# 2026-07-02 Chat Promotion Product Priority Plan

## Goal

让用户主动请求商品推荐时，优先推荐当前站点正在进行的广告活动商品。

覆盖场景：

- 用户直接说“推荐一个商品”“show me a kit”“find something for matchday”。
- 用户点击产品类快捷用语。
- 如果用户明确要“另一个/换一个/不要这个”，再跳过当前广告商品，走用户画像和商品 API fallback。
- 用户在聊天中触发过广告商品后，主动消息广告仍然保留，但短时间内不能立刻重复触达同一个广告。

本方案只设计实现边界，不改动现有代码。

## Execution Discipline

本功能必须分批推进，不能一次性把全部逻辑堆进去。

每一期必须遵守：

1. 开始前确认本期目标和不做范围。
2. 只修改本期列出的文件。
3. 新增或更新对应 self-check。
4. 完成本期代码后先跑代码自检。
5. 再跑本期专项 self-check 和相关回归 self-check。
6. 再做真实链路自检。
7. 自检通过后更新：
   - `logs/updates/YYYY-MM-DD.md`
   - 必要时新增或更新 `docs/releases/*.md`
   - 必要时更新 `scripts/deployment-check.mjs`
8. 完整完成本期后，才允许进入下一期。

如果任何一期验证失败，必须先修复或回到本期开始前状态，不得继续推进后续期。

## Current Code Finding

### 普通聊天商品推荐

当前链路：

1. `src/features/chat/chat-page.js`
   - 点击快捷用语时把 `productTrigger` 传给 `onSendMessage()`。
2. `src/services/chat-service.js`
   - `sendCharacterReply()` 把 `productTrigger` 发给后端。
3. `server/chat-text-message-service.js`
   - `createUserReply()` 调用回复编排。
4. `server/chat-reply-orchestrator-service.js`
   - 调用 `buildMascotProductContext()`。
5. `server/mascot-product-context-service.js`
   - 根据用户文本或 `quick_product` 触发商品 API。
   - 调用 `fetchProductSummary()` 获取站点商品。
   - 调用 `filterProductsByIntent()` 过滤。
6. `server/chat-product-reply-service.js`
   - 从 `productContext.products[0]` 生成商品气泡。

结论：普通聊天商品推荐现在只看站点商品 API，不看广告活动。

### 广告活动

当前链路：

1. `server/promotion-campaign-match-service.js`
   - 按站点、时间、状态、角色范围、关键词、优先级匹配广告活动。
   - 同账号同活动去重。
2. `server/proactive-message-job-service.js`
   - 主动消息 job 中调用 `resolvePromotionCampaignForProactive()`。
3. `server/chat-proactive-message-service.js`
   - 命中广告后创建广告文案和广告商品气泡。

结论：广告活动目前只服务主动消息，不服务用户主动聊天推荐。

### 用户画像

当前已有基础：

- `server/chat-memory-taxonomy.js`
  - 已有 `favorite_club`、`favorite_player`、`favorite_team_entity`、`purchased_product`。
- `server/user-memory-record-service.js`
  - `buildPromptMemoryBlock()` 会把用户喜好和购买记录放进 prompt context。
- `server/chat-wakeup-context-service.js`
  - 普通回复和主动消息可读取用户记忆。

结论：画像信息已能给 AI 参考，但没有形成确定性的商品排序或选品 fallback。

## Design Rules

### Must Reuse

- 继续复用 `promotion_campaigns.product_snapshot_json` 作为广告商品快照。
- 继续复用 `priority` 字段：数值越小越优先。
- 继续复用 `product-intent-service.js` 的触发判断、团队/类型提取和“换一个”语义基础。
- 继续复用 `chat-product-reply-service.js` 生成商品气泡。
- 继续复用现有商品 API fallback，不另做第二套搜索。

### Must Not Do

- 不把广告查询直接塞进 `chat-reply-orchestrator-service.js`。
- 不让前端判断广告活动是否命中。
- 不让 AI 自己决定是否优先广告。
- 不把“是否重复触达”交给 AI 或 prompt 判断。
- 不复制一套商品气泡插入逻辑。
- 不改主动消息现有行为，避免影响每日主动消息和广告去重。
- 不在本阶段做复杂购买画像算法。

## Deduplication Rule

去重必须是独立后端确定性逻辑，不写进 AI prompt，也不让 agent 自己识别。

### Product Rule

- 用户主动聊天触发广告商品，不永久消耗主动消息广告投放资格。
- 主动消息广告仍然可以触发。
- 但如果同一个用户在最近一段时间内已经通过聊天看到同一个 `campaignId`，主动消息短时间内不要马上再次发送同一个广告。
- 初始建议窗口：24 小时。
- 24 小时后，主动消息仍可再次命中该广告，除非原主动消息 delivery 规则已经阻止。

### Data Source

第一期不新增数据库表，先复用现有消息记录：

- 聊天触发广告商品时，商品消息 payload 带 `campaignId`。
- 商品消息 `source_type = promotion_campaign`。
- 商品消息 `source_ref = promotion-campaign-product`。
- 去重服务通过 `chat_messages.product_payload_json` 和 `sent_at` 判断最近是否触达过。

如果后续统计口径需要更精细，再评估新增轻量事件表，不在第一期做。

### New File: `server/promotion-campaign-dedup-service.js`

职责：广告活动去重判断，只做确定性查询，不生成文案，不调用 AI。

建议导出：

```js
export async function listRecentlySeenPromotionCampaignIds(db, {
  userId,
  siteId,
  withinHours = 24,
} = {})

export async function hasRecentlySeenPromotionCampaign(db, {
  userId,
  campaignId,
  withinHours = 24,
} = {})
```

调用边界：

- 聊天广告推荐：可用来排除用户刚看过的广告，尤其是“换一个”场景。
- 主动消息广告：在 `resolvePromotionCampaignForProactive()` 选候选时排除 24 小时内聊天触达过的同 campaign。
- 不写入 delivery 表。
- 不影响主动消息每日次数表。

## Proposed File Structure

### New File: `server/chat-product-recommendation-service.js`

职责：普通聊天和快捷用语的商品推荐决策层。

建议导出：

```js
export async function buildChatProductRecommendationContext(db, {
  character,
  userId,
  userText,
  productTrigger,
  recentMessages,
} = {})
```

内部流程：

1. 判断角色是否允许商品推荐。
2. 解析用户商品意图：
   - 当前是否是产品请求；
   - 是否快捷用语；
   - 是否“换一个/另一个/不要这个”。
3. 解析当前站点。
4. 如果不是“换一个”，先查广告候选。
5. 如果有广告候选，返回广告商品 context。
6. 如果没有广告候选，fallback 到当前 `mascot-product-context-service.js` 商品 API 搜索。

这样 `chat-reply-orchestrator-service.js` 只改一行调用，不承载广告规则。

### New File: `server/promotion-campaign-chat-recommendation-service.js`

职责：给“用户主动聊天推荐”查当前可用广告活动。

建议导出：

```js
export async function resolvePromotionCampaignForChatProduct(db, {
  siteId,
  userId,
  character,
  userText,
  productTrigger,
  recentMessages,
  excludeCampaignIds,
} = {})
```

和现有 `resolvePromotionCampaignForProactive()` 的区别：

- 不使用主动消息 delivery slot。
- 不强制同账号同活动只发一次，除非后续产品规则要求。
- 需要支持“换一个”时排除当前会话最近展示过的广告商品。
- 需要接入 `promotion-campaign-dedup-service.js` 的近期触达排除结果。
- 只返回候选，不直接写消息。

排序建议：

1. 当前站点；
2. `campaign_status = active`；
3. 当前时间在 `starts_at` 和 `ends_at` 范围内；
4. `role_target = all` 或匹配角色分类；
5. 优先级 `priority ASC`；
6. 即将结束的活动优先；
7. 创建时间更新的优先或沿用现有排序。

如果用户文本命中广告关键词，可以在同优先级内加分，但不应压过明确更高优先级。

### Modify: `server/mascot-product-context-service.js`

建议收缩职责：

- 保留现有商品 API 搜索能力。
- 导出或保留 `resolveProductSite()`、`canCharacterSendProductContext()` 这类能力时要谨慎。
- 如果需要复用站点解析，优先新建小工具文件，避免循环依赖。

推荐新建：

### New File: `server/product-recommendation-site-service.js`

职责：商品推荐链路共享的站点解析。

可从 `mascot-product-context-service.js` 迁出：

- `resolveProductSite()`
- `canCharacterSendProductContext()`
- `canCharacterUseOwnProductSite()`

原因：

- 广告优先推荐和普通商品 API fallback 都需要同一个站点判断。
- 如果不拆，广告推荐服务要反向依赖 mascot context，职责会混。

### Modify: `server/chat-reply-orchestrator-service.js`

最小修改：

```js
const productContext = await buildChatProductRecommendationContext(...)
```

替换当前：

```js
const productContext = await buildMascotProductContext(...)
```

不在这个文件里写广告查询、排序、排除逻辑。

### Modify: `server/chat-product-reply-service.js`

小幅扩展商品 payload：

- 如果 product context 来自广告活动，商品 payload 应带：
  - `campaignId`
  - `sourceType: "promotion_campaign"`
  - `sourceRef: "promotion-campaign-product"`
  - `discountCode`
  - `livePriceFetchedAt` 如果快照价格可信则沿用当前时间或快照时间。

不复制 `createProactivePromotionCampaignMessages()` 里的商品 payload 构造，建议抽共享 mapper：

### New File: `server/promotion-campaign-product-payload-service.js`

职责：广告活动商品快照转商品气泡 payload。

当前 `chat-proactive-message-service.js` 内部已有 `buildCampaignProductPayload()`。

建议迁出到新文件，供两条链路复用：

- 主动消息广告商品气泡；
- 用户主动推荐广告商品气泡。

这样可以避免主动消息一套、聊天推荐一套，后续字段不会两边漏。

### Modify: `server/promotion-campaign-match-service.js`

主动消息广告匹配继续留在这个文件，但候选过滤要接入独立去重服务。

建议最小改动：

- `resolvePromotionCampaignForProactive()` 增加近期聊天触达排除。
- `listEligibleCampaignRows()` 保持原职责：查时间、站点、状态、delivery 去重。
- 在候选 scored 前或 scored 后过滤 `recentlySeenCampaignIds`。

不允许：

- 不把聊天推荐逻辑搬进本文件。
- 不让本文件直接解析用户“换一个”意图。
- 不改变现有主动消息 daily slot 和 delivery reservation 逻辑。

### Modify: `server/product-intent-service.js`

只补确定性意图，不扩大职责。

建议新增：

- `isAlternativeProductRequest(userText)`

用于识别：

- 中文：换一个、另一个、不要这个、还有别的吗、其他款、不是这个；
- 英文：another one、something else、not this、different one、show another、any other。

这不是 AI 判断，必须是明确规则。

### Modify: `src/features/chat/chat-quick-replies.js`

原则上不需要修改。

快捷用语已经传 `productTrigger: "quick_product"`，只要后端统一走 `buildChatProductRecommendationContext()`，快捷用语自然优先广告。

如果后续要让某个快捷用语强制跳过广告，再额外扩展 trigger；本阶段不做。

## Product Context Shape

建议统一返回：

```js
{
  sourceType: "promotion_campaign" | "product_api",
  siteId,
  siteName,
  siteSlug,
  siteCurrency,
  searchIntent,
  campaign: null | {
    id,
    priority,
    title,
    messageText,
    discountCode,
  },
  products: [...]
}
```

这样 prompt、商品气泡、统计都知道商品从哪里来。

## Promotion Dedup Shape

建议 `promotion-campaign-dedup-service.js` 返回简单结构：

```js
{
  campaignIds: ["campaign_xxx"],
  windowHours: 24
}
```

去重只看结构化字段：

- `internal_uid`
- `source_type`
- `source_ref`
- `product_payload_json.campaignId`
- `sent_at`

不读取 AI 文案，不做语义判断。

## Behavior Rules

### 用户主动推荐商品

如果用户的消息触发商品推荐：

1. 查当前站点正在进行的广告活动。
2. 过滤 24 小时内刚在聊天里展示过的同一广告活动，除非这是第一次推荐且没有其他可用活动。
3. 有广告活动：
   - 选优先级最高的广告商品；
   - 商品卡使用广告商品快照；
   - 文本补充仍走现有 AI 回复，但 prompt 明确这是 selected product。
4. 没有广告活动：
   - 走现有商品 API 搜索。

### 快捷用语

如果快捷用语带 `quick_product`：

1. 按当前站点查广告活动。
2. 有广告活动，优先广告商品。
3. 没有广告活动，走现有 `query = recommended`。

### 用户要求另一个商品

如果用户明确说“换一个/另一个/不是这个”：

1. 排除当前会话最近展示过的商品或广告 campaign。
2. 优先使用用户画像：
   - favorite club
   - favorite player
   - favorite team entity
   - purchased product
3. 组合一个商品 API query。
4. 如果画像没有可用信息，再用用户当前文本 fallback。

第一期可以只做到：

- 跳过最近展示的广告商品；
- 使用当前商品 API fallback。

画像排序可以作为第二期，避免一次做太大。

### 主动消息广告去重

主动消息触发广告时：

1. 保留现有主动消息活动匹配和 delivery 规则。
2. 额外读取最近 24 小时内用户已经通过聊天看到过的广告 campaign。
3. 如果当前候选 campaign 在近期触达列表中，就跳过。
4. 如果还有其他 active campaign，按原优先级继续选。
5. 如果没有其他 active campaign，就回到原主动消息普通关怀逻辑。

这保证：

- 聊天中触发广告不会永久消耗主动消息投放资格。
- 用户不会在短时间内被同一个广告重复打扰。
- 主动消息广告功能仍然存在。

## Phasing

### Phase 1: 广告商品 payload 共享与确定性去重地基

目标：

- 抽出广告商品 payload mapper，保证主动消息和聊天推荐未来使用同一份商品卡字段。
- 建立独立广告去重服务，但只接入主动消息候选过滤，不接入聊天推荐。
- 保证主动消息广告仍然可发，只是 24 小时内不重复发用户刚在聊天里看过的同 campaign。

修改范围：

- 新增 `server/promotion-campaign-product-payload-service.js`
- 新增 `server/promotion-campaign-dedup-service.js`
- 小改 `server/chat-proactive-message-service.js`，复用新的广告商品 payload mapper。
- 小改 `server/promotion-campaign-match-service.js`，主动消息候选过滤近期聊天已看广告。

不做：

- 不改普通聊天推荐。
- 不改快捷用语。
- 不改用户画像 fallback。
- 不改主动消息每日次数和 delivery reservation。

验收：

- 主动消息命中广告时仍然发送广告文案和广告商品卡。
- 广告商品卡字段与改动前一致或更完整。
- 用户 24 小时内已经在聊天里看过同 campaign 时，主动消息不重复发送该 campaign。
- 用户没有看过该 campaign 时，主动消息广告仍正常发送。

建议自检：

- 新增 `scripts/promotion-campaign-dedup-self-check.mjs`
- 扩展或保留 `scripts/promotion-campaign-product-message-self-check.mjs`
- 覆盖：
  - 广告 payload mapper 输出完整商品字段；
  - 主动消息广告不被普通用户无关消息误拦截；
  - 24 小时内同 campaign 被跳过；
  - 超过 24 小时不被跳过。

真实链路自检：

- 本地创建一个 active 广告活动。
- 运行主动消息 job，确认仍能发出广告商品。
- 手动或脚本插入一条聊天广告商品消息，再运行主动消息 job，确认同 campaign 被跳过。
- 确认普通聊天商品推荐行为暂时不变。

记录要求：

- 本期完成后更新当天 `logs/updates/YYYY-MM-DD.md`。
- 新增 release 节点，例如 `docs/releases/2026-07-02-promotion-dedup-foundation.md`。
- 如新增 self-check，应加入 `scripts/deployment-check.mjs`。

### Phase 2: 广告优先接入普通聊天推荐

目标：

- 用户主动要求商品推荐时，优先返回当前站点 active 广告商品。
- 快捷用语也走同一逻辑。

修改范围：

- 新增 `server/product-recommendation-site-service.js`
- 新增 `server/promotion-campaign-chat-recommendation-service.js`
- 新增 `server/chat-product-recommendation-service.js`
- 小改 `server/chat-reply-orchestrator-service.js`
- 小改 `server/chat-product-reply-service.js`，识别广告 source。

不做：

- 不做复杂用户画像推荐。
- 不改前端快捷用语 UI。
- 不改变主动消息投放次数和每日限制。
- 不改变 Phase 1 的主动消息去重窗口。

验收：

- 有 active 广告活动时，“推荐商品”发出广告商品。
- 点击产品快捷用语时发出广告商品。
- 广告商品卡内容来自 `product_snapshot_json`。
- 主动消息广告商品仍正常。
- 无 active 广告时，原商品 API 推荐正常。
- 聊天推荐广告不会写入主动消息 delivery 表。

建议自检：

- 新增 `scripts/chat-promotion-product-priority-self-check.mjs`
- 覆盖：
  - active campaign 优先；
  - priority 小的优先；
  - role_target 不匹配时跳过；
  - 无 campaign fallback 到 product API；
  - quick_product 触发 campaign。

真实链路自检：

- 本地登录前台账号进入 Millie。
- 发送“推荐一个商品”，确认优先出现广告商品。
- 点击产品快捷用语，确认也优先出现广告商品。
- 暂停/过期广告后再测一次，确认回到原商品 API 推荐。
- 运行主动消息广告自检，确认 Phase 1 功能未破坏。

记录要求：

- 本期完成后更新当天 `logs/updates/YYYY-MM-DD.md`。
- 新增 release 节点，例如 `docs/releases/2026-07-02-chat-promotion-priority.md`。
- 新增 self-check 后加入 `scripts/deployment-check.mjs`。

### Phase 3: “换一个”跳过当前广告商品

目标：

- 用户明确要求另一个商品时，不重复推荐同一个广告商品。

修改范围：

- `server/product-intent-service.js`
  - 新增 `isAlternativeProductRequest()`。
- `server/promotion-campaign-chat-recommendation-service.js`
  - 支持排除最近商品或 campaign。
- `server/chat-product-recommendation-service.js`
  - 根据 recent messages 提取最近展示过的 product/campaign。

不做：

- 不做复杂画像排序。

验收：

- 用户第一次“推荐商品”拿广告商品。
- 用户紧接着说“换一个”，不会再拿同一个广告商品。
- 没有其他广告时 fallback 到商品 API。

建议自检：

- 新增或扩展 `scripts/chat-promotion-product-priority-self-check.mjs`。

真实链路自检：

- 本地登录前台账号进入 Millie。
- 发送“推荐一个商品”，确认拿广告商品。
- 紧接着发送“换一个”，确认不重复同一个 campaign。
- 如果没有其他广告，确认回到商品 API 推荐。

记录要求：

- 本期完成后更新当天 `logs/updates/YYYY-MM-DD.md`。
- 必要时更新 Phase 2 release 节点或新增独立 release 节点。

### Phase 4: 用户画像 fallback 推荐

目标：

- 当用户要求另一个商品，且没有可用广告时，根据用户记忆构造更合理的 query。

修改范围：

- 新增 `server/user-product-preference-service.js`
  - 从 `user_memory_records` 读取购买记录、喜欢球队、球星。
  - 输出稳定 query，不让 AI 自由决定。
- `server/chat-product-recommendation-service.js`
  - fallback query 优先使用画像。

不做：

- 不做购买记录导入。
- 不做复杂推荐系统。
- 不做跨站推荐。

验收：

- 用户记忆里有喜欢球队时，fallback 商品 query 包含该球队。
- 用户记忆里有购买记录时，避免重复推荐完全相同商品标题。
- 没有画像时仍按原文本搜索。

建议自检：

- 新增 `scripts/chat-product-preference-fallback-self-check.mjs`
- 覆盖：
  - favorite club 生成稳定 query；
  - purchased product 避免完全重复；
  - 没有画像时不影响原 API fallback。

真实链路自检：

- 本地构造或使用已有用户记忆。
- 发送“换一个/another one”。
- 确认 fallback query 使用用户画像。
- 确认没有画像时仍能正常推荐。

记录要求：

- 本期完成后更新当天 `logs/updates/YYYY-MM-DD.md`。
- 新增 release 节点，例如 `docs/releases/2026-07-02-chat-product-preference-fallback.md`。
- 新增 self-check 后加入 `scripts/deployment-check.mjs`。

## Verification Plan

每一期至少跑：

- `node --check` 覆盖新增和修改文件。
- 对应 self-check。
- 相关旧 self-check，至少覆盖：
  - `scripts/promotion-campaign-product-message-self-check.mjs`
  - `scripts/promotion-campaign-self-check.mjs`
  - `scripts/product-message-trigger-self-check.mjs`
  - `scripts/mascot-product-context-self-check.mjs`
- `npm run check:deployment`。
- 本地真实链路：
  - 登录前台账号；
  - 进入 Millie；
  - 发送“推荐一个商品”；
  - 点击产品快捷用语；
  - 如果有第二期，继续发送“换一个”。

涉及服务器发布时，再跑：

- `curl -fsS https://alove.fans/api/health`
- 服务器对应 self-check。
- 线上实际对话链路抽测。

## Risk Notes

- 不能复用主动消息的 delivery 去重规则，否则用户主动问商品时可能因为“这个广告已经主动发过”而拿不到广告商品。
- 不能让聊天推荐写入 `promotion_campaign_deliveries` 或 `proactive_message_deliveries`，否则会污染主动消息投放统计。
- 不能让主动消息去重永久屏蔽聊天触发过的广告；当前规则是短窗口去重，初始 24 小时。
- 不能让广告商品和 API 商品并行各发一个卡，否则会造成重复气泡。
- 不能让 prompt 自己决定是否优先广告，广告优先必须由后端确定。
- 不能让 prompt 自己决定是否重复触达，去重必须由 `promotion-campaign-dedup-service.js` 判断。
- 广告商品价格来自快照，和实时 Shopify 价格可能有差异；后续如要实时价，应继续走现有商品气泡局部价格刷新规则。
- 如果广告商品快照缺图、缺 URL、缺价格，应跳过该广告或回退 API，不能生成破损商品卡。

## Recommended Starting Point

先做 Phase 1。

原因：

- Phase 1 先处理共享 payload 和确定性去重，能保证主动消息广告不被后续改坏。
- 做完 Phase 1 后，再做 Phase 2 的聊天广告优先，风险更低。
- Phase 1 不改前端、不改普通聊天推荐，验证边界最清楚。
- 只有 Phase 1 自检和真实链路通过后，才能推进 Phase 2。
