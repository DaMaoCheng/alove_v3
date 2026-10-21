# Maintainability Cleanup Round 2

## 目标与边界

本轮只治理已经有明确证据的职责混乱、重复数据契约和生命周期泄漏，不为了缩短文件而拆文件。

- 不改变产品规则、页面结构、视觉样式、API 路径、响应字段、数据库结构、站点配置、模型配置或线上数据。
- 不更新服务器或 GitHub；全部工作只在本地分支 `codex/maintainability-cleanup-20260723` 推进。
- 拆解前恢复点为本地 tag `snapshot/pre-maintainability-cleanup-20260723`，指向 `3cfbb08`。
- 每一批保留原公开入口作为 facade；调用方不需要理解内部拆分。
- 每一批必须先通过专项自检和对抗式复核，才能进入下一批。
- 如果拆分后调用方需要学习更多接口、出现第三份转换逻辑或真实页面行为变化，立即停止并回到上一检查点。

## 本轮确认的问题

### 1. 商品详情 payload 在三个入口分别组装

当前 Search、Kitshop、Chat 分别维护商品详情 payload：

- `src/features/search/search-results-renderer.js`
- `src/features/kitshop/kitshop-page.js`
- `src/features/chat/chat-product-card.js`

这不是单纯代码重复：此前已经发生过新增 `customizationOptions` 后，搜索入口没有传递字段，导致同一商品在不同入口展示不一致。

### 2. 商品详情 renderer/controller 已经混合多个可独立变化的职责

`chat-product-panel-renderer.js` 同时处理图片、折扣规则与价格计算、定制选项、尺码、购买状态、支付方式、文案和站点品牌。

`chat-product-panel.js` 同时处理面板事件、折扣选择、定制选择、结账窗口、商品动态补全、防旧请求覆盖、切换动画和支付栏拖动。

这两个文件的主要风险不是行数，而是折扣、定制和结账任一功能变化时，都要跨越多个无关区域修改。

### 3. 后台编辑弹窗的 document 监听没有释放

以下模块会在编辑器反复打开时继续添加全局 `document.click` 监听：

- `src/features/admin-console/admin-carousel-controller.js`
- `src/features/admin-console/admin-character-editor-controls.js`
- `src/features/admin-console/admin-creator-account-picker.js`

关闭弹窗只删除 DOM，不能释放监听器闭包，长期后台操作会累积重复监听和已移除 DOM 引用。

### 4. 数据库 bootstrap 是跨业务域大文件，且缺少结构一致性保护

`server/db-bootstrap-tables.js` 同时定义多个业务域约 32 张表，并与 `database/schema.sql` 共同维护新库基线和旧库升级逻辑。

两者并存有合理用途，不能简单删除其中一个；真正问题是所有领域堆在一个文件，以及没有可靠验证新库基线与升级结果一致。

### 5. 存在与当前隐私规则冲突的死模块

`server/chat-voice-upload-service.js` 没有生产调用方，但仍保留用户原始语音落盘能力。当前正式规则是语音送 ASR 后不保存原始音频，继续保留该模块会误导后续维护者。

## 明确不拆的内容

以下模块本轮不处理：

- `server/chat-voice-asset-service.js`：虽然较长，但资产状态机、并发预占、失败恢复和文件最终化强耦合；现有测试较完整，拆分收益暂不足以覆盖状态机风险。
- `server/mascot-campaign-delivery-job-service.js`：任务状态、目标状态和 campaign reservation 需要保持同一事务语义；等待新增暂停/取消等真实需求时再抽 repository。
- `server/guest-auth-claim-service.js`：跨表操作必须保持同一承接事务。
- `server/product-normalizer.js`、`server/shopify-discount-catalog-service.js`：当前职责内聚，长查询文本不等于职责混乱。
- `database/schema.sql`：它是声明式空库基线，不因行数拆分。
- Discover/Kitshop 横向货架公共化、后台会话模板搬迁、全量自检框架重写：都有改善空间，但没有本轮已发生的功能缺陷证据。

## 批次 0：基线、方案与恢复点

### 做什么

- 建立本计划、独立本地分支和恢复 tag。
- 记录当前 Git、服务、数据库、专项自检和部署门禁基线。
- 将依赖源码行数的结构守卫改为验证公开入口和职责边界，不再用一行增减判断架构是否合格。

### 验收标准

- 工作区开始时干净，恢复 tag 可解析到 `3cfbb08`。
- 当前服务 PID、项目路径、健康接口和数据库连接明确。
- 改造前相关专项与完整 `npm run check:deployment` 的结果被记录。
- 结构守卫能发现 facade 重新吸收实现，但不会因为注释或格式增加一行失败。

## 批次 1：低风险生命周期与死代码治理

### 1A. 删除死语音上传模块

修改范围：

- 删除 `server/chat-voice-upload-service.js`
- 更新 `docs/system/04-backend-services-and-data.md`
- 更新语音隐私专项自检

拆后形态：

- 用户语音上传只存在于临时请求/ASR 链路。
- 文档明确说明原始用户音频不持久化。
- 不新增替代模块，不改变现有语音输入接口。

验收：

- 全仓库不存在生产导入或调用。
- 用户语音转文字、上传校验、正式用户与游客语音输入专项通过。
- 真实语音输入链路仍先生成文字消息，再生成 AI 回复。

### 1B. 修复后台弹窗监听生命周期

修改范围：

- `admin-carousel-controller.js`
- `admin-character-editor-controls.js`
- `admin-creator-account-picker.js`
- 必要的专项自检

拆后形态：

- picker binder 返回 disposer，或统一接收当前 editor 的 `AbortSignal`。
- 关闭 editor 时只执行一次销毁，所有本次打开创建的全局监听同时释放。
- 不改变 HTML、样式、字段值和保存行为。

验收：

- 连续打开/关闭同一编辑器至少 20 次，document 上有效处理器数量不增长。
- 选择语言、选择 creator、选择 carousel character 仍各触发一次。
- Create/Edit/Cancel/Save 真实后台交互无回归。

## 批次 2：统一商品详情数据契约

### 做什么

新增一个共享纯函数模块，例如：

`src/features/chat/chat-product-panel-payload.js`

它只负责把可信商品对象规范化为商品详情面板需要的稳定 payload。Search、Kitshop、Chat 继续传入各自上下文，但不再自行维护商品字段白名单。

### 接口

模块只提供一个主要 interface：

```js
normalizeProductPanelPayload(product, {
  site,
  message,
  character,
  normalizedImageUrl
})
```

它负责保留商品核心字段、动态结账字段、折扣、定制、站点、消息和角色上下文；不负责 DOM、请求、埋点或导航。

### 修改范围

- 新增 `src/features/chat/chat-product-panel-payload.js`
- 修改 `search-results-renderer.js`
- 修改 `kitshop-page.js`
- 修改 `chat-product-card.js`
- 新增跨入口契约自检

### 验收标准

- 同一完整商品分别经过 Search、Kitshop、Chat 后，核心商品字段完全一致。
- `discountOffers`、`customizationOptions`、currency、variant/cart、site scope 不丢失。
- Search 和 Kitshop 不会凭空获得角色折扣上下文。
- 聊天和实时通话继续保留当前角色、消息和埋点来源。
- FKK/GG 的搜索、Kitshop、Chat 商品详情均能打开，且不存在跨站字段污染。

## 批次 3：把商品详情变成深模块

本批不是把每个函数拆成一个文件，而是把高变化、高风险规则藏到少量稳定 interface 后面。

### 3A. 折扣与价格模块

新增：

`src/features/chat/chat-product-panel-discounts.js`

职责：

- 折扣候选规范化和选中态；
- 确定性价格预览计算；
- 货币匹配与金额格式化；
- 无折扣 checkout URL 构造。

对外只保留少量纯函数和一个渲染入口。复杂 Shopify 最终资格仍不由前端认定。

验收：

- 百分比、固定金额、门槛、币种不一致、复杂类型、切换和取消结果与拆前一致。
- 选择假码、失效码或取消后，不沿用上一跳转的折扣状态。
- 顶部价格与底部购买栏价格同步。

### 3B. 定制选项模块

新增：

`src/features/chat/chat-product-panel-customization.js`

职责：

- 定制字段规范化；
- 依赖项可见性；
- 选择状态和加价；
- 定制字段 DOM 渲染。

移除生产 renderer 中的硬编码预览商品和公开 URL 预览开关；如仍需 UI 预览，fixture 只能存在于本地预览资产或测试文件。

验收：

- 无真实定制字段的商品不展示定制区。
- 有真实字段的商品按每件商品自己的 player、name、number、patch 配置显示。
- 选项依赖、输入保持、加价和切换行为与拆前一致。
- Search、Kitshop、Chat、实时通话共用同一结果。

### 3C. 结账与动态补全控制器

新增：

- `src/features/chat/chat-product-panel-checkout.js`
- `src/features/chat/chat-product-panel-hydration.js`

职责：

- checkout 模块负责弹窗预开、链接生成/切换、购买导航与错误收口；
- hydration 模块负责 resolve 请求、并发合并、防旧响应覆盖和动态字段合并；
- `chat-product-panel.js` 保留事件装配、开关面板和模块协调。

验收：

- Buy now 保持拆分前已经生效的尺寸与折扣行为；请求期间切换商品、尺码或折扣时，旧请求必须被取消且不能覆盖当前页面。
- 定制字段本轮只保持面板选择、依赖显示和加价预览状态。Avis/Shopify 定制选项尚未映射到真实购物车，这是既有功能缺口，需等待可靠的 option/cart 协议后另开功能批次，不能伪装成本轮已实现。
- 浏览器阻止弹窗、接口失败、切换商品、快速重复点击均不会打开旧链接或空白页。
- 动态补全慢响应不能覆盖后来打开的商品。
- 正式用户、游客受限入口和实时通话商品浮层行为不变。

### 3D. Renderer 收口

`chat-product-panel-renderer.js` 最终只负责：

- 组装商品详情 DOM；
- 调用折扣、定制、图片、品牌和购买状态模块；
- 更新面板上明确属于渲染层的局部状态。

不设机械行数目标；以“新增折扣规则只改折扣模块、增加定制字段只改定制模块”为验收标准。

## 批次 4：数据库 bootstrap 领域拆分

### 做什么

保持 `server/db-bootstrap-tables.js` 作为兼容 facade，按真实领域把实现移动到：

- `server/db-bootstrap-core-tables.js`
- `server/db-bootstrap-commerce-tables.js`
- `server/db-bootstrap-chat-tables.js`
- `server/db-bootstrap-operations-tables.js`
- `server/db-bootstrap-knowledge-tables.js`

调用方继续从原 facade 导入，初始化顺序不变。不改任何 SQL 内容、表名、索引、列定义或 seed 行为。

### 为什么这样拆

- 每个领域的表结构变化只触碰本领域文件；
- 空库基线 `schema.sql` 仍保持完整；
- 旧库升级逻辑仍由 bootstrap 承担；
- 不引入当前项目并不需要的大型 migration 框架。

### 验收标准

- 原 facade 的所有 export 名称与调用顺序不变。
- 空库初始化成功。
- 当前已有库重复执行两次无结构变化、无重复索引、无配置覆盖。
- 用 `information_schema` 对比空库初始化结果与升级结果，表、列、索引一致。
- 站点 Token、站点登录开关、商品缓存、折扣、游客、广告和知识库现有数据不被覆盖。

## 最终真实链路验收

所有批次完成后：

1. 对全部修改文件运行语法检查和 `git diff --check`。
2. 运行每批专项、所有受影响模块自检和 `npm run check:deployment`。
3. 重启本地服务，确认 `4173` 监听 PID 来自当前项目，健康接口正常。
4. 直接验证真实接口：
   - FKK/GG 商品搜索和 resolve；
   - Kitshop shelves；
   - 正式/游客商品详情字段隔离；
   - 折扣选择、取消和 checkout URL；
   - 数据库初始化幂等性。
5. 真实浏览器模拟：
   - Search、Kitshop、Chat 打开同一商品；
   - 有/无定制商品；
   - 0/1/多折扣码、切换、取消、失效；
   - 尺码选择、Buy now、关闭重开、快速切换商品；
   - 后台相关编辑器连续打开关闭并保存；
   - 游客入口不获得正式用户折扣。
6. 对比改造前后页面 DOM、关键截图、接口字段和数据库结构。
7. 由独立 Agent 做前端行为、后端结构/数据和异常状态三类互评；存在 P0/P1 时不得交付。
8. 清理全部临时账号、测试数据、浏览器状态和本地测试文件。

## 回滚

- 每批开始前确认上一批工作区和自检均为稳定状态。
- 某批验收失败时只回退该批文件，不在失败批次上继续叠加下一批。
- 完整回退使用 `snapshot/pre-maintainability-cleanup-20260723`。
- 数据库批次必须先使用临时数据库验证；没有确认备份与连接目标前，禁止对当前本地业务库做破坏性操作。

## 2026-07-23 实施结果

状态：本地完成，未更新服务器，未更新 GitHub。

- 批次 1 完成：删除未使用且与现行隐私规则冲突的原始语音落盘模块；后台编辑器的全局监听统一绑定当前弹窗生命周期。
- 批次 2 完成：Search、Kitshop、Chat 使用同一个显式字段白名单 payload；敏感 Token、加密字段和 Provider 原始数据不能进入 DOM 商品 payload。
- 批次 3 完成：折扣、定制、动态补全和 checkout 已从面板 renderer/controller 中按职责拆出；原入口保持兼容 facade。
- Checkout 额外补齐：请求级 pending、12 秒超时、AbortController、商品/尺码/折扣上下文复核、切换或关闭取消、失效占位页关闭以及 800ms 重复点击保护。
- 批次 4 完成：22 个数据库 table bootstrap 函数按五个领域移动，函数体、公开 export 和 `db.js` 调用顺序保持不变。
- 当前真实 `aiove_app` 连续执行两次初始化后，51 张表、769 个列定义、428 条索引记录和关键业务表计数前后完全一致。
- 本地浏览器验证 FKK Search 与 Kitshop 打开同一 Spain 商品时，`productId`、名称、价格、站点和 URL 一致；游客商品详情没有正式用户折扣。
- 最终 `npm run check:deployment`、多站点 preflight、HTTP smoke、专项行为测试和三类独立 Agent 复核通过，无 P0/P1 遗留。

验证边界：

- 当前数据库账号没有 `CREATE DATABASE` 权限，因此没有创建独立空库；本轮未修改 `database/schema.sql`、`server/db.js`、任何 SQL 函数体或初始化顺序，已由逐函数一致性与真实已有库双次初始化覆盖本轮风险。
- Avis/Shopify 定制选择仍未映射进真实购物车。本轮保持现有面板展示和选择状态，不把这一既有功能缺口误记为已完成。
