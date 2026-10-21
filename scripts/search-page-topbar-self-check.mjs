import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProductPanelPayload } from "../src/features/chat/chat-product-panel-payload.js";

const searchPageSource = readFileSync("src/features/search/search-page.js", "utf8");
const topbarSource = readFileSync("src/features/search/search-topbar.js", "utf8");
const resultsSource = readFileSync("src/features/search/search-results-renderer.js", "utf8");
const stateSource = readFileSync("src/features/search/search-product-state.js", "utf8");

assert.match(searchPageSource, /<div class="search-detail-shell">[\s\S]*<aside class="prod-panel search-prod-panel">/, "search product detail should live in its own container outside the results shell");
assert.match(searchPageSource, /searchState\.renderInto\(page, \{ onQueryChange: handleTermSelect \}\)/, "search page should inject term selection back into the split renderer");
assert.match(searchPageSource, /searchState\.scheduleProductSearch\(page, \{ onQueryChange: handleTermSelect \}\)/, "search page should reuse the same term selection callback during debounced product search rendering");

assert.match(topbarSource, /topbar\.className = "topbar search-topbar"/, "search page should use a page-specific topbar class");
assert.match(topbarSource, /<div class="search-topbar-inner">[\s\S]*search search-active[\s\S]*search-cancel/, "search input and cancel button should live in the centered search topbar inner container");
assert.match(topbarSource, /<button class="menu-btn"[\s\S]*<div class="search-topbar-inner">[\s\S]*<div class="search search-active">[\s\S]*<button class="btn btn-ghost search-cancel"/, "menu button should sit outside the centered search controls");

assert.match(resultsSource, /class="sr-row search-product-row product-card-trigger"/, "search product rows should use their own list row styling while keeping product panel click binding");
assert.doesNotMatch(resultsSource, /class="sr-row product-card search-product-row"/, "search product rows should not inherit chat product card width styles");
assert.match(resultsSource, /class="search-product-price"/, "search product rows should render price on the right side");
assert.match(resultsSource, /class="search-product-action"[\s\S]*copy\.t\("search\.view"\)[\s\S]*ICONS\.back/, "search product rows should render a localized View arrow action");
assert.match(resultsSource, /characters\.filter\(\(item\) => includesQuery\(\[item\.name\], q\)\)/, "search page should filter character results by name only");
assert.doesNotMatch(resultsSource, /includesQuery\(\[item\.name, item\.roleTitle, item\.shortBio/, "search page should not match character role or bio text");
assert.match(resultsSource, /data-search-character="\$\{escapeAttr\(item\.id\)\}"/, "search page should navigate to matched characters from the shared character list, including the current site mascot");
assert.equal(
  normalizeProductPanelPayload({ price: "£36.00" }).priceNow,
  "£36.00",
  "search product detail payload should map API price into priceNow",
);

assert.match(stateSource, /export const PRODUCT_SEARCH_DEBOUNCE_MS = 500;/, "search product state should keep the 0.5 second debounce");
assert.match(stateSource, /const productLimit = hasMatchingCharacter\(normalizedQuery\) \? 2 : 10;/, "search page should request ten products only when no character matches the current query");
assert.match(stateSource, /searchSiteProducts\(\{ siteSlug, query: normalizedQuery, limit: productLimit, guestMode \}\)/, "search product state should pass the character-aware product limit to the site API");

const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
assert.match(panelSource, /closest\("\.product-card, \.product-card-trigger"\)/, "product panel should bind both chat cards and search result rows");

const searchCss = readFileSync("src/features/app-shell/styles/search.css", "utf8");
assert.match(searchCss, /\.search-topbar\s*\{[\s\S]*justify-content: center/, "search page topbar should center the search controls on desktop");
assert.match(searchCss, /\.search-topbar-inner\s*\{[\s\S]*width: min\(760px, 100%\)[\s\S]*justify-content: center/, "search topbar inner container should constrain and center controls");
assert.match(searchCss, /\.search-shell\s*\{[\s\S]*justify-content: center/, "search results should be centered when the product panel is closed");
assert.doesNotMatch(searchCss, /body\.product-open\[data-view="search"\] \.search-shell\s*\{[\s\S]*justify-content: flex-start/, "search results shell should not shift when the product panel opens");
assert.match(searchCss, /\.recent-row:hover,\s*\.sr-row:hover\s*\{[\s\S]*background: var\(--surface\)/, "search result hover background should match the default row background");
assert.match(searchCss, /\.search-detail-shell\s*\{[\s\S]*position: fixed[\s\S]*top: var\(--topbar-height/, "search product detail should use a fixed independent container below the topbar");
assert.match(searchCss, /\.search-detail-shell\s*\{[\s\S]*right: 0/, "desktop search product detail should touch the right edge");
assert.match(searchCss, /body\[data-view="search"\] \.search-prod-panel \.pp-scroll\s*\{[\s\S]*overflow-y: auto/, "search product detail content should scroll inside the panel");
assert.match(searchCss, /\.search-product-row\s*\{[\s\S]*width: 100%/, "search product rows should match character row width");
assert.match(searchCss, /\.search-product-row \.search-product-price\s*\{[\s\S]*color: var\(--accent\)/, "search product price should use the theme color");
assert.match(searchCss, /\.search-product-action\s*\{[\s\S]*color: var\(--accent\)/, "search product View action should use the theme color");
assert.match(searchCss, /\.search-topbar \.menu-btn\s*\{[\s\S]*position: absolute[\s\S]*left: 30px/, "desktop menu button should not push the centered search controls off center");
assert.match(searchCss, /@media \(max-width: 720px\)[\s\S]*\.search-topbar \.menu-btn\s*\{[\s\S]*position: static/, "mobile search topbar should keep the menu button in normal flow");

console.log("search page centered topbar self-check passed");
