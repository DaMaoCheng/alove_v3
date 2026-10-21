# 2026-06-22 主动消息与广告活动分期计划

## 目标

按两阶段推进主动触达：先把“什么时候发”稳定下来，再加“发哪条促销”。

## 分期

### Part 1：主动消息调度器

- 给 `mascot` / `creator` 增加站内主动消息扫描器。
- 基于最近消息时间计算 4-6 小时空闲窗口。
- 夜间按站点时区顺延。
- 复用现有主动消息 job 执行链路。
- 自检覆盖重复 job、未回复主动消息、quiet hours 等边界。

### Part 2：广告活动管理

- 增加 `promotion_campaigns`、`promotion_campaign_deliveries`。
- 增加管理员广告活动列表/新建/编辑。
- 在主动消息发出前做活动匹配。
- 同一账号同一活动只投放一次。
- 第一版只发文本，不做商品气泡联动。

## 当前状态

- Part 1：已完成。
- Part 2：已完成第一版本地实现，待后续继续补 UI 细化、投放统计和商品联动。

## Part 2 文件范围

- `database/schema.sql`
- `server/db.js`
- `server/promotion-campaign-service.js`
- `server/promotion-campaign-match-service.js`
- `server/proactive-message-job-service.js`
- `server/admin-routes.js`
- `src/config/api-config.js`
- `src/services/promotion-campaign-service.js`
- `src/features/admin-console/admin-console-data.js`
- `src/features/admin-console/admin-console-content.js`
- `src/features/admin-console/admin-console-page.js`
- `src/features/admin-console/admin-console-promotion-campaigns-template.js`
- `src/features/admin-console/admin-promotion-campaigns-controller.js`
- `src/features/app-shell/styles/admin-console.css`
- `scripts/promotion-campaign-self-check.mjs`

## 验证口径

- 语法检查只跑本次新增/修改文件。
- 后端必须跑 `node scripts/promotion-campaign-self-check.mjs`。
- 前端至少保证管理页入口、列表、弹窗接线完整，无缺失引用。
- 更新 `docs/releases` 和 `logs/updates`，避免实现和项目树记录脱节。
