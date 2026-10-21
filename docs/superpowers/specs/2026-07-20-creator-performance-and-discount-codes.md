# 网红表现看板与折扣码管理规格

状态：`Current / Approved direction`（网红个人看板及可信个人统计接口已在本地实现；后台汇总仍为 Approved direction；折扣码数据库、CRUD 接口和后台页面已本地实现，尚未部署）

## 1. 目标

- 为 creator 账号恢复独立工作台，只展示其本人网红角色带来的真实互动表现。
- 在现有后台概览中补充全站网红表现汇总和排行，不新增重复的后台一级菜单。
- 将后台静态“折扣码（待）”替换为真实登记与管理页面。（Current locally）
- 所有统计从服务端可信关系推导，不信任前端提交的 owner、角色类型或站点归属。
- 按功能职责拆分模板、控制器、service 和查询模块，避免继续向既有大文件堆积职责。

## 2. 非目标

- 本期不计算网红收入、分成、可提现金额、订单佣金或结算记录。
- 本期不通过 Shopify API 创建、修改或删除独立站折扣。
- 本期不实现折扣领取、核销、一次性绑定、订单归因或财务结算。
- 本期不修改 `promotion_campaigns.discount_code` 的历史字符串；后续可将活动编辑器改为选择同站点已登记折扣码。

## 3. 角色与权限

### 3.1 Creator 账号

- creator 账号在首页左侧菜单看到“Creator dashboard”入口。
- 个人看板只能读取当前登录账号拥有的 creator 角色及其可信统计。
- personal 账号不能看到入口，也不能访问接口。
- admin 账号使用后台聚合数据；不把个人 creator 看板作为管理员的日常入口。

### 3.2 管理员

- 管理员在现有后台概览查看全站网红汇总、趋势与排行。
- 管理员可按站点和时间范围筛选。
- 管理员可创建、编辑、启用、停用和查询折扣码登记。

## 4. Creator 个人看板

### 4.1 时间范围

| 选项 | 含义 | 默认 |
| --- | --- | --- |
| 7 days | 当前时刻向前 7 天 | 否 |
| 30 days | 当前时刻向前 30 天 | 是 |
| 90 days | 当前时刻向前 90 天 | 否 |

对比周期为紧邻当前周期之前、长度相同的时间段。日期边界由服务端统一计算，前端只提交稳定枚举 `7d`、`30d` 或 `90d`。

### 4.2 KPI

| 指标 | 确定性口径 | 页面展示 |
| --- | --- | --- |
| Conversations | 选定周期内收到至少一条用户消息的去重正式会话数 | 当前周期数量、环比方向与百分比 |
| Product triggers | 可信归属于当前 creator 的 `product_bubble_triggered` 数量 | 当前周期数量、环比方向与百分比 |
| Store visits | 可信归属于当前 creator 的 `product_detail_cta_click` 数量 | 当前周期数量、环比方向与百分比 |
| Visit rate | `Store visits / Product triggers` | 百分比；分母为 0 时显示 `--` |

前一周期为 0 时，变化率显示 `--`，不能伪造 100% 或无限增长。当前值和前值均为 0 时使用持平状态。

### 4.3 趋势图

- 按自然日分桶，使用服务端返回的连续日期序列；无事件日期必须返回 0。
- 通过分段控件切换 Conversations、Product triggers、Store visits。
- 一次只显示一个指标，避免不同数量级共用纵轴造成误导。
- 图表必须具备 loading、empty、error 和 ready 四种状态；无真实接口时不得使用演示数字填充。

### 4.4 页面身份信息

- 顶部与左侧身份区优先展示当前 creator 账号的昵称和头像。
- creator 角色资料接入后，补充角色名称与头像；不得继续使用固定演示人物。
- 一个 creator 账号当前只允许拥有一个未归档 creator 角色；若没有可用角色，页面显示明确空状态，不跨账号回退其他角色。
- 该限制由业务层预检查和数据库唯一索引共同保障：业务层返回可理解提示，数据库阻止并发请求同时写入两个未归档 creator 角色。
- 已归档 creator 角色不占用名额，允许创建替代角色；替代角色存在时，旧角色不能恢复为未归档状态。
- 普通角色不受此限制，同一账号仍可拥有多个非 creator 角色。
- creator 角色创建后不能通过普通编辑更换绑定账号，也不能在 creator 与普通分类之间转换，避免借分类切换把历史会话和商品统计转移到其他账号；未来如需转移或转换，必须设计独立迁移流程。
- owner 账号失效或所属站点停用时，管理员仍可将现有 creator 角色归档；恢复上架时必须重新校验账号、站点和唯一性。

### 4.5 受众留存

- `Unique chatters`：选定周期内与当前 creator 角色对话的去重正式用户数。
- `New chatters`：首次与当前角色产生有效会话的时间落在选定周期内的用户。
- `Returning chatters`：周期开始前已经与当前角色产生过有效会话，并在选定周期内再次对话的用户。
- `Return rate`：`Returning chatters / Unique chatters`；分母为 0 时显示 `--`。
- `Avg. messages`：选定周期内用户发送的消息数 / Conversations；分母为 0 时显示 `--`。
- 新用户与回访用户必须互斥，二者之和等于 Unique chatters；游客是否纳入需在真实统计接口批次前单独确认，当前不默认混入正式用户口径。

### 4.6 热门产品

- 展示当前 creator 在选定周期内 Product triggers 前 5 的可信产品。
- 字段为商品图片、商品名称、Product triggers、Store visits 和 `Store visits / Product triggers`。
- 排序按 Product triggers 降序、Store visits 降序、稳定 product key 升序，避免同值时列表跳动。
- 商品必须来自 creator 所属站点的可信商品快照；前端不能提交商品归属或跨站补图。

## 5. 后台概览中的网红表现

在现有后台概览增加一个独立区段，复用相同时间范围和站点筛选语义：

- 网红会话总数；
- 商品触发总数；
- 独立站跳转总数；
- 整体跳转率；
- 单指标日趋势；
- 网红排行。

排行字段：creator 账号、creator 角色、站点、会话数、商品触发数、独立站跳转数、跳转率。排序和分页由服务端允许字段白名单控制。

## 6. 可信统计边界

当前产品事件客户端可提交 `ownerUserId`、角色类型和站点等提示字段，这些字段不能作为网红报表归属依据。服务端必须通过以下关系重新解析：

`message_id -> chat_messages -> chat_sessions -> ai_characters.owner_uid`

同时必须满足：

- 事件中的用户与会话所属用户一致；
- 角色为 creator 类别且未发生跨站错配；
- 查询始终限定当前 creator owner，或管理员明确选择的站点范围；
- 客户端 `ownerUserId`、角色类型和站点只可用于排查，不可决定报表归属。

不满足可信链的历史事件不得计入 creator 报表；需要单独统计丢弃数量，供后端审计。

## 7. 折扣码登记模型

第一版是 Alove 对独立站既有折扣码的登记系统，不是 Shopify 折扣创建器。

| 字段 | 输入方式 | 规则 | 目标 |
| --- | --- | --- | --- |
| Code | 文本框 | 必填；同站点内忽略大小写唯一 | 记录独立站已有折扣码 |
| Site | 站点下拉 | 必填；active 站点 | 确定业务归属和唯一范围 |
| Ownership type | 分段控件或单选：Site / Creator | 必填 | 区分站点专享与网红专享 |
| Creator account | 可搜索下拉 | Creator 类型时必填；必须属于所选站点 | 确定网红专享归属 |
| Offer description | 文本框 | 必填；描述真实优惠，不做自动计算 | 给运营识别优惠内容 |
| Validity mode | 分段控件：Indefinite / Fixed | 必填 | 支持无限期或固定期限 |
| Starts at | 日期时间选择器 | Fixed 时必填 | 生效时间 |
| Ends at | 日期时间选择器 | Fixed 时必填且晚于开始时间；Indefinite 时为 `NULL` | 结束时间或无限期 |
| Status | 滑动开关 | Enabled / Disabled | 人工停用 |
| Notes | 多行文本框 | 可空 | 内部备注，不面向用户 |
| Created / Updated | 只读 | 服务端生成 | 审计记录 |

### 7.1 确定性规则

- 同一站点内 `code` 忽略大小写唯一；不同站点允许相同文本。
- 一个站点和一个 creator 均可登记多个 code。
- Site 类型不能保留 creator 归属；切换到 Site 时服务端必须清空 creator 字段。
- Creator 类型的账号必须为 active creator、属于选定站点，且服务端再次校验。
- Indefinite 模式写入 `ends_at = NULL`；Fixed 模式要求 `ends_at > starts_at`。
- 页面派生状态为 Scheduled、Active、Expired、Disabled，不额外持久化易过期的展示状态。
- 第一版不显示伪造的“已使用次数”。在订单归因接入前，该字段不存在。

## 8. 状态与错误

- 页面必须覆盖 loading、empty、ready、validation error、request error 和 permission denied。
- 接口错误不能被 0、空数组或旧缓存伪装为成功。
- 跨站、越权、已失效 creator、不合法时间范围和重复 code 必须由服务端确定性拒绝。
- 失败响应使用稳定错误码和管理员可理解的提示，不暴露 SQL、Token 或内部堆栈。

## 9. 验收标准

- creator 首页左侧入口只对 creator 账号显示，个人账号不可见。
- 页面不再出现固定人物、假美元、假销量、假折扣使用和提现内容。
- 7/30/90 天控件、KPI、趋势指标切换及 loading/empty/error/ready 状态完整。
- 受众留存的新用户、回访用户、回访率和平均消息数口径确定且互相一致；热门产品固定为同站点可信 Top 5。
- creator 统计只能通过可信服务端关系归属，伪造前端 owner/site/role 不会改变报表。
- 后台概览与个人看板使用同一指标定义，不出现同名不同口径。
- 折扣码同时支持站点和 creator 归属、固定期限和无限期，并通过服务端验证。
- 新增职责分别落在模板、控制器、前端 service、后端 service 和 route 文件；不形成新的综合大文件。
