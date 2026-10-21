import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controllerSource = readFileSync("src/features/admin-console/admin-sites-controller.js", "utf8");
const editorSource = readFileSync("src/features/admin-console/admin-sites-editor.js", "utf8");
const templateSource = readFileSync("src/features/admin-console/admin-console-sites-template.js", "utf8");
const regionPickerSource = readFileSync("src/features/admin-console/admin-sites-region-picker.js", "utf8");

assert.match(controllerSource, /export function bindAdminSites/, "controller should keep the page binding entry");
assert.match(controllerSource, /openSiteEditor/, "controller should delegate modal lifecycle to the editor helper");
assert.match(controllerSource, /listAdminSites/, "controller should keep list loading");
assert.match(controllerSource, /setDefaultAdminSite/, "controller should keep default-site action handling");
assert.match(controllerSource, /listAdminMascotSettings/, "controller should load mascot choices for site binding");
assert.match(controllerSource, /collectSiteMascotOptions/, "controller should normalize mascot choices");
assert.doesNotMatch(controllerSource, /function readSitePayload/, "controller should not keep editor payload reading");
assert.doesNotMatch(controllerSource, /function bindSiteRegionPicker/, "controller should not keep region picker binding");
assert.doesNotMatch(controllerSource, /searchAdminGeoRegions/, "controller should not own region online search");

assert.match(editorSource, /export function openSiteEditor/, "editor helper should own site editor opening");
assert.match(editorSource, /export function closeSiteEditor/, "editor helper should own site editor closing");
assert.match(editorSource, /export function readSitePayload/, "editor helper should own payload reading");
assert.match(editorSource, /bindSiteRegionPicker/, "editor helper should wire region picker into the site form");
assert.match(editorSource, /createAdminSite/, "editor helper should own create flow");
assert.match(editorSource, /updateAdminSite/, "editor helper should own update flow");
assert.match(editorSource, /bindSiteMascotPicker/, "editor helper should wire mascot picker into the site form");

assert.match(templateSource, /siteMascotPickerHtml/, "site editor should render the mascot picker");
assert.match(templateSource, /data-site-mascot-option/, "site editor should render selectable mascot options");

assert.match(regionPickerSource, /export function bindSiteRegionPicker/, "region picker helper should own picker binding");
assert.match(regionPickerSource, /export function mergeRegions/, "region picker helper should own region merge utility");
assert.match(regionPickerSource, /searchAdminGeoRegions/, "region picker helper should own online region search");
assert.match(regionPickerSource, /data-site-region-online/, "region picker helper should own online search action handling");
assert.match(regionPickerSource, /selected\.delete\(remove\.dataset\.siteRegionRemove/, "region picker helper should allow removing selected tags");

console.log("admin sites controller split self-check passed");
