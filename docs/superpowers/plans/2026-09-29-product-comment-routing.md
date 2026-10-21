# Product comment routing and contextual reply

## Scope

Keep ordinary conversational comments in the normal chat path while preserving explicit product search and product follow-up behavior. The change covers the JEV product signal, the guest product adapter, and the guest no-match language fallback.

## Stages

### Stage 1: Routing contract

- Add a JEV `product_action` signal for whether the user is asking the system to find, recommend, compare, price, size, or check availability of a product.
- Keep product mentions and comments separate from product actions. `Bonito bikini`, `Nice shirt`, and a bare team name remain ordinary conversation unless the user asks to find or inspect a product.
- Require the normalized JEV product decision to pass both the product route and the product-action confidence gate before the product adapter promotes a deterministic `not_product` message.

### Stage 2: Reply behavior

- Preserve the existing deterministic parser and recent product follow-up handling for explicit requests, size/color changes, and product-card follow-ups.
- Keep daily-chat messages in the regular reply prompt with the existing bounded recent conversation context.
- Make the product no-match fallback follow the session language and keep its feedback action aligned with that language.

### Stage 3: Verification

- Add mocked JEV coverage for product comments versus product requests.
- Verify the exact regression conversation: the Madrid sizing request still returns the product context, while `Bonito bikini` goes through ordinary chat and does not create a no-match product response.
- Run focused product/JEV/output-policy checks, syntax checks, and the local health endpoint.

## Changed files

- `server/jev-intent-service.js`: add and normalize `product_action`.
- `server/product-intent-classifier-service.js`: require the product-action confidence gate and support mocked fetch in self-checks.
- `server/guest-chat-product-service.js`: pass the bounded recent product context to the classifier.
- `server/guest-chat-output-policy.js`: pass `languageCode` into the no-match normalizer.
- `scripts/jev-intent-routing-self-check.mjs`: add product-comment and product-request cases.
- `scripts/product-comment-routing-self-check.mjs`: verify the guest recommendation boundary and localized fallback.

## Acceptance criteria

- `Bonito bikini`, `Nice bikini`, and a bare `Real Madrid` do not trigger product search, product cards, or no-match feedback.
- `¿Tienen bikinis?`, `有没有比基尼？`, and `帮我找皇马球衣` remain product requests.
- The existing `Una camisetas del Madrid talla 4xxl` path still resolves the external/source product and 4XL context.
- Product-card follow-ups such as a size or color change continue to reuse recent product context.
- Spanish sessions do not receive an English no-match sentence.
- JEV failure or low confidence preserves the existing Venice Plan B and ordinary-chat fallback.
