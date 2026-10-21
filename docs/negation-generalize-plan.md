1	# 生图否定语义判定 · 通用化收敛方案（最终落地版）

问题回顾：访客否定类生图请求被 `resolveChatImageRequestConstraints` 的穿戴正则
`/穿|试穿/…` 裸命中「穿」字 → 误判穿戴=true → 最终 prompt 被塞进「自然服装 + 随机 wardrobe 服装段」，
与完整用户消息打架；上游 Venice 对这类裸露画面还会返回隐私模糊图。
第一版把这件事拆散到四处（专门否定正则 + 特殊 prompt 句 + 多语种罗列 + 裸露自检用例），本版按"判定处识别否定、
完整原话原样往下走"的思路收敛，去掉冗余与露骨措辞。

不改行为边界：布尔结论 `{ wants_no_clothing, wants_clothing }` 保留（字段名不动），阈值 0.7 不动，
wardrobe 随机服装维度在否定命中时跳过的逻辑保留，完整用户消息原样拼进最终 prompt。

备份：git tag `backup/pre-neg-generalize-20261001` + `.backups/neg-generalize-20261001/`。

---

改动 4（处文件）+ 自检脚本，全部收敛在本次新增功能路径，不碰其他运行中功能：

1) server/jev-intent-service.js（说明文字精简，字段 / 阈值 / 出口结构不动）
   - `image_wants_no_clothing.instructions`：去掉罗列各国裸露词的举例，改通用说明
     （通用：据语义判断该图请角色是否无任何服装，不限语种；普通照片或试穿请求判 false）。
   - 其余（读答案、>=0.7 阈值、imageConditions、mapJevImageIntent 出口）不动。

2) server/chat-image-intent-classifier-service.js（fallback 说明句精简）
   - Venice gemma JSON fallback 的 schema 说明句去掉罗列裸露词的举例，改通用一句。
   - JSON key（wants_no_clothing/wants_clothing）、normalizeConditions 逻辑不动。

3) server/chat-image-variation-service.js
   - NEGATED_CLOTHING_PATTERN：删掉西 / 葡 / 土 / 德语罗列，保留否定骨架
     （英文 no/not/without + clothes/clothing/outfit）仅作语义服务不可用时的兜底，平时不生效；完整否定原话仍原样进最终 prompt。
   - 删未引用的常量 NO_CLOTHING_WARDROBE（dead code）。
   - resolve 逻辑、wardrobe 跳过、维度输出过滤不动。

4) server/chat-image-provider-service.js
   - buildFirstPersonScenePrompt：删掉否定专用的特殊 prompt 句早退分支
     早退分支。否定且无商品 / 无上传服装的请求自然落到已有的通用分支
     「natural portrait photo … + 完整用户消息原样」（User photo request: 行本就带完整原话，不改）。
   - 其余分支（合影 / 商品 / 上传服装 / wantsWear / 默认）不动。

自检脚本 scripts/chat-image-variation-self-check.mjs：裸露用例换成常规否定 + 留 1 个否定命中
   - 「take a photo without clothing」→ wants_no_clothing=true / wants_clothing=false / wantsWear=false / usesProductReference=false
   - 「我想要不要红色的」「去掉帽子」「take a photo with no red」→ wants_no_clothing=false / wants_clothing=false（常规否定不误判）
   - 「try this on without underwear」+ 商品 → wants_clothing=true / usesProductReference=true（穿戴翻转否定，回归）
   - semantic 优先两组（普通否定 / try-on）换通用措辞 userText，断言保留
   - 原有用例（重试稳定 / try-on / ordinary / historical / 语种 try-on）回归

---

验收（全部过才算完，均本地）：
1. node --check 四个 js —— 通过
2. node scripts/chat-image-variation-self-check.mjs —— passed
3. node scripts/chat-image-final-regression-self-check.mjs —— passed（真实 3307 库 + job + 配额 + summary 不含 provider prompt）
4. 真实链路端到端（本地 4173 访客，一条否定消息）：ready 出图，
   prompt_full_text 完整带用户否定原话、无矛盾服装段、无否定专用 prompt 句，imageRequestConstraints.wants_no_clothing=true 落库
5. git diff 只动 4 个 js + schema 不动 + 自检脚本，无其他
6. 现有正常会话 + 文本回复仍通（回归，不额外触发）

不改：schema / bootstrap / quota / entitlement / 每日配额 / 失败安抚 / 前端 / 其余表。

---
二轮清扫：残留裸露措辞一次性收敛（本次发现残留，补清）
残留位置（裸露词，通用 clothes 除外）：
1) server/jev-intent-service.js —— 说明句裸露罗列 → 通用「wear no clothing」
2) server/chat-image-intent-classifier-service.js:125 —— 同上
3) server/chat-image-variation-service.js —— 兜底正则删罗列裸露 / 否定词，只留英文否定骨架；完整否定原话仍进最终 prompt
4) scripts/chat-image-variation-self-check.mjs —— 裸露 / 服装用例 → 常规否定用例，注释同步通用化
5) docs/image-negative-semantic-fix-plan.md + docs/negation-generalize-plan.md —— 罗列裸露词 / 用户原话裸露例 通用化

验收：node --check 4 js + variation + final-regression + grep 复查裸露词清零（两天日志 + 本次文件 + docs）。


## 2026-10-01 发布前收敛

以 `docs/releases/2026-10-01-chat-image-semantic-release.md` 和实际代码为准，以上分步描述保留为历史实现记录。
- 确定性允许的真实图片请求也获取语义条件：复用已有可信 JEV 结果，否则调用现有 classifier；硬拦截及 mock 请求跳过。
- 保留合法的两个 false 条件，不因值均为 false 退回正则；缺失或非布尔字段才视为语义不可用。
- `NO_CLOTHING_WARDROBE` 和否定专用 prompt 早退分支已经移除，不再属于遗留问题。
- 已补无注入 JEV 的入口回归、同消息缓存回归及 Pro/Lite 编辑模型隔离测试。
