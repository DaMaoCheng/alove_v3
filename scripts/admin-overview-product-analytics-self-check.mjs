import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const overviewSource = readFileSync("src/features/admin-console/admin-console-overview-template.js", "utf8");
const controllerSource = readFileSync("src/features/admin-console/admin-overview-controller.js", "utf8");
const adminDataSource = readFileSync("src/features/admin-console/admin-console-data.js", "utf8");
const adminOverviewStyleSource = readFileSync("src/features/app-shell/styles/admin-overview.css", "utf8");
const serviceSource = readFileSync("src/services/product-analytics-service.js", "utf8");
const chatProductImpressionsSource = readFileSync("src/features/chat/chat-product-impressions.js", "utf8");
const chatProductCardSource = readFileSync("src/features/chat/chat-product-card.js", "utf8");
const productPanelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const productPanelCheckoutSource = readFileSync("src/features/chat/chat-product-panel-checkout.js", "utf8");

assert.match(overviewSource, /商品漏斗/, "overview should render product funnel section");
assert.match(overviewSource, /商品点击排行/, "overview should render product ranking section");
assert.match(overviewSource, /data-product-rank-search/, "overview should render product ranking search input");
assert.match(overviewSource, /filteredProducts/, "overview should filter product ranking rows by search query");
assert.match(overviewSource, /sortedProducts/, "overview should sort product ranking rows locally");
assert.match(overviewSource, /paginatedProducts/, "overview should paginate product ranking rows locally");
assert.match(overviewSource, /admin-product-rank-scroll/, "product ranking table should have a bounded scroll area");
assert.match(overviewSource, /data-product-rank-page/, "product ranking should render pagination controls");
assert.match(overviewSource, /data-product-rank-sort/, "product ranking column headers should be sortable");
assert.match(overviewSource, /商品曝光/, "overview should show total product impressions");
assert.match(overviewSource, /商品点击/, "overview should show total product clicks");
assert.match(overviewSource, /Buy now 跳转/, "overview should show total checkout jumps");
assert.match(overviewSource, /product-source-row/, "overview should render a second source breakdown row");
assert.match(overviewSource, /对话商品/, "overview should include chat source metrics");
assert.match(overviewSource, /搜索结果/, "overview should include search source metrics");
assert.match(overviewSource, /Kitshop 货架/, "overview should include Kitshop source metrics");
assert.match(overviewSource, /product-kpi-primary/, "click rate KPI should use primary theme styling");
assert.match(adminOverviewStyleSource, /\.product-kpi-primary\{[^}]*background:var\(--surface\);/, "primary KPI should keep the standard card background");
assert.match(adminOverviewStyleSource, /\.product-kpi-primary \.kpi-v\{[^}]*color:var\(--accent\);[^}]*\}/, "primary KPI value should use theme color");
assert.match(adminOverviewStyleSource, /\.product-source-row\{[^}]*grid-template-columns:repeat\(3/, "source cards should form a desktop second row");
assert.match(overviewSource, /admin-select-field/, "overview site filter should use global admin select field style");
assert.match(overviewSource, /admin-select/, "overview site filter should use global admin select style");
assert.doesNotMatch(overviewSource, /按气泡点击排序/, "overview should remove fixed sort helper copy");
assert.match(overviewSource, /跳转率/, "overview should show jump rate");
assert.doesNotMatch(overviewSource, /收入 Top 角色/, "overview should not keep role revenue ranking in first version");

assert.doesNotMatch(adminDataSource, /概览（待）/, "admin overview navigation should not show pending marker");
assert.doesNotMatch(adminDataSource, /账户概览（待）/, "admin overview title should not show pending marker");

assert.match(controllerSource, /bindAdminOverview/, "overview controller should bind admin overview");
assert.match(controllerSource, /getAdminProductAnalyticsOverview/, "overview controller should load product analytics");
assert.match(controllerSource, /data-analytics-range/, "overview controller should bind range filter");
assert.match(controllerSource, /data-analytics-site/, "overview controller should bind site filter");
assert.match(controllerSource, /productQuery/, "overview controller should keep product ranking search query");
assert.match(controllerSource, /productPage/, "overview controller should keep product ranking page");
assert.match(controllerSource, /productPageSize/, "overview controller should keep product ranking page size");
assert.match(controllerSource, /productSortKey/, "overview controller should keep product ranking sort key");
assert.match(controllerSource, /productSortDirection/, "overview controller should keep product ranking sort direction");
assert.match(controllerSource, /data-product-rank-sort/, "overview controller should bind product ranking sort headers");
assert.match(controllerSource, /data-product-rank-page/, "overview controller should bind product ranking pagination");
assert.match(controllerSource, /data-product-rank-search/, "overview controller should bind product ranking search input");
assert.match(controllerSource, /restoreProductSearchFocus/, "overview search rerender should restore product search focus");
assert.match(controllerSource, /setSelectionRange/, "overview search rerender should restore cursor position");

assert.match(serviceSource, /recordProductAnalyticsEvent/, "frontend service should record product analytics events");
assert.match(serviceSource, /getAdminProductAnalyticsOverview/, "frontend service should fetch admin product analytics overview");

assert.match(chatProductImpressionsSource, /product_bubble_impression/, "chat product impressions should report product bubble impressions");
assert.match(chatProductCardSource, /data-product-message-id/, "product card should keep message id for analytics");
assert.match(chatProductCardSource, /data-product-character-id/, "product card should keep character id for analytics");

assert.match(productPanelSource, /product_bubble_click/, "product panel binding should report product bubble clicks");
assert.match(productPanelSource, /product_detail_open/, "product panel should report detail opens");
assert.match(productPanelCheckoutSource, /product_detail_cta_click/, "product checkout handler should report CTA clicks");

const searchPageSource = readFileSync("src/features/search/search-page.js", "utf8");
const searchResultsSource = readFileSync("src/features/search/search-results-renderer.js", "utf8");
const kitshopPageSource = readFileSync("src/features/kitshop/kitshop-page.js", "utf8");
assert.match(searchPageSource, /recordDetailEvents: !guestMode/, "search detail and checkout actions should be recorded for authenticated users");
assert.match(searchResultsSource, /product_search_result_impression/, "search results should report impressions");
assert.match(kitshopPageSource, /product_kitshop_impression/, "Kitshop shelves should report impressions");
assert.match(kitshopPageSource, /product_kitshop_card_click/, "Kitshop cards should record clicks");
assert.match(kitshopPageSource, /\.\.\.\(payload\.analytics \|\| \{\}\)/, "Kitshop cards should retain the server-issued catalog receipt");

console.log("admin overview product analytics self-check passed");
