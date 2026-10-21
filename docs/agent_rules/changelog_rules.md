# Changelog Rules

本文件约束 `alove-page-rebuild` 的更新日志、Bug 日志和 release 节点维护方式。

## 1. 日志位置

本项目默认记录位置：

- 更新日志：`logs/updates/YYYY-MM-DD.md`
- Bug 日志：`logs/bugs/YYYY-MM-DD.md`
- Release 节点：`docs/releases/*.md`

不要把这些记录写到错误目录，例如 `Documents/alove`、临时目录、历史镜像目录。

## 2. 更新日志规则

每次完成实际操作（代码或配置改动、实际排查、测试、发布、Git 同步等）后，按现有格式更新当天的 `logs/updates/YYYY-MM-DD.md`。纯讨论、未执行的方案不记入工作日志。

Bug 后续处理或发布后同步补充状态；按证据区分已实现、专项测试、真实链路验证与部署，不以健康检查代替业务验收。

至少写清：

- 本次目标
- 实现内容
- 自检结果
- 边界和遗留问题

不要把没有验证的事情写成已完成，不要把“计划做”写成“已做”。

## 3. Bug 日志规则

只有明确缺陷时才写 `logs/bugs/YYYY-MM-DD.md`。

记录时要说明：

- Bug 编号
- 现象
- 影响
- 根因
- 修复状态
- 是否已验证

如果只是正常需求调整或 UI 迭代，不要硬写进 Bug 日志。

## 4. Release 节点规则

有阶段性能力落地时，同步更新 `docs/releases/` 节点文档。

Release 节点应写清：

- Scope
- Changed Files
- Behavior
- Verification
- Notes

保持和现有项目里的英文 release 节点风格一致，不要随意改格式。

## 5. 记录与代码一致性

- 日志写入前，先确认对应代码、自检、接口或页面验证已经完成。
- 不允许出现“日志说已完成，但服务没重启、脚本没跑、页面没验证”的情况。
- 如果只是规则文档、流程文档更新，不要误写业务 release。
