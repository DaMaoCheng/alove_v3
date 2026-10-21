# Chat Product Search Resilience

## Goal

Reduce false “no products found” responses caused by intermittent TTMall latency while preserving full-site real-time search and existing Shopify behavior.

## Scope

- Read the current site’s Kitshop product cache before remote chat search.
- Reuse the existing product intent filtering and ranking; do not create a second matching policy.
- Fall back to the remote source on a cache miss.
- On a remote source failure, use a recent (but explicitly marked) cache result when it satisfies the intent.
- Keep detail-required flows on the remote path.
- Add deterministic tests for fresh-cache hit, remote fallback, stale-cache fallback, and no-match behavior.

## Code changes

1. Add `server/product-cache-search-service.js` as a small data-access/selection seam. It loads `site_product_cache` through the existing repository, maps rows through `mapCachedProducts`, applies `filterProductsByIntent`, `filterProductsBySearchCriteria`, and `prepareProductCandidates`, and enforces a bounded freshness window.
2. Update `server/chat-product-recommendation-service.js` to try a fresh cache for ordinary searches before `executeProductSearch`. Skip the shortcut when complete detail hydration is required. If the remote path throws, retry selection from a bounded stale-cache window and label the source as cache.
3. Add a focused self-check script with injected cache rows and remote fetch functions; no credentials or external writes.
4. Update the daily log only after code, service, and browser checks pass.

## Non-goals and safety

- No schema change, UI change, role/persona change, payment change, or change to Shopify source behavior.
- Cache is site-scoped and never crosses sites.
- Cache results are only returned after the same deterministic intent filters used by remote results.
- No stale cache is presented as live data in internal source metadata.

## Acceptance criteria

- A matching fresh cache returns without calling TTMall.
- A cache miss calls the existing remote search unchanged.
- A remote timeout returns a matching recent cache result instead of “no match”.
- A cache miss plus remote timeout remains `source_error`.
- Age/detail-required searches do not bypass required detail hydration.
- Existing product intent, recommendation, visitor, and non-TTMall self-checks remain green.
- Local service health is HTTP 200 and a real browser chat search displays a product card or the explicit source-unavailable state, never a false no-match caused by timeout.
