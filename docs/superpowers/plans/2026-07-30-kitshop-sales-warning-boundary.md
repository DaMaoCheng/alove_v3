# Kitshop 销量刷新与运维告警边界修复方案

## 状态与范围

- 状态：Local implementation，尚未部署或同步 GitHub。
- 目标：修复 FKK 销量订单读取失败，使 Best Sellers 能恢复真实销量快照；同时不再把“销量缓存/刷新失败”这类运维信息展示给前台用户。
- 不做：不改 Shopify Token、Markets 权限、GBP 取价逻辑、订单筛选规则、销量算法、Kitshop 页面视觉设计或服务器配置。

## 已确认事实

1. `server/shopify-order-sales-service.js` 的 `buildRecentOrdersQuery()` 缺少最外层 GraphQL `}`，而 `buildRankedProductsQuery()` 的市场价格改造多保留了一层 `}`。前者会让 Shopify 返回 `unexpected end of file`，后者会返回 `unexpected RCURLY`；两者都会使 `site_kitshop_sales_cache` 进入 `stale`。
2. 该缺失的括号在首次市场货币改造的未提交改动中被误删；与 FKK Token、英国市场或权限无关。
3. `server/kitshop-service.js` 将销售快照故障写入通用 `warning`；正式用户与游客 API 都会把它返回，`src/features/kitshop/kitshop-page.js` 再直接渲染，因而中文运维文案出现在前台。

## 批次 1：先补回归防线（必须先失败）

### 改动位置

- `scripts/shopify-order-sales-self-check.mjs`
  - 从 mock 请求中定位 `AioveRecentProductSales` 与 `AioveSalesRankedProducts` 查询。
  - 新增轻量 GraphQL 文档结构检查：花括号不能提前闭合，最终深度必须为零。

### 原因

现有 mock 只模拟响应、不解析请求文本，所以缺少 `}` 仍可能通过。此检查会直接覆盖本次真实故障。

### 验收

- 在未修复查询前，`node scripts/shopify-order-sales-self-check.mjs` 必须失败，并指出订单查询未闭合。
- 修复后，该脚本恢复通过，且现有节流、分页、销量排序和英国市场上下文断言均继续通过。

## 批次 2：修复销售订单 GraphQL

### 改动位置

- `server/shopify-order-sales-service.js`
  - 在 `buildRecentOrdersQuery()` 中恢复 query operation 最外层的结尾 `}`。

### 验收

- 真实 FKK 本地只读调用 `fetchShopifyOrderSalesSnapshot()` 返回成功，不再有 GraphQL 语法错误。
- 返回的销售快照包含可用订单统计、排行商品，且商品价格币种仍来自 Shopify Markets 的 GBP contextual pricing。
- 不改变订单时间窗口、取消/测试/退款订单排除、节流退避和产品排名逻辑。

## 批次 3：隔离销售运维告警

### 改动位置

- `server/kitshop-service.js`
  - 保留商品源故障的既有 `error` / `warning` 语义。
  - 将仅由销量快照失败或 stale 触发的中文文案改为内部 `adminWarning`，不再复用公共 `warning`。
- `server/admin-kitshop-service.js`
  - 管理员手动刷新结果优先映射 `adminWarning`，继续让管理员可见“销量缓存回退/不可用”的状态。
- `server/product-response-sanitizer.js`
  - `toClientKitshopResult()` 显式剥离 `adminWarning`，防止正式用户 API 泄露内部字段。
- `server/guest-product-sanitizer.js`
  - 保持游客白名单输出；在自检中明确断言它不返回 `adminWarning`。

### 验收

- 销量刷新异常时，服务内部与管理员刷新结果仍能得到中文运维状态。
- 正式用户与游客 Kitshop JSON 均不包含 `adminWarning`；因此现有前台页面不会出现该中文提示条。
- 商品源完全不可用且无缓存时仍返回既有用户可理解错误，不能把无商品货架伪装成成功。

## 批次 4：自动化与真实链路验收

### 自动化自检

1. `node --check` 覆盖所有修改的 JS 文件。
2. `node scripts/shopify-order-sales-self-check.mjs`。
3. Kitshop 缓存、正式用户响应边界、游客响应边界、后台 Kitshop 刷新相关自检。
4. `npm run check:deployment`。
5. `git diff --check`。

### 本地真实链路

1. 读取本地 FKK 站点配置（不打印 Token），执行一次只读订单销量快照，记录成功状态、订单数量和商品数量。
2. 对 FKK 执行本地 `getKitshopShelves({ forceRefresh: true })`，验证货架可构建、销售缓存从 stale 恢复为 ready，并验证正式用户 sanitizer 输出没有 `adminWarning`。
3. 以相同结果分别经过正式用户和游客 sanitizer，验证用户侧不出现内部销售告警，管理员刷新结果仍可承接该字段。

## 回滚

- 若销售查询修复意外影响刷新，只需回退本次 query 结尾与 `adminWarning` 映射改动；旧缓存仍可提供货架。
- 不涉及数据库 migration、线上 Token 或不可逆数据变更。
