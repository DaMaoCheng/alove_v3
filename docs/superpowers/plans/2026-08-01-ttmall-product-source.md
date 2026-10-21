# TTMall 站点商品源接入实施方案

## 目标与边界

- 在后台“站点管理 → 新建/编辑站点 → 商品源类型”增加 `TTMall`。
- 复用现有 `product-source-service`、统一商品结构、搜索排序、商品详情、Kitshop 缓存和聊天商品消息链路，不建立第二套搜索或详情实现。
- 管理员只填写 TTMall API Base URL 与网站 ID。Alove 服务端通过 `GET /v1/token/:websiteId` 获取短期 JWT 并在内存中缓存；JWT 不落库、不回显、不写日志。
- 保持 Shopify Admin 和通用 HTTP 商品源现有行为不变。
- 本轮不实现 TTMall 用户登录态、购物车写入、订单销量读取或折扣码核销。公开商品跳转进入对应 TTMall 独立站商品详情。

## 已确认的 TTMall 接口契约

| 能力 | 接口 | Alove 用途 |
| --- | --- | --- |
| 短期访问令牌 | `GET /v1/token/:websiteId` | 服务端自动鉴权 |
| 商品搜索 | `GET /v1/search` | Search、聊天、活动选品、商品解析 |
| 商品详情 | `GET /v1/product/:id` | 图片、SKU、价格、库存、尺码、定制项 |
| 首页楼层 | `GET /v1/floor` | Kitshop 第一层与其他楼层候选商品 |
| 网站信息 | `GET /v1/website` | 校验网站、解析公开独立站域名 |
| 尺码表 | `GET /v1/sizechart/:id` | 详情显式尺码表；读取失败时不伪造 |

## 分批实施

### 第一批：站点配置与后台界面

修改：

- `server/admin-site-product-source-service.js`
  - 增加 `ttmall` 类型、配置解析、HTTPS Base URL 和正整数网站 ID 校验。
  - 把配置规范化为 `ttmall://<api-host>?websiteId=<id>`，继续存入既有 `sites.product_api_url`，不增加数据库列。
  - 切离 Shopify 时清除旧 Shopify Token，避免无效凭据残留。
- `server/admin-site-mapper.js`
  - 从规范化 URI 映射 `productTtmallApiBaseUrl`、`productTtmallWebsiteId`。
- `src/features/admin-console/admin-console-sites-template.js`
  - 商品源下拉加入 TTMall；Shopify 与 TTMall 字段按类型显示。
- `src/features/admin-console/admin-sites-editor.js`
  - 复用现有表单，绑定类型切换并提交 TTMall 两个字段。
- 新增 `src/features/admin-console/admin-sites-product-source-picker.js`
  - 只负责切换当前商品源字段和必填状态，不承载保存或网络请求。

验收：

- 新建和编辑站点可在 Shopify/TTMall/未配置之间切换并正确回填。
- TTMall 只显示 API Base URL、网站 ID；不显示 Token 和 Shopify 域名。
- 非 HTTPS、内网地址、空网站 ID、非正整数均被服务端拒绝。
- API 响应不包含 JWT 或历史 Shopify Token。

### 第二批：TTMall 商品源适配器

新增 TTMall 深模块：

- `server/product-source-ttmall-service.js` 只负责解析配置与编排搜索、详情、楼层。
- `server/product-source-ttmall-client-service.js` 负责临时 JWT、并发合并、缓存、401 刷新和只读请求。
- `server/product-source-ttmall-mapper.js` 负责归一化商品、价格、图片、尺码、定制项与尺码表。
- 对 API 主机执行公网地址校验，并把验证后的 DNS 地址绑定到实际连接；拒绝重定向和未验证来源的绝对素材 URL。系统 DNS 仅返回 `198.18.0.0/15` VPN Fake-IP 时，通过固定可信 DoH 获取并再次校验公网地址，不直接放行保留地址。
- 年龄检索分批读取候选详情，找到足够结果即停止；搜索阶段不逐件读取尺码表，只有打开商品详情时才读取。
- 绝不返回精确库存数量给浏览器；仅使用库存判断 `available`。
- 将 TTMall 相对图片路径解析成可信 HTTP(S) URL。

修改 `server/product-source-service.js`：

- 在现有商品源 facade 中增加 TTMall 分支并导出识别/公开站点 URL helper。
- 保持通用 HTTP、Shopify Public、Shopify Admin 分支顺序和语义不变。

验收：

- Mock 链路验证 Token → Search → Detail → Size Chart 的请求顺序、Authorization 和标准结构。
- Token 失效遇到 401 时只刷新一次并重试原请求。
- Token、Authorization 不进入异常文本、客户端响应或日志。
- Shopify 与通用 HTTP 自检继续通过。

### 第三批：统一入口接入与 Kitshop 楼层

修改：

- `server/product-search-site-service.js`
  - TTMall 配置解析到公开 storefront URL，后台 API 地址不作为用户跳转地址。
- `server/kitshop-service.js`
  - TTMall 使用 `/v1/floor`，转成现有首页 section 结构后继续交给 `buildKitshopShelves`。
  - 不调用 Shopify theme/order service；无订单销量时由其他公开楼层商品补齐 Best Sellers。
- `server/product-checkout-resolver-service.js`
  - 继续走统一 `fetchProductSummary`；TTMall 详情数据直接用于面板刷新。

由现有统一入口自动覆盖：

- Search 页面；
- 正式账号与游客聊天商品消息；
- 管理员活动选品；
- Kitshop 与缓存刷新；
- 商品详情 resolve、尺码、图片和定制项；
- 公开商品详情跳转。

验收：

- 同一 TTMall 站点的 Search、Chat、活动选品和 resolve 返回同一商品事实。
- Kitshop 第一层取第一个包含商品的有效楼层，第二层不重复第一层商品。
- TTMall 不调用 Shopify Admin、theme 或 order API。
- 无楼层、空商品、Token 过期和上游 5xx 均使用现有缓存/错误边界，不显示内部错误。

### 第四批：验证、文档和审查

- 新增或扩展自检：配置 round-trip、商品源 adapter、Kitshop 楼层、统一 Search/resolve。
- 对网站 ID `4` 的真实 TTMall 测试源执行只读链路验证，确认搜索、详情、图片、尺码、定制和公开链接。
- 执行语法检查、相关 self-check、部署检查和浏览器真实页面验证。
- 更新 `docs/design/`、`docs/system/`、集成文档、release 和 `logs/updates/2026-08-01.md`，明确本地完成但尚未部署。
- 按核心商品链路规则执行多 Agent 对抗式只读审查，修复确认的问题后再汇报。

## 完整验收标准

1. 管理员能配置任意符合契约的 TTMall 站点，而不是写死 GG/FKK 或网站 ID 4。
2. 所有消费者只依赖现有统一商品结构，不出现第二套 TTMall 专属前端详情或聊天分支。
3. TTMall 搜索、详情、Kitshop、Chat、游客、活动选品均固定在当前站点，不能跨站读取。
4. JWT 自动获取、缓存与刷新；不落库、不回显、不记录。
5. 图片、商品链接和 API 主机均通过 HTTPS/公网边界；请求连接绑定已验证的 DNS 地址，非法配置和跨域绝对素材确定性拒绝。
6. Shopify Admin、Shopify Public、通用 HTTP 商品源以及原有 UI 无回归。
7. 不伪造 TTMall 订单销量、折扣、购物车或 checkout 能力；当前只跳转可信商品详情。
8. 本地真实链路和对抗式审查通过后才可宣称完成；本轮不部署服务器、不更新 GitHub。

## 实施状态

`Current locally`：四批均已完成。真实 TTMall 的公开搜索、活动选品、商品详情、对话商品上下文和 Kitshop 已通过本地数据库链路验证；完整部署检查和对抗式审查通过。审查发现的商品详情 CTA、年龄候选分批 hydration、币种换算、素材来源和 DNS 连接安全边界均已修正并增加回归测试。本轮尚未部署服务器或推送 GitHub。
