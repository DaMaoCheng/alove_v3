# 07. Runtime Configuration

更新时间：2026-07-15

本文是正式运行时配置的唯一技术索引，回答三个问题：配置放在哪里、由哪个 `SERVER_CONFIG` 字段提供、哪些功能实际使用它。

## 1. 唯一入口与加载顺序

加载顺序：

1. 进程启动时已经存在的环境变量；
2. `.env.local`；
3. `.env`；
4. `server/config.js` 内的默认值。

`server/config.js` 加载文件时不会覆盖进程已经提供的环境变量。正式业务文件只能读取 `SERVER_CONFIG`；不能自行读取 `process.env` 或再建立第二套 fallback。

例外只有：

- `server/config.js` 本身；
- `server/product-source-http-service.js` 的测试安全开关 `NODE_ENV` 与 `AIOVE_ALLOW_LOCAL_PRODUCT_SOURCE_SELF_CHECK`；
- `scripts/` 下只服务于部署、自检和真实 Provider 测试的命令参数。

`scripts/runtime-config-boundary-self-check.mjs` 会自动扫描这条边界，并在 `npm run check:deployment` 中执行。

## 2. 全局配置映射

| env 配置 | `SERVER_CONFIG` 位置 | 使用功能与主要文件 |
| --- | --- | --- |
| `PORT`、`HOST` | `port`、`host` | `server/server.js` 的监听地址 |
| `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` | `db` | `db-core.js`、`db-advisory-lock-service.js`，以及所有数据库 service |
| `EMAIL_AUTH_DEV_MODE` | `emailAuthDevMode` | 本地验证码显示策略、注册/登录邮件流程 |
| `EMAIL_PROVIDER`、`EMAIL_FROM`、`SMTP_*` | `email` | `email-service.js`、`email-code-service.js` |
| `AUTH_COOKIE_NAME` | `authCookieName` | `cookie-utils.js` 的登录 Cookie |
| `AIOVE_SUPER_ADMIN_EMAILS` | `security.superAdminEmails` | `route-utils.js` 的超级管理员判断 |
| `COOKIE_SECURE`、`FORCE_HTTPS`、`HSTS_*`、`CSP_REPORT_ONLY_ENABLED` | `security` | `security-response-utils.js`、Cookie 与 HTTPS 响应 |
| `TRUST_PROXY`、`TRUSTED_PROXY_IPS` | `security` | `http-request-utils.js` 的真实客户端 IP 解析 |
| `PUBLIC_BASE_URL` | `publicBaseUrl` | Origin 校验、安全策略、Google callback 一致性 |
| `GUEST_NETWORK_PEPPER` | `guestChat.networkPepper` | `guest-network-rate-limit-service.js` 的游客网络指纹 |
| `APP_SECRET` | 兼容 fallback | 仅在专用 key 缺失时兼容；新环境不应把它当作统一万能密钥 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI` | `google` | `google-auth-service.js`、游客登录承接 |
| `AI_REPLY_PROVIDER`、`OPENAI_*` | `aiReply` | 正式/游客聊天、主动消息、角色润色、角色简介、头像审核、图片意图 |
| `TYPESAFE_API_KEY`、`TYPESAFE_BASE_URL`、`TYPESAFE_MODEL`、`TYPESAFE_TIMEOUT_MS` | `typeSafe` | Jev 结构化聊天意图判断；失败或低置信度时回退现有 Venice 分类器 |
| `KNOWLEDGE_AI_*` | `knowledgeAi` | `knowledge-ai-config.js` → `knowledge-ai-service.js` → 后台知识大纲、拆分、摘要、关键词 |
| `IMAGE_GENERATION_*` | `imageGeneration` | `image-generation-provider-service.js`、`chat-image-provider-service.js` |
| `AVATAR_MODERATION_TIMEOUT_MS` | `avatarModeration.timeoutMs` | 头像审核请求超时 |
| `ELEVENLABS_API_KEY`、`ELEVENLABS_BASE_URL`、模型/格式/超时 | `elevenLabs` 的 TTS 字段 | 正式/游客语音回复、主动消息、开场语音、语音重试 |
| `ELEVENLABS_STT_*` | `elevenLabs` 的 STT 字段 | 语音输入、实时通话 STT；key/base/timeout 未单配时继承主 ElevenLabs 配置 |
| `MEMORY_RUNNER_*` | `memoryRunner` | `memory-job-runner-service.js` |
| `PROACTIVE_MESSAGE_SCHEDULER_*` | `proactiveScheduler` | `proactive-message-scheduler-service.js` |
| `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY` | `network.proxyUrl` | `network-proxy.js` 安装的 outbound fetch proxy，优先级按表中顺序 |
| `GEO_SEARCH_*` | `geoSearch` | `geo-region-search-service.js` 的后台地区搜索 |
| `GEO_IP_*` | `geoIp` | `geo-site-resolver-service.js` 的 IP 站点分流 |
| `PRODUCT_API_TIMEOUT_MS` | `productApi.timeoutMs` | HTTP/Shopify 商品源、首页楼层、订单销量请求 |
| `SHOPIFY_ADMIN_API_VERSION` | `productApi.shopifyAdminApiVersion` | Shopify 站点未指定 version 时的默认值；站点 URL version 优先 |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | `productApi.shopifyAdminAccessToken` | 仅在站点没有数据库加密 Token 时的兼容全局 fallback |
| `PRODUCT_API_SECRET_KEY` | `productApi.secretKey` | 站点 Shopify Token 的加解密；代码保留旧环境 fallback，但严格生产门禁要求使用专用 key |

## 3. AI 配置边界

### 对话 AI

`OPENAI_API_MODE` 控制统一对话 Provider 使用 `responses` 或 `chat_completions`。它不是所有 OpenAI 风格请求的全局 endpoint 开关：头像审核与聊天图片意图等能力因响应协议不同，仍由对应 service 使用固定 endpoint。

当前默认模型是 `gpt-5.6-luna`。真实环境可以通过 `OPENAI_MODEL` 覆盖。

可选 `OPENAI_FALLBACK_MODEL` 用于对话模型的第二阶段重试：留空时，主模型保留最多 10 次机会；填写后，主模型先尝试 5 次，只有超时、网络、429、5xx 或无效输出等可重试失败才切到次级模型再尝试 5 次。`OPENAI_FALLBACK_API_KEY` 可选；留空继承 `OPENAI_API_KEY`。次级模型固定复用主模型的 `OPENAI_BASE_URL`、API mode、reasoning effort 和单次超时，不能借此创建第二套不受控 Provider。401、403、404 等不可重试错误不会切换模型。

### Knowledge AI

Knowledge AI 现在由 `SERVER_CONFIG.knowledgeAi` 集中构建：

- 独立 `KNOWLEDGE_AI_*` 有值时使用独立配置；
- 未配置的字段逐项继承 `SERVER_CONFIG.aiReply`；
- `knowledge-ai-config.js` 只是业务 facade，不再读取环境变量。

### 图片与语音

- 图片 key/base 未单配时继承 OpenAI key/base。
- STT key/base/timeout 未单配时继承主 ElevenLabs TTS 配置。
- 因此 `.env.example` 同时列出 TTS 和 STT 字段，不能只配置 STT 后把语音回复误判为可用。

## 4. 站点商品配置边界

以下内容不属于全局 env，保存在 `sites` 表：

- `product_source_type`
- `product_shop_domain`
- `product_api_version`
- `product_api_url`
- `product_access_token_encrypted`
- `shopify_login_enabled`

后台站点编辑链路：

`admin-console-sites-template.js` → `admin-sites-editor.js` → `admin-site-service.js` → `/api/admin/sites` → `admin-site-write-service.js` → `admin-site-product-source-service.js`。

保存 Shopify 配置时，后端校验 domain/version，生成 canonical `product_api_url`，并用 `SERVER_CONFIG.productApi.secretKey` 加密 Token。后台读取只返回 `hasProductAccessToken`，不会返回密文或明文；`shopify_login_enabled` 是独立站点开关，不属于 env，也不会清空 Token。

消费者包括：

- 公开商品 Search；
- 管理员活动选品；
- 正式聊天和前台角色商品；
- 游客商品消息；
- Kitshop 商品缓存和后台刷新；
- Shopify 首页楼层；
- 近 30/60 天订单销量。

数据库加密 Token 优先于全局 `SHOPIFY_ADMIN_ACCESS_TOKEN` fallback。站点 URL 中任意 `tokenEnv` 的旧兼容能力已弃用，业务代码不会再按数据库内容读取任意服务器环境变量。

## 5. 商品密钥换钥约束

不能只在 env 新增或替换 `PRODUCT_API_SECRET_KEY` 后重启。已有密文必须先用旧 effective key 解密，再使用本环境的新专用 key 重加密。严格生产门禁会拒绝缺少该专用 key 的发布环境。

换钥必须单独执行：数据库备份、停止应用服务、事务迁移、立即切换 env 并重启、新旧明文的进程内指纹比对、屏蔽全局 fallback 的真实商品验证和明确回滚。具体步骤见 [Runtime API 配置收口实施方案](../superpowers/plans/2026-07-15-runtime-api-config-consolidation.md)。

迁移工具是 `scripts/migrate-product-api-secret-key.mjs`。它只接受当前用户可读写的普通临时文件，默认做事务预检并回滚；只有在应用已停止后同时提供一次性命令参数 `--maintenance-confirmed --execute` 才更新数据库。工具不会输出 key 或 Token。

## 6. 脚本专用配置

`DEPLOY_*`、`SMOKE_*`、`STRICT_*`、`AIOVE_TEST_*`、`RUNTIME_SELF_CHECK_BASE_URL`、`ALLOW_MUTATING_SELF_CHECKS`、真实 Shopify 自检 Token 等只属于执行命令，不进入主运行时配置表，也不应长期写入共享 `.env.local`。

## 7. 验证命令

```bash
node scripts/runtime-config-boundary-self-check.mjs
node scripts/deployment-env-self-check.mjs
node scripts/knowledge-ai-config-self-check.mjs
node scripts/product-source-service-self-check.mjs
node scripts/admin-site-product-source-self-check.mjs
STRICT_PRODUCTION_ENV=true npm run check:deployment
```

最后一条只用于已经准备好真实生产配置的发布环境。普通本地检查不会验证真实密钥值，但仍会验证配置结构与唯一入口。
