# Guest Chat And Auth Handoff Design

## Goal

让从任意站点入口进入 AIOVE 的未认证访问者，先与该站点前台获得和正式账号一致的聊天交互能力，再通过同一位置的登录或注册承接为正式用户。承接后保留站点和完整聊天历史。

本规格覆盖游客聊天能力与认证承接，不覆盖外部商城 SSO、账号绑定、订单同步或优惠码体系。

## Product Decisions

- Guest 可选择当前冻结站点内所有公开、已发布且本站可见的角色聊天；不得跨站点、使用私有/未发布角色或绕过 Creator 的站点可见性。角色创建始终需要认证。
- Guest 可以浏览公开的 Discover、Search、只读 Kitshop、商品详情和 Create 页面；Create 的上传、AI 润色/生成和正式创建，以及个人资料编辑、主动消息、优惠领取、结算和后台操作仍要求正式认证。
- Guest 聊天开放文字、AI 语音回复、用户语音输入、附件上传、实时通话、商品消息和图片生成。交互能力复用正式账号链路，身份、额度、资源和记忆边界保持独立。
- 每个 Guest 角色会话的文字、语音输入和附件消息独立使用 **30 条用户消息 / 滚动 24 小时**。第 20 条成功消息后显示不打断聊天的注册提示；第 30 条后停止该角色发送并显示登录与注册入口，不影响其他角色。
- 另设服务端成本护栏：同一 guest 角色会话最多 10 条文字/语音/附件用户消息 / 10 分钟；IP/网络仅作短期匿名辅助限速，不能作为身份或站点判断。
- Guest 实时通话不设置分钟额度。每次成功落库的最终用户转写按 1 条计入当前角色的 **30 条 / 滚动 24 小时**；同一 guest session 和同一网络同时只能存在一通 active call，重连与重复回合不能重置或重复消耗消息额度。
- AI 开场白和每条 AI 文字回复生成与正式账号相同的角色语音，不单独扣用户消息额度；TTS 失败必须降级为文字成功，不能重复扣额或复制回复。
- 每个 guest session 的唯一会话允许 **1 次图片生成**，复用现有正式用户图片触发、安全审核、Prompt 与参考素材规则。只有图片资产成功保存为 `ready` 才消耗该资格；失败、审核拒绝、超时或存储失败均不消耗。
- Guest 可以在明确商品意图下接收当前站点可信商品源的商品卡和对应简短角色回复；商品卡、模型上下文和页面均不得包含折扣码、活动优惠或个性化权益。
- 认证引导同时提供 Login 与 Register。认证成功后保持原站点；登录已有账号不能改变该账号原有站点归属。
- Guest session 有效期为 14 天；到期、主动注销或成功承接后不能再读取旧 guest 会话。实际清理任务可延后实现，但过期状态必须即时拒绝访问。

## Non-goals

- 不创建临时 `users` 账号，不导入外部商城用户，也不复制商城密码。
- 不开放角色创建写入、商品结算、优惠码、邀请返利、主动消息或后台能力；Create 页面只提供认证前预览，不调用受保护写接口。
- 不在游客期间写入用户长期记忆、画像、会话摘要、搜索索引、促销投放、订单记录或用户级统计。
- 不在本期实现外部商城账号绑定、订单导入、SSO、优惠码生成、核销或归因。

## Entry And Site Rules

1. 访问 `/:siteSlug/chat` 或带 `agent` 参数的聊天入口时，服务端先校验路径站点为 active，并解析该站点前台。
2. 若未认证，则创建或恢复该浏览器当前有效的 guest session；session 创建时冻结 `site_id` 和 `mascot_character_id`。
3. 后续 guest API 只从 session 读取站点和 guest ID；角色 ID 仅可作为“本站公开且已发布角色”的选择键，服务端必须重新验证其站点可见性和所有权，不能信任客户端 `siteSlug`、`guestId` 或 local storage。
4. 非当前站点、私有/未发布或不符合 Creator 站点范围的角色 ID 均返回同一不可用响应，不泄露其他站点或角色信息。
5. 刷新、认证引导和认证完成后均保留初始站点；IP/默认站点不覆盖显式路径或 session 已冻结的站点。

## Identity And Storage Model

### Guest session

新增独立 `guest_sessions`，至少包含：

- `id`：内部 ID；不对客户端暴露。
- `token_hash`：高熵随机 token 的 hash；数据库不保存原 token。
- `site_id`、`mascot_character_id`：创建时绑定；`guest_character_sessions` 以 `(guest_session_id, character_id)` 保存每个角色的独立聊天会话、24 小时额度和短时限速状态。
- `status`：`active`、`claiming`、`claimed`、`expired`、`revoked`。
- `expires_at`、`message_window_started_at`、`message_count`、时间戳。
- `claimed_user_id`、`claimed_at`、`target_chat_session_id`：承接成功后的审计与幂等恢复信息。

浏览器只通过 host-only、`Path=/; HttpOnly; SameSite=Lax; Secure`（生产）cookie 携带不透明 token。不得把 token 或内部 session ID 写入 URL、localStorage、日志、前端状态持久化或请求 body。创建 session 与承接成功后都旋转/撤销旧 token。

### Chat storage

在 `chat_sessions` 创建 `source_type='guest'`、`internal_uid=NULL` 的受限会话，并以 `guest_character_sessions` 关联所属 guest 与角色。Guest 消息可写入该会话，但不得进入依赖 `users` 外键的 message index、memory、summary 或 proactive 任务；图片、语音、附件和通话任务必须显式支持 guest 所有权。

每条 guest 用户消息必须携带 `clientMessageId`；对 `(guest_session_id, clientMessageId)` 建唯一约束。重复请求返回第一次的处理结果，不新增消息、不重复调用模型、不重复消耗额度。

新增 `guest_image_entitlements`，以 `guest_session_id` 为唯一键，并以 `available`、`reserved`、`consumed` 表达唯一图片资格。图片资产必须能唯一归属正式用户或 guest session 之一，不能伪造 `users` 记录；图片资源继续使用受保护读取，不得改为公开 URL。

## Guest Chat API Boundary

新增独立 `/api/guest/...` 路由；不要在现有 `/api/chat/*` 或 `/api/characters/*` 上放宽 `requireAuth`。

允许的能力：

- 建立/恢复当前浏览器的 guest session 与其唯一会话。
- 读取该 session 的文字消息。
- 发送一条受长度与速率限制的文字、语音或附件用户消息，并请求对应前台文字与语音回复。
- 上传符合正式聊天格式/大小规则的受保护附件，进行正式链路相同的 ASR、视觉输入和安全校验。
- 建立当前 guest 与冻结前台的唯一实时通话；每个成功最终转写先占用共享消息额度，第 30 条的 AI 文字/语音回复完成后结束通话并进入认证引导。
- 获取额度状态和认证引导状态。
- 在现有图片生成规则命中时，创建或恢复唯一的 guest 图片任务及其状态。
- 在服务端确认的商品意图命中时，接收当前站点可信商品源返回的 guest-safe 商品卡。

服务端拒绝的能力：角色创建/管理、profile、活动、优惠、结算、管理员和跨站点或不可见角色请求。图片、附件、语音和通话内容沿用现有正式用户规则与安全审核；游客只增加独立额度和所有权限制。拒绝响应使用统一、非枚举性的产品错误码。

每个 guest 写接口和承接接口必须校验允许的 `Origin`/`Referer`（或等效 CSRF token）；不能只依赖 `SameSite=Lax`。每一次读写均校验 cookie token、session 状态、过期时间、站点、前台绑定和所有权。

## Message And Cost Rules

1. 服务端在同一个事务中锁定 guest session、校验状态和窗口、为新 `clientMessageId` 预留一次额度，再写入用户消息。
2. 新文字、成功落库的语音输入和带附件消息计入同一 30 条额度；同一用户操作只计一次，模型/TTS 回复不单独计数。
3. AI 回复失败不退回已预留额度，但必须保存“用户消息已接收、回复失败可重试”的状态；重试只能关联原消息，不能创建第二条用户消息或第二次扣额。
4. 并发的临界额度请求最多成功剩余额度数；不能依赖前端计数或进程内 Map。
5. Guest 输入沿用现有聊天文本长度、安全过滤和模型调用防线；不得因为 guest 身份放宽提示词、安全或频率限制。

## One Guest Image

1. 仅允许 session 绑定的当前站点前台生成一张图片；不接受自由 `characterId` 或跨站角色。图片的意图识别、Prompt、参考素材和安全审核复用当前正式用户规则。
2. 不为 guest 新增更宽松的图片安全规则；当前正式用户已允许或拒绝的内容，对 guest 保持一致。
3. 创建任务时以 `SELECT ... FOR UPDATE` 锁 `guest_image_entitlements`：仅 `available -> reserved` 可创建一个 placeholder、asset 和 job；同一 session 已有 `reserved` 或 `consumed` 时不得创建第二个任务。
4. worker 在图片文件成功落盘且 asset 为 `ready` 后，原子更新 `reserved -> consumed`。失败、审核拒绝、超时或存储失败将同一资格恢复为 `available`；重试复用原 request/placeholder，不得静默创建第二张图。
5. 任务重放、双击、刷新和服务重启通过 image request id、asset 状态和 entitlement 关联去重。若 `ready` 已写入但资格更新中断，恢复任务必须把该资格补偿为 `consumed`。
6. guest 图片只可由持有该 guest cookie 的浏览器在未过期前读取；承接成功后由正式用户授权读取。图片 URL 不携带 guest token，过期/撤销 guest 的未承接图片按 guest TTL 清除。

## Guest-safe Product Messages

1. 仅当服务端确定当前消息具有商品意图时，角色可发送一张商品卡和与该卡同源的简短补充文本；找不到确定商品或商品源失败时只发正常澄清文本，不伪造价格、库存、链接或商品。
2. 商品检索只使用 guest session 冻结的 active `site_id` 对应的可信商品源；不得使用客户端站点、角色 ID、默认站点或跨站 fallback。
3. Guest 商品链路显式跳过 `promotion_campaign` 和任何活动上下文。持久化、模型提示词与 API 响应都必须清除 `campaignId`、`code`、`discountCode`、优惠文案及 `features` 中的折扣字段。
4. 商品卡只含服务端快照的商品标识、标题、图片、价格、库存、当前站点链接和抓取时间。点击可进入已批准的站点商品详情/外部独立站，不附带个人标识、优惠码或未验证订单信息；领取、结算、保存等操作继续引导认证。
5. Guest 商品卡不触发用户级促销 delivery、优惠资格、长期画像或用户归属统计。匿名浏览统计如需保留，必须另有最小化、可过期的 guest 统计模型。

## Authentication Handoff

### Common precondition

只有当前浏览器持有有效 HttpOnly guest cookie 时，认证成功后才触发承接。客户端不得提交可选择的 guest session ID。登录/注册失败、验证码失败或取消认证都不 claim guest，游客可在未到期前继续聊天。

### New registration

在现有注册事务中完成：创建用户、分配路径站点、激活该站点前台、锁定 active guest session、验证 guest 的站点与前台相同、claim 会话、签发正式用户 session。失败则整体回滚，guest 仍可使用。

新注册用户没有同角色历史会话时，将 guest 会话归属转给该用户；原历史、顺序与时间保留。承接成功后标记 guest 为 `claimed`，撤销其 token，并按常规用户规则异步补建允许的索引/摘要任务。

### Existing-account login

登录成功不改变用户 `site_id`。若 guest 站点与该用户所属站点不一致，拒绝承接、保留已有用户登录结果，并显示“此访客对话属于另一站点，无法转入当前账号”的确定性提示；不得跨站点迁移。

若站点相同：

- 该用户没有同一前台的活跃会话：将 guest 会话归属转给用户。
- 该用户已有同一前台会话：在同一事务中把 guest 的纯文本消息按 `sent_at` 与稳定 tie-breaker 合并进现有会话，保留消息来源审计；随后关闭 guest 会话。不能保留两条会被“最新会话”查询互相隐藏的活跃会话。

claim 使用行锁和唯一 claim 记录：第一次成功后保存 `user_id` 与目标会话；同一个用户的重试返回同一结果，不复制消息或激活；另一个用户尝试 claim 同一 session 必须失败。

承接成功后，guest 消息、商品卡、ready 图片、语音资产、附件和已结束通话记录都转给 claimant，且商品快照保留原站点；进行中的图片、语音或通话任务在承接中不得复制。只有迁入正式用户且按正式规则允许的文本/转写才可进入索引、摘要或记忆候选流程；游客期间不自动形成长期画像、促销资格或主动消息。

## Failure, Privacy And Cleanup

- 过期、撤销、无效或已 claim 的 token 不返回任何历史消息、商品卡或图片；浏览器可开始新 guest 会话或登录。
- 清理任务与 claim 必须协调状态/锁，不能在 claim 中删除会话；claimed 会话按正式用户数据保留策略处理，未 claim guest 会话及其附件、语音、通话记录和受保护文件按 14 天后清理。
- IP 辅助限速仅保存最小化、短期可过期的派生值；不得作为用户画像或跨站点关联依据。
- UI 在首次聊天前说明“游客对话在本浏览器临时保存，注册后可保留”；具体隐私文案及法务要求在上线前单独审核。

## Delivery Phases

分批文件与验收状态见 [Guest Chat Phased Implementation Plan](../plans/2026-07-10-guest-chat-phased-implementation.md)。本地批次 1 至 9 与完整全场景回归均已完成；站点/数据基础、文字聊天、无优惠商品消息、一次成功图片、认证承接、游客 AI 语音回复、语音输入、附件、实时通话、多模态资源承接和过期清理已通过专项、独立互评、真实接口、WebSocket 和浏览器验证。本地 FKK 开关开启供验证，GG 保持关闭；生产发布验收、服务器和 GitHub 更新尚未执行。

### Phase 1: Guest text chat foundation

- guest session、cookie、安全校验、站点/前台冻结、独立 guest 路由。
- 单前台文字会话、30/24h 额度、10/10min 速率、幂等发送与失败重试。
- 一次图片生成的 guest entitlement 状态机、受保护图片读取与失败恢复；内容规则复用现有生图链路。
- guest-safe 商品卡：站点可信商品源、无活动/折扣码注入、商品详情跳转。
- 公开浏览与受限操作的登录/注册 CTA。

### Phase 2: Auth handoff

- 注册/登录后的原子 claim、同站点校验、新账号转移、已有账号会话合并。
- guest token 撤销、任务补建、过期/清理和审计状态。

### Approved chat-capability extension

- AI 开场白/回复语音：复用正式 TTS、角色音色、受保护语音资产和播放队列。
- 用户语音与附件：复用正式上传、格式/大小校验、ASR、视觉输入和消息顺序。
- 实时通话：复用正式 call service/WebSocket，在握手和最终转写落库时校验 guest cookie、站点/角色和共享 30 条额度；时长只用于后台审计，不作为使用限制。
- 承接与清理：语音、附件和通话记录随 guest provenance 转移或清理。

### Explicit later phases

- 外部商城账号绑定、订单同步、SSO、权益与折扣码体系。
- 更多角色或跨设备 guest 会话。

## Acceptance Scenarios

1. 未认证用户从任意 `/:siteSlug/chat` 入口进入，刷新后仍只看到同站点前台和原对话；IP/default site 不改变它。
2. 伪造另一站点、另一前台、普通/网红角色、guest ID 或 session ID 的请求均不能读取或写入他人数据。
3. Guest 可浏览公开页面并在冻结前台聊天中使用文字、AI 语音回复、语音输入、附件、实时通话、商品和生图；角色创建写入、优惠、结算和后台仍要求认证。
4. 前 30 条文字/语音/附件用户消息共用额度；第 20 条后出现软提示；第 31 条不写消息、不调用模型并返回认证 CTA。并发临界请求不超额。
5. AI 开场白和成功回复带可播放角色语音；TTS 失败保留文字。语音输入先显示用户转写，再显示思考和 AI 回复，不出现错序或重复扣额。
6. 附件只能由当前 guest 读取，跨 guest/过期 cookie 拒绝；图片附件进入正式视觉上下文，失败上传不计消息额度。
7. 实时通话每个成功落库的最终用户转写计 1 条；第 30 条仍生成并播放对应 AI 回复，随后由服务端结束通话。刷新、重连、重复 turn、并发 socket 和清 cookie 不能绕过共享额度或读取其他 guest 通话。
8. 相同 `clientMessageId` 的双击、网络重试或并发请求只产生一组用户消息/角色回复，且只消耗一次额度。
9. AI 回复失败后，用户无需重发原消息即可按同一消息重试；不会产生重复扣额或重复角色回复。
10. 新注册用户完成认证后能在同站点前台看到完整 guest 多模态聊天历史；guest cookie 失效，guest 期间没有主动消息、优惠或长期记忆。
11. 已有账号同站点登录：无同前台会话时转移；有同前台会话时历史按定义合并且不隐藏旧会话。跨站点登录不得承接。
12. 注册/登录重试、浏览器刷新、claim 并发与数据库事务失败后，不出现第二个用户、重复前台激活、重复迁移、文件泄漏或消息丢失。
13. 14 天过期、清空 cookie、换浏览器或使用旧 token 时，不泄露历史或受保护资源；可以开始新 guest 会话或登录。
14. 合规图片请求只产生一条 placeholder，只有 ready 后消耗唯一资格；失败、审核拒绝、任务重放、双击、并发、服务重启或承接中断都不多扣、不多生成，成功后第二次图片请求被拒绝。
15. Guest 商品意图只可得到 session 站点可信商品源的快照卡；其他站点、角色、默认站点 fallback、活动商品和折扣字段均不会进入卡片、AI 文案、API 响应或跳转上下文。
16. guest claim 前/中/后，附件、语音、ready 图片、通话记录和商品卡只对所属 guest 或 claimant 可见；成功承接后历史保持，旧 guest cookie 不可再读取。

## Implementation Gate

进入代码前，必须：

1. 按 [分批实施计划](../plans/2026-07-10-guest-chat-phased-implementation.md) 维护文件、迁移、接口、测试、回滚和发布步骤。
2. 对权限、cookie/CSRF、消息/通话/图片额度并发、claim 幂等、站点隔离、商品折扣剥离、附件/语音/图片资源访问和数据清理做多 Agent 代码审查。
3. 使用真实未登录浏览器链路、注册链路与已有账号登录链路进行验证；不得仅以单元脚本宣称完成。
