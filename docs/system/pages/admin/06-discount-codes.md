# 后台：折扣码

状态：`Current`。折扣码登记、角色归属、前台展示与 Checkout 链路已部署；Shopify 实时搜索、规则自动回填和预计折后价为 `Current locally`，尚未部署。本页始终只登记 Shopify 已有折扣，不创建、修改或删除独立站折扣。

## 1. 页面身份

- 入口：`/admin?view=codes`。
- 适用账号：`admin`；列表/选项需要后台读取权限，新增和编辑需要 `admin:promotions:write`。
- 目标：记录站点专享和网红专享折扣，为后续活动权益与订单归因提供稳定业务对象。
- 不做：领取、核销、使用次数、订单归因、Shopify 折扣创建/编辑/删除。

## 2. 列表字段与操作

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 搜索折扣码、优惠或网红 | 搜索文本框 | 否；空值为全部 | code、优惠说明、网红昵称或邮箱 | 快速定位登记 | 服务端按确定性 LIKE 查询 | 输入停止后刷新列表 | `discount_codes`、creator 账号 |
| 全部站点 | 下拉 | 否；默认全部 | active 站点选项 | 限定业务归属 | 无效站点不会改变服务端范围 | 列表按 site 过滤 | `sites` |
| 全部归属 | 下拉 | 否；默认全部 | 前台 / 网红 | 区分权益来源 | 仅允许 `site`、`creator` | 列表按 owner 过滤 | `ownership_type` |
| 全部状态 | 下拉 | 否；默认全部 | 生效中 / 未开始 / 已过期 / 已停用 | 查看运营状态 | 状态由服务端时间派生 | 列表过滤 | `is_enabled`、`starts_at`、`ends_at` |
| 新增折扣码 | 主按钮 | 不适用 | 打开编辑弹窗 | 创建登记 | 无权限时接口拒绝 | 打开空表单 | `discount_codes` |
| 折扣码 / 优惠 | 只读列表列 | 不适用 | code 大写保存；优惠说明 | 识别优惠 | 不显示使用次数 | 点击编辑可修改 | code、offer_description |
| 归属 | 只读列表列 | 不适用 | 前台，或 creator 账号/角色 | 显示权益来源 | creator 由服务端关系返回 | 只读 | `creator_uid`、角色 |
| 站点 | 只读列表列 | 不适用 | 站点名称和 slug | 显示业务归属 | 只返回 active/历史关联站点的安全字段 | 只读 | `site_id` |
| 有效期 | 只读列表列 | 不适用 | 无限期，或开始/结束时间 | 快速判断时间范围 | 状态读取时实时派生 | 只读 | `validity_mode`、时间字段 |
| 状态 | 只读 pill | 不适用 | 生效中、未开始、已过期、已停用 | 呈现派生状态 | 不允许前端直接写 status | 由接口响应更新 | 折扣码状态机 |
| 更新时间 | 只读 | 不适用 | 服务端时间 | 审计修改时间 | 不信任客户端时间 | 只读 | `updated_at` |
| 编辑 | 链接按钮 | 不适用 | 当前行 ID | 打开已有数据 | 非法 ID 返回 404 | 保存后列表刷新 | 折扣码记录 |

## 3. 新建/编辑弹窗字段

| 字段/控件 | 控件与输入方式 | 必填与默认值 | 允许内容/来源 | 用途 | 校验与错误 | 保存/操作结果 | 关联目标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 站点 | 下拉 | 是；新建默认当前可用首个站点，编辑原站点 | active 且配置 Shopify Admin 商品源的站点 | 固定业务归属与折扣查询源 | 停用/不存在 400；切换会清空已选 code 和 creator | 保存 site_id | `sites.id` |
| Shopify 折扣码 | 实时搜索框 + 下拉结果 | 是；至少输入 2 个字符 | 当前站点 Shopify Admin API 返回的 code；最多登记 64 字符 | 从真实 Shopify 折扣中选择，不接受手工伪造规则 | 搜索需后台身份；保存前服务端用 exact code 再查一次，未找到或读取失败则拒绝 | 保存 code 与 Shopify 规则快照 | `discount_codes.code`、Shopify `DiscountCodeNode` |
| 已匹配状态 | 只读提示 | 选择结果后出现 | `code · 已匹配 Shopify` | 明确区分“输入文字”和“已选真实结果” | 再次修改文字或切换站点即清空匹配 | 不直接保存 | 前端选择状态 |
| Shopify 规则摘要 | 只读卡片 | 选择结果后出现 | 优惠类型/金额、使用门槛、有效期、Shopify 状态、是否支持预计折后价 | 让管理员核对真实规则 | 复杂优惠、订单门槛、限定商品/客户或币种不确定时显示“结账页确认” | 保存服务端重新读取的规则，不信任搜索结果 | Shopify discount snapshot |
| 归属 | 单选分段：前台/网红 | 是；默认前台 | `site` 或 `creator` | 选择站点码或网红码 | 其他枚举 400 | site 清空 creator | `ownership_type` |
| 网红账号 | 下拉 | 归属为网红时必填 | 当前所选站点的 active creator，且有未归档 creator 角色 | 确定推广归属 | 跨站、停用、无角色 400 | 保存 creator_uid | `users`、`ai_characters` |
| 启用状态 | 滑动开关 | 是；默认开启 | 开启/关闭 | 人工停用而不删除记录 | 服务端转布尔值 | 状态可变为 disabled | `is_enabled` |
| 备注 | 多行文本框 | 否 | 最长 1000 字符，仅后台内部 | 记录运营备注 | 超长 400；不面向用户或模型 | 保存 notes | `notes` |
| 保存折扣码 | 主按钮 | 不适用 | 提交站点、已选 code、归属、启用和备注 | 持久化登记 | 服务端重新读取 Shopify，覆盖前端规则；权限、关系和唯一性最终判定 | 关闭弹窗、刷新列表、Toast | 折扣码记录 |
| 取消/关闭 | 次按钮/关闭图标 | 不适用 | 无数据提交 | 放弃本次编辑 | 无 | 关闭弹窗 | 无 |

已删除人工输入：优惠说明、有效期类型、开始时间和结束时间。这些字段全部以保存时 Shopify 返回值为准，后台只读展示。

## 4. 状态、接口与相邻影响

- loading：列表显示加载中；options 失败时页面显示错误，不伪造空列表。
- empty：无匹配记录时显示“暂无折扣码”。
- permission denied：读取或写入错误显示服务端提示；不会把失败当作成功。
- Shopify lookup failed：搜索或保存时读取失败会显式报错，绝不把管理员输入当成可信折扣规则。
- 商品详情读取：规则快照最多信任 15 分钟；旧的本地开始/结束时间不会阻断刷新候选，因此 Shopify 提前开始或延长优惠可在 TTL 后恢复。过期或 scheduled 到点时服务端刷新 Shopify。
- 刷新写回带 ID/站点/code/同步时间乐观锁；并发编辑时旧结果不能覆盖新规则。Provider 失败不返回旧优惠，记录安全警告并冷却 60 秒。
- 成功保存后重新读取列表，旧的广告活动 `promotion_campaigns.discount_code` 字符串不被自动改写。
- 有明确角色上下文的正式用户商品详情和 AI 可按既有资格规则使用登记结果；游客、Search 和 Kitshop 不获得角色折扣。
- 商品详情只对“无门槛、全商品、全客户”的 active 百分比折扣，以及同币种固定金额折扣计算预计折后价。Buy now 为单商品、数量 1，因此无门槛整单固定立减同样可从当前商品价扣除。满减、买赠、免运费、限定商品/客户、App 折扣和币种无法确认时只展示优惠卡，最终价格由 Shopify Checkout 决定。

## 5. 代码关联

- 页面：`src/features/admin-console/admin-discount-codes-template.js`、`admin-discount-codes-controller.js`、`admin-discount-code-editor.js`。
- 请求：`src/services/discount-code-service.js`、`src/config/api-config.js`。
- 后端：`server/admin-discount-code-routes.js`、`server/discount-code-service.js`、`server/discount-code-normalizers.js`、`server/shopify-discount-catalog-service.js`、`server/discount-code-eligibility-service.js`。
- 数据：`database/schema.sql`、`server/db-bootstrap-tables.js`、`server/db.js`。
