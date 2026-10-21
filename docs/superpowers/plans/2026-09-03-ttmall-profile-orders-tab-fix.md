# TTMall profile Orders tab fix

## Goal

让已绑定 TTMall 账号的 Profile → Orders 标签能够保留、进入并加载该账号的订单历史。

## Scope and implementation

- `src/app/app-main-ui-actions.js`
  - Extend the existing profile-tab normalizer to preserve `orders`.
  - Reuse `profileActions.loadProfileOrders()` when opening the profile directly on Orders or switching to Orders.
  - Keep the existing in-place tab switching path; do not remount or alter modal styles.
- `scripts/profile-orders-tab-self-check.mjs`
  - Add a focused source-level regression check for tab preservation and order loading triggers.
- `scripts/deployment-check.mjs`
  - Run the focused regression check as part of the deployment gate.

## Non-goals

- No changes to TTMall API paths, authentication, order mapping, pricing, images, or database records.
- No changes to existing Profile/Invite behavior or modal CSS.

## Acceptance

1. `orders` remains the active profile tab after `setProfileTab("orders")`.
2. Entering Orders invokes the existing order-history request exactly through `loadProfileOrders()`.
3. Existing profile modal no-refresh and TTMall order mapping checks remain green.
4. Deployment gate and local multisite HTTP smoke pass.
5. No credentials, tokens, or order payload secrets appear in source, logs, or release artifacts.

## Rollback

Revert the single code/test commit; no database or external order state is changed.
