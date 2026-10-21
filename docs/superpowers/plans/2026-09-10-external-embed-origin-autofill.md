# 2026-09-10 站外嵌入 Origin 自动填写

## 目标

站外嵌入首次配置时，从站点管理已保存的 `site_url` 提取 HTTPS Origin；避免把临时地址写入公开 CORS 配置。

## 实施范围

1. `server/external-embed-service.js`
   - 查询站点时带回 `site_url`。
   - 从网站链接提取 `protocol + host`，移除路径、参数、锚点和末尾斜杠。
   - 新配置、空配置、以及 `0.0.0.1`/localhost 等临时地址优先显示并保存该 Origin。
   - 已保存的正式公网 Origin 保持不变；手动输入仍按原 HTTPS 校验。
2. `src/features/admin-console/admin-console-external-embeds-template.js`
   - 在字段下明确显示自动填写来源，保留手动修改入口。
3. `scripts/external-embed-service-self-check.mjs`
   - 覆盖首次自动填写、临时地址纠正、正式手动 Origin 保留与公开 CORS 读取。

## 不在范围

- 不迁移或批量覆盖既有线上 `site_external_embeds` 记录。
- 不放宽公开接口的精确 Origin CORS 策略。
- 不改安装代码、挂件样式、CTA 或游客聊天权限。

## 验收

- 站点网站链接为 `https://www.projerseyshop.es/path` 时，嵌入页面显示 `https://www.projerseyshop.es`。
- 保存后 API 只允许该 Origin 读取已发布配置。
- 已有正确 Origin 不变；用户可覆盖默认值为另一有效 HTTPS Origin。
- PJ 与一个既有站点的本地服务函数/API 校验均通过。

## 回退

单次提交可回退；由于不自动改写数据库已有记录，回退不会破坏已发布挂件配置。
