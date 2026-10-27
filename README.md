# AIOVE / alove_v3

这是 AIOVE 当前活跃的新项目仓库，用于承载新版前台、后台管理、聊天、商品推荐、知识库、主动消息、多站点和部署运维能力。

## 当前版本

2026-10-27 已验证客服跟进、商品候选差异、图片穿搭承接、异步自然补句、防重复调用及聊天图片独立过滤配置。运行源码 `0a60764`；365 项发布门禁、28 项线上隔离检查和多站点 HTTP 验证通过。有限异常兜底及其他验收边界保留，详情见项目私有发布记录。

## 文档入口

建议先从系统文档开始看：

- [Product Design](./docs/DESIGN.md)
- [System Documentation](./docs/system/README.md)
- [Page and Field Reference](./docs/system/pages/README.md)
- [System Overview](./docs/system/01-system-overview.md)
- [Frontend Pages](./docs/system/02-frontend-pages.md)
- [Admin Console](./docs/system/03-admin-console.md)
- [Backend Services and Data](./docs/system/04-backend-services-and-data.md)
- [Operations and Deployment](./docs/system/05-operations-and-deployment.md)
- [API Index](./docs/system/06-api-index.md)

其他重要入口：

- [Current Workspace](./docs/current-workspace.md)
- [Project TODO](./docs/project-todo.md)
- [Release Notes](./docs/releases/)
- [Update Logs](./logs/updates/)
- [Bug Logs](./logs/bugs/)

## 项目定位

这个项目不是旧项目的简单换皮，而是：

1. 前端按新版 UI 和新版体验重新搭建；
2. 后端能力按页面和功能需要逐步迁移；
3. 数据库优先复用旧项目已有结构和数据；
4. 接口按当前产品实际需要整理和收口；
5. 旧项目只作为历史能力参考源，不整体复制。

## 当前环境

- 本地项目目录：`/Users/cheng/Projects/alove-workspace/alove-page-rebuild`
- 本地服务地址：`http://127.0.0.1:4173`
- 本地 MySQL：`127.0.0.1:3307`
- 当前线上域名：`https://alove.fans`
- 当前线上项目根目录：`/srv/alove-new`

不要把 `/Users/cheng/Documents/alove` 当作源码根目录；它只是本地路由说明目录。

## 本地运行

启动新项目和 MySQL：

```bash
/Users/cheng/Projects/alove-workspace/scripts/start-main.sh
```

停止本地服务：

```bash
/Users/cheng/Projects/alove-workspace/scripts/stop-all.sh
```

只启动 Node 服务：

```bash
npm run start
```

## 常用检查

```bash
npm run check:deployment
node scripts/secret-leak-self-check.mjs
node scripts/system-docs-self-check.mjs
```

## 上传与安全边界

以下内容不应提交到 GitHub：

- `.env.local`
- 真实 API Key / Token / 密码
- 数据库备份包
- `dist/` 发布包
- `node_modules/`
- 本地临时备份目录 `.codex-backups/`
- 用户上传文件，除明确作为项目资源的 `uploads/voice/presets/*.mp3`

真实线上配置保存在服务器 shared `.env.local`，不进入仓库。

## Public source baseline

This repository starts from a sanitized source baseline. Earlier Git history, internal conversation reviews, deployment records and operational logs are retained privately. Runtime configuration and customer data are not included.
