# AIOVE 页面与字段规范

更新时间：2026-07-21

本目录是 [AIOVE 产品设计规范](../../DESIGN.md) 的页面实现事实补充，说明当前每个页面、弹窗、字段和操作“用于什么、如何输入、保存后发生什么”。长期业务规则仍以 `docs/design/00-07` 为准；接口、服务、数据表和代码位置以 `docs/system/` 为准。

## 状态

- `Current`：已由当前代码确认。
- `Approved direction`：已确认方向但尚未实现。
- `TBD`：仍需产品决策。
- `Placeholder`：页面存在，但只有静态内容或假数据。
- `Hidden`：代码仍在，但当前导航不开放。

页面另外标记验证范围：`Local verified` 表示本地代码/页面已核验，`Production verified` 表示真实线上链路已核验。`Current` 或 `Implemented` 不能单独理解为已经发布线上。

## 页面文档完整性标准

每一份页面规范必须按真实页面拆分，并覆盖以下内容：

1. **页面身份**：状态、验证范围、入口、适用账号、页面目标和主要关联对象。
2. **字段与控件**：所有输入框、选择器、开关、上传区、按钮、只读值、列表列、筛选器、分页和弹窗字段。
3. **使用方式**：如何输入或选择、是否必填、默认值、允许内容、显示格式和示例。
4. **确定性规则**：前端提示、服务端校验、权限、站点范围、动态选项来源和过滤条件。
5. **结果与关联**：保存或点击后改变什么、写入或读取哪个业务对象、影响哪个前台/角色/账号/活动/会话。
6. **页面状态**：初始、加载、空、成功、失败、禁用、过期和无权限时的用户可见行为。
7. **文档关联**：链接对应长期产品规则、系统说明和必要的相邻页面；不复制完整 API payload、SQL 或部署细节。

### 字段表统一列

页面字段表默认使用下列列；无对应内容时明确写“无”或“不适用”，不能直接省略导致读者误判：

| 列 | 记录内容 |
| --- | --- |
| 字段/控件 | 页面可见名称；无文字控件写明图标含义 |
| 控件与输入方式 | 文本、密码、数字、日期、下拉、单选、多选、开关、上传、只读或按钮 |
| 必填与默认值 | 是否必填、初始选项、空值行为 |
| 允许内容/来源 | 格式、长度、动态选项来源和过滤范围 |
| 用途 | 为什么需要该字段，帮助用户完成什么 |
| 校验与错误 | 前端提示和最终服务端拒绝条件；两者不一致时分别记录 |
| 保存/操作结果 | 成功后页面、数据或状态发生什么变化 |
| 关联目标 | 对应站点、角色、账号、会话、活动、商品、知识库或其他业务对象 |

## 字段记录规则

每个可输入字段至少说明：用途、控件、是否必填、默认值、允许内容/示例、校验和保存效果。只读字段说明数据来源、显示方式和空值。敏感字段只描述格式和处理边界，不记录真实密码、token、密钥或客户数据。

浏览器中的 `required`、`maxlength` 只是前端提示；最终是否可保存以服务端校验为准。若前后端规则不同，文档必须显式写明差异，不能把前端控件当成完整安全边界。

## 完整页面索引

下表按用户实际看到的页面或弹窗列出；多个页面可以由同一份领域文档维护，但不能因为共用文件而省略独立页面的字段和状态。

### 用户侧页面

| 页面/弹窗 | 入口 | 主要目标 | 规范 |
| --- | --- | --- | --- |
| 登录 | `/:siteSlug/login` | 建立正式登录态并保留站点上下文 | [01-authentication.md](./user/01-authentication.md) |
| 注册 | `/:siteSlug/register` | 创建当前站点账号、校验邀请码并承接允许的数据 | [01-authentication.md](./user/01-authentication.md) |
| 忘记密码 | `/:siteSlug/forgot-password` | 通过邮箱验证码重设密码 | [01-authentication.md](./user/01-authentication.md) |
| App Shell/侧栏/顶栏 | 正式账号及已启用游客模式的站点页面外壳 | 提供页面导航、角色通讯录、主题和账号入口 | [02-navigation-discover-search.md](./user/02-navigation-discover-search.md) |
| Discover | `/:siteSlug/discover` | 发现并激活当前站点可见角色 | [02-navigation-discover-search.md](./user/02-navigation-discover-search.md) |
| 角色确认弹窗 | Discover 角色卡 | 激活新角色或继续已有会话；Search 的角色结果按独立规则处理 | [02-navigation-discover-search.md](./user/02-navigation-discover-search.md) |
| Search | `/:siteSlug/search` | 搜索当前站点角色与可信商品 | [02-navigation-discover-search.md](./user/02-navigation-discover-search.md) |
| 404/无权限 | `/:siteSlug/404` 或权限降级 | 阻止越权并提供返回入口 | [02-navigation-discover-search.md](./user/02-navigation-discover-search.md) |
| 全局提示/确认弹窗 | 页面操作成功、失败、警告或二次确认时 | 显示确定性结果并执行确认/取消回调 | [02-navigation-discover-search.md](./user/02-navigation-discover-search.md) |
| Chat | `/:siteSlug/chat?agent=` | 与指定角色进行文字、语音、附件、图片和商品对话 | [03-chat-product-call.md](./user/03-chat-product-call.md) |
| 附件图片预览 | Chat 图片附件 | 在受保护资源权限内查看原图和文件名 | [03-chat-product-call.md](./user/03-chat-product-call.md) |
| 商品详情面板 | Chat/Search/Call 的商品卡 | 查看可信商品详情、规格与外部购买入口 | [03-chat-product-call.md](./user/03-chat-product-call.md) |
| 实时通话 | Chat 内通话按钮 | 以连续语音交互复用角色和会话上下文 | [03-chat-product-call.md](./user/03-chat-product-call.md) |
| Create Character | `/:siteSlug/create` | 创建属于当前账号的角色 | [04-create-profile.md](./user/04-create-profile.md) |
| AI 头像生成弹窗 | Create/后台角色编辑器 | 生成候选头像并回填角色表单 | [04-create-profile.md](./user/04-create-profile.md) |
| 头像安全检查/裁剪弹窗 | Create/后台角色或前台头像上传与 AI 候选图 | 审核、定位、缩放并输出受控头像 | [04-create-profile.md](./user/04-create-profile.md) |
| Profile | App Shell 用户卡 | 查看和编辑个人资料、退出登录 | [04-create-profile.md](./user/04-create-profile.md) |
| Invite code | Profile 内标签 | 查看和复制邀请链接/邀请码 | [04-create-profile.md](./user/04-create-profile.md) |
| Kitshop | `/:siteSlug/kitshop` | 浏览当前站点可信商品货架 | [05-kitshop-feedback-creator.md](./user/05-kitshop-feedback-creator.md) |
| 用户反馈弹窗 | 顶部反馈入口 | 提交问题、建议或其他反馈 | [05-kitshop-feedback-creator.md](./user/05-kitshop-feedback-creator.md) |
| Creator Workspace | `/:siteSlug/creator` | 展示当前创作者角色的真实互动与商品转化表现 | [05-kitshop-feedback-creator.md](./user/05-kitshop-feedback-creator.md) |

### 后台页面

| 页面 | `view` | 主要目标 | 规范 |
| --- | --- | --- | --- |
| 概览 | `overview` | 查看商品消息气泡漏斗与商品表现排行 | [01-overview-characters.md](./admin/01-overview-characters.md) |
| 网红角色 | `creatorCharacters` | 管理创作者账号绑定的角色 | [01-overview-characters.md](./admin/01-overview-characters.md) |
| 通用角色 | `commonCharacters` | 管理平台和站点公共角色 | [01-overview-characters.md](./admin/01-overview-characters.md) |
| 站点管理 | `sites` | 配置站点归属、路由、商品源、支付与游客能力 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| 站外嵌入 | `externalEmbeds` | 维护外部独立站的 ALOVE 启动图、角标、引导弹窗和安装代码 | [07-external-embed.md](./admin/07-external-embed.md) |
| 前台管理 | `mascot` | 管理每个站点前台角色及手动广告投放 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| 首页轮播 | `carousel` | 配置当前站点 Discover 轮播和角色目标 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| 轮播图片裁剪弹窗 | 首页轮播图片上传 | 定位、缩放并输出 16:9 Banner 图片 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| Kitshop 管理 | `kitshop` | 查看/刷新站点商品货架缓存 | [03-commerce-knowledge.md](./admin/03-commerce-knowledge.md) |
| 广告活动 | `promotionCampaigns` | 配置活动范围、可信商品、时间和主动文案 | [03-commerce-knowledge.md](./admin/03-commerce-knowledge.md) |
| 知识库 | `kb` | 管理全局/站点/角色知识内容 | [03-commerce-knowledge.md](./admin/03-commerce-knowledge.md) |
| 用户反馈 | `feedback` | 筛选、查看和处理反馈 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 账号管理 | `accounts` | 管理正式账号、权限、站点、状态和会话 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 游客会话 | `accounts` 内标签 | 查看游客会话、额度和对话记录 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 错误日志 | `logs` | 检索和定位前后端错误记录 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 商家线索 | `leads` | `Placeholder`，仅展示待办方向 | [05-placeholders-hidden.md](./admin/05-placeholders-hidden.md) |
| 折扣码 | `codes` | `Current / Local verified`，登记和管理独立站已有折扣码 | [06-discount-codes.md](./admin/06-discount-codes.md) |
| 交易支付 | `payments` | `Placeholder`，仅展示待办方向 | [05-placeholders-hidden.md](./admin/05-placeholders-hidden.md) |
| 成本与利润 | `costs` | `Placeholder`，仅展示待办方向 | [05-placeholders-hidden.md](./admin/05-placeholders-hidden.md) |
| AI 角色卡 | `agents` | `Hidden`，代码保留但后台导航不开放 | [05-placeholders-hidden.md](./admin/05-placeholders-hidden.md) |

### 后台弹窗与明细视图

| 弹窗/明细 | 入口 | 主要目标 | 规范 |
| --- | --- | --- | --- |
| 网红角色新建/编辑 | 网红角色列表 | 配置 owner、站点继承、头像和角色私有设定 | [01-overview-characters.md](./admin/01-overview-characters.md) |
| 通用角色新建/编辑 | 通用角色列表 | 配置分类、可见性、状态、头像和角色私有设定 | [01-overview-characters.md](./admin/01-overview-characters.md) |
| 站点新建/编辑 | 站点管理 | 配置路由、地区、前台、游客、商品源和支付方式 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| 前台/通用模板编辑 | 前台管理 | 配置站点前台身份、人设、问候语和知识绑定 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| 手动广告投放 | 前台管理“发广告” | 选择同站点有效活动并查看真实任务进度与结果 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| 轮播新建/编辑及图片裁剪 | 首页轮播 | 配置 Banner 内容、目标、状态和 16:9 图片 | [02-sites-mascot-carousel.md](./admin/02-sites-mascot-carousel.md) |
| 广告活动新建/编辑 | 广告活动 | 配置站点、商品、时间、匹配和主动文案 | [03-commerce-knowledge.md](./admin/03-commerce-knowledge.md) |
| 知识文档新建/编辑及 AI 等待 | 知识库 | 配置检索范围、内容和 AI 生成状态 | [03-commerce-knowledge.md](./admin/03-commerce-knowledge.md) |
| 反馈展开详情 | 用户反馈列表 | 查看正文、来源页面和审计字段 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 账号新增/编辑/重置密码 | 账号管理 | 管理正式登录身份、昵称、角色类型和凭据 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 账号批量修改 | 账号管理批量操作 | 修改选中账号的站点、身份或状态 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 正式账号对话列表/详情 | 正式账号展开“查看对话” | 搜索会话并只读审计最近消息 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |
| 游客会话详情/对话 | 游客会话展开 | 查看 guest 额度、能力使用、承接状态和游客阶段消息 | [04-feedback-accounts-logs.md](./admin/04-feedback-accounts-logs.md) |

## 维护要求

1. 页面新增、删除或改变字段时，同一批次更新对应页面规范。
2. 页面规范记录用户可见行为，不复制 CSS、完整 API payload 或 SQL。
3. 选项来自动态数据时，记录来源和过滤规则，不抄写会变化的真实数据。
4. 静态、隐藏、未接后端能力必须标记状态，不能写成可用功能。
5. 验证时至少对照页面模板、controller/validation、服务端写接口和真实页面状态。
