# Knowledge Frontend Cleanup Round 5 Plan

> Scope: split the newly grown admin knowledge frontend files without changing user-facing behavior. Each part must pass targeted self-checks and a real local admin-page verification before the next part starts.

## Baseline

- Current local project: `/Users/cheng/Projects/alove-workspace/alove-page-rebuild`
- Current local app: `http://127.0.0.1:4173`
- Previous cleanup baseline: `docs/superpowers/plans/2026-06-25-architecture-cleanup-round-4.md`
- Backup snapshot for this round: `.codex-backups/2026-06-26-knowledge-frontend-split/`

## Execution Status

- Part 1 completed locally on 2026-06-26: `admin-knowledge-controller.js` was reduced to page orchestration, while editor lifecycle and target picker behavior moved to focused modules.
- Part 2 completed locally on 2026-06-26: knowledge list/editor templates moved to `admin-knowledge-template.js`, while `admin-console-static-tabs.js` keeps static placeholder pages and re-exports the knowledge entry points for compatibility.
- Part 3 completed locally on 2026-06-26: knowledge-specific CSS moved to `admin-knowledge.css` and is imported from `app.css`.
- Final local verification completed: targeted self-checks and Playwright checks for `/admin?view=kb`, `/admin?view=commonCharacters`, `/admin?view=creatorCharacters`, and `/admin?view=mascot` passed.
- Deployment status: not deployed in this round.

## Part 1: Admin Knowledge Controller Split

**Goal:** Keep `bindAdminKnowledge()` as the page entry while moving editor lifecycle, target picker behavior, and payload parsing into focused modules.

**Target files:**

- Keep facade/orchestrator: `src/features/admin-console/admin-knowledge-controller.js`
- Create: `src/features/admin-console/admin-knowledge-editor.js`
- Create: `src/features/admin-console/admin-knowledge-target-picker.js`
- Create if needed: `src/features/admin-console/admin-knowledge-payload.js`
- Update: `scripts/admin-knowledge-scope-ui-self-check.mjs`

**Must not change:**

- Knowledge API payload shape.
- Create/edit/delete behavior.
- Scope switching rules.
- Character/site picker behavior.

**Validation:**

- `node --check` on touched knowledge controller files.
- `node scripts/admin-knowledge-scope-ui-self-check.mjs`
- `node scripts/admin-knowledge-modal-ui-self-check.mjs`
- `node scripts/admin-knowledge-update-self-check.mjs`
- Browser check on `/admin?view=kb`: open create/edit modal, switch scope panels, confirm target picker remains usable.

## Part 2: Admin Knowledge Template Split

**Goal:** Move knowledge list/editor template helpers out of `admin-console-static-tabs.js` so that file returns to static placeholder/admin simple pages.

**Target files:**

- Create: `src/features/admin-console/admin-knowledge-template.js`
- Modify: `src/features/admin-console/admin-console-static-tabs.js`
- Modify imports in knowledge controller if needed.
- Update: `scripts/admin-knowledge-scope-ui-self-check.mjs`

**Must not change:**

- Rendered knowledge table columns.
- Scope tags, binding count dash, category tags.
- Editor DOM attributes used by controller and tests.

**Validation:**

- `node --check` on touched template files.
- `node scripts/admin-knowledge-scope-ui-self-check.mjs`
- `node scripts/admin-character-knowledge-readonly-display-self-check.mjs`
- Browser check on `/admin?view=kb`: table and editor still render.

## Part 3: Admin Knowledge CSS Split

**Goal:** Move knowledge-specific styles out of `admin-console.css` into a scoped `admin-knowledge.css`.

**Target files:**

- Create: `src/features/app-shell/styles/admin-knowledge.css`
- Modify: `src/features/app-shell/styles/admin-console.css`
- Modify: `src/features/app-shell/app.css`
- Update style self-checks if required.

**Must not change:**

- Current visual styling for knowledge list, editor, scope tags, target picker, and readonly knowledge tags.
- Existing import order for unrelated admin pages.

**Validation:**

- `node scripts/admin-knowledge-scope-ui-self-check.mjs`
- `node scripts/admin-character-knowledge-readonly-display-self-check.mjs`
- `node scripts/admin-mascot-knowledge-display-self-check.mjs`
- Browser checks:
  - `/admin?view=kb`
  - `/admin?view=commonCharacters`
  - `/admin?view=creatorCharacters`
  - `/admin?view=mascot`

## Final Verification

- `git diff --check` on touched files.
- Update `logs/updates/2026-06-26.md`.
- Create release node `docs/releases/2026-06-26-knowledge-frontend-cleanup-round-5.md`.
- Do not deploy in this round unless explicitly requested.
