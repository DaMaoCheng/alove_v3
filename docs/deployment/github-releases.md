# GitHub tag 与 Release 发布流程

适用于 `DaMaoCheng/alove_v3`；自 2026-11-25 起，每次正式发布都执行。此步骤不替代服务器部署与验收。

## 发布完成条件

1. 生产验收通过，保留部署包校验值和实际运行源码证据；对应提交已进入远程 `main`。
2. 为准确的运行源码提交创建 annotated tag。不得把后补文档提交或含未提交修改的旧基线冒认为已部署提交；无法准确映射时先补齐源码与包的核验记录。
3. 发布 GitHub Release：写明改动、实际验证和已知问题。公开摘要须脱敏；禁止上传密钥、环境配置、数据库、真实用户对话、私有发布记录或部署包。
4. 读回远程 tag，确认它是 annotated tag 且最终指向正确提交；确认 Release 已发布、绑定正确 tag，当前版本显示为 Latest。将 tag、提交、Release 链接及验证结果记入本地私有发布记录。

只做本地修改或文档同步时，不创建业务版本；正式配置发布需要说明配置范围，源码标签不能还原数据库或环境配置。版本号已存在时先核对目标，禁止移动已发布标签或覆盖历史。

## 命名与命令

日期使用 Asia/Shanghai。常规格式为 `vYYYY.MM.DD`，同日多次发布加简短用途后缀，例如 `v2026.10.27-dependency-security`。

以下占位内容必须替换成已经核验的值：

```sh
git tag -a <tag> <verified-deployed-commit> -m '<release-summary>'
git push origin refs/tags/<tag>
gh release create <tag> --repo DaMaoCheng/alove_v3 --verify-tag --title '<title>' --notes-file <sanitized-notes-file> --latest
```

若使用 GitHub API 创建标签，也必须创建 tag object 再创建 ref；不能只建 lightweight ref。发布失败时读回状态，只补缺失步骤，不移动已建立的正确标签。最后用 `gh api` 读回 tag/ref 和 Release 逐项核验，避免仅凭命令退出码宣称完成。

历史补录须说明原日期和补录日期，并使用 `--latest=false`；不伪造 GitHub 创建时间，不把旧版重新部署。Latest 留给已验收的当前版本。

## 2026-11-25 补录索引

以下为可对应公开提交的版本记录；历史版本按当时验收记录补录，未重新运行旧版。10 月 21 日标签仅标记干净公开源码起点，不代表一次新增部署。迁移前私有历史继续保留私有，不恢复到公开仓库。

| 原日期 | Release | 源码提交 |
| --- | --- | --- |
| 2026-10-21 | [公开源码起点](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.21-public-baseline) | `2bd8e46` |
| 2026-10-22 | [聊天可靠性与备用通道](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.22-chat-reliability) | `eda00e0` |
| 2026-10-22 | [主动消息费用防护](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.22-proactive-cost-guard) | `ebe78fc` |
| 2026-10-22 | [商店服务问答](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.22-store-service-faq) | `034506c` |
| 2026-10-23 | [受约束的近似商品推荐](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.23-constrained-product-alternative) | `3c182b1` |
| 2026-10-23 | [商品证据与后续条件](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.23-product-reply-evidence) | `c8180af` |
| 2026-10-25 | [商品审核与上下文恢复](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.25-product-review-closure) | `2d25e52` |
| 2026-10-26 | [目录候选与尺码](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.26-catalogue-closure) | `24b9046` |
| 2026-10-27 | [客服与图片回复](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.27-support-image-closure) | `0a60764` |
| 2026-10-27 | [运行依赖安全维护](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.27-dependency-security) | `55cb25c` |
| 2026-10-27 | [图片终态与自然回复](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.27-member-image-terminal) | `b025632` |
| 2026-10-28 | [JEV 分流与官方备用](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.28-jev-official-routing) | `5fd5a7d` |
| 2026-10-29 | [混合意图与图片流程](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.10.29-mixed-intent-image) | `9560ff4` |
| 2026-11-03 | [对话恢复收敛](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.11.03-reply-recovery-consolidation) | `c915593` |
| 2026-11-04 | [分流与证据恢复](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.11.04-conversation-routing-recovery) | `c964f12` |
| 2026-11-05 | [语言与客服交接](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.11.05-language-support-recovery) | `fb450dd` |
| 2026-11-06 | [知识证据与混合回复](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.11.06-knowledge-reply-evidence) | `511e178` |
| 2026-11-06 | [历史对话回归维护](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.11.06-historical-regression-repair) | `da06d77` |
| 2026-11-17 | [对话连续性维护](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.11.17-conversation-maintenance) | `69871ed` |
| 2026-11-25 | [会话可靠性与活动礼盒](https://github.com/DaMaoCheng/alove_v3/releases/tag/v2026.11.25) | `f3fd0fd` |

11 月 23 日礼盒及工具栏当时以未提交快照发布，没有可准确对应的独立公开提交，因此不另建会误导回滚的旧标签；相关源码已纳入 `v2026.11.25`。仅配置调整、未部署草稿和文档提交不另补为生产源码版本。GitHub 源码压缩包不包含生产运行环境、数据库及上传资源，回滚仍依赖服务器发布记录和保留的备份。
