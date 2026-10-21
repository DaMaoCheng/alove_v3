# AIOVE 产品设计规范

更新时间：2026-07-19

本目录定义 AIOVE 的长期产品规则：用户为什么会进入某个站点、各类账号能做什么、聊天和角色如何协作、商业权益如何约束，以及后台如何运营。

它不是 API、数据库或部署手册，也不是某一次功能的实施清单。技术实现以 [系统文档](./system/README.md) 为准；一次性功能决策和实施步骤分别记录在 `docs/superpowers/specs/`、`docs/superpowers/plans/`；已经发布的历史事实记录在 `docs/releases/`。

## 规则状态

- `Current`：已由当前代码或已发布行为验证。
- `Approved direction`：产品方向已确认，但尚未实现；不能据此声称功能可用。
- `TBD`：仍需产品决策；实现前必须先完成规格确认。

除非另有标注，文档中出现的站点、角色、账号和活动规则均适用于未来任意站点；`footballkituk`、`gogoalshop` 只作为当前实例，不是规则的一部分。

## 设计地图

| 主题 | 设计规范 | 技术事实 |
| --- | --- | --- |
| 产品模型与术语 | [00-product-model-and-glossary.md](./design/00-product-model-and-glossary.md) | [系统总览](./system/01-system-overview.md) |
| 路由与站点上下文 | [01-navigation-and-site-context.md](./design/01-navigation-and-site-context.md) | [前台页面](./system/02-frontend-pages.md) |
| 身份、权限与生命周期 | [02-identity-permissions-and-user-lifecycle.md](./design/02-identity-permissions-and-user-lifecycle.md) | [后端服务与数据](./system/04-backend-services-and-data.md) |
| 角色、聊天、记忆与 AI 行为 | [03-characters-chat-memory-and-ai-behavior.md](./design/03-characters-chat-memory-and-ai-behavior.md) | [前台页面](./system/02-frontend-pages.md) |
| 商业、权益与画像 | [04-commerce-promotions-and-profile.md](./design/04-commerce-promotions-and-profile.md) | [后台管理](./system/03-admin-console.md) |
| 用户侧体验 | [05-user-facing-experience.md](./design/05-user-facing-experience.md) | [前台页面](./system/02-frontend-pages.md) |
| 后台与运营 | [06-admin-and-operations.md](./design/06-admin-and-operations.md) | [后台管理](./system/03-admin-console.md) |
| 集成与数据治理 | [07-integrations-and-data-governance.md](./design/07-integrations-and-data-governance.md) | [后端服务与数据](./system/04-backend-services-and-data.md) |
| 页面、弹窗与逐字段行为 | 对应上述长期规则 | [页面与字段规范及完整页面索引](./system/pages/README.md) |

## 维护流程

1. 新需求若改变长期产品规则，先更新对应 `docs/design/` 文档并标明状态。
2. 再在 `docs/superpowers/specs/` 写目标、非目标、状态流转、权限、数据来源、确定性规则和验收标准。
3. 在 `docs/superpowers/plans/` 写本次实施范围、迁移、验证、回滚和发布步骤。
4. 功能完成真实验证后，把对应规则更新为 `Current`；有线上发布时，再补 `docs/releases/`。
5. 发现设计与真实行为不一致时，先记录冲突并核对代码；未确认前不得把推测写成 `Current`。

页面级调整还必须同步维护 [页面与字段规范](./system/pages/README.md)：页面目标、入口、身份边界、所有可见字段/控件、输入方式、校验、数据来源、操作结果和关联目标必须能从对应页面文档中查到。只改长期规则但不回写页面行为，或只改页面字段但不标明关联产品规则，都视为文档未闭环。

## 边界

- 本轮不定义视觉 token、组件样式或 CSS 规范。完成单独 UI 审计后，再建立独立视觉设计规范。
- 产品设计不复制接口字段、SQL、环境变量或部署命令；需要这些内容时链接到系统文档。
- 页面控件、字段、默认值、校验和实现状态由 `docs/system/pages/` 维护；`docs/design/` 只保存这些页面必须遵守的长期产品规则，避免同一字段维护两份事实。
- 游客聊天与认证承接已在当前代码和线上版本中实现，由站点开关控制。2026-07-17 运行配置核对结果：本地仅 `footballkituk` 为测试而开启，线上全部站点仍关闭；配置状态可由管理员改变，判断是否真实开放时必须重新检查运行配置。外部账号绑定、订单同步和折扣码能力仍只记录目标方向与待决策项，不能直接对外承诺。
