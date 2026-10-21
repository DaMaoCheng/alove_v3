# Chat Data Retention: 180 Days

## Goal

Keep raw chat messages and their chat media for 180 days, while limiting history visibility independently: registered users see 30 rolling days, guests can use the same guest token for 14 days and see that 14-day conversation, and the account-management default remains 30 days until its later date-range filter is added.

## Scope

- Implement the 180-day raw-message retention policy and clean media linked to expired messages.
- Keep registered-user history visibility at 30 days and guest history visibility at 14 days.
- Keep guest-token lifetime at 14 days; an expired token cannot reopen the conversation, while its stored records remain until the 180-day retention point.
- Keep the current account-management conversation window at 30 days. The administrator time-range filter is a later iteration.
- Preserve existing image-generation quotas and upload behavior.

## Code Changes

1. `server/chat-retention-policy.js`
   - Centralize `RAW_MESSAGES: 180`, `USER_VISIBLE_MESSAGES: 30`, `GUEST_VISIBLE_MESSAGES: 14`, and `ADMIN_CONVERSATION_DEFAULT: 30` so retention and visibility are separate values.
2. `server/memory-cleanup-service.js`, `server/chat-retention-cleanup-service.js`, and `server/memory-job-runner-service.js`
   - Replace the direct bulk message delete with bounded, media-aware cleanup.
   - For each expired registered-user message, delete generated image files, AI voice files, registered attachment files from `product_payload_json`, and guest attachment files through existing safe upload helpers.
   - Keep image job locks through the database deletion transaction; lock related voice rows and skip actively generating media. If a file deletion fails, keep the message and metadata so a later maintenance run can retry.
   - Clean orphan message-index rows after message cleanup.
   - Schedule message cleanup through the existing hourly maintenance enqueue path, as well as at runner startup.
3. `server/guest-session-cleanup-service.js`
   - Leave the 14-day token expiry rule intact. Mark expired guest sessions inaccessible after expiry, but retain messages and attached media until every remaining message is older than 180 days; then reuse the existing guest-session cleanup path to remove the session and its files.
   - Do not treat sent guest attachments as temporary uploads; temporary uploads without a message link keep their existing expiry cleanup.
4. `server/chat-message-store.js` and `server/chat-query-service.js`
   - Apply the 30-day registered-user and 14-day guest windows to user-facing history and contact previews.
5. `server/admin-account-conversation-service.js` and `server/admin-guest-session-service.js`
   - Keep administrator conversation retrieval at its current 30-day default, ready for the later time-range filter.
6. Self-checks and logs
   - Verify 179-day data remains and 181-day data is removed with linked media; verify 30/14-day history visibility and 30-day admin default.
   - Add the self-checks to `scripts/deployment-check.mjs`, then record the result in the release note and daily update log.

## Acceptance Criteria

- A message 179 days old and its image, AI voice, or attachment files remain.
- A message older than 180 days is removed with its linked database metadata and stored media; its parent registered chat session remains.
- A media deletion failure leaves the message and metadata available for retry.
- An active image or voice generation is not removed while the worker is running.
- Registered-user history returns no messages older than 30 days; guest history returns no messages older than 14 days.
- Guest tokens continue expiring after 14 days; the database cleanup does not remove an unclaimed guest session or its messages before the 180-day retention boundary.
- Account-management conversation queries continue using a 30-day default.
- The maintenance runner re-enqueues raw-message cleanup hourly so the 180-day policy continues after startup.
- Existing quota and upload self-checks continue passing.

## Verification

- Node syntax checks for changed server modules and self-check scripts.
- Guarded local-MySQL self-checks for media cleanup, user/guest visibility, guest-session expiry/retention, and administrator default visibility.
- Deployment self-check suite and local service/API health check.

## Risks and Rollback

- Deletion after the 180-day boundary is irreversible once deployed; create a production database and uploads backup before the release.
- If cleanup behavior needs to be stopped, disable the scheduled message-cleanup job or revert the retention policy and cleanup integration. User history windows can be rolled back independently from raw storage retention.
- No server deployment is part of this iteration.
