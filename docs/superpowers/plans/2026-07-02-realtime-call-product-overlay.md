# 2026-07-02 Realtime Call Product Overlay Plan

## Goal

在实时通话期间，如果用户说的话触发了商品消息：

- 聊天对话框内继续保留普通商品气泡。
- 通话弹窗不中断、不关闭、不重启。
- 商品详情自动从底部向上展开，层级高于通话弹窗，叠在通话弹窗上方。
- 用户关闭商品详情后，通话弹窗中间的 `Shop` 按钮右上角出现红色圆形白色感叹号。
- 点击 `Shop` 后重新打开最近一次商品详情。
- 同一通话内触发多个商品时，商品详情支持左右滑动切换，但每次打开默认展示最新商品。

本功能只处理“通话中的商品详情承接体验”，不重做商品触发逻辑。

## Current Code Finding

实时通话后端当前会复用普通聊天回复链路：

- `server/call-turn-service.js`
  - 最终转写后调用 `createUserMessage()`。
  - 再调用 `createUserReply()`。
- `server/chat-text-message-service.js`
  - `createUserReply()` 会进入普通聊天的商品上下文和回复编排。
- `server/chat-reply-orchestrator-service.js`
  - 命中商品时会插入 `contentType = "product"` 的商品消息。

也就是说，通话期间的商品气泡后端链路基本已经存在。当前缺的是前端通话 UI 对这些商品消息的特殊展示状态。

## Design Rules

### Must Reuse

- 商品详情内容渲染应复用现有：
  - `src/features/chat/chat-product-panel-template.js`
  - `src/features/chat/chat-product-panel.js`
  - `src/features/chat/chat-product-panel-renderer.js`
  - `src/features/chat/chat-product-panel-gallery.js`
- 商品价格、尺码、售罄提示、购买按钮、图片翻页和拖动逻辑不新写第二套。

### Must Not Do

- 不改商品触发后端主链路。
- 不新写一套独立商品详情渲染器。
- 不把通话商品逻辑继续堆进 `call-modal.js`。
- 不把通话商品 overlay 直接塞进普通聊天右侧 `prod-panel` 状态，避免普通聊天商品详情和通话商品详情互相污染。
- 不改变通话音频连接、转写、TTS、WebSocket 状态流。

## Proposed File Structure

### New File: `src/features/call-modal/call-product-state.js`

职责：通话商品状态管理的纯逻辑。

需要提供：

- 从通话 payload 的 `items` 中提取 `contentType === "product"` 的消息。
- 将商品 payload 标准化为产品面板可用结构。
- 按商品身份去重。
- 新商品排在最前。
- 维护当前展示 index。
- 关闭 overlay 后保留商品列表和未读提醒状态。

建议导出：

- `extractCallProductsFromPayload(payload)`
- `mergeCallProducts(existingProducts, nextProducts)`
- `normalizeCallProduct(productMessage)`
- `hasCallProducts(state)`
- `resolveLatestCallProduct(state)`

这样状态规则可以独立自检，不依赖 DOM。

### New File: `src/features/call-modal/call-product-overlay.js`

职责：通话期间商品详情浮层 UI。

需要提供：

- `createCallProductOverlay({ products, index, pageLanguage, onClose, onIndexChange, onProductChange })`
- 内部复用 `productPanelHtml()` 和 `bindProductPanel()`。
- 自己负责左右切换按钮或滑动手势。
- 打开时默认展示 `products[index]`，正常情况下 `index = 0` 表示最新商品。
- 关闭时只关闭 overlay，不清空商品列表。

层级要求：

- `.call-product-overlay` z-index 高于 `.call-modal`。
- `.call-product-scrim` 不应关闭通话，只能关闭商品详情。
- overlay 不阻断通话 WebSocket，不触发 `closeCall()`。

### Modify: `src/app/app-state.js`

在 `call` 状态下增加最小字段：

```js
products: [],
productOverlayOpen: false,
productIndex: 0,
hasHiddenProducts: false,
```

字段含义：

- `products`：当前这次通话内触发过的商品，最新在前。
- `productOverlayOpen`：是否显示通话商品详情浮层。
- `productIndex`：当前浮层展示的商品索引。
- `hasHiddenProducts`：用户关闭过商品详情，且当前通话内还有可重新打开的商品，用于 Shop 红点。

### Modify: `src/app/app-call-actions.js`

只做调度，不写 UI HTML。

新增职责：

- 在 `mergeCallMessagesIntoCurrentChat(payload)` 或相邻小函数中提取商品消息。
- 有新商品时：
  - 正常 merge 聊天消息；
  - 更新 `appState.call.products`；
  - 设置 `appState.call.productIndex = 0`；
  - 设置 `appState.call.productOverlayOpen = true`；
  - 设置 `appState.call.hasHiddenProducts = false`。
- `handleCallShopClick()`：
  - 如果有 call products，打开 overlay，默认 index 归 0；
  - 如果没有 call products，不做商品动作。
- `stopCall()`：
  - 清空 `products / productOverlayOpen / productIndex / hasHiddenProducts`。

### Modify: `src/features/call-modal/call-modal.js`

只补 Shop 按钮状态，不放商品详情。

新增 props：

- `hasCallProducts`
- `hasHiddenProducts`

Shop 按钮：

- 有 `hasHiddenProducts` 时，在按钮右上角显示红色圆形白色 `!`。
- 原 Shop icon 和 label 不变。

### Modify: `src/app/app-view-factory.js`

在 `appendOverlayContent()` 中：

- 先挂载通话弹窗。
- 如果 `appState.call.productOverlayOpen` 且有商品，再挂载 `createCallProductOverlay()`。

这样浮层属于全局 overlay，不影响 chat page 的普通右侧商品面板。

### Modify: `src/features/app-shell/styles/call-modal.css`

新增样式：

- `.call-shop-alert`
- `.call-product-scrim`
- `.call-product-overlay`
- `.call-product-shell`
- `.call-product-nav`
- mobile / desktop responsive 约束

样式要求：

- overlay 从底部上滑。
- 背景可轻微遮罩，但不能让用户误以为通话断开。
- 商品详情层级高于通话弹窗。
- 不使用大面积新配色，跟现有通话和商品面板风格一致。

## Interaction Flow

### New Product During Call

1. 用户通话中说出商品相关内容。
2. 后端返回通话 `assistant` / `user_message` event。
3. 前端把商品消息 merge 到聊天区。
4. 前端提取商品 payload 写入 `appState.call.products`。
5. 自动打开 `call-product-overlay`，展示最新商品。
6. 通话弹窗仍保持原连接状态，计时继续，麦克风按钮继续可用。

### Close Product Overlay

1. 用户点击商品详情关闭按钮或遮罩。
2. `productOverlayOpen = false`。
3. `hasHiddenProducts = true`。
4. Shop 按钮右上角显示红色 `!`。

### Reopen From Shop

1. 用户点击通话弹窗里的 Shop。
2. 如果 `products.length > 0`：
   - `productOverlayOpen = true`
   - `productIndex = 0`
   - `hasHiddenProducts = false`
3. 打开最新商品。

### Multiple Products

1. 新商品进入时追加并去重，最新放第一位。
2. overlay 每次自动打开或 Shop 重新打开，都默认 `productIndex = 0`。
3. 用户可在 overlay 内左右滑动或点左右按钮切换其他商品。

## Phasing

### Phase 1: State And Detection

目标：

- 确认通话 payload 中商品消息能被提取。
- 完成 call product state 纯函数。

修改：

- 新增 `call-product-state.js`。
- 修改 `app-state.js`。
- 修改 `app-call-actions.js` 的状态调度。

验收：

- 通话 payload 里混有 text/product/voice 时，只提取 product。
- 同一个商品重复出现不会重复塞入列表。
- 新商品排到第一个。
- 通话结束清空商品状态。

### Phase 2: Overlay UI

目标：

- 做通话商品详情浮层。
- 复用现有商品详情组件。

修改：

- 新增 `call-product-overlay.js`。
- 修改 `app-view-factory.js`。
- 修改 `call-modal.css`。

验收：

- overlay 层级高于通话弹窗。
- 关闭 overlay 不关闭通话。
- 商品详情里的图片、价格、尺码、购买按钮可用。
- 多商品可切换。

### Phase 3: Shop Badge And Polish

目标：

- Shop 红点提醒。
- 关闭后可重新打开最新商品。
- 响应式和样式收口。

修改：

- 修改 `call-modal.js`。
- 补 `call-modal.css` 红点样式。
- 补必要自检。

验收：

- 关闭商品详情后 Shop 出现红色 `!`。
- 点击 Shop 重新打开最新商品。
- 通话结束后红点消失。
- 手机和桌面不出现遮挡错位。

## Self-check Plan

### New Script

新增：

- `scripts/call-product-overlay-self-check.mjs`

覆盖：

- `call-product-state.js` 存在且导出必要函数。
- payload 商品提取规则。
- 商品去重和最新优先规则。
- `appState.call` 增加必要字段。
- `call-modal.js` 存在 Shop 红点渲染入口。
- `call-product-overlay.js` 复用 `productPanelHtml()` / `bindProductPanel()`，不得新写完整商品详情 HTML。

### Existing Checks

需要继续跑：

- `node scripts/call-controls-self-check.mjs`
- `node scripts/call-realtime-phase1-self-check.mjs`
- `node scripts/call-turn-isolation-self-check.mjs`
- `node scripts/product-message-trigger-self-check.mjs`
- `node scripts/chat-product-panel-state-self-check.mjs`
- `npm run check:deployment`
- `git diff --check`

## Real-chain Verification

本地真实链路建议：

1. 启动本地服务和 MySQL。
2. 登录测试账号。
3. 打开 Millie 聊天页。
4. 开启实时通话。
5. 在通话中说商品相关内容，例如 “show me a Barcelona kit”。
6. 验证：
   - 聊天区出现商品气泡；
   - 通话弹窗没有关闭；
   - 商品详情自动从底部上滑并覆盖在通话弹窗上；
   - 商品详情可关闭；
   - Shop 出现红色 `!`；
   - 点击 Shop 重新打开最新商品；
   - 如果再次触发第二个商品，overlay 可左右切换；
   - 通话仍可继续说话和收到回复。

## Risk And Guardrails

### Main Risks

- 通话中 `mountApp()` 过多导致 WebSocket 或麦克风状态被重置。
- 商品 overlay 和普通聊天 `prod-panel` 共用 body class 时互相污染。
- 复制现有商品详情 HTML 造成第二套商品详情逻辑。
- Shop 按钮状态和通话状态混在一起导致 `app-call-actions.js` 继续变胖。

### Guardrails

- 通话商品 overlay 不使用 `body.product-open`。
- 通话商品 overlay 使用自己的状态：`call.productOverlayOpen`。
- 商品详情内容复用现有 product panel 组件，不复制 renderer。
- `app-call-actions.js` 只做状态调度。
- `call-modal.js` 只展示通话按钮和红点。
- 新增逻辑必须有 `call-product-state.js` 纯函数自检。

## Out Of Scope

- 不做后台配置。
- 不做商品推荐规则调整。
- 不做新的商品 API。
- 不做通话 AI 回复文案调整。
- 不做通话中的购物车结算流程重构。
- 不改变普通聊天商品详情行为。

## Rollback Point

如果实现后通话稳定性受影响，可以整体回滚以下范围：

- `src/features/call-modal/call-product-state.js`
- `src/features/call-modal/call-product-overlay.js`
- `src/app/app-state.js` 中 call 商品字段
- `src/app/app-call-actions.js` 中 call product 状态调度
- `src/features/call-modal/call-modal.js` 中 Shop 红点 props
- `src/app/app-view-factory.js` 中 call product overlay 挂载
- `src/features/app-shell/styles/call-modal.css` 中 call product overlay 样式
- `scripts/call-product-overlay-self-check.mjs`

回滚后普通通话和普通聊天商品气泡应保持原样。
