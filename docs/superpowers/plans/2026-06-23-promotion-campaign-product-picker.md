# Promotion Campaign Product Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make promotion campaign product selection use the selected site's product API, and add campaign discount codes that can appear in product details.

**Architecture:** Keep public product search unchanged. Add an admin-scoped product search helper and route that search by `siteId`, returns richer product rows, and is used only by the promotion campaign editor. Store selected product fields in existing campaign columns and store the new discount code in a dedicated column.

**Tech Stack:** Node.js ES modules, MySQL schema migration helpers, browser ES modules, existing admin console components and self-check scripts.

---

## Task 1: Backend Campaign Data And Admin Product Search

**Files:**
- Modify: `database/schema.sql`
- Modify: `server/db.js`
- Modify: `server/product-normalizer.js`
- Modify: `server/product-search-service.js`
- Modify: `server/promotion-campaign-service.js`
- Modify: `server/promotion-campaign-match-service.js`
- Modify: `server/admin-routes.js`
- Modify: `scripts/promotion-campaign-self-check.mjs`
- Modify: `scripts/product-search-service-self-check.mjs`

- [ ] Add failing assertions for `discountCode` persistence and admin product search by `siteId`.
- [ ] Add `discount_code` column to `promotion_campaigns` schema and runtime migration.
- [ ] Normalize product `id` and `sku` from generic and Shopify product payloads.
- [ ] Add `searchAdminPromotionProducts({ siteId, query, limit })` that uses the site's configured product API and returns up to 8 title/SKU matches.
- [ ] Add admin route `GET /api/admin/promotion-campaigns/products`.
- [ ] Include `discountCode` in campaign list, create, update, and matching results.

## Task 2: Admin Campaign Product Picker UI

**Files:**
- Modify: `src/config/api-config.js`
- Modify: `src/services/promotion-campaign-service.js`
- Modify: `src/features/admin-console/admin-console-promotion-campaigns-template.js`
- Modify: `src/features/admin-console/admin-promotion-campaigns-controller.js`
- Modify: `src/features/app-shell/styles/admin-console.css`

- [ ] Replace manual product ID/link fields with a site-aware product search input.
- [ ] Require selecting a dropdown product before save.
- [ ] Store selected product id/title/url through hidden inputs.
- [ ] Add discount code input.
- [ ] Add result rows with image, title, price/SKU, select action, and open-link action.

## Task 3: Product Detail Discount Compatibility

**Files:**
- Modify: `src/features/chat/chat-product-panel.js`
- Modify: `scripts/chat-product-panel-code-visibility-self-check.mjs`

- [ ] Make product detail code display accept `product.code` or `product.discountCode`.
- [ ] Keep code block hidden when neither exists.

## Task 4: Verification And Logs

**Files:**
- Modify: `logs/updates/2026-06-23.md`
- Create or modify: `docs/releases/2026-06-23-promotion-campaign-product-picker.md`

- [ ] Run targeted `node --check`.
- [ ] Run promotion campaign, product search, and product code self-checks.
- [ ] Run touched-file `git diff --check`.
- [ ] Record implementation, verification, and boundaries.
