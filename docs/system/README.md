# AIOVE System Documentation

更新时间：2026-07-21

本目录是 `alove-page-rebuild` 的系统说明入口，用来给产品、运营、设计、开发和后续 AI Agent 快速理解当前项目。

长期产品规则、已确认演进方向和待决策项请先看 [产品设计规范](../DESIGN.md)；本目录只维护已实现的页面、服务、数据、运维和 API 技术事实。

当前真实项目目录：

`/Users/cheng/Projects/alove-workspace/alove-page-rebuild`

不要把 `/Users/cheng/Documents/alove` 当作源码根目录。

## 文档结构

- [页面与字段规范](./pages/README.md)：逐页面说明控件、字段、输入、校验、状态和保存效果。

- [01-system-overview.md](./01-system-overview.md)
  - 项目定位、账号类型、站点模型、页面地图、核心业务流。
- [02-frontend-pages.md](./02-frontend-pages.md)
  - 用户侧页面、弹窗、聊天、商品详情、创建角色、通话等。
- [03-admin-console.md](./03-admin-console.md)
  - 管理后台每个页面、字段、操作、接口和权限边界。
- [04-backend-services-and-data.md](./04-backend-services-and-data.md)
  - 后端服务、数据库表、聊天/语音/商品/广告/主动消息/知识库等业务域。
- [05-operations-and-deployment.md](./05-operations-and-deployment.md)
  - 本地运行、线上发布、配置项、外部集成、备份、日志、脚本分类。
- [06-api-index.md](./06-api-index.md)
  - 当前前后端主要 API 索引，按业务域整理。
- [07-runtime-configuration.md](./07-runtime-configuration.md)
  - 全部正式运行配置的唯一入口、`SERVER_CONFIG` 映射、实际消费者、站点密钥边界和自检规则。
- [08-ai-conversation-request-context.md](./08-ai-conversation-request-context.md)
  - 用户对话时发送给回复模型及相邻 AI 服务的完整上下文、提示词层、请求字段、隐私边界和后处理规则。

## 当前重要状态

- 当前本地服务：`http://127.0.0.1:4173`
- 当前本地 MySQL：`127.0.0.1:3307`
- 当前线上主机：`47.76.136.38`
- 当前线上根目录：`/srv/alove-new`
- 当前线上 service：`alove-new.service`
- 当前线上域名：`https://alove.fans`
- 当前线上 release：`/srv/alove-new/releases/2026-07-16-manual-campaign-quota-separation-release-20260717002000`

## 当前明确边界

- `Kitshop` 前台入口当前在本地开启并有真实页面/API；`Creator workspace` 入口仍隐藏且页面为演示数据。线上是否可见必须按当前 release 重新核验。
- 充值/支付入口当前故意休眠：余额读取保留，创建支付和直接充值接口返回 `403`。
- Google 登录代码已接入，但真实链路曾受服务器访问 Google API 网络问题影响，需要按线上状态复查。
- 管理后台的商家线索、折扣码、交易支付、成本利润是静态待办页，不是完整真实功能。
- 自动主动消息已切为账号级额度：每天每账号 1 到 2 次，`mascot` / `creator` 共享额度；自动匹配广告继续占用该额度。管理员从前台管理显式启动的手动广告不检查、不占用自动主动消息额度，但继续执行活动去重和站点/账号/角色/会话校验。
- 游客能力由站点开关控制。2026-07-17 核对时，本地仅 `footballkituk` 开启用于测试，线上所有站点关闭；运行配置可变，真实开放状态需重新查询。

## 维护规则

- 页面或功能有明显变化时，同步更新对应系统文档。
- 线上发布和部署流程变化时，优先更新 [05-operations-and-deployment.md](./05-operations-and-deployment.md)。
- API 增删改时，更新 [06-api-index.md](./06-api-index.md)。
- 数据表或核心业务服务变更时，更新 [04-backend-services-and-data.md](./04-backend-services-and-data.md)。
