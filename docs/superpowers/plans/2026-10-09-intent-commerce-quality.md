# Intent, commerce and reply quality

Status: implementation and production verification completed. Active release `2026-10-09-intent-commerce-quality-20261009112827`. Git synchronization recorded in the release note.

## Scope and checkpoints

The approved scope is a compatible intent-entry adapter, business knowledge retrieval, grounded product constraints, complete answers and reply boundaries, and proactive candidate quality. Existing Jev questions, criteria, thresholds, configuration and result normalization remain unchanged. Different legacy capability/context inputs must not be collapsed into an allegedly equivalent single request.

1. Entry compatibility: coordinate and reuse identical Jev inputs and pass immutable decisions to consumers. Preserve image target checks, authorization and fallback behavior. Verify frozen Jev source and adapter request/result parity before accepting integration.
2. Commerce and reply repair: business references must answer the question; user and catalogue constraints require evidence; complete answers survive product captions; sales/contact boundaries apply to all outputs. Test guest and registered paths, unknown facts and mixed requests.
3. Proactive quality: bounded recent history, semantic repetition and language/evidence review, preserving locking, quota and deterministic duplicate checks.
4. Integration: focused regression suite, local service/function and browser checks where available. Record actual validation limits, especially paid providers and audio credits.

## Isolation and rollback

Continue in the existing local branch with unrelated uncommitted audit documents preserved. Baseline source is Git HEAD; a separate Jev source copy is saved under `.backups/2026-10-09-intent-review/`. Changes are separated by module ownership and reviewed before integration. Revert only this task's identified source hunks if a checkpoint fails; never reset existing user changes. No deployment, production data/configuration changes or Git push in this task.

## Validation status

- 36 focused/adjacent isolated self-check scripts passed in the final run. All 38 changed/new JavaScript files passed syntax checks; Git diff whitespace check passed.
- Jev core SHA-256 remains `06b6c9929d8a8bfdb0103217b5bc7249c4373a621bb5506c48958385ccacd17d`. Existing question wording, thresholds and normalization are unchanged; compatible per-turn request coordination is outside the core.
- Two temporary local guest turns exercised the actual reply service, local DB and real text providers: UK shipping policy and withdrawal of shopping/contact permission. Persisted output and voice wording were checked; all temporary guest/message/voice reservation records were removed. This was service-function validation, not a browser conversation or generated-audio test.
- Real catalogue assessment correctly returned player/fan/unknown for three Spanish product descriptions. Real geography assessment distinguished residence in Argentina from the product target.
- Local app restarted as PID 5677, actual project cwd verified, `/api/health` returned HTTP 200. Health is a startup check, not a replacement for the business checks above.
- Known limits: model selection can time out and conservatively withhold unsupported results; one English knowledge selection attempt did so. Local CF knowledge has only shipping sections, so store/payment facts were not claimed. No live proactive sends, registered-user browser session, audio generation, full deployment gate or production validation performed.
- See `docs/releases/2026-10-09-intent-commerce-quality.md` for changed-module map, evidence and remaining limits.

- Production gate: final 251 commands and multisite preflight/smoke passed, 41 file hashes and 13 isolated production checks passed. Initial real knowledge timeout triggered rollback; independent knowledge timeout corrected to 8 seconds and verified against actual production knowledge before final re-release. See the release note for real-provider first-attempt/recheck limits, backup details and dependency advisories.
