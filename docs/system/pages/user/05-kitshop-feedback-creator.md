# 用户侧：Kitshop、用户反馈与 Creator Workspace

实现状态：Kitshop、用户反馈与 Creator Workspace 个人统计均为 `Current local`。验证范围：`Local browser + HTTP + database verified`。

## 1. Kitshop 页面身份

状态：`Current`。验证范围：`Local code verified`。

- 路由：`/:siteSlug/kitshop`。
- 页面目标：按当前站点展示可信商品缓存构建的首页主货架与 Alove Best Sellers，并复用商品详情面板进入外部独立站。
- 适用身份：站点开启游客公开能力时游客可浏览；正式用户可浏览并记录货架曝光、卡片点击、详情打开和 Buy now 跳转。游客不写入正式用户商品 analytics。
- 主要关联目标：当前 `site`、可信商品缓存、独立站首页栏目快照、订单销量快照、商品详情面板和外部 storefront。

## 2. Kitshop 页面与货架字段

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Topbar search | App Shell 搜索入口 | 沿用全局行为 | 当前站点 Search | 从 Kitshop 前往搜索 | 不在 Kitshop 内直接过滤货架 | 导航到 Search | 当前站点、Search |
| Kitshop / Matchday shelves | 只读标题 | 固定文案 | 页面模板 | 说明页面用途 | 无 | 无写入 | Kitshop 页面 |
| Shelf title | 只读标题 | 固定生成两层货架；货架可以为空 | 第一层取首页按顺序遇到的第一个有效商品栏目标题；没有可匹配首页栏目时回落 `Recommended`；第二层固定 `Best Sellers` | 区分商品集合 | 空栏目不会伪造商品 | 无写入 | 首页栏目、销量集合 |
| View more | 外部链接 | 有可信 storefront URL 才显示 | 当前站点公开 `siteUrl/storefrontUrl` | 查看独立站更多商品 | 后台 Admin URL、错误的 `shopify-admin:` 和不可信 fallback 不得暴露；新窗口 `noopener noreferrer` | 打开当前站点公开独立站入口 | 当前站点 |
| 商品卡 | 可点击、可键盘 Enter/Space 激活 | 货架有商品才显示 | 当前站点安全商品 payload | 打开商品详情 | 不能把其他站点或未公开商品混入；卡片 JSON 仅使用客户端安全字段 | 打开共用商品详情面板 | 商品、商品详情 |
| 商品图片 | 只读图片 | 无图使用安全占位 | 可信商品 `imageUrl` | 识别商品 | 图片 URL 经过安全响应和资源规范化 | 无写入 | 商品快照 |
| Tag | 条件只读标签 | 无 tag 隐藏 | 商品 tag/Best Seller 补充 | 标示推荐状态 | 不由前端猜测活动权益 | 无写入 | 商品快照 |
| Name | 只读文本 | 缺失回落 Product | 商品名称 | 识别商品 | HTML 转义 | 无写入 | 商品快照 |
| Subtitle | 条件只读文本 | 可空 | `subtitle/summary/stock` | 展示简要说明 | 不伪造库存 | 无写入 | 商品快照 |
| Price now / Price was | 条件只读价格 | 都为空则整行隐藏 | 可信商品价格 | 展示现价和原价 | 无法确认时留空；最终价格仍以结算页为准 | 无写入 | 商品快照 |
| View details | 按钮 | 每个商品卡显示 | 当前卡片 payload | 明确打开详情 | 与点击整张卡共用同一详情入口 | 打开共用商品详情面板 | 商品、商品 analytics |
| Previous / Next | 条件按钮 | 没有横向溢出或位于边缘时隐藏 | 当前 rail 的滚动宽度 | 分页浏览货架 | 较窄 PC 视口内按钮必须保持在画面内；不会改变数据排序 | 平滑滚动约一屏 | 货架显示状态 |
| Drag rail | PC 指针拖动；触屏原生横滑 | 默认静止 | 当前商品 rail | 快速浏览商品 | 移动超过阈值后抑制误点商品卡 | 只改变 scrollLeft | 货架显示状态 |

商品详情字段、游客 Buy now 引导、尺码、图片、支付方式和外链规则统一见 [Chat、商品详情与实时通话](./03-chat-product-call.md)。

## 3. Kitshop 货架构成规则

状态：`Current`。

### 第一层：首页主货架

1. 按独立站首页栏目顺序扫描。
2. 选择第一个能够和可信商品缓存匹配出商品的有效栏目。
3. 保留该栏目原有商品顺序和栏目标题。
4. 只展示可信缓存中可公开读取的商品；空栏目继续找下一栏目，不把整个首页所有栏目平铺进第一层。
5. 若没有任何可匹配的首页栏目，第一层回落为 `Recommended`，最多取缓存前 8 个去重商品；这是容错货架，不得写成独立站首页栏目。

### 第二层：Best Sellers

1. 先取近 30 天净销量排名前 5 个可匹配商品。
2. 再取近 60 天排名中最多 5 个尚未重复的商品。
3. 再从首页其余栏目中以稳定 seed 随机补足，最终最多 15 件。
4. 各来源按商品 identity 全程去重，补足后再稳定混排；同一快照下刷新页面不应无规则抖动。
5. 销量快照不可用时，继续使用可用的首页剩余栏目补偿，不伪造销量排名。

### 商品与缓存边界

- DRAFT、无可信公开 URL、后台 Admin URL 和不可信 `myshopify.com` fallback 不得进入用户货架。
- 正式用户读取到 stale 且允许刷新时，可由服务端后台调度一次缓存刷新；页面先返回现有安全内容，不阻塞等待刷新。
- 游客读取不会触发后台刷新，也不会得到可用于活动/优惠的内部字段。
- 商品卡和详情面板只展示当前响应的客户端安全字段；完整上游 payload 不直接下发。

## 4. Kitshop 状态与操作流转

| 状态 | 用户可见行为 | 数据/操作边界 |
| --- | --- | --- |
| Initial loading | 显示 `Loading shelves...` | 请求 `GET /api/kitshop?siteSlug=`；游客响应再做 guest-safe 清洗 |
| Normal | 渲染一个或两个有效货架 | 正式用户可记录货架曝光、卡片点击、详情和跳转；游客不记正式 analytics |
| Warning/stale | 货架上方显示 warning，现有商品仍可浏览 | 不把 stale 伪装为刚刷新；正式用户可触发后台 refresh schedule |
| Empty | 显示 `No kit shelves are available yet.` | 没有可信商品时不渲染假商品 |
| Request error | 显示错误提示 + empty 文案 | 不吞错误；当前页面没有独立 Retry 按钮，重新进入/刷新页面才会重试 |
| Rail no overflow | 左右按钮隐藏 | 商品顺序不变 |
| Guest checkout | 点击 Buy now 显示 Create account/Login 引导 | 不打开外部结算，不创建订单或权益 |

## 5. 用户反馈弹窗身份

状态：`Current`。验证范围：`Local code verified`。

- 入口：正式用户与游客 App Shell 顶部反馈图标；游客仅在站点已进入游客模式时显示。
- 页面目标：把当前用户或游客的问题/建议连同当前页面路径提交到后台用户反馈列表。
- 主要关联目标：当前账号或游客联系邮箱、站点、当前页面路径、`user_feedback` 记录和后台反馈处理状态。

## 6. 用户反馈字段

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Subject | 单行文本 | 必填；默认空 | 普通文本；前端/服务端最多 120 字符；浏览器 autocomplete off | 简要说明反馈主题 | 前端空值高亮；服务端 trim/合并空白，空值或超长返回 400 | 成功写入反馈主题 | `user_feedback` |
| Details | 5 行 textarea | 必填；默认空 | 普通多行文本；前端/服务端最多 1200 字符 | 描述问题、想法或出现时刻 | 前端空值高亮；服务端规范换行、trim，空值或超长返回 400 | 成功写入反馈正文 | `user_feedback` |
| Contact email | 仅游客显示的 email 输入框 | 游客必填；默认空；正式用户不显示 | 合法邮箱，最多 255 字符 | 让后台能联系未注册反馈者 | 每次停止输入 500ms 后检查格式；检查期间、空值或格式不合法时 Send feedback 禁用；服务端再次校验，不信任前端 | 写入 `user_email`，身份标记为 `guest`，不创建 `users` 临时账号 | `user_feedback`、游客联系信息 |
| Page path | 系统自动字段，不可见不可编辑 | 自动生成 | `window.location.pathname + search`，服务端最多 512 字符且必须是单斜杠开头的站内路径 | 帮助后台定位反馈发生页面 | 非站内格式会被清空，不信任客户端任意 URL | 随反馈保存或保存为空 | 当前站点页面、反馈 |
| User/account/site | 系统自动字段，不可见 | 正式用户来自认证请求；游客优先使用有效 guest session 的冻结站点，否则由请求 Referer 的站内路径解析 active site | 当前 user 或游客联系邮箱、account type、site id/slug | 将反馈关联到真实账号或可联系游客及其访问站点 | 不读取/信任表单 `pagePath` 来决定站点；Referer 无法解析或不是 active 站点时留空 | 随反馈记录保存；游客 `internal_uid` 为 NULL | 当前账号/游客、站点 |
| Send feedback | 主按钮 | Subject 与 Details 有值后提交；默认 `Send feedback` | 当前表单 | 提交反馈 | 提交中禁用并显示 `Sending...`；409 重复、429 频控和其他错误分别提示 | 成功后清空表单、关闭弹窗并 toast；状态初始为 `new` | `user_feedback`、后台反馈 |
| Cancel / Close / Scrim / Esc | 关闭操作 | 不适用 | 当前弹窗 | 退出而不提交 | 不调用接口 | 关闭弹窗；当前实现仅成功提交会 `reset`，普通关闭后再次打开可保留未提交文字 | 弹窗本地状态 |
| Error area | 条件只读提示 | 默认隐藏 | 前端校验或接口错误 | 告知为什么未提交 | 失败不清空 Subject/Details | 保留表单供修改重试 | 反馈提交状态 |

### 反馈确定性风控

- 同一正式用户或同一游客联系邮箱 10 分钟最多成功提交 5 条。
- 同一网络/IP 10 分钟最多成功提交 20 条。
- 同一正式用户或同一游客联系邮箱相同 Subject + Details 在 10 分钟内重复提交返回 409。
- 限制基于当前服务进程内 guard 状态；后台反馈表仍是最终记录，不应把前端按钮节流当安全边界。
- 用户不能从此弹窗选择后台状态；创建时固定为 `new`，后续由管理员处理。

## 7. Creator Workspace 页面身份

状态：`Current local`。验证范围：`Local browser + HTTP + database verified`，尚未发布。

- 路由：`/:siteSlug/creator`。
- 权限：creator 账号首页侧栏显示入口；personal/admin 不显示。数据 API 只接受 creator 登录态，personal/admin 均返回 403；前端隐藏不构成服务端安全边界。
- 入口：首页侧栏已开放 `Creator dashboard`；Profile 内入口仍保持隐藏。
- 页面身份区读取当前登录账号昵称和头像，不再使用固定演示人物；统计响应包含服务端解析的 creator 角色身份。
- 页面通过 `GET /api/creator/analytics` 读取真实数据；没有角色或周期内无数据时显示 0/空排行，不跨账号回退。
- 页面不存在 preview-data 依赖；接口失败显示错误与 Retry，不使用演示数据或旧数字伪装成功。
- 收入、分成、提现、销量、折扣使用和 payout 内容已从页面删除；在订单归因和结算体系真实完成前不恢复。

## 8. Creator Workspace 字段清单

下表区分本地已完成 UI 与尚未实现的数据能力。

| 字段/控件 | 控件与输入方式 | 当前状态 | 预期用途 | 当前操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- |
| Creator badge | 只读标签 | `Placeholder` | 标明创作者工作区 | 仅显示 | 未来 creator account |
| Creator account avatar/name | 只读身份区 | `Current local UI` | 识别当前 creator 账号 | 读取 session nickname/avatar；无头像显示字母占位 | 当前账号 |
| My dashboard | 单项导航 | `Current local UI` | 工作区首页 | 当前只有一个个人看板，无子路由 | Creator Workspace |
| Back to app | 按钮 | `Current` UI 操作 | 返回用户侧 | 导航到 Discover | 当前站点路由 |
| Theme | 主题按钮 | `Current` UI 操作 | 切换深/浅主题 | 仅更新主题 | 全局 UI |
| 7/30/90 days | 分段按钮 | `Current local`；默认 30 days | 选择表现周期 | 请求稳定枚举；快速切换以最后一次选择为准 | creator analytics query |
| Conversations | KPI 卡 | `Current local` | 周期内收到用户消息的去重正式会话数与环比 | 显示真实统计；无数据为 0 | `chat_sessions/chat_messages` |
| Product triggers | KPI 卡 | `Current local` | 服务端可信 `product_bubble_triggered` 数量与环比 | 显示当前角色可信触发 | product analytics |
| Store visits | KPI 卡 | `Current local` | 已验证、去重的 `product_detail_cta_click` 数量与环比 | 显示当前角色可信跳转 | product analytics |
| Visit rate | KPI 卡 | `Current local` | Store visits / Product triggers | 分母 0 显示 `--`，不伪造环比 | creator analytics |
| Trend metric | 分段按钮 | `Current local` | 在 Conversations / Product triggers / Store visits 间切换 | 只切换当前真实趋势序列 | 趋势图 |
| Performance trend | 折线图区域 | `Current local` | 按站点时区自然日显示单项趋势 | 悬停显示日期、指标值、辅助线和当前点 | creator analytics trend |
| Audience loyalty | 环形比例与只读指标 | `Current local` | 查看新用户、回访用户、回访率、去重聊天用户和平均消息数 | 只统计正式用户；新/回访互斥 | creator analytics audience |
| Top products | Top 5 只读排行 | `Current local` | 查看触发最多的商品及其跳转效果 | 商品图/名称/Triggers/Visits/Visit rate 来自同一可信消息快照 | creator analytics + 可信商品快照 |
| Mobile menu/scrim | UI 按钮/遮罩 | `Current` UI 操作 | 小屏打开/关闭工作区导航 | 仅切换 drawer | Creator UI |

## 9. 权限、站点与数据边界

- Kitshop 必须以显式 `siteSlug` 解析 active 站点，不能从前端商品卡推断或跨站 fallback。
- 游客可浏览安全商品，但活动、优惠码、权益和正式 analytics 必须剥离。
- 正式账号可直接提交；游客必须提供格式合法的联系邮箱。游客反馈不创建临时 `users` 账号，账号字段不接受前端伪造；游客优先写入有效 guest session 的冻结站点，未建立会话时从浏览器 Referer 的站内路径解析 active site。
- Creator dashboard 由服务端按当前 creator owner、站点及解析角色固定范围；伪造客户端 owner/site/role 不改变归属，未承接游客不进入正式统计。

## 10. 关联实现与文档

- Kitshop 前端：`src/features/kitshop/kitshop-page.js`、`src/services/kitshop-service.js`、共用 `src/features/chat/chat-product-panel*`。
- Kitshop 服务端：`server/kitshop-routes.js`、`kitshop-service.js`、`kitshop-shelf-builder.js`、`kitshop-repository.js`、商品响应清洗器。
- 反馈前端：`src/features/notifications/notification-panel.js`、`src/services/feedback-service.js`。
- 反馈服务端：`server/feedback-routes.js`、`server/feedback-service.js`、后台反馈服务。
- Creator：前端 `src/features/creator-workspace/creator-workspace-page.js`、`creator-dashboard-template.js`、`creator-dashboard-controller.js`、`src/services/creator-analytics-service.js`；后端 `server/creator-routes.js`、`server/creator-analytics-service.js`。
- API 索引：[06-api-index.md](../../06-api-index.md)。
- 长期规则：[路由与站点上下文](../../../design/01-navigation-and-site-context.md)、[身份、权限与生命周期](../../../design/02-identity-permissions-and-user-lifecycle.md)、[商业、权益与画像](../../../design/04-commerce-promotions-and-profile.md)、[用户侧体验](../../../design/05-user-facing-experience.md)、[集成与数据治理](../../../design/07-integrations-and-data-governance.md)。
- 相邻页面：[商品详情](./03-chat-product-call.md)、[Create/Profile](./04-create-profile.md)、[后台用户反馈与账号](../admin/04-feedback-accounts-logs.md)。
