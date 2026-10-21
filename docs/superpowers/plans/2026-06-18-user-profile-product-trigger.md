# User Profile Product Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend user memory profiles with inferred football interests and imported purchase history, and allow creator/mascot characters to trigger one product message from the site product API.

**Architecture:** Reuse `user_memory_records` instead of adding a purchase/order table. Product context stays in `server/mascot-product-context-service.js`, but the eligibility check expands from mascot-only to mascot-or-creator while normal characters remain excluded.

**Tech Stack:** Node.js ESM services, MySQL schema metadata, existing self-check scripts.

---

### Task 1: Memory Types And Extraction

**Files:**
- Modify: `server/chat-memory-taxonomy.js`
- Modify: `server/chat-memory-extraction-service.js`
- Modify: `server/user-memory-record-service.js`
- Test: `scripts/user-profile-product-memory-self-check.mjs`

- [x] Add `favorite_team_entity` and `purchased_product` memory types.
- [x] Extract likely football interests from direct and soft user statements.
- [x] Keep purchased products import-ready through manual/system memory insertion.
- [x] Include both new types in the prompt memory block.

### Task 2: Creator And Mascot Product Trigger

**Files:**
- Modify: `server/mascot-product-context-service.js`
- Modify: `server/chat-prompt-service.js`
- Modify: `server/chat-text-message-service.js`
- Modify: `server/chat-voice-message-service.js`
- Test: `scripts/mascot-product-context-self-check.mjs`
- Test: `scripts/mascot-product-prompt-self-check.mjs`

- [x] Rename behavior internally around product context without forcing a broad file rename.
- [x] Allow `category_id = creator` to load product context.
- [x] Keep normal public/common characters excluded.
- [x] Use a neutral `sourceRef` for product messages.
- [x] Apply the same product context path to voice-message replies.

### Task 3: Deployment Guardrails

**Files:**
- Modify: `scripts/deployment-check.mjs`
- Modify: `logs/updates/2026-06-18.md`
- Create: `docs/releases/2026-06-18-user-profile-product-trigger.md`

- [x] Add new self-check to deployment checks.
- [x] Record changed behavior in update log.
- [x] Record release-tree node as local unless deployed later.
