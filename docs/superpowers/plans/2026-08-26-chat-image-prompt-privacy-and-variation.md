# Chat image prompt privacy and deterministic variation (local)

## Goal and boundary

Fix the admin conversation image prompt leak, make chat image visual variety deterministic rather than provider-selected, and render the admin image with the same image-card ratio as the user chat.

This change does not regenerate or rewrite historical production images, deploy to a server, update GitHub, or change product-search and normal chat reply behavior.

## Implementation

1. Add `server/chat-image-variation-service.js` as the single pure owner of the six-dimension variation library: expression, pose, camera, scene, wardrobe and lighting. A stable hash of the image asset/message/character produces a repeatable six-part code.
2. Extend `server/chat-image-context-builder.js` to identify only explicit image constraints: current-product try-on, uploaded-image clothing, and group/user-reference requests. The deterministic matcher covers English, Chinese, Turkish, Hungarian and French target-site wording. Persist the safe variation code and constraint flags in the existing `prompt_context_json`; do not add a schema field.
3. Update the provider prompt and reference collector so a product reference is used only for an explicit try-on. Unspecified dimensions use the fixed variation instruction; direct user instructions override it.
4. Stop persisting the original user request and provider prompt in `chat_image_assets.prompt_summary`. Store only `Chat image queued` or a safe variation label. Remove prompt-summary selects/mapping from normal chat and both admin conversation APIs.
5. Reuse the normal `.chat-image-card.is-ready` markup in the admin conversation template, removing the separate prompt caption and square/cropped admin image styling.

## Verification

- Syntax checked every changed server, frontend-template and self-check module.
- Passed deterministic variation, provider prompt, reference-material, context, generation-state, final image regression, chat frontend UX, admin account retention and admin guest session self-checks.
- The DB-chain checks create and clean temporary rows/assets; they verify safe persisted summaries, no prompt summary in normal/admin response data, product try-on preservation, and the shared user image-card markup.
- Local health endpoint returned `ok`.

## Risk control

- Existing production `prompt_summary` values remain untouched; they are no longer selected, mapped or rendered.
- The result remains deterministic per image task even if a worker retries it.
- Product and user-image references are deliberately not inferred from unrelated historical message cards.
