# 三入口商品漏斗统一实施方案

## 目标

将聊天商品气泡、搜索结果和 Kitshop 货架统一纳入后台“商品漏斗”。页面采用两行卡片：第一行四张全站总览卡，第二行按入口拆分；商品排行能够显示来源并按同一口径比较。

本方案只统计已登录用户的商品行为。游客当前不向该运营统计接口写事件，避免把未认证的前端数据放宽为可伪造埋点；游客统计如需纳入，另行设计签名 guest session 事件链路。

## 当前问题与根因

- 聊天使用 `product_bubble_impression`、`product_bubble_click`、`product_detail_open`、`product_detail_cta_click`，是当前概览唯一完整的入口。
- 搜索只通过 `searchReceipt` 记录 `product_search_result_click`；搜索页明确关闭详情/跳转事件，概览 SQL 也没有把搜索点击并入漏斗。
- Kitshop 前端发送 `product_kitshop_card_click`，但服务端白名单未接受该事件；其详情/跳转没有可信商品凭据，事件被拒绝后由客户端静默吞掉。
- 现有概览以“聊天气泡点击 / 聊天气泡曝光”计算 CTR，却把其它来源的行为混在表面数据周边，造成无法比较、可高于 100% 的显示。

## 批次 1：统一受信任商品目录事件

### 修改范围

- `server/product-search-analytics-receipt-service.js`
  - 将已有搜索签名凭据扩展为通用商品目录凭据，携带固定入口 `chat/search/kitshop`；继续绑定当前用户、站点、商品和 30 分钟有效期。
  - 保留对旧版搜索凭据的兼容验证，禁止浏览器伪造商品、站点或来源。
- `server/product-analytics-service.js`
  - 允许受签名凭据验证的搜索、Kitshop 目录事件；不放宽任意产品字段直传。
  - 将所有事件归一为入口维度 `chat`、`search`、`kitshop`：聊天通过真实 `chat_messages` 上下文确认，搜索/Kitshop 通过签名目录凭据确认。
  - 保留已有聊天事件类型和历史数据，避免迁移或历史统计断裂。
- `server/product-search-routes.js`、`server/kitshop-routes.js`
  - 对已登录用户返回的搜索结果和 Kitshop 商品分别附加对应来源的签名凭据；游客响应不携带凭据。
- `server/product-response-sanitizer.js`
  - 白名单放行通用目录凭据字段，不开放商品 Token、站点后台配置或任何身份信息。

### 不做

- 不更改商品、折扣、checkout 生成或 Shopify 订单逻辑。
- 不将游客行为混入当前运营漏斗。
- 不新增数据库表或对既有数据回填猜测来源。

### 验收

- 篡改商品、站点、入口、过期凭据或其他用户凭据，均不能写入统计。
- 搜索和 Kitshop 的真实商品卡可记录曝光、点击、详情打开、Buy now 跳转；聊天原有四项行为不回归。
- 同一来源/商品/动作的重复点击按当前幂等规则处理，不将异常请求写入统计。

## 批次 2：三处前端完整埋点

### 修改范围

- 新增最小共享前端目录曝光上报模块，复用既有 `/api/analytics/product-events` 请求服务，不新增第二套 API。
- `src/features/chat/chat-product-impressions.js`
  - 迁移到共享上报模块或调用共享方法，保持聊天卡片的真实渲染曝光语义。
- `src/features/search/search-page.js`、`src/features/search/search-results-renderer.js`
  - 搜索结果渲染后上报可见列表曝光；点击、详情打开、Buy now 跳转继续使用同一签名目录凭据。
- `src/features/kitshop/kitshop-page.js`
  - 货架渲染后上报商品曝光；卡片打开、详情与 Buy now 统一带上 Kitshop 凭据。
- `src/features/chat/chat-product-panel.js`、`src/features/chat/chat-product-panel-checkout.js`
  - 让从搜索/Kitshop 进入的详情和跳转保留入口来源；聊天仍以聊天消息上下文为准。

### 验收

- 三个入口均可完成“展示 → 点击 → 详情 → 跳转”链路；各自不串来源。
- 搜索/Kitshop 反复渲染不会将同一商品曝光无上限重复累加。
- 游客的登录拦截、商品详情、折扣、尺寸、Checkout 行为维持原状。

## 批次 3：后台两行概览与来源排行

### 修改范围

- `server/admin-product-analytics-service.js`
  - 以归一来源聚合总览和 `chat/search/kitshop` 细分；历史聊天事件仍映射为 `chat`。
  - 统一漏斗指标：`曝光 → 点击 → 详情打开 → Buy now 跳转`。
  - 商品排行按“商品 + 站点 + 来源”聚合，新增来源列；总点击率以全来源点击/曝光计算，不再使用聊天气泡专属分母。
- `src/features/admin-console/admin-console-overview-template.js`
  - 第一行固定四卡：商品曝光、商品点击、详情打开、Buy now 跳转，并显示相邻阶段转化率。
  - 第二行显示对话、搜索、Kitshop 三张紧凑来源卡，每张显示曝光、点击、详情、跳转及关键比例。
  - 排行表增加“来源”列，保留现有筛选、排序与分页交互。
- `src/features/app-shell/styles/admin-overview.css`
  - 沿用既有后台 KPI、表格、窄屏横向滚动样式，只补双行网格和来源卡布局。

### 验收

- 第一行总览固定四张卡；第二行三来源卡在桌面与窄屏均不挤压或截断。
- 同一筛选时间/站点下，第一行数值等于来源卡汇总；比例不超过 100%（分母为同一来源、同一阶段）。
- 缺少某来源数据时显示 0，不影响其它来源或排行。

## 验证与回退

1. 新增服务级自检：签名凭据、来源归一、聚合和篡改拒绝。
2. 新增/扩展前端自检：搜索、Kitshop、聊天各自四阶段事件与后台卡片渲染。
3. 执行语法检查、相关专项自检、`npm run check:deployment`、`git diff --check`。
4. 本地真实浏览器分别从对话、搜索、Kitshop 打开同一商品并点击 Buy now，读取后台接口确认入口及四阶段数据。
5. 对抗审查：检查跨站凭据、跨账号凭据、过期凭据、重复渲染、无商品/无曝光时比例和历史聊天数据兼容。

回退时只需撤回前端上报与新的服务端受签名分支；旧聊天事件和历史表结构不变，后台可继续显示聊天历史数据。
