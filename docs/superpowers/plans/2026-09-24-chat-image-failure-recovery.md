# 生图失败占位与角色回复恢复（2026-09-24）

## 目标

保留生图排队/生成中的占位体验；生图最终失败时，用户侧不显示失败卡片或供应商原始错误，并由当前角色根据已有上下文发送一条简短、符合人格的失败说明。数据库仍保留失败状态，供后台审计、额度释放和错误排查。

## 现状与范围

- `server/chat-image-generation-service.js` 已创建 `image_generation` 占位消息。
- `server/chat-image-job-service.js` 已维护 queued/generating/ready/failed 状态，并在最终失败时释放游客额度。
- `src/features/chat/chat-image-message.js` 当前会渲染 failed 卡片。
- `src/app/chat-image-status-poller.js` 当前在失败后的短暂窗口继续轮询，但只按图片状态判断是否重渲染。
- 普通账号、游客、语音入口共用生图任务；本次不改素材库图片、额度规则、供应商重试和数据库保留策略。

## 实施方案

1. 新增 `MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE_FAILURE_REPLY`。
2. 生图任务提交最终失败状态后，使用按 asset 加锁的幂等补偿任务排入失败回复；不在重试中的中间失败状态发送回复。状态提交与任务排队分开，排队异常写入结构化日志，后续可由任务恢复机制补偿。
3. 新增失败回复 job service：读取失败图片前的最近消息和角色资料，复用 `buildChatReplyPrompt`、现有 AI provider、游客安全策略和语音资产服务，要求角色简短道歉、不得声称图片已生成。
4. 失败回复任务按 `chat-image-failure:<assetId>` 幂等落库，账号和游客均保留原有消息/语音写入方式，并以数据库 advisory lock 防止并发重复调用 AI。
5. 前台只隐藏 `failed` 图片卡片，保留 queued/generating/ready 渲染；失败后的轮询窗口继续保留，用于拉取异步失败回复，并在新增回复消息时重挂载页面。
6. 后台和数据库继续保留失败图片记录及原始错误；公共聊天 DTO 只返回失败状态和更新时间，不返回供应商错误正文。
7. 失败时间使用图片资产 `updated_at`，而不是占位消息创建时间；失败回复任务纳入 worker 心跳与 stale job 恢复，并在失败状态提交后做一次短延迟补排队。

## 代码级修改范围

- `server/memory-job-service.js`：增加失败回复 job 类型。
- `server/memory-job-runner-service.js`：分派失败回复 job。
- `server/chat-image-job-service.js`：最终失败提交后排入失败回复 job，并记录状态更新异常。
- `server/chat-image-failure-reply-job-service.js`：新增失败回复生成、账号/游客持久化和失败兜底。
- `src/features/chat/chat-image-message.js`：失败状态返回空渲染结果。
- `src/app/chat-image-status-poller.js`：失败宽限期内继续拉取，并在出现新回复消息时触发重渲染。
- `server/chat-message-store.js`：公开图片 DTO 隔离原始错误，并返回失败更新时间供轮询宽限期使用。
- `server/chat-prompt-layers.js`：为“任务已创建但最终失败”的失败回复提供明确提示层。
- `scripts/chat-image-failure-recovery-self-check.mjs`：覆盖占位、失败状态、幂等 job、失败回复和前台隐藏行为。

## 验收标准

- queued/generating 状态仍显示原有占位和加载动画。
- ready 状态仍显示图片和成功提示。
- failed 状态不在用户聊天界面显示失败卡片或 `Not found`，但后台/数据库仍有失败记录。
- 最终失败只创建一个失败回复任务和一条失败回复消息；worker 重试或重复回调不会重复发送。
- 失败回复使用当前角色和最近上下文，明确道歉，不声称图片已生成，不暴露 provider、错误码、额度或内部任务信息。
- AI 失败时仍有安全的本地化兜底文字，文字消息不因语音生成失败而丢失。
- 普通聊天、素材库图片、成功生图、游客/注册用户额度和现有重试逻辑保持不变。

## 回退点

回退本次新增的 job 类型、失败回复 service、前台失败隐藏逻辑和对应自检；不需要数据库迁移，原有 `chat_image_assets`/`chat_messages` 数据可继续使用。
