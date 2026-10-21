# 用户侧：Create Character、AI 头像、Profile 与 Invite

实现状态：Create、AI 头像、Profile、Invite 为 `Current`；Voice clone 与 Invite via email 为 `Placeholder`；Creator Workspace 入口为 `Hidden`。验证范围：`Local code verified`。

## 1. Create Character 页面身份

- 路由：`/:siteSlug/create`。
- 页面目标：配置并创建一个属于当前正式账号的 AI 角色，创建成功后立即激活并进入该角色 Chat。
- 正式用户：personal、creator、admin 均可进入；Creator 分类另有账号与站点限制。
- 游客：可查看、选择和填写页面草稿；上传头像、AI 头像、AI polish 和正式创建会弹出认证引导，不写入角色数据。
- 主要关联目标：当前账号、角色分类、角色私有设定、语音预设、语言配置、临时头像资产、角色可见性与角色激活。

## 2. Create Character 字段

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Avatar | 图片上传区 | 可选；默认图片占位 | JPG/JPEG/JFIF/PNG/WebP；源文件最大 12MB；裁剪输出 512×512 WebP | 设置角色头像 | 上传前审核；裁剪/上传失败显示独立 `avatarError`；服务端只接受受控头像路径 | 上传成功保存临时 `avatarUrl`，提交角色时写入头像/封面 | 临时头像资产、角色 |
| Upload avatar | 按钮 + 单文件选择 | 可选 | 同上 | 从设备选择头像 | 游客先认证；上传或生成中禁用 | 打开文件选择→审核→裁剪→上传 | 临时头像资产 |
| AI generate | 按钮 | 可选 | 当前角色草稿或手动描述 | 打开 AI 头像生成弹窗 | 游客先认证；上传或生成中禁用；Provider 未配置/失败显示通用错误 | 成功后仍需裁剪并上传，未直接保存角色 | AI 生成临时图、头像资产 |
| Remove | 条件按钮 | 有头像时显示 | 当前临时头像 | 清除草稿头像 | 删除失败仅记录清理失败，不假装删除远端成功 | 清空 `avatarUrl/avatarPreviewUrl` | 临时头像资产 |
| Character name | 单行文本 | 必填；默认空 | 任意普通文本；UI 无 `maxlength`，服务端 trim 后最多 96 字符 | 角色显示名和 slug/短标题生成上下文 | 空值提示 `Character name is required`；超长内容按服务端上限处理 | 写入角色 `name`；实时更新预览 | 角色 |
| Category | 卡片单选 | 必填；状态为空时默认当前账号可见列表第一项 Football Babe | Football Babe、Creator、Pundit、Fan、Companion；personal 不显示 Creator | 定义角色分类、发现位置与部分权限 | 非 allowlist 拒绝；Creator 另见下方账号规则 | 写入 `category_id`；更新预览 role | 角色分类、账号 |
| Personality | 卡片单选 | 必填；默认未选 | Hype & loud、Calm mentor、Cheeky banter、Tactical nerd、Old-school | 形成角色说话风格和私有提示层 | 非 allowlist 拒绝 | 写入 speaking style/profile/persona 上下文 | 角色私有设定 |
| Voice | 自定义单选下拉 | 必填；默认未选 | 当前 11 个受控预设标签：Nova、Sunny、Iris、Velvet、Mira、Atlas、Ever、Vale、Rook、Nolan、Echo | 决定角色 AI 语音音色 | 必须匹配现有预设；不在文档记录真实 provider 凭据或内部 voice ID | 写入受控 provider/voice 映射和 sample URL | 角色语音配置 |
| Voice preview | 每个选项内播放/暂停按钮 | 可选 | 预设 sample asset | 提交前试听 | 播放失败 toast；离开页面/隐藏页面停止播放 | 仅播放，不保存额外数据 | 语音预设 |
| Clone my voice PRO | 按钮 | 可见但不可配置 | 无真实输入 | 告知未来会员能力 | 游客先认证；正式用户只看到 members-only 对话框 | `Placeholder`：不上传声音、不创建克隆、不改变 Voice | 未来会员语音能力 |
| Language | 可搜索下拉单选 | 必填；默认未选；初次最多展示 16 项 | 支持语言库；搜索每次最多 16 个结果；显示 Fast voice/High quality voice 能力提示 | 固定角色默认回复语言并选择语音模型能力 | 必须命中支持语言库；无结果显示 `No matching language` | 保存 label/code 与语音支持标记，写入角色 profile 和 persona language guidance | 角色语言、TTS |
| Opening line | 单行文本 | 必填；默认空 | 普通文本；UI 无 `maxlength`，服务端最多 512 字符 | 新会话首次开场内容 | 空值拒绝 | 写入 `opening_line`；实时更新预览气泡 | 角色、会话开场 |
| Backstory | 多行 textarea | 必填；默认空 | 普通文本；UI 无 `maxlength`；创建校验 20-4000 字符 | 形成角色私有背景设定 | 空值、少于 20 字符拒绝；服务端最多 4000 字符 | 写入 persona prompt，并附加确定性语言规则 | 角色私有设定 |
| AI polish | 按钮 | Backstory 有内容时使用；默认空 | 当前 name/category/personality/voice/language/opening line/backstory | 润色背景故事 | 游客先认证；服务端输入最多取 1200 字符，输出规范化最多约 900 字符；未配置/失败保留原文 | 成功仅回填 Backstory 草稿，仍需点击创建才保存 | 角色草稿、AI provider |
| Visibility | Private/Public 卡片单选 | 默认 Private | 固定二选一 | 控制角色发现范围 | 非法值由服务端回落 Private；不替代角色状态与访问权限校验 | Private 仅本人可见/聊天；Public 可被其他用户在 Discover/Search 发现 | 角色可见性 |
| Live preview | 只读卡片 | 未填时显示占位 | 当前头像、名称、Category、Personality、Opening line 草稿 | 在提交前预览角色卡核心信息 | 预览不是已保存记录，也不验证服务端权限 | 无写入 | 当前表单草稿 |
| Create & start chatting | 主提交按钮 | 所有必填字段通过后可用；提交中显示 Creating | 当前表单规范化 payload | 创建并开始使用角色 | 上传/生成未结束先提示；游客先认证；创建失败显示通用错误并保留其他草稿 | 创建 `published` 角色、激活当前用户角色、重置草稿并导航到 Chat | 角色、激活、会话入口 |

### Creator 分类规则

- personal 账号前端不显示 Creator，服务端也拒绝普通账号创建 Creator。
- creator 账号必须绑定 active 站点，且只能存在一个未归档 Creator 角色。
- admin 可创建 Creator；角色站点取管理员账号当前绑定站点，没有站点时不会由前端任意指定其他站点。
- 非 Creator 分类不绑定具体 `site_id`；mascot 与 Creator 按站点过滤，Football Babe、Pundit、Fan、Companion 等其他公开分类当前可跨站全局展示，私有角色仍只对 owner 可见。

## 3. AI 头像生成弹窗

状态：`Current`。入口为 Create 的 AI generate；它只产出候选临时图片，最终仍需裁剪和上传。

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Background scan | 短暂只读 loading | 打开后显示约 650ms | 当前 Backstory | 判断是否可直接用故事生成 | 不是外部网页扫描；只读取当前表单 Backstory | 进入 Use story 或 Custom prompt 状态 | 当前角色草稿 |
| Story preview | 只读摘要 | Backstory 非空时显示 | Backstory 前 90 字符左右 | 让用户确认将使用哪段背景 | 不等于完整 prompt | 无写入 | 当前角色草稿 |
| Custom prompt | 按钮 | 有 Backstory 时可切换 | 无 | 改为手动描述 | 无 | 显示描述 textarea | 弹窗模式 |
| Describe the avatar | textarea | 手动模式必填；默认空或保留本次重试文本 | 自由视觉描述 | 提供头像生成内容 | trim 后为空时高亮并聚焦；UI 未设置显式长度上限，服务端会裁剪上下文字段 | 作为生成输入，但不会直接进入角色 persona | AI 生成请求 |
| Use story | 按钮 | Backstory 模式显示 | 当前 Backstory + 其他角色草稿 | 用角色故事生成 | Backstory 为空不可调用 | 进入 Generating | AI 生成请求 |
| Generate | 按钮 | 手动模式显示 | 手动描述 + 其他角色草稿 | 发起生成 | 描述为空不提交；防重复生成 | 进入 Generating | AI 生成请求 |
| Loading/timer/estimate | 只读状态 | 请求中显示 | 前端计时与固定估时文案 | 展示等待状态 | 计时不是 SLA | 成功进入 ready，失败进入 error | 生成任务状态 |
| Regenerate | 按钮 | 生成失败或裁剪阶段可用 | 保留的 prompt/mode | 重新生成候选图 | 旧临时图先进入受控清理 | 新请求替换候选图 | 临时生成资产 |
| Crop | 裁剪器 | 生成成功后必须完成才能回填 | 候选图片 URL | 产出角色头像比例和尺寸 | 取消时清理未采用候选图 | 生成 512×512 WebP 并走正常上传 | 临时生成资产、头像资产 |
| Close/遮罩 | 按钮/点击遮罩 | 不适用 | 当前弹窗 | 退出生成流程 | 不应误保存未采用图片 | 关闭；未采用临时图按流程清理 | 临时生成资产 |

生成服务强制成人、单主体、无文字/水印等固定安全与风格约束；页面不会把底层模型、密钥或真实 provider 配置暴露给用户。

### 3.1 头像安全检查与裁剪弹窗

状态：`Current`。Create、后台通用/网红角色和前台头像编辑共用同一套头像审核与 1:1 裁剪器；AI 生成候选图跳过本地文件审核步骤，但仍必须进入相同裁剪和受控上传链路。

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Checking avatar | 只读 loading 弹层 | 选择本地文件后显示 | 当前待上传图片 | 等待上传前安全审核 | 审核拒绝显示 `Avatar not allowed`；失败不进入裁剪、不保存资源 | 审核通过后读取文件并打开裁剪器 | 上传审核、临时文件 |
| 裁剪画布 | 鼠标/触摸拖动图片 | 打开时按图片短边自动填满 1:1 区域 | 已审核本地图片或 AI 候选图 | 决定头像取景位置 | 图片无法读取显示明确错误；拖动被限制，不能露出画布空白 | 只改变本地裁剪位置 | 头像候选图 |
| Zoom | range 滑杆 | 默认 1；范围 1–3，步进 0.01 | 当前候选图 | 放大取景 | 缩放基于自动填满比例，并继续限制边界 | 只改变本地缩放值 | 头像候选图 |
| Use photo | 主按钮 | 裁剪器打开时可用 | 当前画布 | 确认裁剪 | Canvas 处理失败显示 `Processing failed`，不回填损坏资源 | 输出 512×512 WebP，再进入受控头像上传；上传成功才回填表单 | 临时头像、角色/前台头像 |
| Retry/Re-upload | 条件图标按钮 | AI 候选或本地重选流程提供回调时显示 | 调用入口定义的重试动作 | 放弃当前候选并重新生成/选择 | 先清理当前未采用候选；按钮不是再次提交同一裁剪结果 | 关闭裁剪器并回到对应生成或文件选择流程 | 临时生成资产、文件选择 |
| Cancel / X / scrim / Escape | 关闭控件 | 始终可用 | 固定行为 | 放弃本次裁剪 | AI 未采用候选按调用流程清理；不会覆盖原有已保存头像 | 关闭裁剪器并执行取消回调 | 临时资产、编辑器草稿 |

本地文件只接受 JPG/JPEG/JFIF、PNG、WebP，源文件最大 12MB；不支持类型、超限、读取失败、审核失败、Canvas 失败和上传失败是不同错误阶段，不能统一写成“头像已保存失败”。

## 4. Create 页面状态流转

1. 进入页面时草稿字段为空，Category 根据账号可见列表回落到第一项，Visibility 为 Private。
2. 任一字段变化标记 `dirty`；离开未提交页面时触发离开保护并清理临时头像。
3. Avatar upload、AI generate、AI polish、Create 各自维护独立 loading/error，不应用一个失败清掉其他字段。
4. 提交先做前端 allowlist/必填校验，再由服务端重复校验账号、站点、分类、语音、语言、头像路径和长度。
5. 成功后服务端创建 `published` 角色并激活；前端重置 Create 草稿、刷新角色/联系人并进入新角色 Chat。

## 5. Profile 弹窗身份

状态：`Current`。入口为 App Shell 左下角正式用户卡片；游客点击同一位置进入登录页，不打开 Profile。

- 页面目标：查看/编辑当前正式账号公开昵称与显式球队偏好，查看账号统计、进入允许的后台并退出登录。
- 弹窗先使用 session 快速渲染，再静默调用 Profile 接口补全数据；Tab 切换不重载整页。
- 主要关联目标：当前 `user`、认证 session、用户显式偏好、角色激活、聊天统计、邀请关系。

### Profile tab 字段

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Avatar | 只读头像 + 相机装饰图标 | OAuth 头像缺失时字母占位 | 最近 OAuth 头像或 session | 识别当前账号 | **当前没有头像编辑事件** | 无写入；相机图标不是可上传按钮 | 当前账号、OAuth profile |
| Display name | 单行文本 | 必填；默认 profile/session 昵称 | 普通文本；UI 无 `maxlength`；服务端合并空白并最多 64 字符 | 设置产品内显示名称 | 空值拒绝；保存失败保留输入并显示 error | 写入 `users.nickname`，同步 profile 与前端 session store | 当前账号、session |
| Email | 只读输入框 | 当前账号邮箱 | 认证数据 | 展示登录标识 | 此处不能修改 | 无写入 | 当前账号、认证 |
| Favourite club | 单行文本 | 可空 | 普通文本；服务端合并空白并最多 128 字符 | 保存用户明确声明的球队偏好 | 可清空；不得由 AI 猜测覆盖显式值 | 写入 `users.favorite_club`，可供商品偏好/画像规则读取 | 当前账号、用户画像 |
| Chats | 只读统计卡 | 缺失为 0 | 正式 active user session 中用户消息总数 | 展示用户聊天活跃度 | 不是会话数量；仅统计服务查询口径 | 无写入 | 聊天消息 |
| Legends | 只读统计卡 | 缺失为 0 | active 角色激活数 | 展示已激活角色数量 | 归档/非 active 激活不计 | 无写入 | 角色激活 |
| Kits unlocked | 只读统计卡 | 缺失为 0 | billing log 中 kit/product/merch unlock 去重数 | 展示已解锁商品权益数量 | 不是 Shopify 订单数量 | 无写入 | billing log |
| Save changes | 按钮 | loading/saving 时禁用 | Display name + Favourite club | 保存可编辑资料 | 接口失败显示可理解 error；不修改 Email/Avatar/账号类型 | 成功显示 Saved，并更新 session 中昵称/头像等可用资料 | 当前账号、session |
| Open admin console | 条件按钮 | 仅 admin 显示 | 当前账号类型 | 进入后台 | 非 admin 不渲染，直接 URL 仍由权限层拦截 | 导航 `/admin` | 管理员权限 |
| Creator workspace | 条件按钮代码 | 当前始终隐藏 | creator/admin | 未来进入创作者工作区 | `Hidden`；即使有权限也不显示 | 无操作入口 | Creator Workspace |
| Log out | 按钮 | 正式用户显示 | 当前认证 session | 退出账号 | 即使服务端 logout 失败也记录失败并清理受控前端状态 | 撤销/清理登录态并回同站点登录流程 | 认证 session、站点路由 |
| Close/遮罩 | 按钮/点击遮罩 | 不适用 | 当前弹窗 | 关闭资料面板 | 未保存输入不会自动提交 | 关闭弹窗 | Profile UI |

### Profile 状态

- `loading`：顶部显示 `Loading profile...`，可编辑项和保存按钮禁用。
- `saving`：保存按钮显示 `Saving...` 并防重复提交。
- `success`：显示 `Saved.`，session 与页面用户卡同步。
- `error`：显示读取或保存错误；读取失败时仍可保留已有 session 内容，不能将其写成完整 profile 已加载。
- `unauthenticated`：接口拒绝，游客没有该弹窗。

## 6. Invite code tab

状态：邀请码、统计和复制为 `Current`；Invite via email 为 `Placeholder`。

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Your invite code | 只读文本 | Profile 加载时确保生成；UI 数据缺失时会显示 `AIOVE-0000` 占位 | 当前用户 `referral_code` | 分享邀请身份 | 占位不是有效邀请码，不能当真实 code 使用 | 无写入；真实缺码由 Profile 服务生成 | 当前账号、邀请关系 |
| Copy code | 按钮 | 正常 Profile 读取会先确保生成真实 code | 按钮 `data-invite-code`；异常缺码时页面显示 `AIOVE-0000` | 复制邀请码 | **当前缺口**：Profile 未成功补齐 code 时，事件会回退复制页面显示占位；该占位不是有效邀请码 | 写入系统剪贴板并短暂显示 Copied；正常链路复制真实 code | 当前账号、剪贴板 |
| Friends joined | 只读统计 | 缺失为 0 | 使用当前 referral code 注册的账号数 | 查看邀请人数 | 仅按已记录邀请码关系统计 | 无写入 | 被邀请账号 |
| Credits earned | 只读统计 | 缺失为 0 | 当前实现为每个成功邀请 5 credits 的统计计算 | 展示邀请收益 | 这是当前统计口径，不等于完整可提现/核销系统 | 无写入 | 邀请统计 |
| Copy link | 按钮 | 真实 code 有则带 query；无 code 仅为注册路径 | 当前 origin + `/:siteSlug/register?invite=<code>` | 分享同站点注册链接 | 使用 profile 的站点 slug；不跨站点改写归属 | 复制完整链接 | 站点、注册、邀请关系 |
| Invite via email | 禁用按钮 | 始终禁用 | 无输入 | 表示未来邮件邀请方向 | `Placeholder`；没有收件人、邮件模板或发送接口 | 不发送邮件 | 未来邀请邮件 |

## 7. 权限、站点与数据边界

- Create 的游客可见不等于可写；所有上传、生成、润色和创建接口都要求正式认证。
- Profile/Invite 只读取当前认证用户，前端不能传用户 ID 查看其他账号。
- 显式 Favourite club 是用户确认数据；AI 记忆或购买推断不得覆盖它。
- Public/Private 只控制发现与所有者范围，不能绕过角色 `published/archived` 状态、站点和聊天访问校验。
- 创建角色使用受控 voice preset 和语言库；真实 provider ID、API key、模型凭据不进入页面文档。

## 8. 关联实现与文档

- Create 前端：`src/features/create-character/`、`src/app/app-create-actions.js`、`character-create-actions.js`、`character-avatar-actions.js`。
- Profile 前端：`src/features/profile-modal/`、`src/app/app-profile-actions.js`。
- 前端 service：`src/services/character-service.js`、`upload-service.js`、`profile-service.js`。
- 服务端：`server/character-routes.js`、`character-creation-service.js`、`character-normalizers.js`、`character-polish-service.js`、`image-generation-service.js`、`profile-routes.js`、`profile-service.js`。
- API 索引：[06-api-index.md](../../06-api-index.md)。
- 长期规则：[身份、权限与生命周期](../../../design/02-identity-permissions-and-user-lifecycle.md)、[角色、聊天、记忆与 AI 行为](../../../design/03-characters-chat-memory-and-ai-behavior.md)、[商业、权益与画像](../../../design/04-commerce-promotions-and-profile.md)、[用户侧体验](../../../design/05-user-facing-experience.md)。
- 相邻页面：[认证页面](./01-authentication.md)、[导航与发现](./02-navigation-discover-search.md)、[Creator Workspace](./05-kitshop-feedback-creator.md)。
