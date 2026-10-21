# TTMall 链路回归与 BS Kitshop 修复方案（2026-09-03）

## 目标

在不回退现有聊天、角色、站外挂件和非 TTMall 站点功能的前提下，将已验证的 TTMall 绑定/购物车/结算/订单能力重新纳入当前主线，并修复 BS Kitshop 楼层、产品识别和图片过滤问题。

## 阶段与边界

### 阶段 1：建立回退点并恢复既有实现

- 以当前稳定提交建立本地检查点 `codex/ttmall-reintegration-checkpoint-20260903`。
- 复用历史已验证提交 `0985868` / 分支 `codex/ttmall-site-managed-release-20260828` 中的 TTMall 模块、路由、前端面板、订单历史和专项自检。
- 采用 Git 合并解决共享文件冲突，不直接覆盖当前站外挂件、AI、聊天和其他最新功能。
- 不修改服务器、不写入线上密钥、不创建真实订单。

### 阶段 2：修复 BS Kitshop 数据链路

- 统一 TTMall 首页楼层选择，按现行接口 `display=1` 识别公开可售楼层，保留接口返回顺序。
- 复用现有 `isUsableTtmallFloorProduct` 过滤无效商品，不把售罄楼层当作唯一首页楼层。
- 将 TTMall 商品 CDN 加入可信来源白名单，使游客 Kitshop 返回图片。
- 保持 Search、Chat、详情和 Kitshop 使用同一站点商品源与 resolve 逻辑。

### 阶段 3：本地真实链路自检

- 先做语法和专项自检：运行时访问、商品源、账号绑定、购物车、结算、订单、前端购物车、Kitshop、商品详情。
- 再用本地 BS 配置和测试账号完成商品搜索/详情/绑定/加购/购物车回读/结算页闭环；不提交真实付款。
- 验证 Shopify/FKK 与站外挂件功能没有回归。

### 阶段 4：发布前检查点

- 完成全量 `npm run check:deployment`、多站点 preflight 与本地 HTTP smoke。
- 记录正式 TTMall API 域名、websiteId、认证合同仍需技术同事确认；不得仅把旧测试域名替换成 `api.ttmall.co`。
- 本轮仅完成本地修复和验证；服务器发布、密钥写入和真实订单需另行授权。

## 代码落点

- TTMall 绑定、购物车、结算、订单：`server/ttmall-*.js`、`src/features/chat/chat-ttmall-*.js`、`src/services/ttmall-account-binding-service.js`、`server/routes.js`。
- 商品源与楼层：`server/product-source-ttmall-service.js`、`server/product-source-ttmall-mapper.js`、`server/kitshop-service.js`、`server/kitshop-shelf-builder.js`。
- 游客图片可信来源：`server/product-source-provenance.js`、`server/guest-product-sanitizer.js` 及其既有自检。
- 回归保护：`scripts/ttmall-*-self-check.mjs`、`scripts/kitshop-*-self-check.mjs`、`scripts/product-*-self-check.mjs`。

## 验收标准

- BS Kitshop 至少返回正常首页楼层，顺序与 TTMall 接口一致，产品有名称、URL、图片和正确可售状态。
- BS 商品详情可识别 TTMall 商品和尺码；已绑定账号可加购并回读购物车。
- 结算页能读取地址、物流、支付方式；创建订单结果按 `redirect_link` 或 `succeed` 明确分流，不把不完整响应误报成功。
- Profile Orders 能读取订单列表和详情。
- FKK/Shopify 商品搜索、加购/checkout、站外挂件、聊天和角色功能专项回归通过。
- 不向浏览器、日志、文档或发布包写入 Token、密码或 API Key。
- 任一阶段失败均回退到检查点，不继续叠加补丁。
