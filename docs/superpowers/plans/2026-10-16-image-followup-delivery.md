# 图片续接与真实交付状态迭代方案（2026-10-16）

## 目标及证据

CF 游客会话中，第一次图库消息真实存在，第二次用户要另一张时没有新增图，系统却在边界审核拒绝后用旧图 ready 拼出 Foto lista。现有函数已隔离复现。图库文件存在/HTTP200不等于用户浏览器当时显示成功。原 JEV/图片分类结果未持久化，不能断言原分流漏在哪一层。

基线 06685d4；本地分支 codex/image-followup-delivery-20261016；涉及原文件备份 .backups/image-followup-20261016/。仅本地实现与验收，不部署、不推送、不改线上数据。历史未提交内容保留。

## 兼容边界（方案补充后执行）

- 不改页面、样式、公开 API、DB schema、依赖、JEV核心规则及阈值、0.54语言审核、主模型链、裸体/商品/试穿规则、额度及锁。
- 历史图片和当前动作结果分别处理；有旧图不代表本轮已交付。本轮配额/拒绝/活跃任务指令优先于历史 ready。图片状态读取继续按session/owner/character/用户顺序及同一message+asset锚定。
- 非图片语义不得因存在欢迎图、商品图、用户上传图而获得新图权限。近期真实角色图只提供有限语义背景，不授予动作；当前文本仍须由现有分类器确认要新视觉输出。短句历史主体例外仅普通图库照片，不继承旧裸体/服装/试穿/显式生图权限。
- 只对近期真实角色图背景的有界短句补充现有图片分类（一次，沿用预算），无该背景的JEV快速路径不变。较长明确请求按既有路径处理，避免扩大普通聊天延迟；分类失败不执行动作。
- 复用 createMascotLibraryImageMessage 的图库去重、现有 guest/member 额度/工作队列、共享prepareChatIntentTurn结果；不写并行意图模型或关键词补丁。注册用户既有生成/图库策略不改变。
- 原审核失败重生、商品卡/参考图、售前/订单/混合问题的并行回答保持；诊断失败不改变回复/发图结果。

## 阶段 A：状态与兜底（root）

1. server/chat-image-status-context-service.js：保留当前/历史锚定；review输入提供本轮创建/阻断的有限事实。历史ready只能说明上一张，不能输出无指代的本轮完成提示；当前blocked指令不被旧ready遮蔽。
2. server/chat-image-copy-service.js：复用现有语言归一与状态文案，仅为历史ready/本轮未新增提供明确限定的服务端兜底，覆盖现有43语言，正常本轮ready文案不变。
3. server/chat-reply-review-contracts.js：在现有IMAGE_CONTRACT补充当前交付与旧图查询的区别，不加新审核层或新schema。chat-reply-boundary-service.js仅必要接线，避免向大文件堆语义逻辑。
4. 定向红/绿回归：旧order50、当前90、审核relevant+matched=true+boundary拒绝，不得生成裸Foto lista；真正本轮图库/生图ready仍能确认；旧图查询不创建任务；queued/failed/未知/刷新失败保持真实性。

## 阶段 B：短句承接（image_followup_context）

1. server/chat-image-conversation-context-service.js：复用最近6条，提取实际角色图片与其前置用户请求；欢迎/商品/上传图及超界证据不建立承接。
2. server/chat-image-intent-classifier-service.js：JEV no-image且存在上述短承接背景时，用一次现有classifier判断；request/action证据仍在当前文本，actor可有限引用上述用户请求。旧图位置/状态、感谢、换题、商品查看必须non_image；明确请求不得靠历史改变服装/模式权限。
3. server/chat-intent-turn-service.js 已共享图片分类结果，优先不改、不重复调用。新增隔离专项验证各入口契约及负例；不把模拟返回当真实模型能力。

## 阶段 C：诊断（root）

复用 server/ai-reply-log-service.js 的有限JSON与500字符限制；server/chat-image-generation-service.js 在guest/member既有入口记录request/session、JEV有限结论、最终图片分类来源/置信度、动作结果、原因、实际image-message ID。不记提示词、原始用户文、URL、密钥或图片；不新增DB表。记录错误fail-open，不改变额度/事务/业务结果，不重复执行工具。

## 阶段 D：验收及独立复核

- 状态/锚定：新图ready、旧图ready、旧图查询、queued/generating/failed/unknown、读库/刷新失败、后续用户/跨会话/跨角色；当前失败/额度结果不得被旧ready覆盖。
- 意图：西语/英语/匈语续图、旧图查询、话题切换、仅欢迎图、商品图/上传图、证据伪造、条件继承拒绝；语义不靠固定例子。
- 既有链路：游客/注册/语音、普通聊天、混合物流问题、商品卡/候选、试穿真实参考图、配额/并发/幂等、提供商备用、0.54审核和一次重生。图库多轮不同ID，原生成请求幂等保持。
- 本地真实链路：限定127.0.0.1:4173/MySQL3307，使用现有账号/隔离游客。真实模型至少完成“请求角色照片→查询上一张→再要一张→普通聊天/商品查看”序列。逐轮核对新增图片数、不同图库ID、有效URL、消息顺序、真实诊断，而非仅判断回复文字。复用现有库图避免无必要生图/音频付费；必要受控故障验证与真实模型结果分别记录。测试数据清理/事务回滚，不能动已有用户数据。
- 独立Agent复核共享状态/配额/商品保护；阻塞项修复并回归后才交付。运行匹配风险的既有门禁；最终本地服务重新加载、PID/真实目录/健康/多站点HTTP验证。
- 完成标准：上述目标场景及关联回归有证据；不声称模型永不失败、不以隔离脚本替代真实链路。若真实验收不通过，先定位并修复相关根因，不扩大到其他业务设置。

## 回退及交付

本次无schema/状态版本升级。回退涉及源码即可；本地备份与基线可定位。每阶段结果写入当日日志及本方案/发布节点，保留失败样本和限制。最终汇报修改/新增/删除、测试范围、真实验收及剩余问题，不做服务器/GitHub操作。

## 真实页面发现后的必要补充（实现前补入）

首轮本地页面已产生图库记录/有效URL，但页面只有00:00空语音块。纯函数复现确认 server/chat-message-store.js 的image映射与 src/features/chat/chat-message-renderer.js 的图片分支各漏 mascot_library_image。新增阶段B2：两处仅补该有限type，分别复用mapMascotGreetingImage和现有图片卡，不加渲染器、不改CSS、不扩大URL白名单/隐私投影。补map→render专项，覆盖无效URL/欢迎图/生图/普通语音文字，真实页面reload核对图库img.complete/naturalWidth和不同URL。此为本次无图现象的直接根因修复，属于已授权相关范围。

独立审查补充A：本轮taskCreated/currentImageMessageId存在但DB未见该行时必须保持本轮unknown，不能选旧ready；active_generation与旧ready交叉同样不报旧完成。日志在外层事务提交前写入，成功动作统一称prepared，实际持久交付须通过messageId查到提交后的消息，不把预备日志当最终成功。

## 真实模型返工及验收依据

首轮 where 未创建图但图片分类曾4500ms超时；首轮 otra 未发图，旧图兜底已正确限定，不能记作完整通过。其日志经过trigger归一，不能从none反推原模型判定。核查后补齐classifier最新图片枚举，统一当前动作/历史主体的提示词：省略表达本身可表示当前追加请求，不要求重复照片名词、主体或动词；普通追加走图库，不自动升级显式生图。保持6条/80字符上下文界限及当前证据、商品、服装权限校验。新增有限classificationOutcome/Intent诊断，区分模型无意图、低置信和证据校验拒绝，不存原文。

| 实现入口（当前行号） | 实际变化 | 验收标准 |
| --- | --- | --- |
| server/chat-image-conversation-context-service.js:10 | 提取近期真实角色图和前置用户请求 | 欢迎/商品/上传图不建立续图权限，超界无背景 |
| server/chat-image-intent-classifier-service.js:31,102,124,169 | 有界续接进入现有分类器；图库枚举及省略语契约一致；有限诊断 | JEV无图时仍能确认当前追加；旧图查询/聊天/商品不发角色图；不继承服装/裸图/显式生成条件 |
| server/chat-image-status-context-service.js:51,99 | 当前消息精确锚定及历史限定兜底 | 当前行缺失不冒用旧ready；新图ready可确认；阻断/未知不报完成 |
| server/chat-image-copy-service.js:172 | 43语言历史ready文案 | 必须明确上一张且本轮未新增；本轮正常ready不变 |
| server/chat-reply-review-contracts.js:18 | 原图片审核补当前/历史区别 | 历史ready不证明新交付；保留混合问题及真实阻断原因 |
| server/chat-message-store.js:298 / src/features/chat/chat-message-renderer.js:31 | 补图库枚举，复用原映射和图片卡 | 浏览器图库图完整加载；非法URL不显示；语音/欢迎图/生图兼容；无CSS变化 |
| server/chat-image-generation-service.js:40,503 / server/ai-reply-log-service.js:238 | 复用日志入口记录有限意图及prepared结果 | 不影响执行权限/事务/额度；≤500字符、无原文密钥URL；提交成功需查实际messageId |
| scripts/deployment-check.mjs | 注册3个新专项 | 原完整门禁与新增状态/续接/显示回归通过 |

旧图查询→otra复验：查询未新增图且classifier明确model_no_intent/1.0；otra时JEV none/.61，现有classifier确认library_photo/1.0，提交新的图库消息order150。浏览器四张图（欢迎+三次请求）均complete=true、naturalWidth864且URL不同。该回合仍附带既有商品不确定分流的中性澄清；本次不为消除这一文案扩大商品规则或删除混合问题保护。

## 最终交付状态

- 阶段A/B/B2/C实现，独立复核无阻断；阶段D本地验收完成。最终源码完整门禁309步骤、多站点preflight/HTTP smoke、9个运行文件语法和diff检查通过（生产专属strict env本地按既有规则跳过）。
- 真实页面8轮：请求图、查询旧图、短追加、普通聊天、商品查看；首轮失败与修复后复验分别保留，不掩盖返工。普通聊天正常；商品查看发1张真实商品卡且角色图数保持4（欢迎+图库3）。没有新生图任务；图库ID/URL不同，已实际加载。注册/语音/额度/商品参考图/订单等由既有门禁回归覆盖，未声称全部做过新注册用户页面对话。
- 本地测试guest及其22消息、9个独有语音行/文件已私有备份并清理；已有图库与账号等数据保留，受保护计数12/12/36/14/235不变。只关闭自建测试标签。
- 本地服务PID64868/实际根目录/127.0.0.1:4173/API健康确认。日志、Bug及英文release节点已写；仍未部署服务器、提交Git或推GitHub。

## 后续：成功续图后的多余澄清（同日本地迭代）

- 用户追加授权后核查：不是新图失败或语言阈值问题。图片分类已完成请求，但独立商品分流仍为unclear/classification_uncertain；边界拒绝后的scopeNote又无条件追加商品中性澄清。原真实样本及新的最小函数自检都复现`Foto lista.`后追加`Aclara...`。
- 复用现有classifier增补`requestScope=image_only|mixed|unknown`，不增加模型调用。仅分类accepted+allowed且requestEvidence覆盖完整归一化当前文本时认定image_only；缺失、陌生字段或部分证据默认为unknown。不同语言适用同一语义契约，不加词表。
- `chat-image-status-context-service.js`新增小判定`isFulfilledImageOnlyRequest`：本轮创建、当前图片真实ready、当前trigger通过且image_only缺一不可。`chat-reply-boundary-service.js`仅在此条件、商品unclear且不存在其他商品/业务/知识/结账/订单/benefit/显式事实及事实限制契约时省略通用uncertaintyCopy。全部审核、权限、retained正文和其他fallback照常执行，不删除回复中的字符串，不提前返回整轮。
- `ai-reply-log-service.js`在既有白名单JSON内记录有限requestScope，仍≤500字符，无原文。新增字段不改变动作权限；不改JEV、阈值、超时、重试、CSS、schema或配置。
- 定向红→绿；47项图片上下文、973项state-flow、43语言875项、商品图片边界38项及参考图/语言重生专项通过。新增mixed/unknown/部分证据、旧图、pending、并行业务/商品/事实及获批retained正文回归。
- 新真实临时guest：首轮遇既有4500ms分类timeout，未发图，保留失败证据；后续完整请求成功。`otra`一轮JEV none/.64、classifier image_only/1.0，实际新图加载且回复严格为`Foto lista.`，边界仍执行且fallback。混合`发另一张你的照片并说说今天状态`分类mixed，真实发图并完整回复状态，未被短确认替代。共3张不同图库图，欢迎+图库4图均加载。证据`.backups/image-only-clarification-20261016/`；最终门禁/清理结果在当日日志收尾。
- 最终完整309步骤门禁、多站点preflight/HTTP smoke、语法/diff检查通过；生产专属strict env保持既有本地跳过。临时guest/13消息/5个独有语音行及文件已私有备份清理，受保护计数不变，图库原文件保留。本地PID70752/真实目录/健康确认。此后续修复已完成本地验收；未部署/提交/推送。
