import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { creatorDashboardHtml } from "../src/features/creator-workspace/creator-dashboard-template.js";
import { canAccessView } from "../src/app/access-control.js";

const ROOT = new URL("../", import.meta.url);
const sidebarSource = await readFile(new URL("src/features/app-shell/app-sidebar.js", ROOT), "utf8");
const pageSource = await readFile(new URL("src/features/creator-workspace/creator-workspace-page.js", ROOT), "utf8");
const controllerSource = await readFile(new URL("src/features/creator-workspace/creator-dashboard-controller.js", ROOT), "utf8");
const stylesSource = await readFile(new URL("src/features/app-shell/styles/creator-workspace.css", ROOT), "utf8");
const mainSource = await readFile(new URL("src/app/main.js", ROOT), "utf8");
const siteCopySource = await readFile(new URL("src/i18n/site-copy.js", ROOT), "utf8");

const pendingHtml = creatorDashboardHtml({ status: "pending" });
assert.match(pendingHtml, /Analytics connection pending/, "unconnected dashboard must state that analytics is pending");
assert.match(pendingHtml, /data-range="7d"/);
assert.match(pendingHtml, /data-range="30d"/);
assert.match(pendingHtml, /data-range="90d"/);
assert.match(pendingHtml, /Conversations/);
assert.match(pendingHtml, /Product triggers/);
assert.match(pendingHtml, /Store visits/);
assert.match(pendingHtml, /Visit rate/);

const noCharacterHtml = creatorDashboardHtml({ status: "ready", character: null, trend: [] });
assert.match(noCharacterHtml, /No creator character is linked yet/, "creator without a linked character must receive a clear empty state");

const readyHtml = creatorDashboardHtml({
  status: "ready",
  range: "7d",
  metric: "storeVisits",
  summary: { conversations: 12, productTriggers: 8, storeVisits: 4, visitRate: 50 },
  comparison: { conversations: { percent: 20, direction: "up" } },
  trend: [
    { label: "Jul 19", conversations: 4, productTriggers: 3, storeVisits: 1 },
    { label: "Jul 20", conversations: 8, productTriggers: 5, storeVisits: 3 },
  ],
});
assert.match(readyHtml, />12</, "ready state must render real summary values");
assert.match(readyHtml, />50\.0%</, "visit rate must use percentage formatting");
assert.match(readyHtml, /\+20\.0% vs previous period/, "comparison must render stable direction and percentage");
assert.match(readyHtml, /polyline/, "ready trend data must render a line chart");
assert.match(readyHtml, /data-creator-chart-guide/, "ready chart must include a hover guide");
assert.match(readyHtml, /data-creator-chart-marker/, "ready chart must include an active point marker");

const insightsHtml = creatorDashboardHtml({
  status: "ready",
  range: "30d",
  audience: { uniqueChatters: 17, newChatters: 12, returningChatters: 5, returnRate: 29.4, averageMessages: 4.2 },
  topProducts: [{
    productKey: "product-1",
    name: "England Home Soccer Jersey",
    imageUrl: "https://cdn.shopify.com/product.jpg",
    productTriggers: 8,
    storeVisits: 3,
    visitRate: 37.5,
  }],
});
assert.match(insightsHtml, /Audience loyalty/, "ready dashboard must show audience loyalty");
assert.match(insightsHtml, /29\.4%/, "audience loyalty must derive the return rate");
assert.match(insightsHtml, /New chatters/, "audience loyalty must distinguish new chatters");
assert.match(insightsHtml, /Returning/, "audience loyalty must distinguish returning chatters");
assert.match(insightsHtml, /Avg\. messages/, "audience loyalty must show conversation depth");
assert.doesNotMatch(insightsHtml, /Engagement journey/, "dashboard must not duplicate top-level KPI values in a journey panel");
assert.match(insightsHtml, /Top products/, "ready dashboard must show the product ranking");
assert.match(insightsHtml, /cdn\.shopify\.com/, "product ranking must show API-provided product imagery");
assert.match(insightsHtml, /England Home Soccer Jersey/, "product ranking must show API-provided product names");
assert.doesNotMatch(insightsHtml, /Demo data/, "real dashboard must not label or restore demo data");
assert.doesNotMatch(`${controllerSource}\n${pageSource}\n${stylesSource}`, /preview|creator-demo-badge/, "creator dashboard must not retain preview-only state or styles");

for (const forbidden of ["Leo Marquez", "Total earnings", "Withdrawable", "Payout history", "Kits sold via you"]) {
  assert.doesNotMatch(`${pendingHtml}\n${pageSource}`, new RegExp(forbidden, "i"), `creator UI must not restore placeholder content: ${forbidden}`);
}

assert.match(sidebarSource, /const canSeeCreator = accountType === "creator";/, "creator entry must be scoped to creator accounts");
assert.equal(canAccessView("creator", "creator"), true);
assert.equal(canAccessView("creator", "admin"), false, "admin must use the admin aggregate instead of the creator-only API");
assert.match(sidebarSource, /copy\.t\("nav\.creator"\)/, "creator sidebar entry must use localized copy");
assert.match(siteCopySource, /"nav\.creator": "Creator dashboard"/, "English copy must retain the creator dashboard label");
assert.match(pageSource, /resolveUserDisplayName\(user\)/, "workspace identity must use the signed-in account");
assert.match(pageSource, /getCreatorAnalytics/, "workspace must load the creator analytics service");
assert.match(pageSource, /registerViewDisposer/, "creator workspace must register its dashboard cleanup");
assert.match(mainSource, /disposeView\(/, "app remount must dispose the previous view before replacement");
assert.doesNotMatch(pageSource, /creator-dashboard-preview-data/, "workspace must not fall back to preview data");
assert.match(stylesSource, /@media \(max-width:480px\)/, "creator dashboard must keep a narrow-screen layout");
assert.match(stylesSource, /grid-template-columns:1fr/, "creator KPI cards must collapse to one column on narrow screens");
assert.match(controllerSource, /document\.body\.append\(tooltip\)/, "chart tooltip must be mounted outside the chart container");
assert.match(controllerSource, /querySelectorAll\("\.creator-chart-tooltip"\)/, "mounting a dashboard must remove stale chart tooltips");
assert.match(controllerSource, /tooltip\.remove\(\)/, "chart tooltip must be removed when the dashboard unmounts");
assert.match(controllerSource, /chart\.addEventListener\("pointerleave"/, "chart tooltip must hide when the pointer leaves");
assert.match(controllerSource, /chart\.addEventListener\("mouseleave"/, "chart tooltip must support mouse leave events");
assert.match(controllerSource, /document\.removeEventListener\("pointermove", hideWhenOutsideChart\)/, "global hover guard must be removed during rerender and unmount");
assert.match(controllerSource, /requestSequence/, "range loading must guard against stale responses");
assert.match(controllerSource, /status: "error"/, "request failures must render an explicit error state");
assert.match(stylesSource, /\.creator-chart-tooltip\{ position:fixed;/, "chart tooltip must use viewport positioning");

console.log("creator dashboard UI self-check passed");
