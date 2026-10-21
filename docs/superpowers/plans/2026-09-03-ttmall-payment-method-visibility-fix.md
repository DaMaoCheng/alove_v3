# TTMall 支付方式显示修复方案

## 目标

结算弹窗应显示 TTMall `/v1/payment` 返回的所有 ALOVE 可安全承载的支付方式。非银行卡支付方式不能因存在 `payment_param` 而被误隐藏；银行卡、CVV、有效期等敏感输入方式仍不可选。

## 代码级方案

### 1. 服务端支付方式映射

- 文件：`server/ttmall-checkout-client-service.js`
- 位置：`mapPayment()`。
- 调整：将“`payment_param` 非空”改为敏感字段判定；识别字段名中的 card、CC、CVV、CVC、安全码、expiry/expiration 等明确敏感输入。
- 兼容：尊重上游显式 `requires_sensitive_input` 标记；字符串参数无法安全解析时 fail-closed。
- 边界：不把 `payment_param` 原文返回浏览器，订单提交仍只传 `payment_id`。

### 2. 前端结算渲染

- 文件：`src/features/chat/chat-ttmall-checkout-panel.js`
- 位置：`renderOptions()`。
- 保持现有过滤边界：仅过滤 `requiresSensitiveInput === true`，因此服务端修正后非银行卡方式会自动进入下拉选项。
- 不改共享下拉组件、默认选择、订单提交流程或其他平台商品面板。

### 3. 回归保护

- 文件：`scripts/ttmall-checkout-self-check.mjs`
- 增加非银行卡参数可选、银行卡参数仍不可选的接口映射场景。
- 保留订单请求字段断言，确保不会把 provider 参数带到浏览器或订单请求。

## 验收标准

1. `/v1/payment` 返回含非银行卡参数的方式时，结算下拉显示并可选择该方式。
2. 含卡号、CVV/CVC、有效期等敏感字段的方式仍不显示。
3. 创建订单请求只提交 `payment_id` 等既有字段，不提交 `payment_param`。
4. TTMall checkout/cart 目标自检、语法检查、diff 检查和本地健康接口通过。
5. 完整部署门禁若出现无关既有自检失败，必须单独记录，不借本次需求修改共享下拉组件。

## 风险与回退

- 风险：上游新增未知敏感字段时可能需要补充敏感字段模式；当前未知字符串参数解析失败仍按敏感处理。
- 回退：回退本次提交即可恢复原判定，不涉及数据库迁移。

## 本次不做

- 不修改 TTMall API 参数合同。
- 不开放银行卡/CVV 收集。
- 不改其他站点或 Shopify 支付方式配置。
