# Jev intent routing

## Scope

Use TypeSafe Jev as the default structured intent classifier for chat requests. Reuse the current image, product, and TTMall order handlers and keep their existing Venice classifiers as Plan B.

## Stages

### Stage 1: Client and normalized decision

- Add TypeSafe runtime configuration and a small HTTP client using the existing `fetch` and provider logging conventions.
- Ask one Choice question plus independent Noul questions for daily chat, character image, product, order, web search, and unsupported/unclear requests.
- Treat generic “send/show a photo” language as a character-photo request that uses the existing library first; require explicit creation language before selecting new-image generation.
- Treat plural or existing-photo wording as `character_photo`, a standalone one-picture request as `new_image`, and try-on language tied to an earlier image as `try_on`; try-on and generation take precedence over image inspection.
- Add a small conversation-context summary for recent character images, user uploads and product images so natural follow-up wording can be classified without exposing full chat history to Jev.
- Normalize the response into a stable internal decision. Apply confidence thresholds in code.
- Cache the normalized decision briefly by normalized message text and capability signature so one turn does not make duplicate Jev calls.

### Stage 2: Existing classifier adapters

- Make image, product, and order classifiers consult Jev first.
- Preserve deterministic blockers and permission checks before any side effect.
- Fall back to the existing Venice classifier when Jev is unavailable, returns invalid JSON, or is below the configured confidence floor.
- Do not pass Jev output into the reply prompt; only the selected handler receives the normalized result.

### Stage 3: Verification

- Add mocked routing tests for valid, low-confidence, timeout, invalid response, and unsupported-role cases.
- Run a small real Jev matrix in the local environment for multilingual daily chat, character photo, try-on, product search, order lookup, and ambiguous text.
- Run the existing image/product/order self-checks and full deployment check.

## Changed files

- `server/config.js`, `.env.example`, `docs/system/07-runtime-configuration.md`: TypeSafe settings.
- `server/jev-intent-service.js`: HTTP client, request state, normalization, confidence gates, short-lived cache.
- `server/chat-image-intent-classifier-service.js`: Jev-first image adapter with Venice fallback.
- `server/product-intent-classifier-service.js`: Jev-first product adapter with Venice fallback.
- `server/chat-order-intent-service.js`: Jev-first order adapter with Venice fallback.
- `scripts/jev-intent-routing-self-check.mjs`: mocked and real-path checks.
- `logs/updates/2026-09-23.md` and a release note: implementation and verification record.

## Behavior and safety

- Jev only decides what the user appears to want. It cannot authorize account binding, product sending, quotas, image generation, order access, or web search by itself.
- Existing deterministic blockers, character capability checks, site commerce settings, TTMall access checks, quotas, and image library-first behavior remain authoritative.
- Low-confidence or failed Jev decisions go to the existing classifier. If both systems cannot safely classify a request, the current ordinary-chat or clarification behavior remains.
- No prompt, API key, upstream response body, or user-identifying data is written to logs.

## Acceptance criteria

- Normal chat does not trigger image, product, or order actions.
- A character-photo request maps to the existing library-first image path; explicit generation and try-on preserve their current behavior.
- Product requests still use the existing product search and bubble pipeline, with no bubble for unsupported character/site capabilities.
- Order requests still require the existing TTMall binding action and never claim that an order was queried.
- Jev timeout, rate limit, missing key, invalid response, and low confidence all reach the existing Plan B without breaking the turn.
- Existing focused checks and `npm run check:deployment` pass; local real HTTP health and a real multilingual Jev matrix pass when the configured key is available.
