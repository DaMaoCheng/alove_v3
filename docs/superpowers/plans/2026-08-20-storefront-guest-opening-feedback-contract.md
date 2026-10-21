# 游客前台开场白与反馈入口契约收口（本地）

## 目标与边界

修复所有前台角色的两条共享游客链路：

1. 新会话开场白必须按该会话已确定的站点语言，读取角色已保存的语言包；缺少该字段才回退角色原文。
2. 角色只有在系统确实会写入反馈动作时，才允许回复承诺反馈入口；物流单号等当前不能在站内核验的确定性服务边界，必须同时生成一个真实反馈按钮。

本轮不改角色内容、站点设置、产品搜索、TTMall、服务器或 GitHub。

## 实现

1. 新增 `server/character-localized-content-service.js`：仅解析并校验 `localized_content.translations.<language>.openingLine`，按会话语言返回非空开场白，失败/缺失回退 canonical `opening_line`。不在读取时调用模型或改写数据库。
2. `server/guest-session-service.js` 与 `server/chat-opening-message-service.js`：角色查询补齐 `localized_content`；游客首次会话、游客激活公开角色、已登录用户首次会话均复用同一个解析器，文本和开场 TTS 使用同一已解析值。
3. `server/chat-feedback-action-service.js`：抽出 `resolveChatFeedbackActionCandidate`。候选覆盖既有定制、终局无商品匹配、无可信客服知识，以及确定性的物流追踪号/追踪请求；最终写库动作继续以候选为唯一来源，并保留 AI transport fallback 门禁。
4. `server/chat-prompt-service.js`、`server/chat-global-reply-policy.js`、`server/chat-reply-orchestrator-service.js`、`server/guest-reply-service.js`：同一候选同时进入提示词和最终动作。无候选时禁止模型暗示“下方反馈按钮”；有候选时系统在回复后落真实动作，模型不自行写 CTA。
5. `server/guest-chat-output-policy.js`：物流受控回复按会话语言输出，并不再自行承诺不存在的按钮；统一追加层只在真实动作存在时提供反馈引导。

## 验收

- 单元/服务自检：匈牙利语、土耳其语开场白从 stored map 读取；无 map 回退 canonical；feedback candidate 对 tracking/no-knowledge/no-match 生效，已知知识/普通闲聊/AI fallback 不生效。
- 游客本地真实链路：在 `mezkiraly` 创建新 guest 会话，首条开场白为匈牙利语；发送追踪号后得到匈牙利语受控回复并且恰好一个 `feedback_action`；同 client message 重试不重复动作。测试 guest 完成后清理。
- 回归：现有 guest/product/feedback 自检通过；`git diff --check` 通过。

## 风险控制

- 不按模型语义、历史文本或浏览器状态推断动作；仅使用服务端可验证上下文。
- 不扩展到普通非前台角色；不因一般“不知道”问题滥发反馈。
- 不覆写现有会话中的历史开场白，修复仅影响新插入的 opening message。

## 执行结果（本地）

- 已完成：共享开场语言解析、游客首次会话/角色切换/开场语音接入、服务端反馈候选、提示词与写库收口、受控物流多语言回复及回归测试。
- 已验证：匿名浏览器在 `mezkiraly` 新建会话显示匈牙利语开场白；物流单号与到货时间问题均产生一枚真实 `feedback_action`，点击复用现有 Feedback 弹窗。
- 保留边界：无可信候选时不会承诺或生成反馈入口；AI transport fallback 不生成动作；不修改旧会话历史；仅本地变更。
