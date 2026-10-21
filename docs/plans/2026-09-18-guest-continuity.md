# 游客连续性迭代（仅本地）

## 已有证据与边界

线上两次携带同一 Cookie 的 HTTP 请求返回同一 chat ID；这不是 CF 浏览器关闭/重开测试，也不能证明无痕模式是实际原因。此前 1531 的地区统计是 JOIN 后消息行计数，不能称为会话数；此前时间窗口没有验证数据库时区，因此不作为本次身份判断依据。

## 实现

1. `server/guest-visitor-service.js`、独立 bootstrap 表：90 天随机匿名 Cookie，服务端只保存 hash；按站点关联游客，保留首次/最近访问与身份事件。以既有 guest ID 为会话凭证，visitor 永不授予聊天读取或登录权限。
2. `server/guest-chat-routes.js`：在已有 GET session 链路记录 created/reused/invalid 与安全原因；不改变原 401、quota、注册承接、来源 handoff 行为。诊断失败不阻断聊天。
3. `server/guest-continuity-candidates-service.js`：只读、有限候选窗口，展示同站近期会话的多项相似证据。IP 或时间单项不建立关联，不合并记录，不输出概率或真实人数。
4. `server/admin-guest-session-service.js`：仅当前分页批量补充匿名标识、关联次数与候选；保留既有列表过滤与权限。
5. `src/features/admin-console/admin-guest-sessions-template.js`：在既有展开信息内补充同浏览器匿名标识、首次/最近访问、最近复用结果、关联会话及疑似证据；复用样式，不修改表格列。
6. 测试脚本：本地 MySQL/HTTP 验证创建与复用、旧 guest 补标识、仅清 guest Cookie 的关联、全部 Cookie 清除后的新身份、站点隔离、无效 token、诊断失败和后台输出。

## 副作用与处理

- 清除所有 Cookie/结束无痕会话会丢失匿名标识，不做绕过浏览器隐私的持久指纹。
- 只有相同匿名标识才能标记同浏览器，不等于同一个自然人；相似证据仅供管理员核查。
- 历史记录不自动补认身份。来源页面继续使用既有 external_source_context_json，每次有效 handoff 更新。
- 新诊断表有索引及保留窗口，查询有数量上限；不把访客审计写进每条聊天消息。
- 额度、注册承接、订单、支付、站点配置和角色人格不改动。疑似关联不共享聊天记录。

## 验收

- 同一 guest Cookie 重入返回同一 guest/chat；消息与额度不重置。
- 只丢失 guest Cookie 但匿名 Cookie 存在：新会话可以关联；全部 Cookie 丢失：新匿名身份。
- 同 Cookie 跨站关联隔离；无效身份仍按原协议拒绝并清 guest Cookie。
- 后台历史/空值/XSS/诊断失败均能正常显示；原查看对话与来源页面不变。
- 普通浏览器关闭重开真实验证及本地 HTTP+DB 验证分别记录，不相互冒充。
- 自检清理仅本次 fixture；记录日志，不部署、不推 GitHub。

## 代码级收口

| 文件 | 修改与复用方式 | 验收标准 |
| --- | --- | --- |
| `server/guest-visitor-schema.js` / `server/db.js` | 幂等创建 anonymous_visitors、guest_visitor_links、guest_identity_events；给 guest_sessions 增加 site_id/created_at/id 索引 | 重复执行无覆盖站点配置、无重建旧表 |
| `server/guest-visitor-service.js` | 独立 HttpOnly、SameSite=Lax 的90天观察 Cookie；站点+hash 唯一；已有有效 guest 的关联优先 | 只失去观察 Cookie 或冲突标记不会转移原 guest 的归属；不以标记读取聊天 |
| `server/guest-chat-routes.js` | 仅现有 GET session 调用观察服务，401仍清原游客 Cookie | 创建/复用/失效记录；诊断异常不改变业务返回 |
| `server/guest-continuity-candidates-service.js` | 当前分页按站点查询最多200条候选；每条取首条用户文本，超过1000字符不参与文本比较 | 同站、创建相距30分钟内，IP+页面、IP+文字或页面+文字至少一组；文字规范化后至少20字符；最多展示3条 |
| `server/admin-guest-session-service.js` | 当前分页批量补充结果，辅助读取失败回退为空 | 保留原过滤、分页、查看对话及权限；不对每条guest单独查库 |
| `src/features/admin-console/admin-guest-sessions-template.js` | 既有展开详情新增匿名访问关联组；已有 escape 与样式直接复用 | 折叠表格HTML不变；危险字符串转义；最多20条关联ID |
| `server/guest-visitor-cleanup-service.js` / `server/memory-job-runner-service.js` | 复用定期清理任务，分批删除90天前事件；过期且无任何保留guest的匿名组才删 | 每批上限1000；活跃及已认领历史关联保留；附属清理失败不使原任务失败 |
| 新增4个专项脚本、deployment-check、self-check-manifest | 复用本地DB环境保护与发布检查入口 | 所有新增测试与相关现有回归串行执行；测试数据按唯一ID清理 |

候选线索使用已有最近IP/来源及首条用户文字，不扩充设备指纹、不发送聊天给外部API。这里的“文字相同”是确定性比较，不是风格识别，也不靠语言关键词表。

## 发布与回滚边界

本阶段仅落地本地。后续发布需另按发布流程备份并部署；本次没有上传服务器或推送 GitHub。回滚时移除路由与管理端观察接入即可恢复原行为，新增独立表可保留，不需要删除业务数据；新增 Cookie 无认证能力。
