# 统一站点品牌配置规格

状态：`Current`（本地实现并验证，尚未发布服务器/GitHub）

## 1. 目标

- 站点名称、公开网站地址和站点 Logo 只在站点管理中维护一次。
- 登录页、Kitshop、商品详情和后续 Shopify Customer Account 登录入口读取同一份站点品牌配置。
- 修改站点品牌后，新打开或重新加载的页面使用最新配置；历史聊天商品消息不固化旧 Logo。
- 没有配置 Logo 时继续使用站点域名 favicon；favicon 失败时使用项目通用 globe 图标。

## 2. 实施前问题

- 实施前 `sites` 只有 `name` 和 `site_url`，没有独立的公开 Logo 字段。
- 商品详情在 `src/features/chat/chat-product-panel-renderer.js` 中从商品 URL 提取域名，再拼接 Google favicon URL；它不读取站点管理配置。
- 登录页知道 URL 路径中的 `siteSlug`，但没有读取当前站点公开品牌信息。
- Kitshop API 返回站点名称和网址，但没有统一 Logo 字段。
- 把 Logo 复制进每条商品消息会造成历史消息长期保存旧值，不能满足“后台改一次，全局同步”。

## 3. 统一数据模型

站点品牌唯一来源为 `sites`：

| 字段 | 作用 | 输入方式 | 公开边界 |
| --- | --- | --- | --- |
| `name` | 站点显示名称 | 站点管理文本框，必填 | 可公开 |
| `slug` | 路径与站点上下文 | 站点管理文本框，必填且唯一 | 可公开 |
| `site_url` | 独立站公开首页 | 站点管理 URL 文本框 | 可公开 |
| `site_logo_url` | 站点品牌 Logo；为空时使用 favicon | 站点管理 URL 文本框，可空 | 可公开 |
| `shopify_login_enabled` | 是否允许登录页展示本站授权登录入口 | 站点管理滑动开关；默认开启 | 仅公开布尔值 |

商品 Token、Shopify Admin 域名、API version、地区绑定、游客开关等仍属于各自配置，不进入公开品牌响应。

## 4. Logo 解析优先级

所有页面使用同一个确定性优先级：

1. 当前站点 `site_logo_url`；
2. 当前站点 `site_url` 对应的 favicon；
3. `site_url` 为空时，从当前站点 active 可信商品缓存提取 storefront origin，并使用其 favicon；
4. 商品自身 URL 对应的 favicon；
5. 项目通用 globe fallback。

Logo URL 只接受 `http` 或 `https`。前端图片加载失败必须继续降级，不能隐藏整个购买入口或阻塞商品详情。

## 5. 页面行为

### 5.1 站点管理

- “网站链接”继续维护独立站公开 URL。
- 新增“站点 Logo”字段，管理员可填写完整图片 URL；留空时页面明确说明会自动读取网站 favicon。
- 保存后后台列表和后续公开品牌读取使用最新值。

### 5.2 登录页

- 登录页按当前显式路径 `/{siteSlug}/login` 读取该 active 站点公开品牌；无显式路径时先完成现有 IP 分流，再读取分流后的站点。
- Shopify Customer Account 按钮未来位于 Google 按钮下方、邮箱分隔线上方，图标和名称使用统一站点品牌。
- 本规格不实现 Shopify OAuth、Customer Account token、callback 或账号绑定；只有站点已配置 Shopify 只读 Token 且 `shopify_login_enabled=true` 时才允许展示禁用的品牌预览，其余状态完全隐藏；预览不能成为可点击却无法登录的假入口。

### 5.3 商品气泡与商品详情

- 商品气泡继续保存商品事实与 `siteId/siteSlug`，不把站点 Logo 作为不可变商品事实。
- 打开商品详情时根据 `siteSlug` 读取当前品牌；老消息也能显示后台最新 Logo。
- 商品详情读取品牌失败时继续使用商品 URL favicon，不影响价格、尺码、购买链接和支付方式。

### 5.4 Kitshop

- Kitshop 的站点响应补充统一品牌字段。
- Kitshop 商品详情继续复用聊天商品详情面板，不建立第二套 Logo 规则。
- 货架、销量、缓存和商品排序不因品牌配置变化而刷新或重算。

## 6. 公共接口与安全

- 新增按 `siteSlug` 读取 active 站点公开品牌的只读接口。
- `site_url` 为空时只允许从同站点 active 商品缓存的公开 `product_url` 推导 origin；管理员显式配置始终优先。
- 响应只包含 `siteId/name/slug/siteUrl/logoUrl/hasProductAccessToken/shopifyLoginEnabled` 等公开或安全布尔字段。
- 不存在、非法或 inactive 的显式站点必须返回失败，不回退默认站点，避免跨站品牌错配。
- 不返回商品 Token、Shopify Admin URL、OAuth secret、地区配置、用户数或后台备注。

## 7. 非目标

- 不实现 Shopify Customer Account OAuth/OIDC。
- 不导入 Shopify 客户、订单或用户画像。
- 不修改商品事实、价格、库存、尺码、购买链接、Kitshop 货架算法或广告活动商品快照。
- 不新增图片上传器；本轮 Logo 使用 URL 配置。

## 8. 验收标准

- 后台只改一次 Logo URL，登录品牌读取、Kitshop 站点数据和商品详情均使用新值。
- 历史商品消息不需要重写数据库，重新打开详情即可读取当前品牌。
- Logo 为空、Logo 404、站点 URL 为空和品牌接口失败均有确定性 fallback。
- FKK 和未来新增站点使用同一套逻辑，没有在页面里写死站点名称或 Logo。
- 后台不能保存系统保留 slug；不存在或停用的显式路径不能带着假 slug 继续注册或登录。
- 游客和正式用户看到的商品品牌一致；游客响应不泄露后台或 Shopify 凭据。
- 现有登录、Google OAuth、站点分流、商品气泡、商品详情、Kitshop 和后台站点编辑回归通过。

## 9. 本地实施结果

- `sites.site_logo_url`、后台编辑字段、已有库幂等迁移与空库 schema 已完成。
- 公开品牌接口与前端共享品牌 service/fallback 已完成；响应执行严格白名单。
- 登录页仅在站点已有 Token 且授权登录开关开启时显示禁用的品牌按钮预览；当前没有 OAuth action，因此不会触发 Shopify 跳转，后续传入真实 action 后自动启用。
- Kitshop 和聊天/搜索共用商品详情已经读取当前站点品牌；真实 FKK 商品详情验证为 `siteSlug=footballkituk` 并使用当前公开网站 favicon。
- 站点保存会清理当前品牌请求并通知同一 SPA 更新；普通商品详情只合并同时在途请求，不永久缓存已完成结果，重新打开可读取后台最新品牌。
- 本规格没有改变商品排序、价格、库存、广告活动、Google/邮箱登录或服务器配置。
