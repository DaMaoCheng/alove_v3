# Oct19：队列隔离、执行截止及图片等待闭环（本地迭代）

用户已授权本地实现及真实链路自检，方案完善后直接推进；不修改生产、不重启生产、不自动补发隔夜图片。基线Git f5f9b92/runtime234174b。旧dirty文档不暂存/覆盖；原文件快照在私有.backups/queue-isolation-20261019/original。

## 证据与目标

Oct18主动消息19:35运行未结束，串行runnerActive挡住后续所有任务；23:30图片仍queued/startedNULL。HTTP已有超时，具体内部等待无历史阶段日志，不能编造根因。目标是即使任何后台await永久挂起，用户图片仍可执行，卡住任务不会晚写/重复投递，图片排队有最终状态。

## 方案与文件级边界

1. `memory-job-service.js`：复用现有事务claim/complete/fail/heartbeat，加image/background类型过滤与当前claim_token条件。新增nullable执行token列，旧未领取任务NULL兼容；`database/schema.sql`、现有db.js迁移注册增加幂等列迁移。新任务执行状态写入必须匹配running及token，旧attempt不能完成/失败新attempt。保留现有retry/backoff/status值。
2. `memory-job-runner-service.js`：编排独立image/background lane，各至多1执行，旧batchSize/优先级在各lane内保持。提取原executeMemoryJob原样到小executor模块，不复制业务。由标准库child_process.fork隔离每次任务执行；独立监督器给整个执行单元有限预算，超时先停止并确认exit再标失败/恢复，不裸Promise.race继续后台写。最多2业务执行进程，无新依赖。安全停机同时停止两lane和子进程，不永久await。
3. 新小型执行worker/supervisor与预算policy模块：IPC只传job和有限阶段/结果，不打印凭证/用户prompt。执行阶段、错误码、超时类型记录到既有job日志/有限result元数据。图片每次总执行至少配置provider超时+90秒，默认5分钟；普通后台默认5分钟；主动消息/图片失败回复按现有10次模型尝试、主动消息2轮候选及语音重试推导独立上限，避免外层预算截断原流程；批活动按现有5目标批次推导较大预算。ai-reply-service的10次/250ms常量提取到ai-reply-request-policy共同引用，不改变模型重试规则，不给每个备用切分剩余。父进程崩溃后worker必须随父连接断开退出，跨实例恢复使用DB执行身份及锁，不能活worker仍写时重领。
4. `proactive-message-job-service.js`、`chat-proactive-message-service.js`、`proactive-message-delivery-service.js`：复用每日slot唯一键/owner锁/发送前policy，job稳定deliveryId与发送事务内任务fence；消息和delivery sent同事务提交。正常直接调用保持原行为，campaign并行事务同样保护；超时不盲目取消不确定投递再重投，先读已提交事实。不可对用户重复发送。
5. `chat-image-job-service.js`及小生命周期模块：复用asset GET_LOCK、staged/ready重放、游客资格/额度事务和既有自然失败回复。首次排队超过5分钟或整次请求超过15分钟不再开始合成；截止不被retry/heartbeat刷新。独立expireImages控制进程扫描queued且仍拥有的任务（与running恢复watchdog分离，避免互相卡住），持锁重查；running由监督器确认终止后收口。ready不可倒退，旧终态不能复活。不删除共享网络已消耗额度、不重复扣额度、不跨guest/session处置。隔夜旧图只结束，不补发图片。
6. 前端复用既有poller/失败隐藏/自然失败消息，不改布局样式，不新增自动重试按钮或按客户端计时伪造DB失败。后端失败回复任务同image lane执行，避免普通后台阻塞。浏览器观测上限改为30分钟；服务端只在failed图片上附加failureReplyPending布尔值（稳定任务主键查询），排队/运行的失败回复继续被观察，其他失败保持原60秒观察。客户端计时不取消任务；当前15分钟图片加一次失败回复约24分12秒，但多个任务积压或外层重试可能超过30分钟，不能把观察上限当成全负载完成承诺。

## 分期与验收

A 先补红例：真实runner orchestration中永久挂起主动任务不应阻挡image；确认终止前不可释放lane；旧token不得写状态。以可控fixture缩短时间，使用真正worker进程与真实生产函数，明确和付费验收区分。
B 数据/投递边界：真实本地MySQL事务验证claim过滤、双领取竞争、CAS、任务完成与投递原子性、kill提交前后无重复；失败释放游客预留一次、ready重放不重复扣。DB初始化测试严格串行，独立fixture清理并核对保护计数。
C 端到端：启动正常本地服务，真实页面新游客/注册用户最相关入口；真实Lite生成至少1次，核对实际job→assetready→页面图片加载与自然正文。受控挂起仅放在隔离本地验收进程/fixture，不给生产代码增加按客户文本触发故障的后门。不以mock图片宣称真实生成通过。再测试排队到期的失败自然消息及普通聊天/素材图/商品/主动消息/语音相关保护。
D 独立架构/幂等复核、目标自检、完整部署门禁及本地重启HTTP。新增自检注册既有门禁。日志/bug/release明确分层证据，未完成不标通过。

## 坑点/保护与回退

- Abort fetch不能取消SQL/文件/日志等待；结束Promise不等于旧任务停写，必须kill+exit，服务端事务/投递CAS仍必需。
- 心跳不是新预算；截止基于固定claim/请求时间。持续心跳不能无限延期。
- 不能回收其他实例仍活跃任务；逐asset锁、token和子进程生命周期一致。停机parent退出时子进程不能孤儿继续发消息。
- 单纯先查再发不是幂等：发送事务内锁任务/slot，message与sent同提交；timeout后重试先认已有sent。
- 新增nullable列可回退旧代码，但待新执行全部停止再回退；本地迁移前保存结构/相关状态。生产迁移及历史卡住任务处置留待单独授权发布阶段。
- 前端失败卡隐藏是现有设计，不能改成永久占位；自然失败回复必须去重且有限执行，不假报ready。
- 队列DB查询/监督器自身也要有限，watchdog故障不能占住image lane；无界并发/全库扫描/重复服务初始化均禁止。
- 原业务handler尽量原样复用；若保护需要新增状态/接口，先把影响、测试补到本方案再做。没有付费生产调用或生产数据修复。


## 发布前必要补充（用户已授权发布及单张补发）

补发核查证实原生图校验只认主角色，与既有guest_character_sessions多角色映射不一致。为保证Mia原请求实际可完成，chat-image-job-service的游客资格查询共用该映射；active使用角色chat_session_id，claimed使用角色target_chat_session_id；仅主角色回退旧字段，并核对chat角色/游客及claimed owner，站点/过期/额度限制保留。既有guest image套件补六个真实SQL正反例（含旧代码红例），不改JEV/提示词/样式。

一次补发为独立运维操作：原资产过期保留历史，唯一sourceRef创建一个新任务，继承原用户输入/角色条件，走原额度预留；旧失败通知安全结束后才新建及说明，避免晚到误报。执行前服务器本机备份和严格身份校验，本地控制mock验收重复执行/并发/额度不足/错误身份/语言及旧通知顺序，再使用真实Lite并核对文件和provider日志。不做其他旧任务的补发。
