# 02. Frontend Pages

更新时间：2026-08-02

本文档说明用户侧页面、弹窗和主要交互。

逐页面字段、控件、默认值和校验见 [页面与字段规范](./pages/README.md)。

## 1. 全局 App Shell

### 入口与路由

登录后的主要页面都运行在统一 App Shell 内：

- `/:siteSlug/discover`
- `/:siteSlug/search`
- `/:siteSlug/kitshop`
- `/:siteSlug/create`
- `/:siteSlug/chat?agent=<characterId>`
- `/:siteSlug/creator`（creator 账号入口可见，本地已接真实个人统计）

相关文件：

- `src/app/main.js`
- `src/app/app-view-factory.js`
- `src/app/app-navigation.js`
- `src/app/app-state.js`
- `src/app/access-control.js`
- `src/app/site-routing.js`
- `src/features/app-shell/app-shell.js`
- `src/features/app-shell/app-sidebar.js`
- `src/features/app-shell/app-topbar.js`

### 核心功能

- 根据当前 view 渲染页面。
- 从当前 active 站点公开 branding / visitor resolution 读取标准化语言，不按 slug 写死。
- 当前固定 UI 文案支持 English 与 Chinese (Mandarin)；其他站点语言的页面先回退 English，但 AI 仍可使用站点配置语言。用户侧唯一语言包入口为 `src/i18n/site-copy.js`，新增语言步骤和排除边界见 `src/i18n/README.md`。
- 路径切换或当前站点 branding 更新时同步 `appState.site.pageLanguage` 与 `<html lang>`；商品名、角色名和商品源业务内容保留原文。
- 登录注册、导航、Discover、Search、Kitshop、Chat、Create、Profile、反馈、商品详情、实时通话、弹窗、空状态及安全错误提示共享上述语言包。后台管理控制台、创作者工作台、网红运营内容及动态业务数据不在固定 UI 翻译范围内。
- 登录后加载角色、联系人、轮播图。
- 侧边栏展示导航和联系人。
- 顶部栏的搜索外观是进入 Search 的按钮；登录用户可打开真实用户反馈表单。
- 用户头像入口打开 Profile Modal。

### 关键状态

在 `appState` 中维护：

- `site.currentSlug`
- `site.pageLanguage`
- `session`
- `characters`
- `chat`
- `profile`
- `call`
- `adminView`

### 特殊规则

- 站点启用游客聊天时，未登录用户可浏览 Discover、Search、Kitshop、商品详情和 Create，并使用当前前台 Chat；Create 的上传、AI 操作和正式创建仍要求认证。关闭时需要认证的页面回同站点登录页。
- `creator` 页面入口只对 creator 账号显示；真实统计 API 只接受 creator 登录态。
- `admin` 需要 admin 权限。
- `Kitshop` 入口当前开启；`Creator workspace` 对 creator 账号开放且不再使用演示数据。
- 顶部反馈入口真实调用 `POST /api/feedback`，不是通知面板；游客不显示。

## 2. 登录页

### 路由

`/:siteSlug/login`

### 用户对象

未登录用户。

### 核心功能

- 邮箱密码登录。
- Google 登录跳转。
- 读取当前路径站点的公开品牌；未来站点 Customer Account action 可用时，在 Google 下方展示同一品牌按钮。
- 进入注册页。
- 进入忘记密码页。
- 登录成功后恢复当前站点归属和授权页面。

### 主要文件

- `src/pages/login/login-page.js`
- `src/pages/login/login-logo.js`
- `src/pages/login/theme-toggle.js`
- `src/app/app-session-actions.js`
- `src/store/session-store.js`
- `src/services/auth-service.js`
- `src/services/site-branding-service.js`
- `src/features/shared-ui/site-branding.js`

### 主要接口

- `POST /api/auth/login`
- `GET /api/auth/google/start?siteSlug=<slug>`
- `GET /api/auth/me`
- `GET /api/site/branding?siteSlug=<slug>`
- `GET /api/balance`
- `GET /api/chat/contacts`

### 规则与边界

- 浏览器认证是 cookie-only。
- 前端不保存 auth token。
- 登录失败文案统一，避免账号枚举。
- 登录成功后，若有 guest 承接角色则优先进入该角色；否则进入联系人数组第一项；没有联系人进入 Discover。当前没有“最后聊天对象”选择逻辑。
- 401 会触发全局 `aiove:auth-expired`，清空 session 并跳回登录。
- 当前没有 Shopify Customer Account OAuth action，因此品牌按钮不显示；不得把预留 UI 写成已可用登录方式。

## 3. 注册页

### 路由

`/:siteSlug/register`

### 核心功能

- 输入昵称、邮箱、验证码、密码和确认密码。
- 可填写邀请码。
- 支持 Google 注册/登录入口。
- 注册成功后自动登录。

### 主要文件

- `src/pages/auth/register-page.js`
- `src/pages/auth/auth-form-controls.js`
- `src/pages/auth/auth-form-state.js`
- `src/pages/auth/auth-leave-protection.js`
- `src/pages/auth/confirm-password-validation.js`
- `src/app/app-session-actions.js`

### 主要接口

- `POST /api/auth/email/check`
- `POST /api/auth/email/send-code`
- `POST /api/auth/register`
- `GET /api/auth/google/start`

### 规则与边界

- 邮箱输入 blur 和提交时都会检查占用。
- 验证码按钮发送后 60 秒倒计时。
- URL 中 `?invite=` 或 `?inviteCode=` 会预填邀请码。
- 有未提交表单时离开页面会触发保护。
- 注册站点会影响账号归属和默认前台激活。
- 当前浏览器持有同站点 guest cookie 时，注册成功优先回到被承接的前台聊天并保留游客历史；跨站点注册会失败且不创建账号。

## 4. 忘记密码页

### 路由

`/:siteSlug/forgot-password`

### 核心功能

- 输入邮箱。
- 获取验证码。
- 输入新密码和确认密码。
- 重置成功后返回登录页。

### 主要文件

- `src/pages/auth/forgot-password-page.js`
- `src/pages/auth/confirm-password-validation.js`
- `src/app/app-session-actions.js`

### 主要接口

- `POST /api/auth/email/send-code`，`scene=forgot_password`
- `POST /api/auth/forgot-password/reset`

### 规则与边界

- 前端文案提示密码至少 8 位并包含字母和数字。
- 页面有离开保护。
- 成功后约 1.2 秒跳转登录。

## 5. Discover 广场页

### 路由

`/:siteSlug/discover`

### 核心功能

- 展示首页轮播 banner。
- 展示角色分类。
- 当前站点没有公开且已发布的 Creator 角色时隐藏 Creator 分类；切换站点后若原选中分类已不可用，自动选择第一个可用分类。
- 展示角色卡片。
- 点击角色先打开确认/预览，再激活角色并进入聊天。

### 主要文件

- `src/features/discover/discover-page.js`
- `src/features/discover/discover-character-confirm.js`
- `src/app/character-load-actions.js`
- `src/app/character-activation-actions.js`
- `src/services/character-service.js`
- `src/services/home-carousel-service.js`

### 主要接口

- `GET /api/characters?siteSlug=<slug>`
- `GET /api/home/carousel?siteSlug=<slug>`
- `POST /api/characters/:id/activate`

### 规则与边界

- 只展示公开且已发布角色。
- creator 角色按当前站点过滤。
- mascot 只展示当前站点生效前台。
- 重复激活角色会提示已激活，不重复创建。
- 当前首页角色卡片行被调整为单行展示。

## 6. Search 搜索页

### 路由

`/:siteSlug/search`

### 核心功能

- 搜索角色。
- 搜索商品。
- 点击角色进入聊天。
- 点击商品打开商品详情。

### 主要文件

- `src/features/search/search-page.js`
- `src/features/search/search-topbar.js`
- `src/features/search/search-product-state.js`
- `src/features/search/search-results-renderer.js`
- `src/features/chat/chat-product-panel.js`
- `src/services/product-search-service.js`

### 主要接口

- `GET /api/products/search?siteSlug=<slug>&query=<text>&limit=2`
- `POST /api/products/resolve`
- `POST /api/analytics/product-events`

### 规则与边界

- 商品搜索有 500ms 防抖。
- 前端最多请求 2 个商品结果。
- 用 request id 丢弃过期响应。
- 切换页面时清空搜索框。
- 清空搜索会关闭商品详情。
- 搜索页商品详情不记录 detail open/CTA 事件，只记录搜索结果点击。

## 7. Chat 聊天页

### 路由

`/:siteSlug/chat?agent=<characterId>`

### 核心功能

- 加载角色资料。
- 加载消息记录。
- 加载快捷用语。
- 发送文字消息。
- 发送快捷用语。
- 发送附件。
- 发送语音。
- 播放 AI 语音。
- 展示商品气泡。
- 打开商品详情。
- 打开实时通话。

### 主要文件

- `src/features/chat/chat-page.js`
- `src/features/chat/chat-message-renderer.js`
- `src/features/chat/chat-composer.js`
- `src/features/chat/chat-quick-replies.js`
- `src/features/chat/chat-voice.js`
- `src/features/chat/chat-product-card.js`
- `src/features/chat/chat-product-panel.js`
- `src/app/chat-data-actions.js`
- `src/app/chat-text-actions.js`
- `src/app/chat-reply-scheduler.js`
- `src/services/chat-service.js`

### 主要接口

- `GET /api/characters/:id/messages`
- `GET /api/characters/:id/quick-replies`
- `POST /api/characters/:id/messages`
- `POST /api/characters/:id/messages/reply`
- `GET /api/chat/contacts`
- `POST /api/analytics/product-events`

### 消息发送链路

1. 用户点击发送。
2. 前端调用 `POST /api/characters/:id/messages`。
3. 用户消息立即出现在页面。
4. 前端约 1.5 秒后调用 `POST /api/characters/:id/messages/reply`。
5. 后端生成 AI 回复。
6. 如果有商品，先插商品气泡。
7. 商品后续补充文字约 500ms 后显示。
8. 语音资源生成后绑定到回复消息。

### 规则与边界

- 切换到别的角色时，如果回复到了当前非打开角色，会标 unread。
- 加载消息时，如果最新用户文本没有角色回复，会恢复调度补 reply。
- 归档角色不可聊天、不可通话，输入框禁用并显示下架提示。
- 超过一天的消息时间显示更完整日期时间。
- AI 文本和语音文本需要同源；带情绪标签的语音文本会清洗成显示文本。

## 8. Chat 附件

### 入口

聊天输入框附件按钮。

### 核心功能

- 选择图片或文档。
- 前端校验文件类型和大小。
- 图片压缩为 webp。
- 计算原始文件 SHA-256。
- 上传后先生成 pending asset；用户点击发送后才生成附件消息。

### 主要文件

- `src/features/chat/chat-composer-attachment.js`
- `src/features/chat/chat-attachments.js`
- `src/app/chat-attachment-actions.js`
- `src/services/chat-upload-service.js`
- `src/services/guest-chat-service.js`

### 主要接口

- `POST /api/characters/:id/attachments`
- `POST /api/guest/uploads/chat`
- `DELETE /api/guest/uploads/chat/:attachmentId`

### 规则与边界

- 最大 20MB。
- 支持 JPG/JPEG/JFIF/PNG/WEBP/GIF。
- 实际支持图片（JPG/JPEG/JFIF/PNG/WebP/GIF）、PDF 和 TXT；当前旧提示文案若声称支持 Word/Excel/PPT/RTF，属于待修正文案，不能当作能力事实。
- 上传请求头包含上传文件名、原文件名、原文件 SHA-256。
- 已启用站点的游客复用同一附件控件和处理规则，但先保存为受保护 pending asset；发送后与文字共用游客消息额度。

## 9. Chat 语音消息

### 入口

聊天输入框麦克风按钮。

### 核心功能

- 浏览器录音。
- 上传音频。
- 服务端 ASR 转文本。
- 按文本消息流程触发 AI 回复。

### 主要文件

- `src/features/chat/chat-composer-voice.js`
- `src/features/chat/chat-voice-recorder.js`
- `src/app/chat-voice-actions.js`
- `src/services/chat-voice-service.js`
- `src/services/guest-voice-wav-service.js`
- `src/services/guest-chat-service.js`

### 主要接口

- `POST /api/characters/:id/voices`
- `POST /api/characters/:id/voices/:messageId/reply`
- `POST /api/guest/voices`
- `POST /api/guest/voices/:messageId/reply`

### 规则与边界

- 依赖 `navigator.mediaDevices.getUserMedia` 和 `MediaRecorder`。
- 最长录音 120 秒。
- 服务端限制语音最大 10MB。
- 上传前后都有格式和签名校验。
- 游客录音在浏览器转换为 16kHz mono PCM16 WAV，转写消息与文字/附件共用游客额度，AI 回复仍复用正式文字与 TTS 链路。
- 页面失焦导致播放中断后，已修复重新播放按钮不可点的问题。

## 10. 商品详情面板

### 入口

- Chat 商品气泡。
- Search 商品结果。

不是独立路由。

### 核心功能

- 展示商品主图和多图轮播。
- 支持拖动翻图。
- 展示商品名、价格、原价、库存、参数。
- 展示尺码。
- SKU 命中项目内通用尺码表时，在 Size 同行显示 `Size Chart`，点击后打开页面级独立悬浮弹窗；未识别 SKU 时隐藏。
- 选择尺码后跳转独立站购物车。
- 记录商品行为埋点。

### 主要文件

- `src/features/chat/chat-product-panel.js`
- `src/features/chat/chat-product-panel-renderer.js`
- `src/features/chat/chat-product-panel-gallery.js`
- `src/features/chat/chat-product-panel-template.js`
- `src/features/chat/chat-product-card.js`
- `src/services/product-analytics-service.js`
- `src/services/site-branding-service.js`

### 主要接口

- `POST /api/products/resolve`
- `POST /api/analytics/product-events`
- `GET /api/site/branding?siteSlug=<slug>`

### 规则与边界

- 如果商品有 variant/尺码，必须选择可购买尺码才启用 Buy now。
- 有库存尺码可点。
- 没货尺码灰色不可点。
- PC 端 hover 没货尺码显示售罄提示。
- 手机端点击没货尺码显示居中轻提示，约 2 秒关闭。
- 售罄提示语言跟随页面语言，不跟随 AI 角色语言。
- 当前 `gogoalshop` 和 `footballkituk` 页面语言都是 English。
- 站点 Logo 使用统一品牌优先级：显式 Logo、站点 favicon、商品 URL favicon、globe；历史商品消息打开详情时重新读取当前站点品牌。
- 尺码表由服务端按可信商品变体 SKU 使用最长前缀匹配本地固定目录，不再实时读取独立站商品页；未知 SKU 不展示猜测结果。

## 11. Create Character 创建角色页

### 路由

`/:siteSlug/create`

### 核心功能

- 创建 AI 角色。
- 选择头像、名称、分类、性格、音色、语言、开场白、背景故事、可见性。
- AI 润色背景故事。
- AI 生成头像。
- 上传头像并裁剪。
- 提交后进入新角色聊天。

### 主要文件

- `src/features/create-character/create-character-page.js`
- `src/features/create-character/create-character-template.js`
- `src/features/create-character/create-character-validation.js`
- `src/features/create-character/create-character-visibility.js`
- `src/features/create-character/create-character-voice-preview.js`
- `src/app/character-create-actions.js`
- `src/app/character-avatar-actions.js`
- `src/app/app-create-actions.js`
- `src/services/character-service.js`
- `src/services/upload-service.js`

### 主要接口

- `POST /api/characters`
- `POST /api/characters/polish`
- `POST /api/characters/generate-avatar`
- `POST /api/uploads/avatar/moderate`
- `POST /api/uploads/avatar`
- `DELETE /api/uploads/avatar`

### 规则与边界

- 名称、分类、性格、声音、语言、开场白、背景故事必填。
- 背景故事至少 20 字符。
- 普通个人账号不展示 Creator 分类。
- Creator 分类要求 creator/admin，并且 creator 账号必须绑定站点。
- 默认私密，用户可改公开。
- 创建成功后的跳转不依赖公开列表刷新。
- 离开创建页时会清理临时头像。
- 语音克隆按钮目前只是 members-only 提示，不执行真实克隆。

## 12. Profile Modal 个人资料弹窗

### 入口

侧边栏底部用户卡片。

### 核心功能

- 查看个人资料。
- 编辑 Display name。
- 编辑 Favourite club。
- 查看邀请码。
- 复制邀请链接。
- 退出登录。
- 管理员可进入 Admin Console。

### 主要文件

- `src/features/profile-modal/profile-modal.js`
- `src/features/profile-modal/profile-modal-content.js`
- `src/features/profile-modal/profile-modal-events.js`
- `src/app/app-profile-actions.js`
- `src/app/app-main-ui-actions.js`
- `src/services/profile-service.js`

### 主要接口

- `GET /api/profile`
- `PATCH /api/profile`
- `POST /api/auth/logout`

### 规则与边界

- 打开弹窗先用 session 数据渲染。
- 再 silent 拉取 profile，不整体刷新页面。
- tab 切换不刷新页面。
- 保存成功同步 session store。
- Invite link 格式：`/:siteSlug/register?invite=<code>`。
- 复制失败时 fallback 到临时 textarea + `execCommand("copy")`。
- Creator Workspace 入口当前隐藏。

## 13. Call Modal 实时通话

### 入口

Chat 页右上角电话按钮。

### 核心功能

- 打开通话弹层。
- 请求麦克风权限。
- 建立 WebSocket。
- 采集音频并转成 16k PCM16 base64。
- 流式发送音频帧。
- 显示实时转写和角色回复。
- 播放角色语音。
- 结束后把通话消息合并回聊天。

### 主要文件

- `src/features/call-modal/call-modal.js`
- `src/features/call-modal/call-realtime-client.js`
- `src/features/call-modal/call-websocket-client.js`
- `src/features/call-modal/call-audio-capture.js`
- `src/features/call-modal/call-state-machine.js`
- `src/features/call-modal/call-playback-guard.js`
- `src/features/call-modal/call-client-diagnostics.js`
- `src/app/app-call-actions.js`

### 主要接口

WebSocket：

`/ws/call`

消息类型：

- `start_call`
- `audio_chunk`
- `audio_probe`
- `resume_listening`
- `end_call`

### 规则与边界

- 只能在非归档角色聊天页打开。
- 打开后自动 start。
- 关闭会停止 WebSocket、AudioContext、媒体轨道和计时器。
- 暂停会停止监听/播放并可恢复。
- 前 8 次每秒发送 `audio_probe` 诊断。
- 角色音频播放结束后约 200ms 恢复监听。
- 有播放超时保护。
- 游客与正式账号复用同一弹窗和客户端；游客可用性由 capability 与共享 30 条消息额度控制，不显示或执行独立通话分钟额度。
- 启动失败、服务端结束或异常断线都会释放麦克风并停止页面计时；结束态不能再次恢复暂停按钮。

## 14. 404 页面

### 路由

`/:siteSlug/404`

### 核心功能

- 展示 Page not found。
- 提供回 Discover 按钮。

### 主要文件

- `src/features/not-found/not-found-page.js`
- `src/app/access-control.js`

### 规则与边界

- 无权限访问 creator/admin 时显示 404。
- 未登录访问需要登录的页面时回登录，不显示 404。

## 15. Kitshop

### 路由

`/:siteSlug/kitshop`

### 核心功能

- 固定展示两层货架：第一层取当前站点独立站首页按顺序遇到的第一个有效商品栏目，并保留栏目标题和公开商品顺序。
- 第二层固定为 Alove `Best Sellers`：最近 30 天净销量前五 + 最近 60 天最多五个未重复热销商品 + 首页其他栏目的随机公开商品，去重后补足到最多 15 件并统一混排；其他首页栏目不继续生成前台货架。
- 只展示 `ACTIVE` 且已发布到 Online Store 的商品；DRAFT、未公开和没有公开商品 URL 的记录不得进入货架。
- 展示商品卡、价格和独立站 View more；站点没有单独配置公开 URL 时，Kitshop 从可信公开商品 URL 推导独立站 origin，不使用 Shopify Admin 源地址。
- Kitshop 商品详情复用统一站点品牌，不单独保存或维护第二份站点 Logo。
- 商品卡打开通用商品详情面板。
- 支持键盘、左右翻页和鼠标拖动。
- 游客可浏览，Buy now 需要认证。
- 具备 loading、warning、error 和 empty 状态。

详细字段见 [Kitshop 页面规范](./pages/user/05-kitshop-feedback-creator.md)。

## 16. 用户反馈弹窗

### 入口

登录用户顶部反馈按钮；游客不显示。

### 核心功能

- 输入 Subject（最多 120 字符）和 Details（最多 1200 字符）。
- 自动附带当前页面 path。
- 真实提交 `POST /api/feedback`，支持重复内容和频率限制错误提示。

详细字段见 [用户反馈页面规范](./pages/user/05-kitshop-feedback-creator.md)。

## 17. Creator Workspace

路由为 `/:siteSlug/creator`，首页入口只对 creator 账号显示。页面通过 creator 专属只读接口展示本人角色的会话、商品触发、独立站跳转、趋势、受众与 Top products；接口失败不会回退演示数据。收入、分成、提现和折扣使用仍未实现。
