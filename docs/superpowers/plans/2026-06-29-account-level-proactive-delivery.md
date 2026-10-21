# 2026-06-29 Account-Level Proactive Delivery Plan

## Goal

把主动消息从“会话各自触发”升级为“账号级共享触达”：

- 每个账号每天至少 1 条主动消息。
- 每个账号每天最多 2 条主动消息。
- 所有可主动发消息的角色共享这 2 条额度。
- 可发角色仅限 `mascot` 和 `creator`。
- 角色选择尽量平均，避免同一个账号连续被同一个角色触达。
- 广告活动命中时占用一次主动消息额度，并继续保持“同一账号同一广告只投放一次”。

## Current Implementation

当前主动消息链路为：

- `server/server.js`
  - 启动 `startMemoryJobRunner()` 和 `startProactiveMessageScheduler()`。
- `server/proactive-message-scheduler-service.js`
  - 扫描 active user session。
  - 只允许 `mascot` / `creator`。
  - 当前按 session 维度判断 4-6 小时 idle。
  - 当前用 unanswered proactive 保护避免连续发。
  - 入队 `memory_jobs` 的 `send_proactive_message`。
- `server/memory-job-runner-service.js`
  - 消费 `memory_jobs`。
- `server/proactive-message-job-service.js`
  - 发出主动消息。
  - 发前先调用 `resolvePromotionCampaignForProactive()`。
  - 命中广告时调用 `createProactivePromotionCampaignMessages()`，生成文字消息 + 商品气泡。
  - 未命中广告时调用 AI 生成普通主动关怀。
- `server/promotion-campaign-match-service.js`
  - 只匹配同站点、active、时间窗口内、角色范围匹配、该账号未收到过的广告。
  - `promotion_campaign_deliveries` 已有唯一键 `campaign_id + internal_uid`。

## Target Behavior

### Daily Account Quota

- 额度维度：`internal_uid` + 用户所属站点时区里的自然日。
- 每天最少：1 条。
- 每天最多：2 条。
- 广告和普通关怀都计入同一个账号级额度。
- 一个广告发出文字 + 商品气泡时，仍只算 1 次主动触达。

### First Daily Message

- 每天必须有一次兜底触达。
- 如果账号当天还没有主动消息，到账号当天的随机白天时间后，即使没有新的 4-6 小时会话机会，也要触发一次。
- 夜间不发，延后到白天。

### Second Daily Message

- 第二条不是必发。
- 只有当前已有 session 满足原来的 4-6 小时 idle、上一条主动消息后用户已回复、且账号当天未达到 2 条时才发。
- 如果上一条主动消息用户未回复，当天不发第二条。

### Character Rotation

- 候选角色来源：
  - 当前账号已有 active user session；
  - 角色 `character_status = published`；
  - 角色 `category_id IN ('mascot', 'creator')`；
  - 用户当前仍能访问该角色。
- 如果只有 1 个候选角色，就只能由它发。
- 如果有 2 个候选角色，本次不能和上一次主动触达角色相同。
- 如果有 3 个或以上，排除上一次角色，再从剩余角色中优先选择历史主动触达次数更少的角色。
- 同分时允许确定性随机，避免长期固定顺序。

### Promotion Campaign Interaction

- 选出本次发送角色后，再进入现有广告匹配。
- 广告命中后发送广告文案 + 商品气泡。
- 广告投放仍保持 `promotion_campaign_deliveries` 的账号级唯一投放保护。
- 广告触达也写入新的账号级主动触达记录。
- 如果广告预留成功但消息创建失败，不能错误消耗账号级额度；要保持现有 job 失败重试语义。

## Required Data Structure

新增账号级主动触达记录表，建议命名：

`proactive_message_deliveries`

建议字段：

- `id`
- `internal_uid`
- `site_id`
- `character_id`
- `session_id`
- `message_id`
- `delivery_date`
- `delivery_status`
- `source_type`
  - `proactive_nudge`
  - `promotion_campaign`
- `source_ref`
- `campaign_id`
- `slot_index`
  - 1 或 2
- `created_at`
- `sent_at`
- `updated_at`

建议索引：

- `idx_proactive_deliveries_user_date (internal_uid, delivery_date, delivery_status)`
- `idx_proactive_deliveries_user_character (internal_uid, character_id, sent_at)`
- `idx_proactive_deliveries_message (message_id)`

不要把账号级额度塞进 `promotion_campaign_deliveries`，因为普通主动关怀也需要计数。

## Files To Modify

### Database

- `server/db-bootstrap-tables.js`
  - 增加 `createProactiveMessageDeliveriesTableIfMissing()` 或放入现有 bootstrap table 分组。
- `database/schema.sql`
  - 如果当前项目仍维护 schema 快照，同步新增表。

### Proactive Scheduler

- `server/proactive-message-scheduler-service.js`
  - 从 session-level 扫描升级为 account-level 选择。
  - 继续复用 `SEND_PROACTIVE_MESSAGE` job。
  - job payload 需要携带：
    - `deliveryMode`: `daily_required` 或 `idle_followup`
    - `slotIndex`
    - `deliveryDate`
    - `selectedBy`: `account_rotation`
  - 保留 queued/running job 去重，避免同一账号当天重复入队。

### Proactive Gate / Delivery Record

- 新增小模块优先：
  - `server/proactive-message-delivery-service.js`
- 职责：
  - 计算站点时区 delivery date。
  - 查询账号当天已发送次数。
  - 查询账号上一条主动触达角色。
  - 查询角色历史发送次数。
  - 预留/完成账号级主动触达记录。
  - 判断第 2 条是否允许。

### Proactive Job

- `server/proactive-message-job-service.js`
  - 发送前再次检查账号级额度，避免排队期间重复。
  - 消息创建成功后写入/完成 `proactive_message_deliveries`。
  - 普通主动关怀和广告消息都要完成记录。
  - 广告路径中 `promotion_campaign_deliveries` 和新表要保持一致。

### Self-Checks

- `scripts/proactive-message-scheduler-self-check.mjs`
  - 覆盖每天至少 1 条、最多 2 条、普通角色不参与。
- 新增或扩展：
  - `scripts/proactive-message-account-quota-self-check.mjs`
  - 覆盖角色轮换、2 个角色不连续、3 个角色按少发优先。
- `scripts/promotion-campaign-product-message-self-check.mjs`
  - 覆盖广告触达计入账号级主动消息额度。
- `scripts/proactive-message-job-split-self-check.mjs`
  - 如果新增模块，更新导入边界断言。

### Logs / Release

- `logs/updates/2026-06-29.md`
- `docs/releases/2026-06-29-account-level-proactive-delivery.md`
- `docs/current-workspace.md`

## Acceptance Criteria

- 一个账号当天没有主动消息时，调度器能为它入队第 1 条主动消息。
- 一个账号当天已有 2 条主动消息时，不再入队或发送第 3 条。
- 一个账号当天已有 1 条且用户未回复时，不发送第 2 条。
- 只有 `mascot` / `creator` 会进入候选，普通角色不会进入候选。
- 2 个候选角色时，本次角色不等于上一次主动触达角色。
- 3 个以上候选角色时，排除上一次角色，并优先选择历史发送次数更少的角色。
- 广告命中时仍然发送广告文字 + 商品气泡，并且只占用 1 次账号级主动触达额度。
- 同一账号同一广告仍然只投放一次。
- 现有 4-6 小时 idle、quiet hours、queued/running job 去重不能退化。
- 主动消息语音生成链路不能退化。
- 当前 promotion campaign 管理、商品气泡、主动消息 job runner 不能受损。

## Verification

必须至少执行：

- `node --check server/proactive-message-scheduler-service.js`
- `node --check server/proactive-message-job-service.js`
- `node --check server/proactive-message-delivery-service.js`
- `node --check server/db-bootstrap-tables.js`
- `node scripts/proactive-message-scheduler-self-check.mjs`
- `node scripts/proactive-message-account-quota-self-check.mjs`
- `node scripts/proactive-message-self-check.mjs`
- `node scripts/proactive-message-voice-self-check.mjs`
- `node scripts/promotion-campaign-product-message-self-check.mjs`
- `node scripts/proactive-message-job-split-self-check.mjs`
- `git diff --check -- <touched files>`

如果新增表或 migration 行为改动，需要本地服务启动后确认：

- `http://127.0.0.1:4173/api/health` 正常；
- `memory_jobs` 能继续被 runner 消费；
- 新表存在且自检数据会清理。

## Out Of Scope

- 不做后台配置页面。
- 不做用户端关闭主动消息开关。
- 不改广告活动编辑 UI。
- 不新增推送、邮件、短信，只做站内聊天记录。
- 不做线上部署，除非用户单独确认。

## Risks

- 账号级 quota 和旧 session-level gate 如果边界不清，会导致重复入队或漏发。
- 广告预留和账号触达预留需要注意事务边界，避免广告记录成功但聊天消息失败后额度被错误消耗。
- 角色轮换必须是确定性代码，不要交给 AI 判断。
- 自检必须覆盖数据清理，避免污染本地库。
