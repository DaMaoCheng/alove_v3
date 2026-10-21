# Admin Account Date Filter

## Goal

Add a shared date filter to both account-management lists: registered accounts and guest sessions. The filter supports today, the last 7 days, the last month, and a custom inclusive date range.

## Date Semantics

- The list is filtered by the record's latest activity timestamp.
- Registered accounts use `last_seen_at`, falling back to `created_at` when no activity has been recorded.
- Guest sessions use the latest message/call activity, then claimed/updated/created time as fallbacks.
- Presets are evaluated by the server so pagination and totals are filtered consistently.
- A custom range uses local calendar dates and includes the full end date.

## Code Changes

1. `server/admin-date-filter.js`
   - Normalize the shared preset/custom values and append safe SQL date predicates.
2. `server/admin-account-list-service.js` and `server/admin-guest-session-service.js`
   - Accept `dateRange`, `startDate`, and `endDate` and apply the shared predicate before counting and paging.
3. `server/admin-account-routes.js` and `src/services/admin-account-service.js`
   - Pass the date filter through both admin list APIs.
4. `src/features/admin-console/admin-date-range-filter.js`
   - Reuse the existing dropdown, button, field, and native date-input patterns for the shared filter and custom calendar popup.
5. Account/guest templates, state, and controllers
   - Render one shared date state for both views, reload each list only after a preset or valid custom range is applied, and keep list items/summaries isolated between the two controllers.
   - Recalculate both views' KPI summaries and tab totals from the same server-side date range.
6. `src/features/app-shell/styles/admin-accounts.css`
   - Add only the positioning/layout needed for the existing field/button styles to form the custom popup.
7. `scripts/admin-account-date-filter-self-check.mjs`, deployment checks, release note, and daily log
   - Verify SQL filtering, inclusive custom bounds, empty ranges, frontend wiring, and existing account/guest list behavior.

## Acceptance Criteria

- Today, 7-day, and 1-month selections filter both lists server-side and return correct totals/pages.
- Custom date selection opens a calendar input popup; start and end are required, and the end date is inclusive.
- After either custom date is selected, the other native calendar disables dates that would create a reversed range.
- Invalid or reversed custom ranges do not send a request and show an inline error.
- Switching between registered accounts and guests preserves one shared date selection and updates both lists' totals/cards.
- Existing search, type/status, site filters, pagination, row expansion, and conversation actions continue to work.
- No database schema or existing UI component is replaced.

## Verification

- Syntax checks for new/changed modules.
- Guarded local-MySQL service self-check covering all presets, custom bounds, combined filters, and empty data.
- Existing admin account/guest self-checks and deployment suite.
- Local browser verification of preset selection, custom calendar popup, apply/cancel, pagination, and responsive layout.

## Rollback

Revert the date-filter service/template/controller changes. Existing list APIs continue to accept omitted date parameters and retain their previous behavior.
