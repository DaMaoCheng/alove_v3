# 2026-07-07 新对话项目交接文档

## 1. 接手结论

当前唯一活跃项目是：

`/Users/cheng/Projects/alove-workspace/alove-page-rebuild`

不要把 `/Users/cheng/Documents/alove` 当成源码目录。那个目录只是路由说明。

新对话接手时，先读：

1. `AGENTS.md`
2. `README.md`
3. `docs/current-workspace.md`
4. 本文档
5. 最近更新日志：`logs/updates/2026-07-07.md`、`logs/updates/2026-07-06.md`、`logs/updates/2026-07-03.md`
6. 最近 release：`docs/releases/2026-07-07-admin-avatar-cover-sync-hardening.md`、`docs/releases/2026-07-06-discover-character-rail.md`、`docs/releases/2026-07-03-discover-activation-count-mia.md`

接手后第一条命令建议：

```bash
cd /Users/cheng/Projects/alove-workspace/alove-page-rebuild
git status --short
```

## 2. 当前环境

- 本地服务：`http://127.0.0.1:4173`
- 本地 MySQL：`127.0.0.1:3307`
- 本地启动脚本：`/Users/cheng/Projects/alove-workspace/scripts/start-main.sh`
- 本地停止脚本：`/Users/cheng/Projects/alove-workspace/scripts/stop-all.sh`
- 线上主机：`47.76.136.38`
- 线上项目根目录：`/srv/alove-new`
- 线上 service：`alove-new.service`
- 线上域名：`https://alove.fans`
- 当前线上 release：`/srv/alove-new/releases/2026-07-07-admin-avatar-cover-sync-hardening-20260707110258`
- 当前线上保留 release 数：5
- GitHub 仓库：`git@github.com:DaMaoCheng/alove_v3.git`
- 当前最新 tag：`v2.10_707`
- 当前最新提交：`7f6f538 feat: sync discover avatar and cropper release`

注意：不要把真实 API key、服务器密码、数据库备份、`.env.local`、用户上传文件写进文档、日志或提交。

## 3. 项目整体功能

### 3.1 用户侧

- 多站点路由：根据路径、IP、地区、默认站点、账号归属进入不同站点。
- 登录/注册/忘记密码：邮箱验证码、密码登录、Google 登录、邀请码注册。
- 广场页：展示公开通用角色和 creator 角色，不展示 mascot 前台角色。
- 搜索页：按当前绑定站点的商品源搜索商品。
- 创建角色页：用户可创建私密或公开角色，支持头像上传裁剪和 AI 生成头像。
- 聊天页：
  - 文本聊天；
  - AI 语音回复；
  - 用户语音输入；
  - 图片/附件延迟发送；
  - 视觉理解；
  - 生图；
  - 商品气泡；
  - 商品详情；
  - 尺码选择、售罄提示、跳转购物车；
  - AI 免责声明；
  - 历史图片轻量召回。
- 实时通话：
  - WebSocket 通话；
  - 麦克风开关；
  - 通话期间触发商品时展示商品浮层；
  - Shop 按钮可重新打开通话中触发的商品详情。

### 3.2 后台管理

- 概览：商品曝光、点击、跳转、排行和统计。
- 账号管理：用户列表、站点归属修改、账号对话查看。
- 站点管理：站点 slug、地区、默认语言、前台绑定、商品源配置。
- 前台管理：mascot 前台角色资料和头像。
- 通用角色管理：公开/私密、上架/下架、头像、知识库展示。
- 网红角色管理：creator 角色、绑定账号、站点、上架状态、头像。
- 首页轮播：不同站点的轮播内容和点击目标。
- 广告活动：站点、商品、角色范围、关键词、折扣码、主动文案、时间和状态。
- 知识库：全局、指定站点、指定对象三类范围，关键词触发检索。
- 错误日志/操作日志：用于排查前后端问题。

### 3.3 商品和广告

- 站点商品源配置在后台站点管理里维护。
- 当前重点商品源是 Shopify Admin API，只读 token 加密落库，不回显。
- 聊天推荐、搜索页、广告活动选品都应使用同一套站点商品源。
- 聊天商品请求和快捷用语会优先使用当前站点有效广告商品。
- 主动消息也可以触发广告，但会和聊天内广告展示做去重，避免同一账号短期重复收到同一广告。
- 商品气泡可见后局部刷新实时价格，同一产品 4 小时内不重复刷新。
- 产品详情直接消费商品气泡 payload，不再自己单独刷新价格。

### 3.4 AI 和语音

- AI 回复要求口语化，并结合上下文情绪。
- 文本和语音内容必须一致：生成时可带情绪标签，显示前清洗标签。
- 主动消息也生成语音。
- 当前聊天回复已尽量禁止 `If you want, I can...` 这类服务型尾句。
- ElevenLabs 用于 TTS/STT；前台有专门音色，其他角色使用普通槽位或系统音色。

### 3.5 生图

- 生图覆盖所有角色，包括私密角色。
- 当前测试额度是每账号、每天、每个角色 100 张，方便测试。
- 生成中同一对话只允许一个生图任务，完成或失败后释放锁。
- 生图统一走当前 provider 封装：无参考图时文生图，有角色图、商品图、用户上传图时带参考图。
- 已覆盖：
  - AI 穿商品；
  - AI 穿用户上传衣服；
  - 用户和 AI 合影；
  - 结合商品、角色、用户图、上下文生成英文提示词。
- 生成图片会压缩后落库并作为聊天图片消息展示。
- 普通看图请求不应误触发生图，应走视觉理解回复。

## 4. 代码结构地图

### 4.1 前端

- `src/app/main.js`
  - 前端入口和主应用挂载。
- `src/features/app-shell/`
  - 页面 shell、侧边栏、顶部导航、全局布局。
- `src/features/app-shell/styles/`
  - 页面和组件样式，包含 discover、chat、overlays 等样式。
- `src/features/discover/`
  - 广场页、角色卡、分类、横向轨道。
- `src/features/chat/`
  - 聊天页、消息渲染、商品气泡、商品详情、生图状态、附件发送、语音播放等。
- `src/features/call-modal/`
  - 实时通话弹窗和通话商品浮层。
- `src/features/create-character/`
  - 创建角色页、头像生成、头像上传、角色创建表单。
- `src/features/avatar-cropper/`
  - 通用头像裁剪弹窗。创建页和后台角色页都复用这里。
- `src/features/admin-console/`
  - 后台管理主要前端模块，包含账号、站点、角色、前台、广告、知识库、轮播等。
- `src/features/profile-modal/`
  - 用户资料弹窗、邀请码复制、邀请链接复制。
- `src/features/search/`
  - 搜索页和商品搜索展示。
- `src/services/`
  - 前端 API 调用和共享服务。
- `src/icons/`
  - 统一图标定义，近期新增了头像裁剪重试的 refresh 图标。

### 4.2 后端

- `server/server.js`
  - Node 服务入口，启动 HTTP、WebSocket、后台任务。
- `server/routes.js`
  - API 路由总入口。
- `server/db*.js`
  - 数据库连接、schema、seed、字段迁移。
- `server/auth-*.js`
  - 登录、注册、Google OAuth、session、限速。
- `server/character-*.js`
  - 公开角色、创建角色、激活、后台角色保存。
- `server/admin-*.js`
  - 后台管理接口和 service。
- `server/chat-*.js`
  - 聊天消息、回复编排、语音、商品、记忆、知识库、生图、附件、视觉输入。
- `server/product-*.js`
  - 商品搜索、商品源、价格刷新、checkout、商品分析。
- `server/promotion-campaign-*.js`
  - 广告活动查询、写入、匹配、去重、统计、商品 payload。
- `server/proactive-message-*.js`
  - 主动消息调度、额度、上下文、投递。
- `server/call-*.js`
  - 实时通话、turn 隔离、WebSocket provider。
- `server/knowledge-*.js`
  - 知识库范围、检索、AI 配置。
- `server/upload-*.js`、`server/protected-upload-*.js`
  - 上传校验、受保护资源访问、管理员审查访问。
- `server/security*.js`
  - 安全头、CSP、可信代理、响应安全工具。

### 4.3 脚本、日志和发布

- `scripts/`
  - 大量自检脚本、部署脚本、迁移脚本、seed 辅助脚本。
- `scripts/deploy-server-release.mjs`
  - 当前服务器发布脚本。
- `scripts/create-deployment-archive.mjs`
  - 打包 release。
- `scripts/deployment-check.mjs`
  - 发布前综合检查。
- `logs/updates/`
  - 每日更新日志。
- `logs/bugs/`
  - Bug 记录。
- `docs/releases/`
  - 每个 release 节点说明。
- `docs/system/`
  - 系统文档。
- `docs/superpowers/plans/`
  - 较大功能的推进方案，例如聊天生图、实时通话商品浮层。

## 5. 近期推进内容

### 5.1 2026-07-07

已完成并部署：

- 后台通用/网红角色改头像后，同步修复广场角色卡图片不更新的问题。
- 覆盖半更新旧数据：`avatar_url` 已更新但 `cover_url` 仍是旧图时，也能同步修复。
- 头像裁剪弹窗三按钮布局自适应。
- 中间重试按钮从文字改成圆形箭头 icon。
- 服务器旧 release 清理到最新 5 个。
- GitHub 已更新并打 tag：`v2.10_707`。

重点文件：

- `server/character-admin-service.js`
- `src/features/admin-console/admin-character-avatar-controls.js`
- `src/features/admin-console/admin-character-ai-controls.js`
- `src/features/admin-console/admin-mascot-avatar-ai-controls.js`
- `src/features/admin-console/admin-character-mapper.js`
- `src/features/avatar-cropper/avatar-cropper.js`
- `src/features/app-shell/styles/overlays.css`
- `src/icons/icons.js`
- `scripts/admin-character-avatar-cover-sync-self-check.mjs`

### 5.2 2026-07-06

已完成并部署：

- 广场角色卡改为横向轨道。
- PC 角色卡区域和 banner 同宽，超宽时显示左右悬浮按钮。
- 手机端一行显示一个半卡片，可横向滑动。
- 每个分类最多展示 30 个角色。
- 广场隐藏 mascot 分组和 mascot 角色。

重点文件：

- `src/features/discover/discover-page.js`
- `src/features/app-shell/styles/discover.css`

### 5.3 2026-07-03 到 2026-07-07 的角色工作

已推进多个公开角色和形象：

- Mia
- Luna
- Kai
- Yunn-na
- 其他 Fan / Pundit / Companion 角色

注意：

- 通用公开角色不限制站点，全站点可见、可激活。
- mascot 是系统前台，不应该出现在广场。
- 角色卡星星后的数字现在是激活账号数，不是 `New`。
- 新角色图片使用 shared uploads，同步服务器时不能只发代码包，还要确保图片资源存在。

### 5.4 2026-07-01 到 2026-07-02

重点完成：

- 聊天生图能力：
  - 触发识别；
  - 防误触发；
  - 视觉输入；
  - 参考图输入；
  - 图片压缩落库；
  - 图片状态轮询；
  - 等待期间不抢输入焦点；
  - 图片历史轻量召回。
- 商品能力：
  - 搜索页和聊天商品源统一；
  - 商品气泡可见后局部刷新价格；
  - 产品详情复用气泡价格；
  - 尺码库存和购物车跳转。
- 后台账号查看对话：
  - 30 天窗口；
  - 多日期段展示；
  - 用户消息条数；
  - 产品、图片、附件富消息展示；
  - 管理员受保护图片访问修复。
- 实时通话商品浮层：
  - 通话中触发商品不打断通话；
  - 商品详情覆盖在通话弹窗上；
  - 关闭后 Shop 按钮有红点提示。
- 广告活动：
  - 聊天商品请求和快捷用语优先推荐广告商品；
  - 主动消息广告和聊天广告做去重。

## 6. 当前状态判断

截至本文档创建时：

- 线上最新 release 已部署。
- GitHub main 已推送。
- 最新 tag 为 `v2.10_707`。
- 当前主要交接点不是一个正在中断的代码修改，而是准备开新对话继续推进。
- 如果新对话继续做角色，需要重点关注：
  - 角色头像/角色卡图是否同步；
  - shared uploads 是否同步服务器；
  - 广场是否隐藏 mascot；
  - 角色卡激活数是否真实；
  - 新角色是否全站点可见。
- 如果新对话继续做商品/广告，需要重点关注：
  - 搜索、聊天推荐、广告选品是否同用站点商品源；
  - 不要让聊天内广告和主动消息广告重复轰炸同一个账号；
  - 商品实时价格刷新必须是局部刷新，不能打断聊天滚动。

## 7. 常用检查命令

基础静态检查：

```bash
node --check <file>
git diff --check
```

综合部署检查：

```bash
npm run check:deployment
node scripts/secret-leak-self-check.mjs
node scripts/system-docs-self-check.mjs
```

打包：

```bash
DEPLOY_RELEASE_ID=<release-id> npm run package:deployment
```

发布：

```bash
DEPLOY_RELEASE_ID=<release-id> npm run deploy:release -- --execute
```

线上健康检查：

```bash
curl -fsS https://alove.fans/api/health
```

常用专项自检：

```bash
node scripts/admin-character-avatar-cover-sync-self-check.mjs
node scripts/admin-character-avatar-cropper-self-check.mjs
node scripts/site-character-filtering-self-check.mjs
node scripts/discover-card-metrics-self-check.mjs
node scripts/chat-image-final-regression-self-check.mjs
node scripts/product-search-service-self-check.mjs
node scripts/chat-promotion-product-priority-self-check.mjs
```

## 8. 接手注意事项

1. 先确认真实目录，别在 `/Users/cheng/Documents/alove` 写业务文件。
2. 如果用户说“更新到服务器”，通常不是口头说明，要实际部署、线上验证、必要时清理旧 release。
3. 如果用户说“更新到服务器，然后更新到 GitHub”，要完成部署、验证、commit、push、tag。
4. 服务器发布不要覆盖 shared `.env.local`、数据库和 uploads。
5. 后台站点商品源、Google、ElevenLabs、图片生成 API 都属于敏感配置，不写进仓库。
6. 看到商品、广告、聊天、生图、语音相关问题，先查对应 self-check 和最近 bug/update log。
7. 同一个问题第二次没修好时，不要继续贴补丁，先重新定位。
8. 修改复杂链路时，每完成一个小阶段就做真实链路自检，再进入下一阶段。
9. 用户对 UI 很敏感，移动端/PC 都要看；文字不能挤压、不能重叠、不能随便加标签。
10. 用户偏好“通用规则”和“确定性逻辑”，不要把去重、优先级、权限、触发条件交给 AI 自由判断。

## 9. 新对话可以直接这样开场

可以把下面这段发给新对话：

```txt
请接手 AIOVE 项目。真实项目目录是 /Users/cheng/Projects/alove-workspace/alove-page-rebuild，不要用 /Users/cheng/Documents/alove。
先读 AGENTS.md、README.md、docs/current-workspace.md 和 docs/handoffs/2026-07-07-new-thread-project-handoff.md。
当前最新线上 release 是 2026-07-07-admin-avatar-cover-sync-hardening，GitHub tag 是 v2.10_707。
接下来继续从当前项目状态推进，改动前先说明要改哪些文件，改完要做真实链路自检。
```
