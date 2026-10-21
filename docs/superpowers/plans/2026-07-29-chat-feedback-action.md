# 聊天未解决问题反馈入口实施方案

## 目标

当站点前台或网红角色依据可信上下文仍无法解决用户的独立站问题时，保留角色的自然说明作为第一条文字消息；紧接着发送第二条紧凑行动消息，展示与页面右上角一致的反馈 icon 和当前语言的“点击这里”文案。用户点击后直接打开既有 Feedback 弹窗。

本方案不新增反馈页面、提交接口、数据库表、邮箱校验逻辑或后台列表；弹窗继续使用现有样式、背景模糊、站点记录、游客必填联系邮箱和限流保护。

## 批次 1：把既有反馈弹窗变为可复用打开能力

### 修改范围

- `src/features/notifications/notification-panel.js`
  - 保留现有反馈弹窗 HTML、提交逻辑、关闭逻辑、背景模糊 class 和游客邮箱校验。
  - 抽出 `openFeedbackDialog({ guestMode })`：无论当前是否处于带顶部栏的页面，都确保现有反馈弹窗已挂到 `document.body`，然后用原有方式打开和聚焦主题输入框。
  - 顶部右上角 icon 继续调用同一个打开方法；不保留两份弹窗结构。
- `src/features/app-shell/app-topbar.js`
  - 仅把 `guestMode` 传给已存在的绑定函数，保持顶部入口行为不变。

### 不做

- 不改变 Feedback 表单字段、接口、数据库字段或后台列表。
- 不在聊天页重写 modal、scrim、blur 或邮箱格式校验。

### 验收

- 首页右上角反馈 icon 与聊天行动按钮打开的是同一个弹窗结构。
- 游客打开时仍有必填 `Contact email` 和原有 500ms 校验；登录用户维持现有字段行为。
- 打开后 `body.feedback-open` 仍生效，背景模糊和关闭/Escape 行为不变。

## 批次 2：受控生成第二条反馈行动消息

### 修改范围

- 新增 `server/chat-feedback-action-service.js`
  - 只对 `mascot` 与 `creator`（前台、网红）角色生效。
  - 仅在服务端已确认的未解决条件下生成行动 payload：可信商品检索无结果，或客服知识意图没有可用参考。
  - AI transport fallback、普通闲聊、已经有商品候选、已有知识参考和其他角色均不生成，防止把服务器异常或普通话题误导成收集联系方式。
  - 根据角色配置语言生成简短行动文案；payload 不含用户邮箱或其它隐私数据。
- `server/chat-reply-orchestrator-service.js`
  - 在正式用户的文字/语音聊天持久化中，把行动消息作为角色文字回复之后的第二条消息写入，`content_type=feedback_action`，不创建语音、不进入商品统计。
- `server/guest-reply-service.js`
  - 使用同一 service，在游客聊天采用相同条件与顺序持久化行动消息。
- `server/chat-message-store.js`
  - 将 `feedback_action` payload 映射为明确的客户端字段，保留既有 `text`、`product`、附件、商品卡和图片映射。

### 数据与顺序

```text
用户消息
  → 角色文字回复（第一条，按人设说明不能确认/解决）
  → feedback_action（第二条，icon + Click here）
```

无需 migration：`chat_messages.content_type` 已是可扩展的 `VARCHAR(32)`，现有 `product_payload_json` 可保存不含敏感信息的行动 payload。

### 不做

- 不让模型自由决定或伪造商品、客服结果或反馈入口。
- 不把行动消息加入 TTS、用户记忆、商品消息、促销投放或产品曝光统计。
- 不因为服务超时/模型 fallback 而提示用户留下联系方式。

### 验收

- FKK/GG 与未来站点均只在当前站点上下文下生成行动消息；不硬编码站点名。
- 前台/网红的可信无结果会有且仅有一条行动消息；普通角色和已解决问题没有。
- 游客与登录用户都会持久化、刷新可恢复该行动消息；行动 payload 不包含邮箱。
- 商品卡、语音、图片、折扣、知识库已命中回复的顺序和内容保持原样。

## 批次 3：聊天渲染与真实链路验证

### 修改范围

- `src/features/chat/chat-message-renderer.js`
  - 新增 `feedback_action` 专用渲染：不显示多余正文或语音，只显示复用的反馈 icon 和紧凑可点击标签。
- `src/features/chat/chat-page.js`
  - 为行动按钮绑定 `openFeedbackDialog({ guestMode })`，不新增网络请求。
- `src/features/app-shell/styles/chat.css`
  - 仅补充行动消息的紧凑样式；桌面/移动端均保持在聊天消息流内，弹窗本身继续沿用 `overlays.css`。
- 相关自检脚本
  - 覆盖服务端条件、消息顺序、游客/正式用户边界、渲染按钮和复用弹窗打开行为。

### 真实链路验收

1. 本地 FKK 前台或网红输入一个可确定没有结果的商品需求。
2. 确认先出现角色的自然致歉/说明，再出现 icon + 行动按钮。
3. 点击行动按钮，确认原 Feedback modal 打开、背景模糊保留、当前站点在提交后进入后台反馈记录。
4. 游客重复验证，确认联系邮箱必填、500ms 校验和发送禁用状态不变。
5. 验证一个可正常命中的商品问题、一个知识库已命中的客服问题、一个普通角色问题，确认均不出现行动按钮。

## 回退

- `feedback_action` 是独立消息类型；回退前端后旧客户端只会把它按普通角色消息降级显示，不影响历史聊天、商品卡或反馈数据。
- 回退服务端后不会再写入新的行动消息；既有反馈表、接口和历史消息均不受影响。
