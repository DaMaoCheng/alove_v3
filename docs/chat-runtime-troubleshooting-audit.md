# Chat Runtime Troubleshooting Audit

Updated: 2026-06-09

This document records the dialogue bug audit before proactive messaging work.

## Legacy Bugbook Items Reviewed

Relevant old project issues checked:

- `2026-06-02-chat-cross-user-live-bucket.md`
- `2026-06-03-server-chat-test-probe-pollution.md`
- `2026-05-18-chat-structured-reply-leak.md`
- `2026-05-07-chat-pjax-cache-pending-reply-lost.md`
- `2026-05-05-chat-sidebar-preview-not-realtime.md`
- current project `BUG-2026-06-09-01`

## Current Project Status

### Cross-user live bucket

Current rebuilt project has no WebSocket live event bucket and reads chat sessions by `internal_uid + character_id`, so the old realtime cross-account append bug is not directly present.

Relevant current safeguards:

- message reads require auth
- user sessions are selected by current user
- contacts are filtered by current user sessions

### Test probe pollution

Runtime and memory self-checks now use temporary users and cleanup paths.

Relevant tools:

- `scripts/runtime-chat-self-check.mjs`
- `scripts/memory-runtime-self-check.mjs cleanup`

Additional guard added during this audit:

- obvious instruction probes such as `Reply with one word: win` are rejected by the memory noise layer
- short probe echoes such as `win` and `goal` are rejected by the same layer
- `chat_message_index` skips new rejected probe content
- history retrieval filters existing rejected probe index rows before building wake-up context

### Structured reply leak

Current quality layer detects `displayText`, `speechText`, and `voiceMeta` leakage and extracts visible text before saving the reply.

Regression command:

```bash
node scripts/chat-bug-regression-check.mjs
```

Latest result: passed.

### PJAX pending reply loss

Current rebuilt project does not use the old companion-core PJAX chat page. The closest current risk is client-side optimistic rendering while the request is pending. Current chat submit path remounts app state after request completion, so persisted messages replace optimistic DOM.

### Sidebar preview not realtime

Current chat action updates contacts after message send by calling `upsertContactFromChatResult`. This is not the same old App Frame sidebar bug.

### Unauthenticated message read fallback

Current project already records and fixes this as `BUG-2026-06-09-01`: message reads require login and no longer fall back to demo for logged-out requests.

## New Troubleshooting Tools

### User Chat Runtime Diagnostic

Command:

```bash
node scripts/chat-runtime-diagnostics.mjs --email <user-email> --character fan --limit 8
```

Outputs:

- resolved user
- latest active session
- latest messages
- latest memory jobs
- active memories
- latest day/week/month summaries
- current wake-up context

### Dialogue Bug Regression Check

Command:

```bash
node scripts/chat-bug-regression-check.mjs
```

Currently covers:

- structured reply field leakage
- malformed JSON-like model output
- plain field-style leakage
- instruction-style test probe pollution

## Remaining Notes Before Proactive Messaging

- Proactive messaging must reuse final text sanitization before writing any generated nudge to chat history.
- Proactive messaging should use the same user-scoped session and job diagnostics conventions.
- Any proactive self-check must create and clean temporary test users or messages.
