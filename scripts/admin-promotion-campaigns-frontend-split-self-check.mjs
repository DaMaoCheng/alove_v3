import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controllerSource = readFileSync("src/features/admin-console/admin-promotion-campaigns-controller.js", "utf8");
const editorSource = readFileSync("src/features/admin-console/admin-promotion-campaigns-editor.js", "utf8");
const templateSource = readFileSync("src/features/admin-console/admin-console-promotion-campaigns-template.js", "utf8");
const styleSource = readFileSync("src/features/app-shell/styles/admin-promotion-campaigns.css", "utf8");
const dateTimeSource = readFileSync("src/features/admin-console/admin-datetime-field.js", "utf8");

assert.match(controllerSource, /listAdminPromotionCampaigns/, "controller should keep list loading");
assert.match(controllerSource, /adminPromotionCampaignFiltersHtml/, "controller should keep filter rendering");
assert.match(controllerSource, /adminPromotionCampaignListHtml/, "controller should keep list rendering");
assert.match(controllerSource, /openPromotionCampaignEditor/, "controller should delegate editor flow");
assert.doesNotMatch(controllerSource, /createAdminPromotionCampaign|updateAdminPromotionCampaign|searchAdminPromotionProducts/, "controller should not own create/update/product search service calls");
assert.doesNotMatch(controllerSource, /readPromotionCampaignPayload|bindPromotionProductPicker|promotionProductTimer|FormData/, "controller should not own editor payload or product picker state");

assert.match(editorSource, /export function openPromotionCampaignEditor/, "editor module should expose open editor flow");
assert.match(editorSource, /createAdminPromotionCampaign/, "editor module should own create flow");
assert.match(editorSource, /updateAdminPromotionCampaign/, "editor module should own update flow");
assert.match(editorSource, /searchAdminPromotionProducts/, "editor module should own product picker search");
assert.match(editorSource, /readPromotionCampaignPayload/, "editor module should own form payload extraction");
assert.match(editorSource, /assertPromotionCampaignTiming\(payload\)/, "editor should reject expired active campaigns before submitting");
assert.match(editorSource, /status !== "active" \|\| !payload\?\.endsAt/, "draft, paused, and archived campaigns should allow historical end times");
assert.match(editorSource, /showToast\(message\)/, "expired active campaign validation should use the existing toast feedback");
assert.match(editorSource, /data-promotion-product-option/, "editor module should bind product option selection");
assert.match(editorSource, /bindAdminDateTimeFields/, "editor module should bind the shared full-field date-time picker interaction");
assert.match(dateTimeSource, /addEventListener\("pointerdown"[\s\S]+event\.preventDefault\(\)[\s\S]+openDateTimePicker\(input\)/, "supported primary pointer interaction should explicitly open the transparent native picker layer");
assert.match(dateTimeSource, /addEventListener\("keydown"[\s\S]+event\.preventDefault\(\)[\s\S]+openDateTimePicker\(input\)/, "supported Enter and Space interaction should explicitly open the picker");
assert.match(dateTimeSource, /input\.showPicker\(\)/, "the date-time picker should use the native showPicker API");
assert.match(dateTimeSource, /syncAdminDateTimeDisplay/, "date-time inputs should synchronize their visual value layer");
assert.match(dateTimeSource, /addEventListener\("input", syncDisplay\)/, "manual date-time input should update the visual value");
assert.match(dateTimeSource, /addEventListener\("change", syncDisplay\)/, "picker changes should update the visual value");

assert.match(templateSource, /adminPromotionCampaignEditorModalHtml/, "template should continue to render editor modal");
assert.match(templateSource, /adminPromotionProductResultsHtml/, "template should continue to render product search results");
assert.match(templateSource, /adminDateTimeFieldHtml\("startsAt"/, "start date-time field should use the shared picker control");
assert.match(templateSource, /adminDateTimeFieldHtml\("endsAt"/, "end date-time field should use the shared picker control");
assert.match(dateTimeSource, /data-admin-datetime-display/, "date-time fields should render a visible synchronized value layer");
assert.match(styleSource, /promotion-datetime-control input\[data-admin-datetime\][^{]*\{[^}]*opacity:0/, "native date-time text should stay interactive without exposing Chrome segment selection");
assert.match(styleSource, /:root\[data-theme="dark"\] \.promotion-datetime-control/, "date-time picker should define a dark-theme icon treatment");
assert.match(styleSource, /:root\[data-theme="light"\] \.promotion-datetime-control/, "date-time picker should define a light-theme icon treatment");
assert.match(styleSource, /data-theme="dark"[^}]+background-image:url\([^)]*stroke='%23D7DDD9'/, "dark theme should use the light custom calendar icon");
assert.match(styleSource, /data-theme="light"[^}]+background-image:url\([^)]*stroke='%23304439'/, "light theme should use the dark custom calendar icon");

console.log("admin promotion campaigns frontend split self-check passed");
