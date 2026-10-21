# Scripts Index

This directory contains deployment tooling, self-checks, one-off maintenance scripts, and local development helpers. Prefer the named npm scripts for common flows and use direct `node scripts/...` commands only for targeted verification.

## Main Commands

- `npm run start`
  - Starts the app with `node server/server.js`.
- `npm run check:deployment`
  - Runs the deployment self-check suite from `scripts/deployment-check.mjs`.

默认发布门禁及关键专项检查的入口是 `scripts/self-check-manifest.mjs`。它不是全部历史脚本的逐文件目录：未列入清单的 `*-self-check.mjs` 仍是按改动范围执行的 Targeted/Ad-hoc 检查，不能据此判断它们已被默认门禁覆盖或已经失效。

- `deploymentGate` 指向默认本地发布硬门禁及其真实命令源；
- `conditionalGate` 是生产发布时才开启的严格检查；
- `optionalRuntime` 是会调用运行中服务、真实 Provider 或较长数据库链路的专项检查；
- `targetedCritical` 是未进入默认门禁、但改到对应领域时必须执行的关键专项检查；
- `manual` 是浏览器真实用户操作、公网 smoke 和数据库/上传资源指纹检查。

新增自检时，先决定它属于默认门禁、条件门禁、关键专项、普通 Targeted/Ad-hoc 或手动验收；只有会影响发布判断或关键领域回归的检查才需要更新 Manifest。不要把“文件存在”误当成“已进入发布门禁”。
- `npm run package:deployment`
  - Builds the deploy archive from the whitelist in `scripts/create-deployment-archive.mjs`.
- `npm run deploy:release`
  - Dry-runs the release deployment. Add `-- --execute` only when deploying to the configured server.

## Local Runtime Helpers

Use workspace-level helpers by default:

- `/Users/cheng/Projects/alove-workspace/scripts/start-main.sh`
- `/Users/cheng/Projects/alove-workspace/scripts/stop-all.sh`

The scripts under `scripts/local/` are lower-level helpers for app/database process control. Do not treat them as the primary runbook unless the workspace helper is being debugged.

## Self-Check Categories

- `*-self-check.mjs`
  - Targeted checks for one feature, split boundary, or regression guard.
  - Most are safe and read-only, but DB-backed checks may create temporary rows and clean them in `finally`.
  - `home-carousel-character-target-self-check.mjs` is DB-backed and verifies that a default-mascot carousel target resolves to the current site mascot.
- `deployment-*.mjs`, `create-deployment-archive.mjs`, `deploy-server-release.mjs`
  - Deployment packaging, validation, and server release helpers.
- `*browser-self-check*.cjs`
  - Browser-backed smoke checks. They may require the local app and MySQL to be running.
- `mascot-default-pvc-seed-self-check.mjs`
  - Guards the default mascot seed so new environments do not reintroduce pending ElevenLabs PVC voice fields.
- `lab/*`
  - Manual experiments for providers such as ElevenLabs. These can call external services and may require explicit env vars.

## One-Off Or Data-Mutating Scripts

Treat these as operational scripts, not routine tests:

- `apply-public-character-voice-persona-config.mjs`
- `apply-mascot-template-persona.mjs`
- `enqueue-proactive-message.mjs`
- `import-football-knowledge-modules.mjs`
- `import-initial-knowledge-bases.mjs`
- `apply-site-shipping-policy-knowledge.mjs`
- `apply-tms-tkf-mtt-shipping-policy-knowledge.mjs`
  - 幂等写入 TMS、TKF、MTT 三份站点级物流政策；只更新其固定知识库 ID，不触碰 FKK 或通用客服知识。

Before running one-off scripts, confirm:

- which database they target;
- whether they write or clean data;
- whether current site IDs and character IDs match the expected environment;
- whether a backup or rollback path is needed.

## Deployment Metadata

`scripts/create-deployment-archive.mjs` generates `docs/releases/current-deployment.json` during packaging. That file is ignored by git and should be treated as generated deployment state, not a hand-written release note.

## Adding New Scripts

When adding a script:

- name it after the feature and purpose;
- make write behavior explicit in the file name, comments, or release notes;
- prefer deterministic assertions over broad text search;
- update this README when the script becomes a common entry point or an operational one-off.

## Local test credentials

Self-checks that sign in to an existing administrator account require `ALOVE_TEST_ADMIN_PASSWORD` in the local process environment. Supply it privately; do not commit credentials or test account exports.
