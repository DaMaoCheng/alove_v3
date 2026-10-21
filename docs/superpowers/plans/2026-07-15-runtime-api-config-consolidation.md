# Runtime API 配置收口实施方案

更新时间：2026-07-15

当前进度：批次 A-C 已在本地完成；批次 D 的本地环境已完成备份、事务换钥、重启和真实 Shopify 验证。服务器批次 D 仍未执行，必须在正式发布前使用线上独立 key 单独迁移。

## 1. 目标

把项目正式运行时使用的环境配置收口到 `server/config.js`，让业务 service 只读取 `SERVER_CONFIG`，并建立可自动检查的配置契约，避免新增 API、模型、语音、商品或安全配置时再次散落。

本方案只在本地推进。未经单独发布确认，不修改服务器 shared `.env.local`，不迁移线上站点密钥，不更新 GitHub。

## 2. 当前事实

- `.env.local`、`.env` 只负责提供环境值；`server/config.js` 是正式运行时主入口。
- 大部分业务配置已经由 `SERVER_CONFIG` 提供，但 Knowledge AI 仍在 `knowledge-ai-config.js` 直接读取 `process.env`。
- Shopify 商品源仍支持 URL 中的动态 `tokenEnv`，并在业务 service 内读取任意 `process.env[tokenEnv]`。
- 站点商品源、Shopify domain、API version 和加密 Token 属于站点级数据，保存在 `sites` 表，不应搬入全局 env。
- 当前 `PRODUCT_API_SECRET_KEY` 未形成独立稳定密钥；已有站点 Token 依赖旧 effective key，不能直接改 key 后重启。
- 普通 `npm run check:deployment` 会运行配置结构检查，但严格生产值检查只有显式设置 `STRICT_PRODUCTION_ENV=true` 才执行。

## 3. 配置归属规范

| 配置类型 | 唯一来源 | 消费规则 |
| --- | --- | --- |
| 正式运行时全局配置 | `.env.local` / `.env` → `server/config.js` | 业务代码只能读取 `SERVER_CONFIG` |
| 站点商品源与站点密钥 | `sites` 表 | 后台 service 负责规范化、加密和读取；不能复制到前端或日志 |
| 部署、自检、真实 Provider 测试参数 | 执行命令环境 | 仅对应脚本读取，不混入正式运行时配置契约 |
| 确定性默认值和枚举 | `server/config.js` | service 不得再定义第二套 env fallback |

允许的直接环境读取仅限：

- `server/config.js` 的启动加载与配置构建；
- 明确列入白名单的本地自检安全开关，例如 `NODE_ENV`、`AIOVE_ALLOW_LOCAL_PRODUCT_SOURCE_SELF_CHECK`；
- `scripts/` 下部署、自检和真实 Provider 测试命令自己的参数。

## 4. 已定位的运行时链路

| 配置域 | 入口 | 主要消费者 |
| --- | --- | --- |
| 服务与数据库 | `SERVER_CONFIG.port/host/db` | HTTP server、数据库连接、advisory lock |
| 邮件 | `SERVER_CONFIG.email*` | 验证码、注册、登录邮件 |
| 登录与安全 | `authCookieName/security/publicBaseUrl/guestChat` | Cookie、HTTPS/HSTS/CSP、代理 IP、管理员权限、游客限流 |
| Google 登录 | `SERVER_CONFIG.google` | OAuth callback、游客 claim |
| 对话 AI | `SERVER_CONFIG.aiReply` | 正式/游客聊天、主动消息、角色润色、简介、头像审核、图片意图 |
| Knowledge AI | 目标 `SERVER_CONFIG.knowledgeAi` | 后台知识大纲、拆分、摘要与关键词 |
| 生图 | `SERVER_CONFIG.imageGeneration` | 角色头像与聊天图片 |
| ElevenLabs | `SERVER_CONFIG.elevenLabs` | 正式/游客语音回复、语音输入、实时通话、主动消息与开场语音 |
| 后台任务 | `memoryRunner/proactiveScheduler` | 记忆任务与主动消息调度 |
| 地理与代理 | `network/geoSearch/geoIp` | outbound fetch、地区搜索、IP 站点分流 |
| 商品 | `SERVER_CONFIG.productApi` + `sites` | Search、活动选品、聊天商品、游客商品、Kitshop、首页楼层、订单销量 |

`OPENAI_API_MODE` 只控制使用统一对话 Provider 的链路；头像审核、图片意图等固定 endpoint 能力仍按各 service 的接口协议执行，不能误写成全项目 endpoint 开关。

## 5. 分批实施

### 批次 A：配置契约与无行为清理

- 补齐 `.env.example` 中实际运行需要的 TTS、auth、guest、memory、proxy 等字段。
- 修正当前模型默认值和部署示例为 `gpt-5.6-luna`；历史 release/bug 日志不改写。
- 新增配置唯一入口静态自检，扫描 `server/` 的业务文件，拒绝未列入白名单的直接 `process.env`。
- 删除本地 `.env.local` 中 8 个已确认全仓无引用的旧键：`ALIYUN_ASR_*`、`DASHSCOPE_API_KEY`、`FFMPEG_BIN`、`FFPROBE_BIN`。
- 修改 `.env.local` 前制作本地快照；不读取或输出密钥值。

验收：配置模板和部署清单一致；旧键不存在；业务运行配置无新增旁路；服务可启动。

### 批次 B：正式运行入口收口

- 把 Knowledge AI 解析迁入 `SERVER_CONFIG.knowledgeAi`，保留“未单配时继承对话 OpenAI”的现有行为。
- `knowledge-ai-config.js` 只返回集中配置，不再直接读取环境变量。
- Shopify 全局 fallback 只读 `SERVER_CONFIG.productApi.shopifyAdminAccessToken`。
- 弃用动态任意 `tokenEnv`：当前真实站点未使用；解析旧 URL 时只允许默认 `SHOPIFY_ADMIN_ACCESS_TOKEN`，非白名单名称不读取环境变量并明确告警。
- 统一 Shopify API version fallback 为站点 URL > `SERVER_CONFIG.productApi.shopifyAdminApiVersion`。

验收：Knowledge 独立配置与继承配置均通过；Shopify DB 加密 Token 优先；默认全局 fallback 可用；任意 env 名不能被站点 URL 读取；商品全链路回归。

### 批次 C：配置门禁与文档

- 配置结构检查覆盖全部正式运行键，不依赖生产 secret，也不因 strict flag 跳过。
- 严格生产检查补齐 TTS、Knowledge AI 与专用 `PRODUCT_API_SECRET_KEY`；生产发布前必须先完成对应环境的站点 Token 换钥。
- 把 Knowledge、后台站点商品源自检纳入部署门禁。
- 在系统运维文档维护“配置域 → `SERVER_CONFIG` 字段 → 消费链路”的唯一技术说明；设计文档只交叉引用，不复制 env 细节。

验收：目标自检、preflight 和完整 `npm run check:deployment` 通过。

### 批次 D：商品密钥独立迁移

该批次不得与 A-C 混合发布。

1. 备份数据库和环境配置，只统计密文状态，不输出明文或密钥。
2. 停止应用服务或进入明确维护状态，避免运行中进程继续持有旧 key。
3. 用旧 effective key 解密每个站点 Token；生成本环境独立 `PRODUCT_API_SECRET_KEY`。
4. 同时提供一次性命令参数 `--maintenance-confirmed --execute`，事务内逐条旧解密、新加密、新解密并在进程内比对指纹；任一失败全量回滚。
5. 立即切换环境配置并重启，专项验证时屏蔽全局 Shopify fallback，证明数据库密文可独立工作。
6. 验证后台站点编辑、Search、活动选品、正式/游客聊天商品、Kitshop 首页楼层、订单销量和自动刷新。
7. 验收结束前保留旧 key 和数据库备份作为回滚点。

本地迁移完成也不代表线上已迁移；线上必须单独备份、执行和验收。

## 6. 完整验证矩阵

- `server/config.js`、Knowledge、Shopify 服务语法检查。
- 配置键完整性、唯一入口和敏感信息泄露检查。
- Knowledge AI 继承/覆盖、失败显式返回。
- OpenAI 对话、角色润色、简介、头像审核、图片意图。
- 生图、ElevenLabs TTS/STT/实时 STT。
- Google、SMTP、Geo、outbound proxy。
- Memory runner、主动消息 scheduler。
- Shopify 商品源、商品搜索、首页楼层、销量、Kitshop 缓存与后台刷新。
- 正式用户和游客聊天商品回归。
- `npm run preflight:multisite`、`npm run smoke:multisite`、`npm run check:deployment`。
- 有真实 Provider 条件时，再执行聊天、语音、实时通话、生图与 Shopify 的真实接口验证；没有真实条件时必须明确标注验证边界。

## 7. 回滚

- A-C：回滚本分支文件改动并恢复 `.env.local` 本地快照；不涉及数据库结构变化。
- D：恢复旧环境密钥和数据库备份/旧密文，重启后重新跑商品专项检查。
- 任一批次失败时停在当前检查点，不继续叠加下一批改动。
