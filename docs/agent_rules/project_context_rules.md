# Project Context Rules

本文件约束 `alove-page-rebuild` 的项目上下文判断，避免在错误目录、错误仓库、错误日志位置上推进任务。

## 1. 真实项目目录

默认真实项目根目录是：

`/Users/cheng/Projects/alove-workspace/alove-page-rebuild`

以下目录都不能直接当作当前活跃项目根目录：

- `/Users/cheng/Documents/alove`
- `/Users/cheng/Documents/Codex/...`
- 旧项目 `companion-core`
- 历史镜像、备份、压缩副本

如果当前 cwd 不是上述真实目录，必须先确认当前任务是在讨论、规则整理，还是确实要改代码。

## 2. 任务开始前必读

开始真实项目任务前，默认先读：

1. [README.md](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/README.md)
2. [docs/current-workspace.md](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/docs/current-workspace.md)（如果存在且相关）
3. 最近 1 到 3 天的 `logs/updates/YYYY-MM-DD.md`
4. 与任务相关的 `logs/bugs/YYYY-MM-DD.md`
5. 与任务相关的 `docs/releases/*.md`
6. 已有 spec、plan、handoff、audit、todo 文档

不能忽略已有计划重新设计，也不能不看现有日志就改出和最近决策冲突的实现。

## 3. 与旧项目的关系

旧项目目录：

`/Users/cheng/Projects/alove-workspace/companion-core`

旧项目只用于以下场景：

- 查接口来源
- 查数据库结构来源
- 查配置来源
- 查历史业务规则
- 查已经验证过的后端实现

不允许：

- 整体复制旧项目页面
- 默认照搬旧 UI
- 把旧项目架构原样塞进新项目
- 因为旧项目里有某段逻辑就不经确认迁入新项目

## 4. 常见误判防线

### 目录误判

如果发现当前目录没有业务代码、日志、release、package 或 server/src 结构，不要继续假设“只是没找到”，先核对真实源码目录。

### 路径冲突

如果用户给出的路径、README、日志、当前 cwd、脚本路径不一致，优先以真实项目目录和 README 为准，再向用户同步。

### 日志位置误判

本项目默认日志和版本记录位置是：

- `logs/updates/`
- `logs/bugs/`
- `docs/releases/`

不要在 `Documents/alove`、临时目录或历史镜像目录下新建这些记录。

## 5. 规则落点

项目规则文件应落在真实项目目录下，不应落在空壳目录或历史镜像目录下。

如果需要在 `/Users/cheng/Documents/alove` 放文件，那个文件只能是入口导航规则，不应再复制完整项目规则。
