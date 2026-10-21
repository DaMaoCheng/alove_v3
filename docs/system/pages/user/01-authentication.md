# 用户侧：登录、注册与密码重置

更新时间：2026-07-17

实现状态：`Current`。验证范围：`Local verified`（已对照页面模板、前端 action/service、认证路由、服务端校验、站点归属和游客承接代码；本轮未重新执行真实邮件与 Google Provider 链路）。

Shopify Customer Account OAuth 已确认为 `Approved direction`，但授权、callback、账号匹配和外部商城绑定实现仍为 `TBD`；AIOVE 邮箱免密登录同样尚未实现，见 [登录与外部商城身份方案评估](../../../superpowers/specs/2026-07-13-login-and-commerce-identity-options.md)。当前仅对已在站点管理配置 Shopify 只读 Token 且开启“站点授权登录”的站点显示统一品牌按钮作为本地预览；没有 Token 或开关关闭时完全隐藏，没有真实 OAuth action 时按钮保持禁用。本文件只把 AIOVE 邮箱密码与 Google OAuth 记为当前可操作认证能力。

## 1. 共同页面外壳与认证边界

### 1.1 页面目标与适用身份

登录、注册、忘记密码页共用认证外壳，供未登录访问者建立或恢复 AIOVE 正式账号。已登录用户直接访问认证页时，启动恢复流程会先用服务端 cookie 校验身份，再进入联系人聊天或 Discover，不把认证表单当作账号切换器。

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AIOVE Logo | 只读品牌标识 | 不适用 | 项目内 Logo 组件 | 标识认证入口 | 无 | 无数据写入 | AIOVE 前端 |
| Hero eyebrow、标题、说明、Highlights | 只读文案 | 固定展示；窄屏可按样式折叠 | 页面模板内静态英文文案 | 说明产品定位 | 无后端数据来源 | 无数据写入 | 登录、注册、重置密码共用外壳 |
| 主题切换 | 图标按钮 | 默认 `dark`；若本机已有主题偏好则恢复 | `dark` / `light` | 切换认证页主题 | 本地存储不可用时仍切换当前页面，但不能持久化 | 写入浏览器 `aiove_color_theme`；不提交认证接口 | 当前浏览器主题偏好 |

### 1.2 共同认证与存储规则

- 认证凭证只通过 HttpOnly cookie 发送；前端不读取 token，也不把 token 写入 URL、`localStorage` 或页面日志。
- `localStorage` 中的 `aiove_session` 只缓存 `authenticated`、账号展示信息、余额和站点信息，用于页面状态；启动时仍以 `GET /api/auth/me` 和 cookie 为最终身份依据。
- 任一使用通用 HTTP client 的请求收到 `401` 会触发全局认证过期事件：清理本地 session、聊天/资料状态和弹窗，再回当前有效站点的登录页。
- 页面语言由当前站点页面语言决定；当前认证模板字段名和主要文案为英文。
- 注册与密码重置页有未提交内容时，应用内离开会弹出确认框，浏览器刷新/关闭使用原生离开提示；成功提交后解除保护。登录页没有该离开保护。

## 2. 登录页

### 2.1 页面身份

- 路由：`/:siteSlug/login`
- 状态：`Current`
- 页面目标：用现有 AIOVE 邮箱密码或 Google 身份建立正式 session；如果浏览器带有可承接 guest cookie，同时处理游客会话承接。
- 适用身份：未登录访问者；已登录访问者会被恢复流程带离本页。
- 主要数据目标：`users` 当前账号、账号的单一有效认证 token、当前站点上下文、可承接 guest session、聊天联系人。

### 2.2 字段与控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Email | `type=email` 单行输入；占位 `you@email.com`；`autocomplete=username` | 服务端必填；页面没有 `required` 属性 | 完整邮箱；提交前去首尾空格，服务端转小写 | 查找 AIOVE 账号 | 浏览器校验非空值的邮箱格式；服务端对无效邮箱、空密码、账号不存在、封禁账号和错误密码统一返回 `Invalid email or password.` | 与密码一起提交；不单独保存 | `users.email` |
| Password | 密码输入；`autocomplete=current-password` | 服务端必填；默认空 | 当前 AIOVE 密码；前端不裁剪、不持久化 | 验证账号密码 | 服务端校验安全哈希；错误进入登录失败计数 | 成功后签发新 session；明文不保存 | `users.password_hash`、认证 session |
| Show / Hide | 文本按钮 | 默认 `Show` | 只切换当前密码框 `password` / `text` | 方便检查输入 | 目标输入框不存在时不执行 | 不修改密码内容、不调用接口 | Password 控件 |
| Remember me | 复选框 | 默认勾选 | 勾选 / 不勾选 | 选择本次 session 目标有效期 | 最终仍受账号状态、服务端 token 更新和主动撤销影响 | 勾选为 7 天；不勾选为 12 小时 | `users.auth_token`、`token_expires_at`、认证 cookie |
| Forgot? | 文本按钮 | 不适用 | 固定入口 | 找回密码 | 无 | 进入同站点 `forgot-password` | 忘记密码页 |
| Enter the Arena | 表单提交按钮 | 初始可用；提交中禁用 | 使用 Email、Password、Remember me | 发起邮箱密码登录 | 提交中显示 `Signing in...`，防止同一表单重复点击；失败恢复按钮 | 成功后写 cookie、刷新余额/角色/联系人并路由 | AIOVE session、聊天联系人 |
| Continue with Google | 按钮 | 初始可用 | 当前路径解析出的 `siteSlug` | 发起 Google OAuth 登录/注册 | Provider 未配置返回 503 说明页；state 错误、取消、过期或 Provider 失败进入独立错误页 | 跳转 `/api/auth/google/start?siteSlug=...` | Google OAuth、AIOVE 账号、当前站点 |
| 站点 Customer Account | 品牌按钮；右上角 Shopify SVG 斜角标签 | 仅当 `hasProductAccessToken=true` 且 `shopifyLoginEnabled=true` 时渲染；当前显示但禁用；页面收到真实 `onSiteLogin` action 后自动可用 | 当前站点 `name/logoUrl/siteUrl/hasProductAccessToken/shopifyLoginEnabled` | 预览未来 Shopify Customer Account OAuth 入口 | 无 Token 或后台关闭开关时完全隐藏；禁用状态带配置中 title，不触发跳转；Logo 按统一品牌 fallback | 当前尚无跳转或写入 | 统一站点品牌、站点商品源配置、未来 Shopify OAuth |
| Create your account | 文本按钮 | 不适用 | 固定入口 | 新用户注册 | 无 | 进入同站点 `register` | 注册页 |
| 认证错误区 | 只读 `role=alert` 文本 | 默认隐藏 | 前端安全错误转换结果 | 告知登录失败 | `Current implementation gap`：接口对凭证错误使用统一文案，但通用 HTTP client 会先把登录接口的 `401` 当作全局 session 过期事件并重新挂载登录页；旧表单随后得到的错误文本可能不再可见 | 非 `401` 校验/网络错误在当前表单显示；凭证 `401` 可能只表现为表单被重置 | 当前登录请求 |

### 2.3 页面操作与状态流转

1. 用户提交邮箱密码；前端记录不含明文密码的行为字段并调用登录接口。
2. 服务端按邮箱和请求 IP 检查登录失败桶：同邮箱 5 次/15 分钟或同 IP 20 次/15 分钟达到限制后，锁定对应桶 15 分钟并返回 `429`。
3. 账号必须存在、`account_status=active` 且密码哈希匹配。登录成功会清理本次邮箱/IP 的失败桶。
4. 没有 guest cookie 时直接签发 session；有 guest cookie 时先锁住 guest 回复链路，在事务中尝试承接。
5. 同站点 guest 承接成功时激活前台角色并保留承接会话；已有账号跨站点登录不会更改账号 `site_id`，guest 会话不迁移，并在登录后显示站点不匹配提示。
6. 登录完成后优先进入本次承接角色；否则进入服务端联系人数组第一项；没有联系人进入 Discover。当前没有“最后聊天对象”选择逻辑。

### 2.4 空、加载、成功与错误状态

| 状态 | 当前页面行为 |
| --- | --- |
| 初始 | 表单为空，Remember me 勾选，错误区隐藏。 |
| 提交中 | 主按钮禁用并显示 `Signing in...`。Google 按钮和其他导航按钮没有随邮箱登录提交统一禁用。 |
| 凭证错误 | 服务端返回统一 `401`，不区分邮箱不存在或密码错误；当前通用 HTTP client 会先触发全局认证过期并重新挂载登录页，因此旧表单的错误提示可能不可见，用户可能只看到表单被清空。 |
| 频率限制 | 显示服务端安全文案 `Too many sign-in attempts. Please try again later.`。 |
| 网络/服务异常 | 显示站点语言对应的安全 fallback，不暴露堆栈、SQL 或 Provider 细节。 |
| 成功 | 表单页被 App Shell 替换；根据联系人规则进入 Chat 或 Discover。 |

## 3. 注册页

### 3.1 页面身份

- 路由：`/:siteSlug/register`
- 状态：`Current`
- 页面目标：验证邮箱控制权、创建 AIOVE personal 账号、建立站点归属、初始化计费账号、激活前台或承接同站点游客会话，并自动登录。
- 适用身份：未登录访问者和从游客受限操作进入的访问者。
- 主要数据目标：`users`、`billing_accounts`、邀请码归因、角色激活、guest claim、认证 session。

### 3.2 字段与控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Display name | 单行文本；`autocomplete=name` | 可空；默认空 | 任意文本；服务端压缩连续空白、去首尾空格并截到 64 字符 | 设置账号显示昵称 | 页面没有 `maxlength`；空值由服务端使用邮箱 `@` 前部分 | 保存为 `nickname` | 用户资料、侧栏和 Profile 显示名 |
| Email | `type=email`；`autocomplete=email` | 必填；默认空 | 完整邮箱；服务端转小写 | 作为唯一登录邮箱并接收验证码 | 失焦、发送验证码前、提交前调用可用性接口；邮箱已占用或检查接口失败都会阻止当前操作；服务端注册事务再次检查唯一性 | 保存为账号邮箱、用户名和平台 UID；标记邮箱已验证 | `users.email`、邮件验证码 |
| Verification code | 文本输入；`inputmode=numeric`；占位 `6-digit code` | 必填；默认空 | 当前邮箱、`register` scene 最新一条未消费的 6 位邮件验证码 | 证明邮箱控制权 | 页面没有长度/纯数字属性；服务端验证码 10 分钟有效，错误最多 5 次，错误/过期统一提示；不能跨 scene 使用 | 成功注册时在事务内标记已消费 | `email_verification_codes` |
| Send code / Resend | 按钮 | 初始 `Send code` | 使用 Email；成功后前端 60 秒倒计时 | 请求注册验证码 | 同邮箱同 scene 60 秒冷却、每小时最多 6 次；同 IP 每小时最多 30 次；邮箱已注册、格式错误、邮件 Provider 失败均拒绝 | 成功后显示 `Resend (60s)` 倒计时；不等于注册完成 | 注册邮件验证码 |
| Password | 密码输入；`autocomplete=new-password` | 必填；默认空 | 至少 8 字符，且包含至少一个英文字母和一个数字 | 创建 AIOVE 密码 | 前端提交前和服务端均执行相同基础策略；不符合时字段标红并显示具体文案 | 服务端仅保存安全哈希 | `users.password_hash` |
| Password Show / Hide | 文本按钮 | 默认 `Show` | 显示 / 隐藏 | 检查输入 | 无业务校验 | 不保存 | Password 控件 |
| Confirm password | 密码输入；`autocomplete=new-password` | 必填；默认空 | 必须与 Password 完全一致 | 防止误输 | 两个密码都非空且失焦后不一致会提示；提交时再次前端检查，服务端最终校验 | 不独立保存 | Password 控件 |
| Confirm Show / Hide | 文本按钮 | 默认 `Show` | 显示 / 隐藏 | 检查确认密码 | 无业务校验 | 不保存 | Confirm password 控件 |
| Invite / activation code | 单行文本 | 可空；默认空；URL 有值时预填并只读 | `?invite=` 或 `?inviteCode=`；手工输入允许文本，服务端去全部空白、转大写、最多 64 字符 | 记录同站点邀请归因 | 必须对应 active 邀请人且邀请人有站点；邀请码站点必须等于本次注册解析出的站点；无效或跨站拒绝整个事务 | 有效时写入 `used_referral_code`；不改变显式站点路径 | 邀请人、用户归属站点 |
| Terms | 普通链接 `/terms` | 无独立同意勾选框 | 固定链接 | 展示服务条款入口 | `TBD`：当前没有专用 Terms 页面实现 | 当前点击进入未识别路由/404，而非已完成法律页面 | 法律页面（未实现） |
| Privacy Policy | 普通链接 `/privacy` | 无独立同意勾选框 | 固定链接 | 展示隐私政策入口 | `TBD`：当前没有专用 Privacy 页面实现 | 当前点击进入未识别路由/404，而非已完成法律页面 | 法律页面（未实现） |
| Create account | 表单提交按钮 | 初始可用；提交中禁用 | 汇总全部注册字段和当前 `siteSlug` | 创建账号 | 提交中显示 `Creating account...`；任一服务端校验、站点、邀请码或 guest claim 冲突会回滚事务 | 成功创建账号、计费账户、激活角色并签发 7 天 session | 用户、站点、角色、guest、billing |
| Continue with Google | 按钮 | 初始可用 | 当前 `siteSlug` | 不填写邮箱表单也可注册/登录 | 走 Google OAuth 独立校验 | 新 Google 用户创建 personal 账号；已有身份登录 | Google OAuth、用户、站点 |
| Sign in | 文本按钮 | 不适用 | 固定入口 | 返回登录 | 表单已改动时弹出离开确认 | 确认后进入同站点登录页 | 登录页 |

### 3.3 注册事务与站点规则

1. 服务端先校验邮箱、密码、确认密码和验证码存在，再取得 guest 回复锁并开始数据库事务。
2. 事务内再次检查邮箱占用，消费 `register` scene 验证码，再解析 active 站点和邀请码。
3. 创建 personal 用户及余额为 0 的 billing account。
4. 同站点 guest 可原子承接并激活 guest 前台角色；没有可承接 guest 时激活注册站点的当前前台。
5. guest 站点不匹配在注册场景为严格冲突，会回滚账号创建；不会留下“账号已创建但游客历史未承接”的半完成状态。
6. 成功签发 7 天 session；优先进入承接角色，否则进入联系人第一项，没有联系人进入 Discover。

`Current implementation note`：`resolveRegistrationSite` 在请求 slug 找不到 active 站点时会回退到数据库默认 active 站点。该行为与“显式有效站点路径固定归属”的长期规则存在边界差异，本轮只记录，不修改实现。

### 3.4 页面状态

| 状态 | 当前页面行为 |
| --- | --- |
| 初始 | 全部字段为空；邀请码 URL 有值时预填、只读并标记来源。 |
| 邮箱检查中 | 没有独立 loading 文案；当前操作等待检查结果。 |
| 验证码发送中 | 按钮禁用并显示 `Sending...`；成功进入 60 秒倒计时。 |
| 字段错误 | Email、Code、Password 使用各自错误区；无法分类的注册错误当前回落到 Email 错误区。 |
| 密码不一致 | 两个密码框标红并显示 `Passwords do not match.`。 |
| 提交中 | Create account 禁用并显示 `Creating account...`。 |
| 成功 | 标记表单已提交，认证页被 Chat 或 Discover 替换。 |
| 失败 | 不创建部分账号；按钮恢复，保留用户已输入内容和离开保护。 |

## 4. 忘记密码页

### 4.1 页面身份

- 路由：`/:siteSlug/forgot-password`
- 状态：`Current`
- 页面目标：通过独立 `forgot_password` 邮件验证码重设现有 AIOVE 邮箱账号密码。
- 适用身份：未登录访问者。
- 主要数据目标：现有 `users.password_hash`、认证 token、忘记密码验证码。

### 4.2 字段与控件

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Email | `type=email`；`autocomplete=email` | 必填；默认空 | 现有 AIOVE 邮箱；服务端转小写 | 确定重置账号并接收验证码 | `Current`：发送验证码和最终重置都会明确返回 `No account exists for this email.`；当前没有防账号枚举的统一成功响应 | 不直接修改账号 | `users.email`、忘记密码验证码 |
| Verification code | 文本输入；`inputmode=numeric` | 必填；默认空 | 当前邮箱、`forgot_password` scene 最新未消费的 6 位验证码 | 验证邮箱控制权 | 10 分钟有效，错误最多 5 次；不能复用注册验证码 | 成功重置时标记消费 | `email_verification_codes` |
| Send code / Resend | 按钮 | 初始 `Send code` | 使用 Email | 请求忘记密码验证码 | 同邮箱/scene 60 秒冷却、每小时 6 次；同 IP 每小时 30 次；账号不存在会明确拒绝 | 成功后 60 秒倒计时 | 忘记密码邮件验证码 |
| New password | 密码输入；`autocomplete=new-password` | 服务端必填；默认空 | 至少 8 字符，包含字母和数字 | 设置新密码 | 页面仅展示策略说明，没有注册页同款本地策略函数；服务端最终强制校验 | 保存为新安全哈希 | `users.password_hash` |
| New password Show / Hide | 文本按钮 | 默认 `Show` | 显示 / 隐藏 | 检查输入 | 无业务校验 | 不保存 | New password |
| Confirm new password | 密码输入；`autocomplete=new-password` | 服务端必填；默认空 | 必须与 New password 一致 | 防止误输 | 前端失焦/提交检查一致性；服务端最终再次校验 | 不独立保存 | New password |
| Confirm Show / Hide | 文本按钮 | 默认 `Show` | 显示 / 隐藏 | 检查确认密码 | 无业务校验 | 不保存 | Confirm new password |
| Reset password | 表单提交按钮 | 初始可用；提交中禁用 | 汇总 Email、Code、两次密码 | 执行密码重置 | 提交中显示 `Resetting...`；错误显示在统一错误区 | 更新密码哈希并把账号当前 `auth_token`、`token_expires_at` 置空 | 用户认证状态 |
| Back to sign in | 文本按钮 | 不适用 | 固定入口 | 返回登录 | 表单已改动时弹出离开确认 | 确认后进入同站点登录页 | 登录页 |

### 4.3 状态流转

1. 用户请求 `forgot_password` scene 验证码；发送规则与注册 scene 分开统计和消费。
2. 用户提交验证码和新密码；服务端再次确认账号存在、校验密码策略、消费验证码并更新密码哈希。
3. 更新同时撤销账号当前存储的认证 token；其他浏览器若还持有旧 cookie，下一次受保护请求会收到 `401`。
4. 成功后页面显示 `Password reset successfully. Please sign in with your new password.`、清空表单并解除离开保护，约 1.2 秒后进入同站点登录页；不会自动登录。

### 4.4 页面状态

| 状态 | 当前页面行为 |
| --- | --- |
| 初始 | 字段为空，统一消息区隐藏。 |
| 发送验证码中 | Send code 禁用并显示 `Sending...`。 |
| 倒计时 | 成功后显示 `Resend (60s)` 至可再次请求。 |
| 密码不一致 | 两个密码字段标红并显示一致性错误。 |
| 提交中 | Reset password 禁用并显示 `Resetting...`。 |
| 成功 | 显示成功消息、清空表单、1.2 秒后回登录。 |
| 失败 | 显示安全转换后的服务端错误并保留当前输入；按钮恢复。 |

## 5. Google OAuth 共用流程

状态：`Current when configured`。登录页和注册页共用同一按钮和回调链路。

| 阶段/控件 | 当前规则 | 成功结果 | 失败结果 |
| --- | --- | --- | --- |
| Start | 保存随机 state 和当前站点 slug cookie，最长 10 分钟；请求 `openid email profile`，每次显示 Google 账号选择 | 跳转 Google | 未配置时返回 503 独立说明页 |
| Callback state | 回调 `state` 必须等于 cookie | 继续换 token 和读取 profile | 取消、缺失、过期或不匹配显示独立错误页并提供同站点登录链接 |
| 身份匹配 | 先按 Google provider user id 查找；没有时按邮箱查找现有 AIOVE 用户 | 已有 OAuth 直接登录；同邮箱现有账号新增 Google 绑定；全新邮箱创建 personal 用户 | Google 信息缺失或 Provider 请求失败拒绝 |
| 站点与 guest | 新用户按当前站点注册且 strict guest site match；现有用户保留原 `site_id`，跨站 guest 不迁移 | guest 承接成功优先回角色 Chat；否则进入最近激活角色或 Discover | 跨站现有账号登录成功但显示 guest 不匹配提示 |
| Session | 固定签发 7 天 session | 设置 HttpOnly cookie | 失败不建立登录态 |

## 6. 权限、站点与数据边界

- 邮箱注册只创建 `personal`，不能从前端字段自选 creator/admin。
- 登录不会根据当前路径改写已有账号 `site_id`；认证后普通账号使用自身归属站点。
- 注册的站点来源是当前前端传入 `siteSlug`，服务端必须解析 active 站点；邀请码只能校验当前解析站点，不能跨站改写。
- guest cookie 只有在请求来自配置的公开 App Origin 时才允许参与登录/注册承接；cookie token 不出现在请求 body 或 URL。
- Google OAuth 的 state、站点临时 cookie 和 guest cookie 都由服务端读取；页面不接触 OAuth client secret、access token 或 guest token。
- 当前用户表只保存一个认证 token 哈希；新 session 会覆盖旧 token，因此不是独立多设备 session 表模型。

## 7. 已确认的未完成项与实现差异

| 项目 | 状态 | 当前事实 |
| --- | --- | --- |
| Shopify Customer Account OAuth / 外部商城绑定 | `Approved direction` / `TBD implementation` | 登录页已按站点 Token 状态加入禁用品牌预览，但尚未进入服务端授权、callback、账号匹配和绑定链路。 |
| AIOVE 邮箱验证码免密登录 | `TBD` | 当前验证码只用于注册和密码重置。 |
| Terms / Privacy 页面 | `TBD` | 链接存在，专用页面不存在，也没有独立同意勾选框。 |
| 忘记密码账号枚举保护 | `TBD` | 当前发送验证码和重置接口都会明确说明邮箱不存在。 |
| 登录凭证错误页面反馈 | `Current implementation gap` | 服务端统一凭证错误已实现，但前端把登录 `401` 先当作全局 session 过期并重挂页面，旧表单错误可能不可见。 |
| 无效/停用显式站点的注册归属 | `Current implementation gap` | 服务端当前会回退默认 active 站点；与显式有效路径固定站点的长期规则需后续统一。 |

## 8. 关联文档与实现位置

- 长期产品规则：[路由与站点上下文](../../../design/01-navigation-and-site-context.md)、[身份、权限与用户生命周期](../../../design/02-identity-permissions-and-user-lifecycle.md)、[集成与数据治理](../../../design/07-integrations-and-data-governance.md)
- 系统说明：[Frontend Pages](../../02-frontend-pages.md)、[Backend Services and Data](../../04-backend-services-and-data.md)、[API Index](../../06-api-index.md)
- 游客承接规格：[游客聊天与认证承接规格](../../../superpowers/specs/2026-07-10-guest-chat-and-auth-handoff-design.md)
- 主要前端：`src/pages/login/`、`src/pages/auth/`、`src/app/app-session-actions.js`、`src/services/auth-service.js`、`src/store/session-store.js`
- 主要服务端：`server/auth-routes.js`、`server/auth-service.js`、`server/auth-session-service.js`、`server/email-code-service.js`、`server/google-auth-service.js`、`server/registration-site-service.js`、`server/guest-auth-claim-service.js`
