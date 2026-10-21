import assert from "node:assert/strict";
import {
  DEFAULT_SITE_SLUG,
  getSiteSlugFromPath,
  getViewFromSitePath,
  pathForSiteView,
  resolveEffectiveSiteSlug,
  shouldReplaceExplicitSiteRoute,
  sitePathForUnprefixedPath,
  sitePathForRejectedSitePath,
  shouldRedirectToDefaultSite,
} from "../src/app/site-routing.js";

assert.equal(DEFAULT_SITE_SLUG, "gogoalshop");
assert.equal(getSiteSlugFromPath("/gogoalshop/login"), "gogoalshop");
assert.equal(getSiteSlugFromPath("/footballkituk/discover"), "footballkituk");
assert.equal(getSiteSlugFromPath("/admin"), "");
assert.equal(getSiteSlugFromPath("/login"), "");
assert.equal(getViewFromSitePath("/gogoalshop/login"), "login");
assert.equal(getViewFromSitePath("/gogoalshop/register"), "register");
assert.equal(getViewFromSitePath("/footballkituk/discover"), "discover");
assert.equal(getViewFromSitePath("/footballkituk/chat"), "chat");
assert.equal(pathForSiteView("gogoalshop", "login"), "/gogoalshop/login");
assert.equal(pathForSiteView("footballkituk", "discover"), "/footballkituk/discover");
assert.equal(pathForSiteView("footballkituk", "chat", { agent: "fan" }), "/footballkituk/chat?agent=fan");
assert.equal(sitePathForUnprefixedPath("footballkituk", "/register", "?invite=ABC"), "/footballkituk/register?invite=ABC");
assert.equal(sitePathForRejectedSitePath("footballkituk", "/made-up/register", "?invite=ABC"), "/footballkituk/register?invite=ABC");
assert.equal(sitePathForRejectedSitePath("gogoalshop", "/made-up/chat", "?agent=fan"), "/gogoalshop/chat?agent=fan");
assert.equal(shouldRedirectToDefaultSite("/login"), true);
assert.equal(shouldRedirectToDefaultSite("/admin"), false);
assert.equal(resolveEffectiveSiteSlug({ currentSlug: "gogoalshop", assignedSiteSlug: "footballkituk", accountType: "personal" }), "footballkituk");
assert.equal(resolveEffectiveSiteSlug({ currentSlug: "gogoalshop", assignedSiteSlug: "footballkituk", accountType: "admin" }), "footballkituk");
assert.equal(resolveEffectiveSiteSlug({ currentSlug: "", visitorSiteSlug: "footballkituk", assignedSiteSlug: "", accountType: "personal" }), "footballkituk");
assert.equal(resolveEffectiveSiteSlug({ currentSlug: "", visitorSiteSlug: "", assignedSiteSlug: "", accountType: "personal" }), "gogoalshop");
assert.equal(shouldReplaceExplicitSiteRoute({ status: 404 }), true, "a confirmed missing site should be replaced");
assert.equal(shouldReplaceExplicitSiteRoute({ status: 500 }), false, "a temporary server failure must preserve the explicit site path");
assert.equal(shouldReplaceExplicitSiteRoute({ status: 0 }), false, "a network failure must preserve the explicit site path");

console.log("site routing first phase self-check passed");
