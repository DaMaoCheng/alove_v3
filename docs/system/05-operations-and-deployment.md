# 05. Operations and Deployment

更新时间：2026-10-01

## 1. 本地运行

真实项目根目录：

`/Users/cheng/Projects/alove-workspace/alove-page-rebuild`

本地服务：

`http://127.0.0.1:4173`

本地 MySQL：

`127.0.0.1:3307`

推荐启动：

```bash
/Users/cheng/Projects/alove-workspace/scripts/start-main.sh
```

推荐停止：

```bash
/Users/cheng/Projects/alove-workspace/scripts/stop-all.sh
```

项目内底层 helper：

- `scripts/local/dev-start.sh`
- `scripts/local/dev-stop.sh`
- `scripts/local/start-app.sh`
- `scripts/local/stop-app.sh`
- `scripts/local/start-db.sh`
- `scripts/local/stop-db.sh`

`npm run start` 只会执行：

```bash
node server/server.js
```

它不负责启动 MySQL。

## 2. Node 和依赖

Node 要求：

```txt
>=20.18.1
```

当前 `package.json` 依赖：

- `@elevenlabs/elevenlabs-js`
- `mysql2`
- `nodemailer`
- `sharp`
- `undici`
- `ws`

常用 npm scripts：

- `npm run start`
- `npm run preflight:multisite`
- `npm run smoke:multisite`
- `npm run check:deployment`
- `npm run package:deployment`
- `npm run deploy:release`

## 3. 线上环境

当前线上主机：

`47.76.136.38`

当前线上根目录：

`/srv/alove-new`

当前线上 service：

`alove-new.service`

当前线上公开域名：

`https://alove.fans`

当前线上 release：

`/srv/alove-new/releases/2026-10-01-chat-image-semantic-release-20261001151554`

## 4. 线上发布模型

线上使用 release/symlink：

```txt
/srv/alove-new/
  current -> /srv/alove-new/releases/<release-id-timestamp>
  releases/
  shared/
    .env.local
    uploads/
  backups/
```

原则：

- 不直接在 `/srv/alove-new/current` 手改代码。
- 每次发布一个完整 release。
- 服务器数据库、`.env.local`、uploads 都保留在 shared/线上环境。
- 本地发布包不携带真实 secret、真实 uploads、真实数据库 dump。

## 5. 标准发布流程

打包：

```bash
DEPLOY_RELEASE_ID=<release-id> npm run package:deployment
```

发布 dry-run：

```bash
DEPLOY_RELEASE_ID=<release-id> npm run deploy:release
```

正式发布：

```bash
DEPLOY_RELEASE_ID=<release-id> npm run deploy:release -- --execute
```

发布脚本默认是 dry-run，只有加 `-- --execute` 才会改服务器。

正式发布会做：

1. 本地 archive/checksum/version metadata 校验。
2. 上传包到服务器 `/tmp`。
3. 服务器端 sha256 校验。
4. 解包到新 release。
5. `npm ci --omit=dev`。
6. `.env.local` 链接到 shared。
7. `uploads` 链接到 shared。
8. 切换 `current` symlink。
9. 重启 `alove-new.service`。
10. 本地和公网 `/api/health`。
11. 本地和公网 multisite smoke。

## 6. 回滚

回滚方式：

1. 找到上一版 release。
2. 把 `/srv/alove-new/current` 重新链接到上一版。
3. 重启 `alove-new.service`。
4. 跑 health 和 smoke。

示例：

```bash
ln -sfn /srv/alove-new/releases/<previous-release> /srv/alove-new/current
sudo systemctl restart alove-new.service
sudo systemctl is-active alove-new.service
```

## 7. 清理旧 release

发布脚本默认不删除旧 release。

可选清理：

```bash
DEPLOY_PRUNE_RELEASES=true DEPLOY_KEEP_RELEASES=5 npm run deploy:release -- --execute
```

实际清理前要确认最新 release 已经健康。

## 8. 配置加载

配置加载顺序：

1. `.env.local`
2. `.env`
3. `server/config.js` 默认值

正式运行配置、`SERVER_CONFIG` 字段和全部实际消费者的详细映射见 [07-runtime-configuration.md](./07-runtime-configuration.md)。业务 service 不能绕过该入口直接读取环境变量。

真实密钥不得写入：

- 源码；
- release 文档；
- 更新日志；
- 发布包；
- Git。

## 9. 核心配置项

### 服务

- `PORT`
- `HOST`
- `PUBLIC_BASE_URL`

### 数据库

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

### 邮件

- `EMAIL_AUTH_DEV_MODE`
- `EMAIL_PROVIDER`
- `EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_SECURE`
- `SMTP_PROXY`

### 登录

- `AUTH_COOKIE_NAME`
- `COOKIE_SECURE`
- `FORCE_HTTPS`
- `HSTS_ENABLED`
- `HSTS_MAX_AGE_SECONDS`
- `CSP_REPORT_ONLY_ENABLED`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GUEST_NETWORK_PEPPER`
- `APP_SECRET`（只作为旧环境兼容 fallback，不推荐作为专用密钥）

### 管理权限

- `AIOVE_SUPER_ADMIN_EMAILS`

### AI 回复

- `AI_REPLY_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_API_MODE`
- `OPENAI_REASONING_EFFORT`
- `OPENAI_TIMEOUT_MS`

### Knowledge AI

- `KNOWLEDGE_AI_PROVIDER`
- `KNOWLEDGE_AI_API_KEY`
- `KNOWLEDGE_AI_BASE_URL`
- `KNOWLEDGE_AI_MODEL`
- `KNOWLEDGE_AI_API_MODE`
- `KNOWLEDGE_AI_TIMEOUT_MS`

### 图片生成

- `IMAGE_GENERATION_PROVIDER`
- `IMAGE_GENERATION_API_KEY`
- `IMAGE_GENERATION_BASE_URL`
- `IMAGE_GENERATION_MODEL`
- `IMAGE_GENERATION_EDIT_MODEL`（Venice 参考图编辑模型；未填写时由主模型自动追加 `-edit`）
- `IMAGE_GENERATION_SIZE`
- `IMAGE_GENERATION_COUNT`
- `IMAGE_GENERATION_TIMEOUT_MS`

### ElevenLabs

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_BASE_URL`
- `ELEVENLABS_QUALITY_MODEL`
- `ELEVENLABS_FAST_MODEL`
- `ELEVENLABS_OUTPUT_FORMAT`
- `ELEVENLABS_TIMEOUT_MS`
- `ELEVENLABS_TTS_MAX_RETRIES`（TTS 超时或网络失败时的最大重试次数，硬上限为 2）
- `ELEVENLABS_STT_API_KEY`
- `ELEVENLABS_STT_BASE_URL`
- `ELEVENLABS_STT_MODEL`
- `ELEVENLABS_STT_REALTIME_MODEL`
- `ELEVENLABS_STT_TIMEOUT_MS`

### 任务

- `MEMORY_RUNNER_ENABLED`
- `MEMORY_RUNNER_POLL_MS`
- `MEMORY_RUNNER_BATCH_SIZE`
- `PROACTIVE_MESSAGE_SCHEDULER_ENABLED`
- `PROACTIVE_MESSAGE_SCHEDULER_POLL_MS`
- `PROACTIVE_MESSAGE_SCHEDULER_BATCH_SIZE`

### Geo

- `GEO_SEARCH_PROVIDER`
- `GEO_SEARCH_BASE_URL`
- `GEO_SEARCH_TIMEOUT_MS`
- `GEO_SEARCH_USER_AGENT`
- `GEO_IP_PROVIDERS`
- `GEO_IP_PROVIDER`
- `GEO_IP_BASE_URL`
- `GEO_IP_IPWHOIS_BASE_URL`
- `GEO_IP_IP_API_BASE_URL`
- `GEO_IP_TIMEOUT_MS`

### 商品源

- `PRODUCT_API_TIMEOUT_MS`
- `PRODUCT_API_SECRET_KEY`
- `SHOPIFY_ADMIN_API_VERSION`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`

### 网络代理

- `HTTPS_PROXY`
- `HTTP_PROXY`
- `ALL_PROXY`

## 10. 严格生产检查

命令：

```bash
STRICT_PRODUCTION_ENV=true npm run check:deployment
```

检查方向：

- 禁止本地 URL。
- 禁止占位密码。
- 禁止生产使用 dev email 模式。
- 检查 AI/图片/ElevenLabs key。
- 检查 Google callback。
- 检查部署文件。
- 检查 secret 泄露。

## 11. 外部集成

### MySQL

- 本地默认脚本使用 3307。
- `server/config.js` 默认端口是 3306。
- 实际以 `.env.local` / `.env` 为准。

### Nginx / 反代

需要保留：

- `X-Forwarded-For`
- `X-Real-IP`
- `CF-IPCountry`

### SMTP

用于邮箱验证码和密码重置。

生产必须关闭 `EMAIL_AUTH_DEV_MODE`。

### Google OAuth

代码已接入：

- `/api/auth/google/start`
- `/api/auth/google/callback`

真实可用性需要按服务器出站访问 Google API 状态复查。

### OpenAI / 兼容 API

用于：

- AI 回复；
- 角色资料润色；
- 头像生成；
- 知识库拆分；
- 记忆提取。

### ElevenLabs

用于：

- TTS；
- STT；
- 实时 STT；
- 前台专业克隆音色；
- 语音 preset。

### Geo

可用 provider：

- Cloudflare country header
- `ip-api`
- `ipwhois`
- `ipapi`
- `nominatim`

### Shopify

FKK 商品源使用 Shopify Admin 只读能力。

公开商品搜索链路不会直接读取后台 token。

### 支付/充值

当前休眠：

- 前台充值下单返回 `403`。
- 直接充值返回 `403`。

## 12. 数据备份

正式发布前会创建数据库备份：

```txt
/srv/alove-new/backups/db-before-<release>.sql.gz
```

备份优先使用：

- `mysqldump`
- 没有则 `mariadb-dump`

参数包括：

- `--single-transaction`
- `--quick`
- `--skip-lock-tables`
- `--no-tablespaces`

发布还会备份旧 current：

```txt
/srv/alove-new/backups/current-before-<release>.tar.gz
```

## 13. 日志和版本树

记录位置：

- 更新日志：`logs/updates/YYYY-MM-DD.md`
- BUG 日志：`logs/bugs/YYYY-MM-DD.md`
- Release 节点：`docs/releases/*.md`
- 分期方案：`docs/superpowers/plans/*.md`
- 规格文档：`docs/superpowers/specs/*.md`

Release 文档固定结构：

- `Scope`
- `Changed Files`
- `Behavior`
- `Verification`
- `Notes`

部署 metadata：

- `docs/releases/current-deployment.json`

这个文件由 package 脚本生成，不应手写维护。

## 14. 自检脚本分类

常用入口：

- `npm run preflight:multisite`
- `npm run smoke:multisite`
- `npm run check:deployment`
- `npm run package:deployment`
- `npm run deploy:release`

主要脚本类别：

- `*-self-check.mjs`
  - 功能级回归自检。
- `deployment-*`
  - 部署/打包/环境检查。
- `multisite-*`、`geo-*`、`site-*`
  - 多站点和地区路由。
- `admin-*`
  - 管理台自检。
- `chat-*`、`call-*`、`tts-*`、`elevenlabs-*`
  - 聊天、通话、语音。
- `product-*`、`promotion-campaign-*`
  - 商品和广告活动。
- `proactive-message-*`
  - 主动消息。
- `auth-*`、`login-*`、`secret-leak-*`
  - 鉴权和安全。
- `knowledge-*`
  - 知识库。
- `apply-*`、`import-*`、`enqueue-*`
  - 一次性或写数据脚本，运行前必须确认目标数据库和回滚方式。

## 15. 已知边界

- `docs/deployment-checklist-2026-06-10.md` 是历史参考，当前权威流程是 `docs/deployment/server-runbook.md`。
- `docs/deployment/alove-page-rebuild.service.example` 仍是示例路径，不代表当前线上实际路径。
- `2026-06-29-hidden-entry-points` 当前是本地 only，未部署。
- `api/health` 不依赖数据库和外部 provider，最终验收不能只看它。
- 发布 dry-run 不连接服务器，不代表线上可发布。
