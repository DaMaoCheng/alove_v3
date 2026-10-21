# 用户侧：App Shell、Discover、Search 与 404

更新时间：2026-07-21

实现状态：`Current`。验证范围：`Local verified`（已对照 App 启动、路由/access control、页面模板、页面 action/service、角色/轮播/商品接口与服务端过滤；本轮未使用正式账号重新做生产页面视觉验收）。

本文件记录通用页面外壳、Discover、角色确认/认证引导、Search 和 404 的可见字段与确定性行为。Chat、商品详情面板的完整字段分别见 [Chat、商品与实时通话](./03-chat-product-call.md)；用户反馈的完整字段也在 [Kitshop、反馈与 Creator Workspace](./05-kitshop-feedback-creator.md) 保留专项说明。

## 1. 入口、身份和站点解析

### 1.1 页面入口矩阵

| 页面 | 路由 | 正式账号 | 开启游客能力的未登录访问者 | 游客能力关闭的未登录访问者 | 主要目标 |
| --- | --- | --- | --- | --- | --- |
| App Shell | Discover/Search/Kitshop/Create/Chat/404 外壳 | `Current` | `Current`，公开页面为 guest mode | 仅 404 可直接渲染；其他受保护 view 回登录 | 提供统一导航、角色联系人、主题和账号入口 |
| Discover | `/:siteSlug/discover` | 可用 | 可浏览；只可直接聊天当前站点前台 | 回同站点登录 | 浏览轮播、分类和角色 |
| Search | `/:siteSlug/search` | 可用 | 可搜索；角色和购买操作受 guest 限制 | 回同站点登录 | 搜索角色与当前站点可信商品 |
| 404 | `/:siteSlug/404` 或未知/无权 view | 可用 | 可用 | 可用 | 阻止进入未知或无权页面并提供返回入口 |

游客能力只有在当前 active 站点 `guest_chat_enabled=1` 且存在已发布的有效前台角色时才激活。App 启动先解析显式站点或无前缀访问者站点，再读取 `/api/guest/capability`；接口失败时不静默开放 guest view。

### 1.2 当前站点边界

- 显式客户端站点路径使用通用 slug 语法和保留路径校验，并通过公开品牌接口确认 active 站点；只有明确 404 才将未知或停用 slug 改写到访问者 active 站点。网络错误或服务端 5xx 保留原显式路径并显示失败状态，避免临时故障把用户切到其他站点。未带站点前缀的已知页面先调用访问者站点解析，再改写为站点路径。
- 正式账号恢复后，以账号 `siteSlug` 作为普通用户有效站点；不会因为手工打开另一站点 URL 改写账号归属。
- 角色列表中的 mascot 只允许当前站点有效前台，creator 角色只允许当前站点；其他分类的公开已发布角色当前是全局可见，不按 `site_id` 过滤。
- 商品请求有独立服务端站点守卫：普通账号只能请求账号归属站点，管理员可请求合法站点；游客必须请求当前已开启 guest browsing 的站点并通过 Origin/Referer 校验。

## 2. App Shell

### 2.1 页面目标

App Shell 是用户侧主要页面的统一框架。左侧栏负责全局 view、联系人和账号入口；顶部栏负责移动菜单、Search、主题和正式用户反馈。页面切换会保持当前有效站点，但离开 Search 时会清空当前搜索 query。

### 2.2 左侧栏字段与控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AIOVE Logo | 可点击/键盘 Enter、Space 的品牌标识 | 桌面展开态显示 | 项目 Logo | 展开折叠后的侧栏 | 无 | 移除 `rail` 状态，不改 view | App Shell 布局 |
| Collapse sidebar | 图标按钮 | 展开态可见 | 固定按钮 | 收起侧栏文字，扩大内容区 | 无 | 添加 `rail` 状态 | App Shell 布局 |
| Discover | 导航项 | 始终显示 | 固定 view | 进入广场 | 未认证且 guest 不可用时路由守卫改为 login | 进入同站点 Discover | Discover |
| Create | 导航项 | 始终显示 | 固定 view | 进入角色创建/预览 | guest 可打开页面，但上传、AI 操作和正式保存由 Create 页继续拦截 | 进入同站点 Create | Create Character |
| Kitshop | 导航项 | `Current`，当前开关为显示 | 固定 view | 浏览站点商品货架 | guest 必须是已开启站点；服务端继续做站点和流量校验 | 进入同站点 Kitshop | 可信商品目录 |
| Creator dashboard | 导航项 | 仅 creator 显示 | session `accountType=creator` | 进入网红个人表现看板 | personal/admin 不显示；前端入口不能代替后续统计接口鉴权 | 进入同站点 `/creator` | Creator Workspace |
| Admin console | 导航项 | 仅 admin 显示 | session `accountType=admin` | 进入后台 | 非 admin 即使手工访问也降级 404；服务端后台接口另行鉴权 | 进入全局 `/admin` | Admin Console |
| 导航分隔线 | 只读布局 | 始终显示 | 静态 | 区分页面入口和联系人 | 无 | 无 | 侧栏结构 |
| 正式账号联系人 | 角色导航项 | 有 active activation 时出现 | `/api/chat/contacts`；公开角色或本人私有角色，creator 角色按站点过滤；按最后消息/激活时间排序 | 切换聊天对象 | 角色 archived 时保留不可用标记；真实聊天接口继续校验访问 | 进入 `chat?agent=<characterId>`；切换后清未读状态 | 角色激活、聊天会话 |
| 联系人头像/名称 | 只读 | 来自联系人 | 角色名称、头像；无图使用字符占位 | 识别聊天对象 | 无 | 点击整个联系人进入 Chat | AI 角色 |
| 未读点 | 只读状态 | 有前端未读状态时显示 | 当前 app unread map | 提示新消息 | 打开该角色后清除 | 不独立写后端 | 联系人消息状态 |
| Own / Private / Unavailable 标识 | 只读标签 | 符合角色属性时显示 | owner、visibility、character status | 说明角色归属与可用性 | 无 | 无 | 用户自建角色、私有角色、归档角色 |
| Guest 前台联系人 | 角色导航项 | guest mode 只显示一个 | 冻结的站点前台 `mascotCharacterId`；名称/头像来自角色列表或 capability | 让游客切页后回到原前台 Chat | 不能用 URL 指向其他角色；路由会改回 guest 前台 | 进入当前 guest Chat | guest session、站点前台 |
| Create Character | 导航项 | 正式账号显示 | 固定 view | 快速进入 Create | 需正式认证 | 进入 Create | 用户角色创建 |
| Create account | 导航项 | guest mode 显示 | 固定 view | 引导游客注册 | 保持当前站点路径 | 进入 Register | guest claim、注册 |
| 用户卡片 | 按钮 | 底部固定 | 正式账号显示昵称/邮箱/头像；无头像使用首字母；guest 显示 `Guest` / `Login or register`，当前共用组件会渲染字母占位 | 进入资料或认证 | 正式账号打开 Profile；guest 不读取正式资料 | 正式账号打开 Profile，guest 进入 Login | Profile、认证 |
| Mobile close / scrim | 图标按钮/遮罩 | 小屏抽屉打开时使用 | 固定控件 | 关闭移动侧栏 | 无 | 移除 `drawer-open` | App Shell 布局 |

### 2.3 顶部栏字段与控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Open menu | 图标按钮 | 小屏显示 | 固定控件 | 打开移动侧栏 | 无 | 切换 `drawer-open` | 左侧栏 |
| Search characters, teams, kits... | 外观像输入框的按钮，不可直接输入 | 默认显示占位文案 | 当前页面模板 | 进入专用 Search | 无 | 派发全局导航事件并进入同站点 Search | Search |
| Theme toggle | 图标按钮 | 恢复本机 `dark` / `light` 偏好 | 浏览器本地主题偏好 | 切换 App Shell 主题 | 本地存储失败不影响当前切换 | 写 `aiove_color_theme` | 当前浏览器主题 |
| Send feedback | 图标按钮 | 仅正式账号显示；guest 隐藏 | 固定入口 | 打开真实反馈弹窗 | 提交接口要求正式认证 | 打开反馈弹窗 | 用户反馈 |

### 2.4 用户反馈弹窗（从 App Shell 打开）

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Subject | 单行文本 | 必填；默认空 | 最多 120 字符；前后端都会去首尾空白，服务端压缩连续空白 | 概括反馈 | 空值标红；超长由浏览器 maxlength 和服务端拒绝 | 随反馈保存 | `user_feedback.subject` |
| Details | 多行文本 | 必填；默认空 | 最多 1200 字符 | 描述问题或建议 | 空值标红；超长由浏览器 maxlength 和服务端拒绝 | 随反馈保存 | `user_feedback.content` |
| Page path | 页面不可见，提交时自动采集 | 自动 | 当前 `pathname + search`，服务端只接受以单 `/` 开头的路径 | 关联问题发生位置 | 非法路径被清空 | 随反馈保存 | `user_feedback.page_path` |
| Send feedback | 提交按钮 | 表单有效时执行；提交中禁用 | Subject + Details | 保存反馈 | 同账号 10 分钟最多 5 条、同 IP 最多 20 条；相同内容 10 分钟内拒绝重复 | 成功状态为 `new`，清空并关闭弹窗，显示 toast | 后台用户反馈 |
| Cancel / Close / scrim / Escape | 按钮、遮罩、键盘 | 不适用 | 固定关闭方式 | 退出而不提交 | 当前关闭不弹二次确认 | 关闭弹窗；同一页面挂载周期内再次打开可保留未提交文字，刷新或页面重挂后不保证保留 | App Shell |

### 2.5 App Shell 状态与权限流转

| 状态 | 当前行为 |
| --- | --- |
| App 启动 | 先显示 boot、解析站点、探测 guest capability、用 `/api/auth/me` 恢复正式 session，再决定正式或 guest 外壳，避免只信本地缓存。 |
| 正式账号 | 加载角色、联系人和按页面需要加载轮播/聊天；显示反馈和 Profile，admin 额外显示后台。 |
| Guest | 只显示冻结前台联系人、Create account 和登录用户卡；隐藏反馈；公开 view 可访问。 |
| guest capability 失败/关闭 | 未认证的 Discover/Search/Kitshop/Create/Chat 路由到同站点 Login。 |
| 认证过期 | 清理本地认证和聊天状态、关闭 Profile/Call，replace 到同站点 Login。 |
| 联系人加载失败 | 保留当前已有联系人数据，记录失败；侧栏没有独立错误卡。 |

### 2.6 全局提示/确认弹窗

状态：`Current`。该共用 `alertdialog` 被认证、角色、Create、上传、Chat 和后台操作复用；页面只传入确定性的标题、正文、类型和按钮回调，弹窗本身不代替业务接口校验。

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 类型图标 | 只读 | 默认 info | error、warning、info、success；其他值回落 info | 区分提示语义 | 类型只影响展示，不改变业务状态 | 无写入 | 当前操作状态 |
| Title | 只读标题 | 空值显示 `Notice` | 调用页面提供的纯文本 | 概括结果或确认事项 | 输出转义 | 无写入 | 当前操作 |
| Message | 只读正文 | 可空 | 调用页面提供的纯文本 | 解释原因、后果或下一步 | 输出转义，不渲染调用方 HTML | 无写入 | 当前操作 |
| Confirm | 主按钮 | 默认 `OK` | 调用方可提供按钮文字与确认回调 | 确认提示或继续动作 | 回调由具体页面负责权限、请求和错误处理 | 先关闭弹窗，再执行确认回调 | 当前业务动作 |
| Cancel | 次按钮 | 只有调用方传入文字时显示 | 调用方文字与取消回调 | 放弃需要显式取消的动作 | 无取消文字时不渲染该按钮 | 先关闭弹窗，再执行取消回调 | 当前业务动作 |
| X / scrim / Escape | 关闭控件 | 始终可关闭 | 固定共用行为 | 不执行确认直接退出 | 关闭不会自动回滚已经完成的接口请求 | 清除当前弹窗及回调 | 页面 UI 状态 |

同一时间只保留一个全局提示弹窗；打开新弹窗会先关闭旧弹窗。成功、失败或警告类型不能据此推断服务端是否真的写入成功，具体结果仍以调用页面的真实接口响应为准。

## 3. Discover

### 3.1 页面身份

- 路由：`/:siteSlug/discover`
- 状态：`Current`
- 页面目标：展示当前站点有效轮播、可用角色分类和角色卡；正式账号激活/继续角色，guest 回前台或进入认证引导。
- 主要数据目标：`home_carousel_items`、`ai_characters`、`character_categories`、角色 metrics、`user_character_activations`、聊天会话。

### 3.2 Banner 字段与控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Banner | 只读主视觉 | 使用接口列表第一项；无项或轮播加载失败时用前端 fallback | 当前站点或全局 `published` 轮播；开始时间为空/已开始、结束时间为空/未结束；按 display order、更新时间排序 | 展示当前主推内容 | 页面只渲染第一项，没有轮播切换；轮播接口错误没有独立错误块 | 无直接写入 | 首页轮播配置 |
| Eyebrow | 只读短文案 | 空值显示 `Featured` | Banner 数据 | 标识活动类型 | 输出转义 | 无 | Banner |
| Title | 只读标题 | 空值显示 `Featured character` | Banner 数据 | 说明主推主题 | 输出转义 | 无 | Banner |
| Subtitle | 只读说明 | 空值不显示 | Banner 数据 | 补充主推说明 | 输出转义 | 无 | Banner |
| Image | 背景图 | 空值无背景；fallback 使用项目图片 | 项目相对资源、上传资源或 HTTP(S) 地址 | 视觉展示 | 前台规范化路径并转义 CSS URL | 无 | Banner 图片 |
| CTA label | 按钮 | 无有效目标时不显示 | `ctaText`，空值 fallback `Open` | 执行 Banner 目标 | 仅 `character` + target 或 `url` + target 渲染 | 根据目标进入角色或 URL | 角色、站外/站内 URL |
| Character CTA | 按钮 | 由 Banner 配置 | 有效角色 ID；`mascot_template` 可由服务端映射成当前站点前台 | 进入角色聊天 | guest 只能直接进入当前前台；正式账号已激活直接进 Chat，未激活先调用激活；失败弹错误框 | 创建/复用 activation/session 后进入 Chat | AI 角色、聊天会话 |
| URL CTA | 按钮 | 由 Banner 配置 | Banner `ctaTarget` | 跳转目标页面 | 前端只检查非空；点击使用当前窗口 `location.href` | 离开或切换当前页面 | 配置 URL |

### 3.3 分类与角色卡字段

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Category chips | 单选按钮组 | 初始 `appState.category` 为 `Football Babe`；点击后保持单一 active | active 角色分类，排除 mascot，按后台 display order/label；当前站点没有公开已发布 creator 角色时隐藏 Creator；API 无分类时回退前端 demo 分类 | 筛选当前角色行 | 仅前端按 `character.category.label` 精确匹配；已选分类在新站点不可用时自动回到第一个可用分类 | 更新当前内存 category 并重绘 | Character category |
| Guest 前台卡 | 角色卡 | guest mode 且列表包含 capability 前台时固定插入第一位 | 当前冻结 `mascotCharacterId` | 让游客始终能找到前台 | 不受当前 category 筛选；只在 guest mode 插入 | 点击打开角色确认弹窗并可进入 guest Chat | 站点前台、guest session |
| 角色卡图片 | 只读图片/占位 | 优先 `coverUrl`，否则 `avatarUrl` | 角色公开数据 | 识别角色 | 无图时使用共享占位 | 点击整卡触发确认/认证引导 | AI 角色 |
| Name | 只读 | 来自角色 | 已发布公开角色名称 | 识别角色 | 输出转义 | 无 | `ai_characters.name` |
| Role | 只读 | 空值允许 | `roleTitle` | 说明角色定位 | 输出转义 | 无 | `ai_characters.role_title` |
| Card badge | 只读标签 | 配置存在时显示 | `cardTag`、`cardTagText`；`live` 使用特定样式 | 标记角色状态/运营标签 | 页面不推导标签含义 | 无 | 角色卡配置 |
| Chats | 只读统计 | 无值显示 `-` | 该角色所有正式 `user` session 中 sent 用户消息总数，格式化 k/m | 展示互动量 | 不包含 guest 消息 | 无 | 聊天统计 |
| Star/activation count | 只读统计 | 无值显示 `0` | active activation 去重账号数，格式化 k/m | 展示激活量 | 只统计 active activation | 无 | 角色激活统计 |
| Previous / Next | 图标按钮 | 只有横向溢出时显示；到边界禁用 | 当前角色行宽度 | 翻页浏览角色 | Resize/Mutation/scroll 后重算边界 | 平滑滚动约一页 | 当前角色行 |
| Drag rail | 鼠标拖动；触摸设备使用原生滚动 | 有溢出时可用 | 当前角色行 | 快速横向浏览 | 拖动超过阈值会抑制误点击 | 只改变 scrollLeft | 当前角色行 |

服务端角色列表规则：角色必须 `visibility=public`、`character_status=published`；mascot 只返回当前站点有效前台，creator 只返回当前站点，其他分类当前可跨站全局返回。Creator 分类仅在当前站点至少存在一个符合上述公开、已发布条件的 creator 角色时返回。服务端按发布时间、创建时间倒序；前端筛选后最多渲染 30 张卡。

### 3.4 角色确认弹窗

状态：`Current`。Discover 普通角色卡点击后打开；Banner character CTA 不打开该预览。

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Avatar | 只读圆形头像 | 无图显示占位 | 角色 `avatarUrl` | 识别角色 | 无 | 无 | AI 角色 |
| Name | 只读 | 必有角色时显示 | 角色名称 | 确认对象 | 输出转义 | 无 | AI 角色 |
| Role | 只读 | 空值 fallback `AI character` | 角色 role title | 说明定位 | 输出转义 | 无 | AI 角色 |
| Opening line | 只读气泡 | 空值 fallback `Ready when you are - let's chat!` | 角色 opening line | 预览开场语气 | 输出转义 | 无 | Chat opening message |
| Start / Continue | 主按钮 | 联系人已包含角色时 `Continue`，否则 `Start` | 客户端联系人 activation 集合 | 激活或继续 | `Start` 调服务端激活；重复激活返回 alreadyActivated 时直接进入；失败显示错误弹窗 | 创建/恢复 activation 和 active session，进入 Chat | 角色激活、聊天会话 |
| Cancel / X / scrim / Escape | 关闭控件 | 不适用 | 固定控件 | 放弃本次进入 | 无 | 关闭弹窗 | Discover |

弹窗不展示音色、角色类型标签或 chats/activation 统计；这些字段当前已从弹窗移除。

### 3.5 Guest 角色认证引导

| 触发 | 标题与说明 | 主按钮 | 次按钮/关闭 | 结果 |
| --- | --- | --- | --- | --- |
| 点击非前台角色卡或 Banner character CTA | `Sign in to chat with this character`，说明需创建账号或登录 | `Create account` | `Sign in`；X/scrim/Escape 只关闭 | 主按钮进同站点 Register；次按钮进同站点 Login；不激活角色 |

### 3.6 Discover 页面状态

| 状态 | 当前行为 |
| --- | --- |
| 角色加载中 | 角色行显示 `Loading characters... / Please wait` 占位卡。 |
| 角色接口失败 | 角色行显示 `Unable to load characters` 和安全错误文字。 |
| 分类为空 | 显示 `No characters yet`，说明该分类暂无已发布角色。 |
| 正常 | 渲染过滤后的单行角色 rail；有溢出才显示翻页按钮。 |
| 轮播为空或失败 | 不显示独立 loading/error，使用静态 fallback Banner。 |
| 激活中 | 当前确认弹窗先关闭；卡片没有独立 busy 状态。成功 toast 后进入 Chat，失败另开错误弹窗。 |

## 4. Search

### 4.1 页面身份

- 路由：`/:siteSlug/search`
- 状态：`Current`
- 页面目标：在当前已加载角色列表中即时按名称筛选，并对当前有效站点可信商品源执行防抖搜索；角色进入 Chat，商品打开详情面板。
- 主要数据目标：前端角色列表、可信商品目录、商品点击事件（正式账号）、当前页面内存 query/recent。

### 4.2 搜索框与导航控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Search characters and kits... | 单行文本；`autocomplete=off`；进入页自动聚焦 | 可空；进入 Search 时通常为空 | 自由文本；页面无 `maxlength` | 同时触发角色名称筛选和商品搜索 | 角色只按 name 不区分大小写包含；guest 服务端最多 160 字符，正式账号当前无同款 query 长度前置；商品请求另有限流 | 更新内存 query；立即显示角色过滤，商品 500ms 防抖 | 角色、可信商品 |
| Clear | 搜索框内 X 按钮 | query 非空时显示 | 固定控件 | 清空搜索 | 无 | 清 query、关闭商品面板、恢复 Trending/Recent 并聚焦输入框 | Search 状态 |
| Cancel | 按钮 | 始终显示 | 固定控件 | 离开 Search | 无 | 关闭商品面板、进入同站点 Discover；导航同时清空 query | Discover |
| Open menu | 图标按钮 | 小屏使用 | 固定控件 | 打开侧栏 | 无 | 切换 `drawer-open` | App Shell 侧栏 |

### 4.3 空查询内容

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Trending searches | 5 个只读推荐词按钮 | query 为空时显示 | 前端固定词表 | 提供搜索入口 | 不是后台可配置数据 | 点击回填输入框并执行搜索 | Search query |
| Recent | 最近词按钮列表 | 初始为 app state 内两个演示词；清空后为空 | 当前仅页面内存初始值 | 提供最近搜索入口 | `Current limitation`：新搜索不会追加，刷新不持久化 | 点击执行搜索 | Search query |
| Clear recent | 文本按钮 | Recent 非空时显示 | 固定控件 | 清空近期词 | 只清当前 app 内存 | Recent 变空，显示 `No recent searches yet.` | Search state |

### 4.4 角色结果

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Character row | 可点击结果行 | 名称命中时显示 | 当前站点上下文加载的公开角色列表；仅按角色 name 包含 query | 快速进入角色 | guest 仅当前前台可直接进入；其他角色打开认证引导 | 正式账号直接导航 Chat；guest 前台进入 guest Chat | AI 角色、Chat |
| Avatar | 只读 | 无图使用占位 | 角色 avatar | 识别角色 | 无 | 无 | AI 角色 |
| Name | 只读 | 角色数据 | 角色 name | 展示命中项 | 输出转义 | 无 | AI 角色 |
| Role | 只读 | 空值 fallback `AI character` | 角色 role title | 说明定位 | 输出转义 | 无 | AI 角色 |

`Current implementation gap`：Search 正式账号点击角色不会像 Discover 一样调用 `/activate` 或打开确认弹窗，而是直接进入 Chat。未激活角色首次进入时消息列表为空；首次发送可创建 chat session，但当前链路不会同时创建 `user_character_activations`，因此该角色不一定出现在侧栏联系人中。本轮只记录，不修改业务代码。

Guest 点击非前台角色时显示 `Create an account to chat`：主按钮进入 Register，`Not now` 或关闭只关闭弹窗，没有独立 Sign in 按钮。

### 4.5 商品结果与详情入口

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Product row | 可点击结果行 | 商品命中时显示；最多 2 条 | 当前站点可信商品搜索服务；严格站点解析；正式账号结果附带服务端短时签名回执 | 打开商品详情 | 旧 request ID 返回被丢弃；商品源失败显示独立不可用状态；签名回执无效时统计请求失败但不阻止打开详情 | 打开详情侧栏；正式账号凭当前结果的 `searchReceipt` 记录 search result click，guest 不记录 | 可信商品、商品详情 |
| Product image | 只读图片 | 无图 fallback 项目商品图 | 商品主图 | 识别商品 | URL 经共享资源规范化 | 无 | 商品 |
| Name | 只读 | 空值 fallback `Product` | 商品名称 | 展示命中项 | 输出转义 | 无 | 商品 |
| Meta | 只读 | subtitle/summary 均空时 `Recommended` | 商品副标题或摘要 | 补充说明 | 输出转义 | 无 | 商品 |
| Price | 只读 | 空值不显示 | 可信商品响应价格 | 快速比较 | 页面不自行计算价格 | 无 | 商品价格 |
| View | 只读操作提示 | 固定 | 固定文案 | 表示可展开 | 无 | 点击整行打开详情 | 商品详情面板 |

商品详情面板的图片、价格、尺码、库存、购买、支付方式和可信刷新规则见 [Chat、商品与实时通话](./03-chat-product-call.md)。Search 专属边界：

- 正式账号记录搜索结果曝光、点击、详情打开和详情 CTA 事件；这些事件不要求聊天 `messageId`，而使用 30 分钟内有效、绑定当前用户/站点/商品/入口的服务端签名回执。guest 不记录正式用户商品 analytics。
- guest 可查看详情，但点击 Buy now 会显示创建账号引导，不会打开外部购买页；提示文案提到注册或登录，当前主按钮只有 `Create account`，次按钮为 `Not now`。
- guest 商品搜索要求同源 Origin/Referer、站点开启 guest browsing，并受同网络同站点 30 次/10 分钟额度；正式账号同用户同站点 120 次/10 分钟、同时最多 2 个请求。
- 普通账号请求站点必须等于账号归属站点；管理员可请求格式合法的站点 slug。

### 4.6 Search 状态流转

| 状态 | 当前行为 |
| --- | --- |
| 空 query | 显示 Trending 和 Recent，不请求商品。 |
| 输入中 | 角色结果按名称立即重绘；商品区域显示 `Searching products...`，500ms 后调用接口。 |
| 等待商品 | result count 后显示 `+`；旧 query 的返回不能覆盖新 query。 |
| 有结果 | 显示角色与 Kits 分区；count 为当前角色数加商品数。 |
| 无结果 | 角色和商品都为空且商品请求未失败时，显示 `No results for ...`。 |
| 商品失败 | 角色结果仍可用；Kits 分区显示 `Product search is unavailable right now.`。 |
| 商品详情打开 | body 添加 `product-open`；点击关闭、遮罩、Clear、Cancel 或新搜索关闭详情。 |
| 离开 Search | App 导航统一把 query 清空；浏览器返回到 Search 也不会恢复上一 query。 |

## 5. 404 / 无权限

### 5.1 页面身份

- 路由：`/:siteSlug/404`、未知 view，或前端账号类型无权访问 creator/admin 时的降级结果。
- 状态：`Current`
- 页面目标：不渲染目标业务页，给用户一个安全返回入口。
- 适用身份：正式账号、guest、未登录访问者。

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 404 code/icon | 只读 | 固定 | 页面模板 | 表示页面不存在 | 无 | 无 | 当前未知路由 |
| Title / message | 只读 | 固定英文 | 页面模板 | 说明目标不可用 | 不泄露权限或资源存在细节 | 无 | 当前未知/无权 view |
| Back to Discover | 按钮 | 固定 | 当前有效站点 | 返回可用入口 | 正式账号/guest 可进入 Discover；未认证且 guest 不可用时路由守卫改为 Login | 进入 Discover 或 Login | 站点路由、认证 |

404 不清除认证 cookie，也不修改账号站点归属。它只代表前端 view 不识别或账号类型无权；后台接口仍必须独立鉴权，不能把前端 404 当作安全边界。

## 6. 已确认的隐藏、占位与实现差异

| 项目 | 状态 | 当前事实 |
| --- | --- | --- |
| Creator dashboard 导航 | `Current local` | creator 账号首页侧栏显示；personal/admin 不显示。尚未发布。 |
| Creator dashboard 数据 | `Current local` | 已接入 creator 专属只读 analytics service/API；7/30/90 天摘要、趋势、受众和 Top 5 使用服务端可信角色归属，接口失败显示 Retry，不回退演示数据。尚未发布。 |
| Search Recent 持久化 | `Placeholder` | 只使用内存初始词；不会记录新搜索，刷新后恢复初始值。 |
| Discover 分类有效性 | `Current` | 动态分类加载后保留仍有效的当前分类；当前分类不存在时自动选择第一个可用分类。 |
| Discover 轮播错误表达 | `Current implementation gap` | 轮播为空和加载失败都使用 fallback，用户无法区分。 |
| Search 角色激活 | `Current implementation gap` | Search 点击不执行 activation，可能导致新角色会话不进入联系人。 |
| 动态站点路由 | `Current local` | 前端使用通用 slug 语法、保留路径校验和 active 站点品牌确认；后台新增 active 站点无需修改前端白名单。只有明确 404 才替换显式站点路径。尚未发布。 |

## 7. 关联文档与实现位置

- 长期产品规则：[路由与站点上下文](../../../design/01-navigation-and-site-context.md)、[身份、权限与用户生命周期](../../../design/02-identity-permissions-and-user-lifecycle.md)、[用户侧体验](../../../design/05-user-facing-experience.md)、[集成与数据治理](../../../design/07-integrations-and-data-governance.md)
- 相邻页面：[认证页面](./01-authentication.md)、[Chat、商品与实时通话](./03-chat-product-call.md)、[Create 与 Profile](./04-create-profile.md)、[Kitshop、反馈与 Creator Workspace](./05-kitshop-feedback-creator.md)
- 系统说明：[Frontend Pages](../../02-frontend-pages.md)、[Backend Services and Data](../../04-backend-services-and-data.md)、[API Index](../../06-api-index.md)
- 主要前端：`src/app/main.js`、`src/app/app-navigation.js`、`src/app/access-control.js`、`src/app/site-routing.js`、`src/features/app-shell/`、`src/features/discover/`、`src/features/search/`
- 主要服务端：`server/character-public-service.js`、`server/character-activation-service.js`、`server/home-carousel-service.js`、`server/product-search-routes.js`、`server/product-search-public-service.js`、`server/product-request-guard-service.js`、`server/guest-chat-routes.js`
