# TMS、TKF、MTT 站点级物流知识库

## 目标与边界

- 复用 FKK 已上线的 `customer_service + scope=site + priority=100` 物流知识库模式，为 TMS、TKF、MTT 各新增一份独立的官方配送政策。
- 只新增三条指定知识库及其站点绑定；不修改 FKK、通用客服知识、角色人设、聊天路由、页面或 schema。
- 以各站公开 Shipping Policy 为唯一事实来源；物流知识不承接退货意图，继续由既有退货知识路由处理。

## 实施

1. 新增幂等导入脚本，写入以下固定 ID，并分别绑定真实本地站点：
   - `kb_site_tms_shipping_policy` → TMS
   - `kb_site_tkf_shipping_policy` → TKF
   - `kb_site_mtt_shipping_policy` → MTT
2. 每份正文保留本站配送地区、免费配送、处理/送达时效、追踪、地址和异常包裹边界，并记录原始公开政策 URL。
3. 新增只读自检，验证三种本地语言物流问法各自只返回本站政策、不会串到另外两站或 FKK，并进入聊天 prompt 的知识层。
4. 更新脚本索引与当天更新日志；本地服务重启后做健康检查和真实检索验证。

## 验收标准

- 三个知识库均为 `active`、`customer_service`、`site`、`priority=100`，且站点绑定各自唯一正确。
- TMS、TKF、MTT 的物流问题仅命中各自政策；无站点物流政策时既有通用回退逻辑不变。
- 退货、退款等问题不由新物流政策接管。
- 导入脚本重复运行结果一致；不产生 FKK 或其他站点数据写入。

## 回退

- 仅删除上述三个固定知识库 ID 及其 sections/bindings；不涉及 schema 或其他知识库记录。

## 实施状态

`Completed locally`：仅本地数据与验证，未部署服务器、未更新 GitHub。

### 本地验证结果

- 三份知识库均已创建为 `active / customer_service / site / priority=100`，分别只有一个正确的站点绑定和一个有效政策 section。
- 导入脚本连续运行两次，结果一致；不包含 FKK 的 ID 或数据写入。
- 专项自检使用匈牙利语、土耳其语、法语物流问法，验证各站只命中自己的知识库、不会命中另外两站或 FKK，且政策正文进入真实聊天 prompt。
- 既有 `knowledge-retrieval-access-self-check.mjs` 通过，确认无站点政策的通用回退、FKK 隔离和退货路由没有回归；服务健康检查与 `git diff --check` 通过。
