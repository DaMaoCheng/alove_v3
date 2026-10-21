import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const files = await Promise.all([
  readFile("src/features/app-shell/app-sidebar.js", "utf8"),
  readFile("src/features/app-shell/guest-discover-guide.js", "utf8"),
  readFile("src/features/app-shell/styles/shell.css", "utf8"),
  readFile("src/features/app-shell/styles/app-responsive.css", "utf8"),
]);
const [sidebar, guide, shell, responsive] = files;
assert.match(sidebar, /guestMode && shouldRenderGuestDiscoverGuide\(\)/);
assert.match(guide, /let disposeActiveGuide = null/);
assert.match(guide, /disposeActiveGuide\?\.\(\)/);
assert.match(guide, /requestAnimationFrame\(update\)/);
assert.match(guide, /document\.body\.classList\.contains\("drawer-open"\)/);
assert.match(guide, /window\.__aioveGuestDiscoverGuideStartedAt/);
assert.match(guide, /window\.__aioveGuestDiscoverGuideStartedAt = Date\.now\(\)/);
assert.match(guide, /guide\.style\.opacity = opacity/);
assert.match(guide, /focus\.style\.opacity = opacity/);
assert.doesNotMatch(guide, /rect\.left - 5|rect\.top - 5/);
assert.match(shell, /\.guest-discover-guide-focus[\s\S]*z-index: 56/);
assert.match(shell, /\.guest-discover-guide-mask-layer \{ fill: rgba\(0, 0, 0, \.55\); \}/);
assert.match(guide, /guest-discover-guide-mask-hole/);
assert.match(guide, /maskHole\?\.setAttribute\("rx"/);
assert.match(guide, /--focus-radius/);
assert.match(responsive, /guest-discover-guide--mobile::before/);
assert.match(responsive, /border-bottom: 8px solid var\(--accent\)/);
console.log("PASS guest Discover guide: one active instance, shared deadline/fade, per-frame target tracking, drawer state, and mobile pointer.");
