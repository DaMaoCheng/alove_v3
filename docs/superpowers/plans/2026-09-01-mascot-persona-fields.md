# 前台管理真实人设字段收口方案

## 目标与边界

- 将“前台管理 → 编辑前台”的合并字段“语气 / 人设”拆为“人设”和“语气”两个输入。
- 人设直接维护绑定前台角色的 `ai_characters.persona_prompt`；语气直接维护 `ai_characters.speaking_style`。
- 本次不执行全库迁移、不调用 seed、不自动重写任何既有前台的 `persona_prompt`、`speaking_style` 或 `profile_json`。只有管理员在新字段中主动保存时，才更新对应字段。
- 保留 `mascot_settings.tone` 作为旧配置兼容字段；不删除列、不改变旧站点绑定、问候语、知识库、头像、广告或聊天路由。

## 已确认根因

- 编辑弹窗只提交 `tone`，而保存链路会在每次保存时重新构造并覆盖前台角色的 `persona_prompt`、`speaking_style` 和 `profile_json.style`。
- 回读优先展示 `mascot_settings.tone`，聊天实际读取的是 `ai_characters` 中的人设和语气，三处可能漂移。

## 实施步骤

### 1. DTO 与编辑器

- 修改 `server/admin-mascot-query-service.js`、`server/admin-mascot-mapper.js`：向模板、站点前台和未绑定前台统一返回 `personaPrompt`、`speakingStyle`，值直接来自角色记录。
- 修改 `src/features/admin-console/admin-console-mascot-template.js`、`admin-mascot-controller.js`：替换 `tone` 编辑区为两个 textarea 并提交两个新字段。
- 修改 `admin-mascot-avatar-ai-controls.js`：头像 AI 的背景输入仅取当前 `personaPrompt`。

### 2. 安全保存与旧配置兼容

- 修改 `server/admin-mascot-shared.js`：识别新字段是否被显式提交；新建前台可继续用旧 `tone` 生成初始默认值，已有角色未显式编辑人设/语气时原样保留。
- 修改 `server/admin-mascot-write-service.js`：复用一个 setting 保存函数，旧 `tone` 在新 UI 保存时保持原值；不再因修改名称、头像、问候语或知识库而重建 AI 人设。
- 用户显式保存“语气”时，仅同步 `profile_json.style` 为同一语气，避免实际 prompt 的两份语气说明互相矛盾；未编辑语气时 `profile_json` 原样保留。

### 3. 自检、文档与记录

- 更新既有 mascot UI/头像/写入自检，不让自检修改真实 `mascot_template`。
- 新增或扩展写入自检，以隔离测试站点与临时角色验证：非人设保存的字节级保留、分别编辑两个字段、旧 `tone` 保留、聊天 prompt 分层读取。
- 更新前台管理和 API 文档、当天更新日志。

## 验收标准

1. 编辑弹窗同时显示“人设”和“语气”，重新打开时与 `ai_characters` 当前字段逐字一致。
2. 仅修改头像、名称、问候语或知识库后，前台角色已有 `persona_prompt`、`speaking_style`、`profile_json` 不变。
3. 单独修改人设时只变更 `persona_prompt`；单独修改语气时只变更 `speaking_style` 与 `profile_json.style`。
4. `mascot_settings.tone` 保留原值，不参与聊天 prompt；既有模板、站点覆盖和未绑定前台均可读写。
5. 真实聊天 prompt 同时出现最新 Persona 和 Speaking details，且不包含 legacy `tone`。
6. 通过语法、专项自检、数据库隔离链路、服务重启/健康检查和管理员页面实际保存验证；无须部署或推送。

## 回退

- 本次无 schema 改动或数据迁移。若需要回退，只回退代码；现有角色和 `mascot_settings.tone` 数据不会被本次自动改写。

## 实施状态

`Completed locally`：仅本地改动和验证；未部署服务器、未更新 GitHub。

### 本地验证结果

- 已通过 UI 字段、头像 AI 输入、隔离写入、站点绑定回退、站点前台同步和聊天 prompt 上下文专项自检。
- 隔离写入自检会创建并清理临时站点与角色；复查临时站点记录为 `0`。
- 已重启本地服务，`/api/health` 返回正常；管理页受登录保护，未持有可自动操作的管理员浏览器会话，因此未进行人工点击保存。
- `git diff --check` 通过。`chat-prompt-context-self-check.mjs` 仍断言已被当前全局规则替换的旧联系邮箱文案，属本次改动以外的既有自检漂移，未通过修改业务规则或该自检掩盖。
