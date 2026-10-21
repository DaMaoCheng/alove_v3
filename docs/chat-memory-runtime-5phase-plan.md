# Chat Memory Runtime 5-Phase Plan

Updated: 2026-06-09

This plan is the active local execution document for the memory runtime work. Scope is intentionally narrow:

- no new admin page
- no user-facing settings page
- no candidate review workflow
- server-side runtime only

## Retention Rules

- `chat_messages`: rolling 30 days
- `chat_message_index`: rolling 30 days, aligned with raw messages
- `conversation_summaries` `day`: rolling 45 days
- `conversation_summaries` `week`: rolling 120 days
- `conversation_summaries` `month`: rolling 365 days
- long-lived `user_memory_records`: keep unless archived or explicitly expired by type
- short-lived `user_memory_records`: expire by `expires_at`

## Phase 1: Job Skeleton

Status: completed

Deliverables:

- add `memory_jobs`
- add server-side runner
- support `queued -> running -> completed|failed`

Self-check gate:

- schema contains `memory_jobs`
- runner starts with the server
- at least one real job can be enqueued and completed through the runner path

## Phase 2: Cleanup Mechanism

Status: completed

Deliverables:

- rolling cleanup for `chat_messages` older than 30 days
- synchronized cleanup for `chat_message_index`
- cleanup expired short-term memories
- cleanup summaries by retention window

Self-check gate:

- old raw messages are deleted by job logic
- matching indexes are deleted or cascaded away
- expired short-term memories become unavailable to prompt reads
- outdated day/week/month summaries are removed by retention policy

## Phase 3: Summary Jobs

Status: completed

Deliverables:

- daily summary recompute job
- weekly summary recompute job
- monthly summary recompute job

Self-check gate:

- each job type can recompute the expected summary layer
- summary links are refreshed with the new result
- prompt reads the recomputed summary through the current runtime path

## Phase 4: Memory Extraction Jobs

Status: completed

Deliverables:

- move user memory extraction off the synchronous chat request
- enqueue extraction job after user message persistence

Self-check gate:

- chat request still completes
- extraction no longer runs inline
- runner writes extracted memories afterward with source links intact

## Phase 5: Raw Episode + Context Completion

Status: completed

Deliverables:

- add `raw_episode` memory type support
- store only high-value original utterances
- include raw episodes in wake-up context

Self-check gate:

- qualified user messages produce raw episodes
- raw episodes survive prompt assembly
- wake-up context includes them without duplicating unrelated content

## Execution Rules

1. Implement phases in order.
2. Do a real-chain self-check after each phase before moving on.
3. Keep edits scoped to current runtime work.
4. Prefer reuse of existing chat services and schema patterns.

## Final Self-Check

Command:

```bash
node scripts/memory-runtime-self-check.mjs all
```

Latest result:

- Phase 1: noop job completed through runner
- Phase 2: old raw messages, old indexes, old summaries, and expired memories cleaned while fresh data remained
- Phase 3: day/week/month summary jobs wrote summaries and source links
- Phase 4: memory extraction job wrote formal memory records and source links
- Phase 5: raw episode was written and included in wake-up context
