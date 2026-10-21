# 生图否定语义误判 · 修复方案（语义提取为主 + 正则为兜底）· 与最终落地一致版

背景会话：`guest_anonymized`，用户发了一条否定类生图请求
被误判 `wantsWear=true`，prompt 里「wearing a natural outfit」+ wardrobe 随机 + 用户原话三段打架。
原始事故根因在 `server/chat-image-variation-service.js` 的 `resolveChatImageRequestConstraints`：穿戴正则裸匹配，无否定分支。

路线：新增语义结论 `conditions = { wants_no_clothing, wants_clothing } | null`。
主体走已有语义链路（typesafe JEV 主 / Venice gemma JSON fallback）产出，语种无关；
关键词正则只降级为「语义不可用时的兜底」，最小否定词表，不穷举语种。
判定结论一次性进 job payload，job 重放不再二次判定；最终 prompt 全文单独落库。

自检环境：本地 node 服务 `127.0.0.1:4173`，本地库 `mysqld @127.0.0.1:3307 / aiove_app`（线上库不动）。
备份：`.backups/img-negfix-20260930-161103/` + git tag `backup/pre-img-negfix-20260930-161103`。

---

## 点 1 · 条件提取（语义为主，正则为兜底）

### A) 上游语义链扩结构化输出
- `server/jev-intent-service.js`：
  - `buildQuestions()` 追加两个 noul 问题：
    `image_wants_no_clothing`（是否明确要求角色不穿任何服装，任一种语言，中性照片或服装请求判 false）、
    `image_wants_clothing`（是否明确要求角色穿戴 / try on / put on 服装、商品或自己上传的物件；泛化的拍照措辞不推定）。
  - `normalizeJevResponse`：`readNoul(...) >= 0.7` 阈值判定，返回里追加
    `imageConditions: { wants_no_clothing, wants_clothing }`。
  - `mapJevImageIntent`：return 追加 `conditions: decision.imageConditions || null`。
- `server/chat-image-intent-classifier-service.js`：
  - 新增 `normalizeConditions(raw)`：对象且两布尔任一为 true 时返回 `{wants_no_clothing,wants_clothing}`，否则 null。
  - `normalizeJevImageResult` / `normalizeClassifierResult`：结果追加 `conditions: normalizeConditions(...)`。
  - Venice fallback（`requestClassifier`）system prompt 的 JSON schema 追加
    `"wants_no_clothing": boolean, "wants_clothing": boolean` + 一句说明（同义判定规则，拿不准两布尔皆 false）。

产出约定（下游只读它，字段名固定）：
```js
conditions = { wants_no_clothing: bool, wants_clothing: bool } | null
```

### B) 正则降为兜底（最小否定词表，不穷举语种）
- `server/chat-image-variation-service.js` `resolveChatImageRequestConstraints`：
  - 新增入参 `semanticConditions = null`；
  - 新增模块级 `NEGATED_CLOTHING_PATTERN`：英文否定骨架 `no/not/without + clothes/clothing/outfit`，仅作语义服务不可用时的兜底；
    西 `sin ropa|vestido`、葡 `sem roupa`、土 `çıplak | açıkta`、德 `nackt | ohne kleidung/kleider`；
  - 计算规则：
    - `wants_no_clothing = semanticConditions ? semanticConditions.wants_no_clothing === true : NEGATED.test(request)`；
    - `wants_clothing = semantic ? semantic.wants_clothing === true && !wants_no_clothing : wantsWear && !wants_no_clothing`
      （穿戴正则保留原样，否定命中时被压回 false；显式 try-on 仍会翻回 true）；
    - `usesProductReference / usesUploadedClothing` 的穿戴门控从 `wantsWear` 改读 `wants_clothing`；
  - 出口：`wantsWear: wants_clothing`、新增 `wants_no_clothing / wants_clothing / conditions: semanticConditions || { wants_no_clothing, wants_clothing }`。
  （兜底路径 conditions 由正则回填，字段恒定存在。）

### 自检（点 1）· 已执行
`node scripts/chat-image-variation-self-check.mjs`，脚本尾部追加 4 组用例，原有用例回归：
- 「拍张不带服装的」（兜底路径）→ `wants_no_clothing=true / wants_clothing=false / wantsWear=false / usesProductReference=false`
- 「take a photo without clothing」（兜底）→ `wants_no_clothing=true / wants_clothing=false`
- 「try this on without underwear」+ 商品 → `wants_clothing=true / usesProductReference=true`（穿戴翻转否定）
- 两组 semanticConditions 优先用例（否定 / try-on）→ 语义结论逐字段命中、`conditions` 原样带出
结果：`chat image variation self-check passed`

---

## 点 2 · 判定结论一次性进 job，不再二次正则

- `server/chat-image-generation-service.js`：
  - `analyzeChatImageTriggerWithIntent` 语义分支 return 追加 `conditions: classified.conditions || null`；
  - `createChatImagePlaceholder` 入 `memory_jobs.payload_json` 的 payload 追加 `imageConditions: trigger?.conditions || null`
    （payload 是 JSON 列，结论随 job 持久化，重启 / 重试可恢复）；
- `server/chat-image-job-service.js` `generateChatImageFromJob`：job 解出
  `imageConditions: payload.imageConditions || null` 传给 `generateAndSaveChatImage`（新增同名入参）；
- `server/chat-image-provider-service.js` `generateAndSaveChatImage` → `buildChatImageGenerationContext`；
- `server/chat-image-context-builder.js` `buildChatImageGenerationContext(db,{assetId,messageId,imageConditions=null})`
  → `resolveChatImageRequestConstraints({ ..., semanticConditions: imageConditions })`；
  job 没带（恢复 / 旧 job）时为 null，走正则兜底，不比现状差。
- 占位消息 / quota / entitlement / 每日配额 / 失败安抚流程一概不动。

### 自检（点 2）· 已执行
- `node scripts/chat-image-final-regression-self-check.mjs`（真实 3307 库 + 真实入队 job）通过；
- 真实访客链路：session 里真实 JEV 判定 → 结论入 payload → job 执行，
  `chat_image_assets.prompt_context_json.imageRequestConstraints = {"wants_no_clothing":true,"wants_clothing":false,...}` 落库核验一致。

---

## 点 3 · prompt 拼装：否定结论优先、wardrobe 维度跳过

（`server/chat-image-provider-service.js` + `server/chat-image-variation-service.js`）
- `buildFirstPersonScenePrompt` 顶部新增早退分支（在任何 outfit / wearing 语句之前）：
  ```js
  if (constraints.wants_no_clothing && !hasProduct && !constraints.usesUploadedClothing) {
    （否定专用特殊 prompt 句，已删除）
  }
  ```
  （无商品 / 无上传服装的否定请求不再拼入任何穿戴描述；用户原话仍保留 `User photo request:` 一行，
  「Direct user requirements override…」一行保留不变。）
- `createChatImageVariation`：`constraints.wants_no_clothing` 时 `variation.wardrobe = ""`
  （随机 wardrobe 维度会被 provider 拼进固定 variation 段，留着会冒出矛盾服装句）；
- `getChatImageVariationInstruction`：wardrobe 行改为条件行 + `.filter(Boolean)`，空维度不再输出该行，其余五行不变；
  variation code 仍 6 位（code 只取索引，wardrobe 索引照常随机），不影响既有 code 稳定性。
- 普通 / 商品 / 合影 / 上传服装分支全部不动（回归锚）。

### 自检（点 3）· 已执行
- variation 自检脚本：新增断言均绿；
- final-regression（真实链路 mock 图）：prompt 断言 `Chat image variation {code}` summary + 无 outfit 矛盾段，通过；
- 真实 Venice 出图（本地 4173 访客会话，发一条否定类请求）：
  `prompt_full_text` 实读 —— 最终 prompt 带完整否定原话、无矛盾服装段，
  六维度除 wardrobe 行外齐全，全文无 outfit / wearing / street-style；图 1024x1792 落盘，job completed。
- 普通请求回归：六维度齐全输出不变（variation 脚本原有用例覆盖）。

---

## 点 4 · 最终 prompt 全文落库

- 迁移（定义 + bootstrap 两处，幂等 ALTER 兼容新旧库）：
  - `server/db-bootstrap-chat-tables.js`：`chat_image_assets` CREATE 加 `prompt_full_text MEDIUMTEXT NULL,`；
    追加 `await addColumnIfMissing("chat_image_assets","prompt_full_text","MEDIUMTEXT NULL AFTER prompt_context_json");`
  - `database/schema.sql`：同一行同步加入 CREATE。
- 取值：
  - `server/chat-image-job-service.js` `generateAndSaveChatImage`：
    mock 分支 `fullPrompt: ""`；真实分支 `fullPrompt: generated.prompt || ""`；
  - `updateChatImagePromptAndProvider({…,fullPrompt=""})` UPDATE 追加 `prompt_full_text=?`，values 追加 `fullPrompt`；
    （列 MEDIUMTEXT ~16MB，prompt 无截断需求；失败 / 重试分支只在成功后写，不动）；
  - `prompt_context_json` 内容不变（仍是安全摘要，`prompt_summary` 仍是 `Chat image variation {code}`，不含 provider 原话）。

### 自检（点 4）· 已执行
- 本地 3307 该列已迁移生效（mediumtext NULL），第二次 `addColumnIfMissing` 幂等无报错；
- final-regression `prompt_summary` 不含原话 / provider prompt 断言保持绿；
- 真实访客链路：`SELECT prompt_full_text FROM chat_image_assets WHERE message_id='msg_acb961a3…'` 非空且为当次完整 prompt。

---

## 实际改动文件清单（11 个）

- `server/jev-intent-service.js` —— 点 1A：两问题 + 阈值 + conditions 出口
- `server/chat-image-intent-classifier-service.js` —— 点 1A：normalizeConditions + 两处出口 + fallback schema
- `server/chat-image-variation-service.js` —— 点 1B：兜底否定词表 + wants_no_clothing / wants_clothing + wardrobe 跳过 + 维度输出过滤（点 3）
- `server/chat-image-generation-service.js` —— 点 2：trigger.conditions + payload.imageConditions
- `server/chat-image-job-service.js` —— 点 2：job 透传 + 点 4：fullPrompt 写入
- `server/chat-image-context-builder.js` —— 点 2：入参 + semanticConditions 传入
- `server/chat-image-provider-service.js` —— 点 3：删除否定专用 prompt 句
- `server/db-bootstrap-chat-tables.js` + `database/schema.sql` —— 点 4：prompt_full_text 两处
- `scripts/chat-image-variation-self-check.mjs` —— 点 1/3 新用例
- `docs/image-negative-semantic-fix-plan.md` —— 本文档

## 遗留 / 风险

- 一处 dead code：`server/chat-image-variation-service.js:51` 声明的 `NO_CLOTHING_WARDROBE` 常量无任何引用
  （早先方案的占位文案，落地时改为直接 `wardrobe=""`），不影响运行，后续顺手摘除。
- `wants_no_clothing=true` 且同时带商品 / 上传服装引用的复合场景走原分支（早退分支条件排除两者），
  由「Direct user requirements override…」一行兜住，真实链路未见矛盾输出。
- 线上 3306 未动；上线时走常规发布流程，bootstrap 会对线上幂等补列。


## 2026-10-01 发布前收敛

以 `docs/releases/2026-10-01-chat-image-semantic-release.md` 和实际代码为准，以上分步描述保留为历史实现记录。
- 确定性允许的真实图片请求也获取语义条件：复用已有可信 JEV 结果，否则调用现有 classifier；硬拦截及 mock 请求跳过。
- 保留合法的两个 false 条件，不因值均为 false 退回正则；缺失或非布尔字段才视为语义不可用。
- `NO_CLOTHING_WARDROBE` 和否定专用 prompt 早退分支已经移除，不再属于遗留问题。
- 已补无注入 JEV 的入口回归、同消息缓存回归及 Pro/Lite 编辑模型隔离测试。
