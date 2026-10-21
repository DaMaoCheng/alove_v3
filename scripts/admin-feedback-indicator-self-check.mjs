import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [layout, indicator, feedbackService, notificationPanel, feedbackController, page, lifecycle, styles] = await Promise.all([
  readFile(new URL("../src/features/admin-console/admin-console-layout.js", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin-console/admin-feedback-indicator.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/admin-feedback-service.js", import.meta.url), "utf8"),
  readFile(new URL("../src/features/notifications/notification-panel.js", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin-console/admin-feedback-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin-console/admin-console-page.js", import.meta.url), "utf8"),
  readFile(new URL("../src/app/app-view-lifecycle.js", import.meta.url), "utf8"),
  readFile(new URL("../src/features/app-shell/styles/admin-console.css", import.meta.url), "utf8"),
]);

assert.match(layout, /data-admin-feedback-indicator/, "feedback nav item should include a dedicated indicator element");
assert.match(styles, /\.admin-feedback-dot\{[\s\S]*?position:absolute;[\s\S]*?top:6px;[\s\S]*?left:7px/, "feedback indicator must overlap the feedback icon inside the menu item without clipping");
assert.match(feedbackService, /getAdminNewFeedbackCount/, "indicator should reuse the existing feedback listing API total");
assert.match(feedbackService, /status:\s*"new"/, "only unresolved feedback should trigger the indicator");
assert.match(indicator, /aiove:feedback-submitted/, "same-page feedback submission should refresh the indicator immediately");
assert.match(indicator, /setInterval\(refresh, REFRESH_INTERVAL_MS\)/, "other users' feedback should be picked up without a page reload");
assert.match(notificationPanel, /new CustomEvent\("aiove:feedback-submitted"\)/, "successful feedback submission should dispatch the precise refresh event");
assert.match(feedbackController, /new CustomEvent\("aiove:feedback-status-updated"\)/, "marking feedback done should immediately refresh the indicator too");
assert.match(page, /registerViewDisposer\(shell, bindAdminFeedbackIndicator\(shell\)\)/, "indicator polling must be disposed with the admin view");
assert.match(lifecycle, /WeakMap/, "admin view disposer lifecycle should stay in use");

console.log("admin feedback indicator self-check passed");
