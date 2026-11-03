# Reply recovery consolidation (local)

> 状态说明（2026-11-03）：本文保留各阶段设计和试验历史，不作为当前运行配置。最终代码已统一回复审核门槛0.54，投诉重写只使用原生成回调，旧独立投诉生成分支已删除；最终整轮真实页面验收仍未全部通过。

## Scope and checkpoints

Preserve existing routing, knowledge retrieval, catalogue/identity constraints, action permissions, one-rewrite limit and UI. Existing uncommitted work is retained; local source snapshots are under `.backups/20261103-recovery-consolidation`.

1. Review state: preserve primary and independent language outcomes separately in `chat-reply-review-outcome.js`; replace the complaint-specific snapshot selection in the boundary service with a shared result projection. Final approval still requires the applicable contracts. Test valid rejection plus malformed language result, primary unavailable, explicit language failure and repeated recovery.
2. Rewrite context: existing member/guest generation entry points pass the initial prompt context into the existing complaint correction. Reuse initial role/history/evidence and append rejected text/reasons; do not re-run tools. Retain specialized catalogue, image and order constraints. Verify the actual request includes earlier user history and current corrections; test protected paths remain isolated.
3. Terminal state: distinguish an accepted candidate, a guarded terminal output, and failed generation in the existing recovery helper. Consume terminal output once without calling another recovery/action. Replace ambiguous recovered=true call-site semantics.

## Keep / merge / remove

- Keep: actual route decision, site ownership, action evidence, specialized product captions, source boundaries and final delivery order.
- Merge: independent review result selection, text-recovery terminal semantics, ordinary complaint regeneration input with the initial prompt.
- Remove: complaint-only review snapshot projection and the production complaint path's separate shortened conversation construction where initial context exists. Retain no-context test compatibility until call sites are verified.
- Do not introduce: another classifier, keyword-based complaint templates, unbounded retries or provider changes.

## Acceptance

Run isolated state/feedback/context checks and adjacent product/order/image regressions. Then replay original complaint and another newly worded conversation with an explicit user correction through real local pages and real models. Inspect response content, earlier-user recall, promotion meaning, mixed-question coverage and actual rewrite/guard events. Supplier errors and guarded output are not successful acceptance. No production/GitHub deployment in this task.

## Risks

Full initial context may increase prompt cost; prior assistant text is context, not verified facts. Explicit user corrections must override earlier reports. Protocol errors must not be treated as semantic rejection or approval. Existing fixed fallback may still be reached when no usable candidate is produced; do not claim complete resolution without actual page evidence.

## Final local checkpoint

Eligible complaints use the original generation callback/parser; the experimental displayText schema was removed after an actual invalid_json failure. Separate review outcomes and terminal states passed isolated checks. Strict complaint grounded rewrites retain primary business review and use the existing technical guard instead of independent language re-review; other scopes remain unchanged.

Final targeted checks passed; final page acceptance failed with language HTTP errors/timeouts and guarded replies. Earlier batches also showed promotion-meaning drift and unsupported receipt claims; these remain unresolved and cannot be attributed solely to transport. Final variant and adjacent page coverage is incomplete. Temporary test processes stopped. No production or GitHub release. Evidence is under .backups/20261103-recovery-consolidation/ and the update log.
