# TTmall / Pro Jersey Shop 公开接入调研（2026-07-30）

## 目的与边界

本文件只用于向独立站技术确认 **TTmall 商品只读接入** 所需能力。结论仅来自公开可访问网页和其公开前端静态资源；没有调用、猜测、枚举或绕过任何受保护接口，也没有使用页面内可见的任何客户端凭据。

它不是 TTmall 的官方 API 文档，也不能替代技术同事提供的正式接口契约。

## Alove 当前 Shopify 实际使用的权限清单

以下是从当前服务端查询和已上线功能逐项核出的**全部实际 Shopify 读取 scope**。均为只读；当前代码没有调用 Shopify 写入、客户资料、订单修改或结算写入接口。

| Shopify scope | 当前代码读取的内容 | 对应 Alove 功能 | 是否为 TTmall 第一版最低要求 |
| --- | --- | --- | --- |
| `read_products` | 商品、变体、SKU、可售状态、库存数量、图片、商品链接、商品 metafield、按市场的价格/划线价 | Search、聊天商品消息、商品详情、广告选品、Kitshop 基础货架 | 是 |
| `read_orders` | 最近 60 天订单的商品与数量；只聚合销量，不保存顾客、邮箱或地址 | Kitshop Best Sellers（30/60 天销量混排） | 否；缺失时不能做真实热销排序 |
| `read_themes` | 已发布主题及 `templates/index.json` | Kitshop 第一层复用独立站首页货架顺序 | 否；缺失时不能精准复刻首页楼层 |
| `read_markets` | 市场国家与市场币种 | 选择站点市场上下文，并请求对应市场的真实商品价格/币种 | 是（若 TTmall 有多市场价格）；单一币种站点可由商品接口直接返回币种 |
| `read_discounts` | 折扣码搜索、规则、有效状态 | 后台折扣码输入检索、商品详情折后价预览、Buy now 前实时核验 | 否；缺失时 TTmall 首版不展示或核验其折扣码 |

### 当前 Shopify 调用边界

- 产品读取走 Admin GraphQL `products` / `productByHandle`，并读取变体、图片、`alove.customization_options` metafield 与市场价格；这对应 `read_products`。
- Kitshop 首页楼层读取已发布主题与首页 JSON；这对应 `read_themes`。
- Best Sellers 读取最近 60 天订单和 line items；这对应 `read_orders`。Shopify 默认也只开放最近 60 天订单，不需要 `read_all_orders`。
- 市场国家/币种读取 `markets`；这对应 `read_markets`。
- 折扣码读取 `discountNodes` / `codeDiscountNodeByCode`；这对应 `read_discounts`。
- `inventoryQuantity` 目前只作为可选展示字段使用；如 Shopify 对某个商店要求额外库存 scope，Alove 应安全降级为“仅显示可售状态”，而不应把缺失库存伪造成零库存。

这份清单是让技术同事理解 Shopify 现有能力的对照，不要求 TTmall 复制 Shopify 的权限名。TTmall 应按下文提供等价的、最小只读能力。

## 已确认：该链接有用，但不能直接当作 Alove 的数据源

- [Pro Jersey Shop 首页](https://www.projerseyshop.es/) 的响应头包含 `X-Powered-By: Next.js`，页面也加载 `/_next/static/` 资源；这说明站点前台使用 Next.js，而不是 Shopify storefront。
- 首页公开图片路径包含 `/upload/ttmall/`。这只能证明该店铺部署/资源命名与 `ttmall` 有关联，**不能证明存在名为 TTmall 的对外商品 API，也不能推出认证方法或权限范围**。
- [公开商品详情示例](https://www.projerseyshop.es/productdetail/England-Home-Soccer-Fan-Jersey-World-Cup-2026/623578) 的路径结构为：`/productdetail/<slug>/<numeric-product-id>`。页面服务端输出可见商品标题、数值价格、币种、SKU、Size Guide，以及 `CUSTOMIZE` 的 `Choose a player` / `Add yours` UI。
- 首页可见的商品分类/列表链接包括 `/team/<name>/<id>`、`/category/...`；搜索页前端路由为 `/search`；购物车为 `/cart`。因此 Alove 需要同时覆盖商品搜索和单品详情，不能只抓首页货架。

## 公开前端资源中可见的内部调用线索

以下内容来自该站公开加载的 [`_app` bundle](https://cf.projerseyshop.es/_next/static/chunks/pages/_app-4d7c0cebd4f4b977.js)，仅记录为“该站前端当前使用的路由线索”，不代表对第三方开放，也不允许 Alove 直接依赖或调用：

- 公开 bundle 配置了独立 v1 API base URL（为避免把可被滥用的客户端凭据/地址复制入项目文档，此处不抄录）。
- bundle 中能看到与商品有关的客户端路由字符串：`/product/<id>`、`/search`、`/sizechart`、`/product/html`、`/product/recommend`、`/cart`、`/cart/check`、`/order/generate_order_to_pay`。
- bundle 还显示站点网页自身会读取商品价格、币种、SKU、尺码、定制 UI 与购物车/订单状态。

这只说明独立站本身拥有这些能力；它**不等于** Alove 获得授权。页面内出现的前端配置、cookie、请求头或任何 token 均不得复制到 Alove，也不得作为站点管理的凭据。

## 推荐的正式对接方式

让 TTmall/独立站技术提供一个 **server-to-server、只读、版本化** 的接口。最小可用面为以下两类，不需要让 Alove 抓取网页或复用前台内部接口：

### 1. 商品搜索 / 列表

`GET /v1/alove/products?query=&cursor=&limit=&currency=&locale=`

用于 Alove 的 Search、Kitshop 货架、聊天商品推荐、广告活动选品和缓存刷新。

最少返回字段：

```json
{
  "items": [
    {
      "id": "623578",
      "title": "England Home Soccer Fan Jersey World Cup 2026",
      "handle": "England-Home-Soccer-Fan-Jersey-World-Cup-2026",
      "url": "https://www.projerseyshop.es/productdetail/England-Home-Soccer-Fan-Jersey-World-Cup-2026/623578",
      "images": ["https://..."],
      "price": { "amount": "30.99", "currency": "USD" },
      "compareAtPrice": null,
      "available": true,
      "tags": ["England", "Home", "Fan"],
      "updatedAt": "2026-07-30T00:00:00Z"
    }
  ],
  "nextCursor": null
}
```

要求：`id`、`url`、`price.currency` 必须稳定且真实；无价格、缺货或无公开购买链接的商品不能伪造为可售。

### 2. 单品详情

`GET /v1/alove/products/{id}?currency=&locale=`

用于商品详情打开时的实时刷新、SKU/尺码选择、库存和购买跳转校验。

除列表字段外，最少返回：

- `variants[]`：`id`、`title`、`sku`、`available`、`price`、`compareAtPrice`、`optionValues`；
- `descriptionHtml` 或已清洗的 `description`；
- `sizeChart`：仅在商品实际有对应尺码表时返回，含标题、单位、表头、行数据和 `updatedAt`；
- `customizationOptions`：仅在商品实际允许定制时返回，包含选项、依赖关系、必填/校验、加价、可选球员/号码/徽章等；
- `checkoutUrl` 或能够由指定变体生成安全购买跳转的正式字段。

## 认证和安全要求（请技术同事确认）

推荐使用单个、可轮换的服务端 `Authorization: Bearer <read-only-token>`，或技术方规定的 HMAC 签名。无论采用哪种：

- 只授予商品读取，不要授予订单、客户、写商品、写购物车或后台管理权限；
- 凭据只存 Alove 服务器加密字段，绝不进入前端、URL、日志、截图或 GitHub；
- 应有 API 版本、分页、速率限制、429/5xx 错误格式和过期/撤销机制；
- 价格必须随请求上下文明确币种；若站点支持市场价，应由 TTmall 在响应中直接给出实际展示币种与价格，Alove 不做汇率猜测；
- Alove 只接受 HTTPS、固定可信域名，并验证响应结构；不允许后台输入任意 URL 后由服务器访问。

## 当前无法确认，必须由技术同事提供

1. TTmall 是否有正式开发者 API，以及准确 base URL、版本和认证方式。
2. 是否可以签发一个独立的只读机器凭据；公开网页可见的客户端配置不能使用。
3. 搜索支持哪些参数、最大页长、游标格式、是否可按 `updatedAt` 增量同步。
4. 单品详情是否能返回真实 variant/SKU 库存、市场币种与划线价。
5. 定制项是否能结构化返回；若只有网页 UI，能否由技术方提供 `customizationOptions` 对应的数据结构。
6. 购买跳转是否允许传入 variant / 数量 / 定制参数，及其签名/校验规则。
7. 限流、缓存建议、错误码、SLA、测试环境和 API 变更通知机制。

## 给技术同事的最小回复模板

请提供：

1. 测试与生产 base URL；
2. 认证说明和一份只读测试凭据（通过安全渠道给，不放聊天记录）；
3. 上述“搜索/列表”和“单品详情”接口文档及各一份脱敏真实响应；
4. 商品、变体、价格/币种、库存、图片、描述、尺码表、定制项与购买链接的字段映射；
5. 429、4xx、5xx 失败响应、限流值、分页和数据刷新说明。

## 2026-08-01 本地实施结果

测试与生产契约已经核验，本地已将 `TTMall` 做成与 Shopify Admin 并列的可信商品源类型。管理员填写 API Base URL 和网站 ID；服务端自动使用 `/v1/token/:id` 获取短期 JWT，并通过统一商品源 facade 覆盖 Search、正式账号与游客 Chat、广告活动选品、商品详情 resolve、尺码表、定制项和 Kitshop。

本地使用网站 ID `4` 的真实只读链路验证通过。当前明确不接入 TTMall 登录态、购物车写入、订单销量、折扣创建或核销；商品购买动作跳转到 TTMall 的公开商品详情。该实现尚未部署服务器或更新 GitHub。
