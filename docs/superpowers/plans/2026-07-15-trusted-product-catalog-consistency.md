# 可信商品目录一致性实施方案

日期：2026-07-15
状态：Complete locally; not deployed or pushed

## 第一批：锁定规则和失败自检

### 修改范围

- 新增可信商品目录规格和实施方案。
- 扩展商品搜索自检，断言后台活动选品使用 50 个候选。
- 扩展商品 resolve 自检，断言 Shopify Admin 站点在详情刷新时继续使用 Admin API。

### 不做

- 不修改页面、数据库、站点配置或 Shopify 主题。

### 验收

- 新断言在旧实现上能够准确暴露 5 条候选截断和 public storefront 降级问题。

## 第二批：修复两处不一致

### 修改范围

- `server/product-search-admin-service.js`：向可信商品源显式传入统一候选池上限。
- `server/product-checkout-resolver-service.js`：使用站点原始商品源、加密 Token和统一候选池完成 resolve。

### 不做

- 不重写 `product-source-service`。
- 不修改 Kitshop、聊天推荐、游客商品卡的既有筛选和展示数量。

### 验收

- 后台选品最多返回 8 条，但上游候选读取为 50。
- Admin 站点 resolve 不再降级公共搜索。
- 商品身份不匹配时仍返回原快照且 `resolvedFromSource=false`。

## 第三批：接口边界

### 修改范围

- 普通账号的商品 Search、Resolve 和 Kitshop 请求固定到账号所属站点；管理员保留跨站能力。
- 游客商品 Search 与 Kitshop 补齐 Alove Origin/Referer 校验。
- 正式账号商品读取增加按账号和站点计算的 10 分钟额度与最多 2 个同时在途请求；Search、Resolve、Kitshop 和聊天商品消息剥离内部匹配对象和精确 Admin 库存数。

### 验收

- 普通 FKK 账号访问 GG 商品接口返回 `403`；同站点访问正常。
- 账号所属站点停用或显式站点不存在时不回退默认站。
- 无 Alove Origin 的游客商品 Search 返回 `403`。
- 同账号同站点第 121 次窗口内请求返回 `429`。
- 同账号同站点已有 2 个商品请求在途时，下一次突发请求返回 `429`。
- 前端响应没有 `sourceItem` 或 `inventoryQuantity`。
- 新聊天商品消息不再持久化精确库存，旧历史商品消息读取时也不回传精确库存；不改写历史数据库记录。

## 第四批：文档、记录与完整回归

### 修改范围

- 更新长期产品设计、系统数据流、API 说明和后台字段说明。
- 增加 Bug 日志、更新日志和本地 release 节点。
- 运行专项、真实 Shopify 只读验证、本地 HTTP smoke 和完整部署检查。

### 验收

- 文档不再声称前台商品链路必须降级公共 storefront。
- Token 不回显、不写日志；只记录候选数量和验证结果。
- 商品、聊天、游客、广告活动、Kitshop 及相邻功能回归通过。

## 风险与回退

- 风险：前台能够展示独立站主题对游客隐藏、但仍发布到 Online Store 的商品。这是本次确认的目标行为。
- 风险：Admin API 失败会导致实时刷新失败；现有快照 fallback 必须保留。
- 回退：恢复商品 service 调用参数与商品路由 guard 即可；不涉及数据库迁移、数据重写或缓存格式变化。
- 本轮不建新分支或 worktree：当前主工作区已有用户授权的未发布本地改动，本次只做可独立审查的局部差异，不执行 commit、push 或部署。
