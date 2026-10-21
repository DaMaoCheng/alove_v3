# 2026-06-30 Chat Image Generation Plan

## Goal

在聊天对话内增加角色相关生图能力。

典型场景：

- 用户说“你穿给我看”。
- 用户说“take a photo with this kit”。
- 用户要求角色结合当前商品、角色形象或聊天上下文拍一张图。

第一版目标不是做通用绘图工具，而是做“聊天里的角色照片”。生图过程中用户仍然可以继续聊天，图片完成后固定回填到触发生图的那条消息附近，并进入聊天记录。

## Product Rules

### Allowed

- 角色本人相关照片。
- 角色穿搭、球衣、当前商品上身效果。
- 结合角色头像、角色人设、当前商品图和聊天上下文生成的自然照片。
- 轻度情绪、姿势、场景调整，例如开心、赛前、街拍、matchday 等。

### Not Allowed In V1

- 电商主图。
- 白底商品图。
- 广告素材。
- 批量作图。
- 去背景图。
- 高清产品摄影图。
- 用户上传任意参考图再编辑。
- 同一条请求生成多张候选图。
- 后台配置额度。

这些请求应当走普通聊天回复，角色按人设和上下文委婉拒绝，不创建图片任务。

## Quota And Lock Rules

### Daily Quota

- 第一版额度：每个账号、每个对话、每天 1 张。
- 额度维度：`internal_uid + session_id + local_date`。
- 只在图片生成成功、压缩保存成功、消息更新为 `ready` 后消耗额度。
- 失败、超时、取消不扣额度。

### In-Progress Lock

- 同一对话内存在 `queued` 或 `generating` 图片任务时，不再触发新的生图。
- 只有任务进入 `ready` / `failed` / `cancelled` 后，才释放锁。
- 用户在生成中继续说“再来一张”“换个姿势”等内容时，只走普通聊天回复，不创建新的图片任务。

### Trigger Order

后端触发判断顺序必须固定：

1. 是否是生图意图；
2. 是否已有生成中任务；
3. 是否还有额度；
4. 是否符合允许场景；
5. 创建图片占位消息和异步任务。

任意一步不通过，都不能创建图片任务。

### Quota Exhausted Reply

额度已用完后，角色需要给普通文本/语音回复：

- 回复语言跟当前会话语言走。
- 回复语气符合角色人设。
- 回复需要结合上下文，不能机械提示。
- 回复后不得创建图片任务。

示例语义：

> 今天这段对话里已经拍过一张了，我可以继续陪你聊这套搭配，或者帮你想下一张怎么拍。

实际输出由现有回复链路生成，但必须带后端硬拦截，不能只靠 prompt。

## User Experience

### Message Placement

- 用户触发生图后，后端创建一条 `image_generation` 消息。
- 这条消息固定在触发它的用户消息之后。
- 生成完成后原地更新这条消息，不插到最新消息末尾。
- 用户继续聊天时，不改变这条图片消息的位置。

### Generating State

生成中不显示技术感文案。

建议文案：

- English: `Taking the shot...`
- 中文：`等我拍张照...`

文案规则：

- 跟当前会话语言走。
- 缺少对应语言时 fallback 英文。
- 使用固定文案库，不让 AI 临场自由生成。
- 文案前显示 spinner。

### Ready Notification

如果图片完成时用户已经聊到下方：

- 底部显示轻提示，例如 `Photo ready · View`。
- 点击后滚动回图片消息。
- 不自动打断用户当前输入。

### Refresh Recovery

刷新页面后：

- `queued` / `generating` 图片继续显示占位状态。
- `ready` 图片显示最终压缩图。
- `failed` 图片显示失败状态和简短说明。

## Proposed Backend Structure

新增生图能力必须独立成小模块，不直接塞进现有文本聊天主流程。

### New Files

#### `server/chat-image-generation-service.js`

入口服务。

职责：

- 接收用户消息、生图触发上下文和会话信息。
- 调用 trigger、quota、asset、job 等小模块。
- 创建图片占位消息。
- 创建异步 job。
- 返回本轮新增的图片占位消息。

#### `server/chat-image-trigger-service.js`

生图意图和允许场景判断。

职责：

- 判断用户消息是否像“拍照/穿给我看/上身效果”。
- 判断是否属于禁止场景，如白底图、商品主图、广告素材、批量图。
- 输出确定性结果，不直接调用 AI。

第一版以保守关键词和上下文规则为主，避免误触发。

#### `server/chat-image-quota-service.js`

额度和生成中锁。

职责：

- 查询同会话是否已有 `queued` / `generating` 图片任务。
- 查询当天该账号该会话成功生成数量。
- 生成成功后记录额度消耗。
- 提供自检用的纯函数或明确查询方法。

#### `server/chat-image-job-service.js`

异步任务执行服务。

职责：

- 从 `memory_jobs` 或独立 job payload 中读取生图任务。
- 组装 provider 请求。
- 调用 provider adapter。
- 压缩保存图片。
- 更新图片消息和 asset 状态。
- 失败时更新为 `failed`，并保留错误摘要。

用户会另行提供真实生图 API，因此这里先做 provider 边界，不写死某个供应商。

#### `server/chat-image-provider-service.js`

供应商适配层。

职责：

- 对业务层暴露统一方法，例如 `generateChatImage(payload)`。
- 真实 API 字段、鉴权、超时、错误映射都封装在这里。
- 后续更换供应商只改这个适配层或新增 adapter。

#### `server/chat-image-asset-service.js`

图片资产处理。

职责：

- 接收原始图片 buffer。
- 压缩为 WebP 或项目选定格式。
- 删除临时原图。
- 保存到受保护 uploads 目录。
- 返回宽高、大小、mime、内部路径。

不要复用头像压缩函数处理聊天图。头像是 512 正方形，聊天图需要自己的尺寸和质量策略。

#### `server/chat-image-copy-service.js`

固定文案库。

职责：

- 提供生成中、失败、完成提示等短文案。
- 按会话语言选择。
- 缺失语言 fallback 英文。

### Existing Files To Touch Later

#### `server/chat-text-message-service.js`

只允许做轻量接入：

- 用户消息保存后，调用 `chat-image-generation-service` 判断是否需要创建图片占位。
- 不在这里写生图 API、压缩、额度、状态机。

#### `server/memory-job-service.js`

新增 job type：

- `GENERATE_CHAT_IMAGE`

#### `server/memory-job-runner-service.js`

新增分支：

- `GENERATE_CHAT_IMAGE` -> `generateChatImageFromJob(job)`

#### `server/chat-query-service.js`

确保查询聊天记录时能返回 `image_generation` 消息和图片 asset payload。

#### `server/chat-message-store.js`

扩展消息映射：

- 支持 `content_type = image_generation`。
- 读取图片 payload / asset 状态。

#### `server/protected-upload-routes.js`

聊天生成图应走鉴权访问，不建议放在公开 uploads 下。

#### `server/db-bootstrap-tables.js`

新增图片资产表和额度表。

#### `database/schema.sql`

同步 schema 快照。

## Proposed Frontend Structure

### New Files

#### `src/features/chat/chat-image-message.js`

渲染图片消息。

状态：

- queued
- generating
- ready
- failed
- cancelled

#### `src/features/chat/chat-image-status-copy.js`

前端展示文案库。

后端也会提供状态和文案，前端文件只负责兜底展示，不作为业务规则来源。

#### `src/features/chat/chat-image-ready-toast.js`

图片完成轻提示。

职责：

- 用户当前不在图片附近时显示。
- 点击滚动到对应图片消息。
- 不打断输入。

### Existing Files To Touch Later

#### `src/features/chat/chat-message-renderer.js`

只加分流：

```js
if (message.contentType === "image_generation") {
  return renderChatImageMessage(...);
}
```

不要把图片消息 HTML 全写进这个文件。

#### `src/app/chat-data-actions.js`

确保刷新、轮询或重新加载时能保留图片消息状态。

#### `src/app/chat-text-actions.js`

如果后端返回图片占位消息，需要把它追加到当前消息列表中。

#### `src/features/app-shell/styles/chat.css`

增加图片消息样式。

必须保持移动端和桌面端不横向溢出。

## Data Model Draft

### `chat_image_assets`

建议字段：

- `id`
- `message_id`
- `session_id`
- `internal_uid`
- `character_id`
- `status`
  - `queued`
  - `generating`
  - `ready`
  - `failed`
  - `cancelled`
- `storage_path`
- `protected_path`
- `width`
- `height`
- `bytes`
- `mime_type`
- `prompt_summary`
- `provider`
- `provider_request_id`
- `error_message`
- `created_at`
- `updated_at`
- `completed_at`

建议索引：

- `idx_chat_image_assets_message (message_id)`
- `idx_chat_image_assets_session_status (session_id, status, created_at)`
- `idx_chat_image_assets_user_date (internal_uid, created_at)`

### `chat_image_usage`

建议字段：

- `id`
- `internal_uid`
- `session_id`
- `character_id`
- `usage_date`
- `message_id`
- `asset_id`
- `created_at`

建议唯一约束：

- `uniq_chat_image_usage_message (message_id)`

建议索引：

- `idx_chat_image_usage_user_session_date (internal_uid, session_id, usage_date)`

### `chat_messages`

复用现有消息表：

- `content_type = image_generation`
- `delivery_status = queued / generating / ready / failed / cancelled`
- 图片详情通过 `chat_image_assets.message_id` 关联。

如果后续发现前端需要更轻量读取，也可以在 `product_payload_json` 类似字段中放少量状态 payload，但第一选择是独立资产表。

## Phases

## Phase 0: Plan And Baseline

### Goal

落地方案文档，确认代码落点、分批范围和验收标准。

### Scope

- 新增本计划文档。
- 不改功能代码。
- 不接真实生图 API。

### Acceptance Criteria

- 文档写清楚后端落点、前端落点、数据结构、分批计划和风险。
- 每一批都有独立验收标准。
- 明确写出不做范围，避免功能失控。

### Verification

- 确认文档路径在 `docs/superpowers/plans/`。
- `git diff --check -- docs/superpowers/plans/2026-06-30-chat-image-generation.md` 通过。

## Phase 1: Data And State Skeleton

### Goal

先把“图片消息状态”打通，不接真实生图。

### Scope

- 新增 `chat_image_assets`。
- 新增 `chat_image_usage`。
- 新增 `content_type = image_generation` 的读写映射。
- 新增最小后端服务骨架。
- 新增 mock job，把图片任务从 `queued` 推到 `ready` 或 `failed`。

### Out Of Scope

- 不接真实生图 API。
- 不做角色参考图。
- 不做商品图参考。
- 不做复杂触发语义。

### Acceptance Criteria

- 可以创建一条图片占位消息。
- 刷新页面后占位消息仍存在。
- mock job 可以把占位消息更新为完成状态。
- mock 完成后生成一条可展示的测试图片 asset。
- 失败状态可以被正确展示和恢复。

### Verification

- `node --check server/chat-image-generation-service.js`
- `node --check server/chat-image-job-service.js`
- `node --check server/chat-image-asset-service.js`
- `node --check server/chat-image-quota-service.js`
- `node --check server/db-bootstrap-tables.js`
- 新增 `scripts/chat-image-generation-state-self-check.mjs`
- `git diff --check -- <touched files>`
- 本地打开聊天页，确认图片占位刷新后仍存在。

## Phase 2: Trigger, Quota And Lock

### Goal

把生图触发、生成中锁和成功后扣额度做成后端硬规则。

### Scope

- 新增 `chat-image-trigger-service.js`。
- 新增触发规则：
  - 允许角色照片、穿搭、商品上身；
  - 拒绝主图、广告图、白底图、批量图。
- 新增生成中锁。
- 新增成功后扣额度。
- 新增额度用完后的拒绝回复入口。

### Out Of Scope

- 不接真实生图 API。
- 不做后台额度配置。

### Acceptance Criteria

- 同一会话有 `queued` / `generating` 时，不再创建第二个图片任务。
- 任务 `ready` / `failed` / `cancelled` 后，锁释放。
- 成功后扣额度。
- 失败、超时、取消不扣额度。
- 当天额度用完后，再次请求只生成普通回复，不创建图片任务。
- 明显电商主图请求不会触发生图。

### Verification

- 新增 `scripts/chat-image-trigger-self-check.mjs`
- 新增 `scripts/chat-image-quota-lock-self-check.mjs`
- 新增 `scripts/chat-image-rejection-reply-self-check.mjs`
- 本地真实链路：
  - 发一条触发生图消息；
  - 生成中再发一条“再拍一张”；
  - 确认没有第二个 job；
  - mock 完成后再请求；
  - 确认额度已用完且只回复文本。

## Phase 3: Frontend Image Message UX

### Goal

把图片消息做成真实聊天体验。

### Scope

- 新增 `chat-image-message.js`。
- 新增 `chat-image-status-copy.js`。
- 新增 `chat-image-ready-toast.js`。
- `chat-message-renderer.js` 只加分流。
- 增加图片消息样式。

### Out Of Scope

- 不接真实生图 API。
- 不做图片编辑。

### Acceptance Criteria

- 图片占位显示 spinner 和口语化文案。
- 文案跟会话语言走，缺失语言 fallback 英文。
- 生成完成后原地替换为图片。
- 用户继续聊天时，图片位置不变。
- 图片完成但用户已滚到下方时，底部出现轻提示。
- 点击轻提示能滚回图片。
- 桌面和手机端无横向溢出。

### Verification

- 新增 `scripts/chat-image-message-renderer-self-check.mjs`
- 新增 `scripts/chat-image-status-copy-self-check.mjs`
- Playwright 或浏览器真实链路：
  - 桌面聊天页；
  - 手机视口聊天页；
  - 生成中状态；
  - ready 状态；
  - failed 状态；
  - 刷新恢复状态。

## Phase 4: Real Provider Adapter

### Goal

接入用户后续提供的真实生图 API。

### Scope

- 在 `chat-image-provider-service.js` 中接真实 API。
- 支持超时、错误映射、重试边界。
- 支持返回图片 buffer 或图片 URL 的两种常见形式。
- 保持业务层不直接依赖供应商字段。

### Out Of Scope

- 不做 OpenAI 官方方案绑定。
- 不把供应商字段散落到聊天服务、前端组件或数据库多处。

### Acceptance Criteria

- 真实 API 成功返回后，图片被压缩保存。
- 原图临时文件不长期保留。
- 最终消息展示压缩图。
- provider 报错时，消息进入 `failed`，不扣额度。
- provider 超时时，消息进入 `failed`，不扣额度。

### Verification

- 新增 `scripts/chat-image-provider-contract-self-check.mjs`
- 新增 `scripts/chat-image-compression-self-check.mjs`
- 本地真实链路：
  - 用真实 API 生成 1 张；
  - 刷新页面确认图片仍可看；
  - 检查最终文件大小和格式；
  - 检查原图没有长期残留。

## Phase 5: Character And Product Context

### Goal

让图片真正结合角色形象和商品上下文，而不是泛泛生成。

### Scope

- 从角色资料取：
  - avatar；
  - name；
  - category；
  - persona / backstory；
  - current language；
  - style constraints。
- 从商品上下文取：
  - product title；
  - selected size；
  - product image；
  - product attributes。
- 组装最小 prompt/context payload 给 provider adapter。

### Out Of Scope

- 不做复杂 prompt 管理后台。
- 不做用户自定义风格参数。
- 不做多图选择。

### Acceptance Criteria

- 用户在商品详情或商品气泡上下文里请求“你穿给我看”，生成任务能拿到商品上下文。
- 没有商品上下文时，仍能生成角色普通照片。
- 角色相关信息不会把敏感后台配置带给 provider。
- prompt/context payload 有长度限制和清洗。

### Verification

- 新增 `scripts/chat-image-context-builder-self-check.mjs`
- 本地真实链路：
  - 先触发商品气泡；
  - 选尺码；
  - 请求角色上身照片；
  - 检查 job payload 包含角色和商品摘要；
  - 不包含 token、后台 API、用户隐私配置。

## Phase 6: Hardening And Release

### Goal

做完整回归、自检、日志和发布准备。

### Scope

- 增加最终 self-check。
- 增加 release 文档。
- 更新 `docs/current-workspace.md`。
- 更新 `logs/updates/YYYY-MM-DD.md`。
- 如需部署，再按发布规则打包上线。

### Acceptance Criteria

- 普通文字聊天不受影响。
- 语音回复不受影响。
- 商品气泡不受影响。
- 主动消息不受影响。
- 聊天记录加载不受影响。
- 私密资源鉴权不退化。
- 生图失败不影响普通聊天。

### Verification

必须至少执行：

- `node --check server/chat-text-message-service.js`
- `node --check server/memory-job-runner-service.js`
- `node --check server/chat-query-service.js`
- `node --check server/chat-message-store.js`
- `node --check src/features/chat/chat-message-renderer.js`
- 所有新增 `chat-image-*` self-check。
- `node scripts/runtime-chat-self-check.mjs`
- `node scripts/chat-ai-non-stream-self-check.mjs`
- `node scripts/chat-reply-voice-text-alignment-self-check.mjs`
- `node scripts/chat-product-panel-state-self-check.mjs`
- `node scripts/upload-dirs-self-check.mjs`
- `npm run check:deployment`
- `git diff --check -- <touched files>`

真实链路至少覆盖：

- 管理员或测试账号给角色发普通文本，正常回复。
- 触发生图，出现占位。
- 生成中继续发消息，普通聊天继续。
- 生成中再次请求生图，不创建第二个 job。
- 生成成功后刷新页面，图片仍在触发消息附近。
- 额度用完后再次请求，只有委婉回复，没有图片 job。
- 手机端无横向溢出。

## Initial Risk Notes

### Risk 1: `chat-text-message-service.js` 继续变胖

这是当前最大结构风险。

处理原则：

- 文本消息服务只负责调用生图入口。
- 额度、锁、provider、压缩、状态机都放到独立 `chat-image-*` 文件。

### Risk 2: `memory_jobs` 已承载很多后台任务

新增图片 job 需要注意：

- 不影响主动消息；
- 不影响记忆总结；
- job runner 失败不能让整个 batch 卡死；
- 图片 job 应该有合理超时和重试次数。

### Risk 3: 生成中状态和聊天继续发送可能乱序

处理原则：

- 图片消息创建时就有固定 `display_order`。
- 图片完成只更新原消息，不插入新消息。
- 前端按 `display_order` 排序。

### Risk 4: 图片资源权限

生成图可能包含角色形象和用户上下文，不能默认公开。

处理原则：

- 走受保护访问路径。
- 不放到公开 uploads 白名单。
- 复用现有 protected upload 鉴权模式。

### Risk 5: 供应商 API 未定

用户会后续提供生图 API。

处理原则：

- 先做 provider adapter 边界。
- Phase 1-3 用 mock 或本地假图完成状态链路。
- 不把 OpenAI 或任何单一供应商写进业务层。

### Risk 6: 误触发和滥用

用户可能用聊天功能白嫖做商品主图。

处理原则：

- 第一版额度低。
- 触发规则保守。
- 禁止场景后端硬拦截。
- 拒绝后只走普通回复，不创建图片 job。

### Risk 7: 失败扣额度

生成失败、压缩失败或保存失败都不应扣额度。

处理原则：

- 额度消耗必须发生在 asset 保存成功并且消息更新为 `ready` 之后。
- 使用唯一约束避免重复扣同一条消息。

## Checkpoint Strategy

建议每个 phase 单独形成检查点。

如果进入代码实现阶段：

- 每个 phase 完成后先跑对应 self-check。
- 每个 phase 完成后做一次真实链路验证。
- 每个 phase 完成后更新 release/log/current-workspace。
- 验证失败不进入下一 phase。

## Not Decided Yet

以下内容等用户提供生图 API 或确认业务口径后再定：

- 真实 provider 的请求字段。
- provider 是否支持参考图。
- provider 是否返回 URL、base64、文件流或任务 ID。
- 生成图最终尺寸。
- WebP 质量值。
- 是否给生成图加水印。
- 是否允许用户下载原尺寸图。
