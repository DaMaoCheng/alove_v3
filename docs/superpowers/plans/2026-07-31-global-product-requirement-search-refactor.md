# 全局商品需求与检索状态重构方案

日期：2026-07-31
状态：已发布（`2026-08-01-greeting-media-global-product-search-20260801141019`）

## 目标

- 清理聊天商品检索中针对单一输入、单一球队、单一商品标题和单轮话术追加的特殊判断。
- 让搜索页、正式账号聊天、游客聊天和前台/网红角色共享同一份结构化商品需求。
- 用户已经给出足够条件时直接检索：完全命中才发送商品；没有命中则按角色语气真诚说明，不能重复询问已经确认的条件，也不能发送不符合硬条件的商品。
- 对话拆成多条消息表达时持续累计用户条件；AI 文本、语音和商品气泡不能中断需求上下文。

## 当前根因

- `server/product-intent-service.js` 同时负责自然语言解析、上下文累计、候选过滤、尺码近似和字符串工具，文件过长且职责混杂。
- `3rd` 等等价表达没有进入统一规范化，明确款式会被当作普通关键词。
- 跨消息累计遗漏颜色和复数款式等字段，用户下一条未重复说明时会丢失先前条件。
- 普通寒暄词可能先占满关键词上限，真正的商品属性反而被截断。
- 商品源使用球队宽召回后，缺失的结构化条件无法在本地严格过滤，错误普通款可能进入商品卡。
- “需要补充信息”和“条件充分但无匹配”没有成为互斥状态，可能同时输出澄清句和最终道歉/反馈入口。

## 模块设计

### 新增深模块

新增 `server/product-search-decision-service.js`，提供小型稳定接口：

- `mergeProductRequirement(...)`
  - 合并当前消息与历史需求，当前消息优先，并支持显式清除旧颜色、款式和商品特征。
- `resolveProductSearchReadiness(...)`
  - 在访问商品源前确定 `ready_to_search`、`needs_clarification` 或 `not_product`。
- `resolveProductSearchState(requirement, products)`
  - 返回 `matched`、`nearest_match`、`needs_clarification`、`no_match` 或 `source_error`。
  - 各状态互斥，调用方不再自行猜测。

新增 `server/product-search-execution-service.js`，集中商品源召回、去重、严格过滤和候选排序：

- 同一条结构化需求最多生成 5 个有界召回查询。
- 正式聊天、游客聊天和搜索页通过同一个执行器完成召回与筛选。
- 商品源异常向上保留为 `source_error`，不能伪装成“没有匹配商品”。

需求字段保持数据化，不为具体球队或商品建立判断：

- 身份：球队、球员或有效自由关键词；
- 商品类型：shirt、top、merch 等；
- 商品属性通过特征注册表维护：home、away、third、retro、goalkeeper、long sleeve、full kit、authentic、fan version、training 等；
- 受众与尺码：adult、kids、women、年龄范围、标准尺码；
- 外观与时间：颜色、赛季；
- 定制：姓名、号码、臂章等。

### 兼容入口

`server/product-intent-service.js`：

- 保留现有导出名称，内部改为调用商品需求模块，避免搜索页、聊天、游客和历史自检同时重写。
- 保留站点商品对象的确定性过滤与既有年龄最近尺码能力。
- 删除或收口只为某个输入形态服务的解析分支；球队和商品属性别名改为数据表，不在流程中散落。

### 候选与商品源

`server/product-candidate-ranking-service.js`：

- 只对已经满足硬条件的候选排序。
- 赛季新旧、基础款优先、热度等仍是软排序，不得覆盖球队、商品类型、颜色、款式、受众、年龄和明确属性。
- 除既有年龄最近尺码规则外，不进行跨颜色、跨款式、跨球队替代。

`server/product-search-public-service.js`：

- 继续复用现有 Shopify/站点商品源和查询变体。
- 商品源可使用宽召回，但每个查询变体必须携带同一份原始结构化需求做本地严格过滤。
- 搜索页和 AI 检索不能各自维护不同语义规则。

### 聊天与输出状态

`server/chat-product-recommendation-service.js`、`server/guest-chat-product-service.js`：

- 共用统一需求和检索状态。
- `matched` 才允许创建商品卡。
- `needs_clarification` 只问一个真正缺失的条件。
- `no_match` 不再追问已经确认的字段。

`server/guest-chat-output-policy.js`、`server/chat-feedback-action-service.js`：

- 澄清消息只对应 `needs_clarification`。
- 最终道歉和反馈入口只对应 `no_match`。
- 两种状态确定性互斥，不能通过拼接得到两段相反话术。

## 分批实施

### 批次 1：失败回归与需求模块

- 为截图原句、`3rd/third`、寒暄前缀、`World Cup 2026 2027`、颜色和 goalkeeper 属性建立失败回归。
- 为断续多消息、商品气泡插入、颜色/赛季/款式继承建立失败回归。
- 新增商品需求模块并保持旧导出兼容。

验收：

- 截图第一条消息解析出 `England + shirt + goalkeeper + green + 2026/27`；后续 `3rd/third` 再加入第三球衣条件。
- 后续消息不需要重复球队、颜色或赛季，商品气泡和角色文本不构成需求边界。
- 寒暄词不会进入商品约束或挤掉有效属性。

### 批次 2：严格筛选与检索状态

- 将硬条件与软排序分离。
- 条件充分且无完全匹配时返回 `no_match`。
- 条件不足时才返回 `needs_clarification`。
- 保留年龄最近尺码这一项已批准例外，不新增其它自动替代。

验收：

- 绿色第三门将款没有匹配时不会发送白色普通款、复古款或其它球队商品。
- 泛球队球衣需求仍按现有规则优先最新基础主场款。
- 明确赛季、主客场、颜色、受众、尺码和印号的组合条件不会相互混淆。

### 批次 3：所有入口统一

- 正式账号、游客和搜索页复用相同需求对象和候选规则。
- 商品卡、文本、反馈行动均读取同一检索状态。

验收：

- 三个入口对相同查询得到相同的候选顺序和无匹配结论。
- 游客优惠、角色权限、站点冻结和商品字段清洗保持原样。
- 商品气泡不会中断后续用户条件累计。

### 批次 4：真实链路与对抗式复核

- 语法检查和专项自检。
- 本地 FKK 真实商品源服务函数检索。
- 本地游客浏览器完整对话。
- 有条件时补正式账号真实聊天；没有可用登录态时明确标注边界。
- 多 Agent 分别复核特殊规则残留、状态链路和异常输入。

验收：

- 截图原句第一轮直接搜索，不重复询问主/客/第三。
- 有完全匹配时发送正确商品；无完全匹配时只发一段角色化道歉，不发送错误商品。
- `needs_clarification` 与 `no_match` 不会同时产生。
- 既有 Chelsea/Manchester United/AC Milan、童装年龄、印号、物流/真实性知识库、折扣、搜索页 10 条结果及商品详情链路回归通过。
- `npm run check:deployment`、`git diff --check` 通过。

## 回退与边界

- 不修改 Shopify Token、站点配置、商品表、折扣、结账或商品详情数据结构。
- 不删除现有商品消息或会话数据。
- 新模块通过兼容入口接入；如验证失败，可回退调用而不影响站点商品源。
- 本轮只在本地推进，未获明确授权前不部署服务器、不提交或推送 GitHub。

## 本地完成结果

- 已新增 `server/product-search-decision-service.js`，统一需求合并、明确清除和互斥检索状态。
- 已新增 `server/product-search-execution-service.js`，统一搜索页、正式聊天和游客聊天的有界召回、去重、硬条件过滤与排序。
- 已将“短消息补充旧需求”和“完整新需求替换旧筛选”分为两个确定性状态：前者继承用户已确认条件，后者清除上一轮未在当前请求中出现的款式、颜色、定制和印号，避免旧会话污染新检索。
- 已修正公共合并模块对 `clearFields` 字段标识符错误转小写的问题；`not customized`、`without number`、`no printing` 等短纠正现在会保留球队等有效上下文，同时确定性清除旧定制或印号。
- 活动商品与用户偏好兜底继续复用原有服务：没有明确商品条件时活动仍优先；用户已经说明球队、颜色、赛季、款式、受众或商品特征时，活动与偏好均不能覆盖这些硬条件。
- 商品源缺失、抛错或上游明确返回异常时，搜索页、正式聊天和游客聊天均确定性返回 `source_error`，不会伪装成“没有商品”，也不会触发最终反馈入口。
- 无匹配时继续复用现有反馈动作；如果模型已经生成了邮箱或反馈入口说明，后端不会再次追加同义联系文案，`Click here` 仍作为独立动作消息展示。
- 未为了拆分而重写入口；`product-intent-service.js` 保留兼容导出，现有搜索页、正式聊天和游客聊天调用方平滑接入新模块。

## 本地验收证据

- 本地真实搜索 API：
  - `England black goalkeeper shirt World Cup 2026` 命中 `England Hollywood Keeper Soccer Jersey World Cup 2026 Black`。
  - `England green goalkeeper third shirt 2026/27` 返回 0，不返回白色、复古或普通款。
  - `Manchester United away shirt` 返回 10 条，首条为 `Manchester United Away Soccer Jersey 2026/27 Blue`。
  - `Chelsea 26` 返回当前 `2026/27` 商品。
- 本地真实游客对话：
  - 截图原句首轮直接检索；无精确商品时只返回角色化无匹配说明和独立反馈入口，没有追问 home/away/third。
  - 后续 `The third green goalkeeper shirt.` 保留 England、green、goalkeeper、赛季上下文，仍不发送错误商品。
  - 在同一条包含旧 `third/green/customization` 历史的游客会话中，重新发送 `Do you have the England black goalkeeper shirt for World Cup 2026?`，旧条件被确定性清除，实际发送 `England Hollywood Keeper Soccer Jersey World Cup 2026 Black` 商品卡和角色补充文本。
  - 最终复测截图原句时，页面只显示一段角色化无匹配说明、一份联系承接文案和一个独立 `Click here`，没有错误商品卡，也没有重复追加联系说明。
- 专项回归、活动商品优先级、用户偏好兜底、正式/游客商品消息、反馈入口、商品源错误、搜索页、Kitshop、折扣、商品详情、多站点 preflight 与 HTTP smoke 均通过。
- `npm run check:deployment` 与 `git diff --check` 通过。
- 当前仍仅为本地版本；服务器和 GitHub 未更新。
