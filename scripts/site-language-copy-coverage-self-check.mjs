import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSiteCopy, SITE_COPY_BUNDLES } from "../src/i18n/site-copy.js";
import { getChatImageStatusCopy } from "../server/chat-image-copy-service.js";

const englishKeys = Object.keys(SITE_COPY_BUNDLES.en).sort();
assert.ok(englishKeys.length > 0, "the English source bundle must not be empty");

for (const [locale, bundle] of Object.entries(SITE_COPY_BUNDLES)) {
  assert.deepEqual(Object.keys(bundle).sort(), englishKeys, `${locale} must implement the complete site copy contract`);
  for (const key of englishKeys) {
    assert.ok(String(bundle[key] || "").trim(), `${locale}.${key} must not be empty`);
  }
}

const chinese = createSiteCopy("Chinese (Mandarin)");
assert.equal(chinese.locale, "zh");
assert.equal(chinese.t("nav.discover"), "发现");
assert.equal(chinese.t("auth.leaveTitle"), "离开此页面？");

const english = createSiteCopy("English");
assert.equal(english.locale, "en");
assert.equal(english.t("nav.discover"), "Discover");
assert.equal(chinese.t("kitshop.bestSellers"), "热销商品");
assert.equal(chinese.t("auth.googleFailedTitle"), "Google 登录失败");

const userFacingRoots = ["src/features", "src/pages", "src/app"];
const excludedPrefixes = [
  "src/features/admin-console/",
  "src/features/creator-workspace/",
];
const sourceFiles = userFacingRoots.flatMap((root) => walkJsFiles(root))
  .filter((file) => !excludedPrefixes.some((prefix) => file.startsWith(prefix)));
const referencedKeys = new Map();

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\.t\(["']([^"']+)["']/g)) {
    const key = match[1];
    if (!referencedKeys.has(key)) referencedKeys.set(key, []);
    referencedKeys.get(key).push(file);
  }
}

for (const [key, files] of referencedKeys) {
  assert.ok(Object.hasOwn(SITE_COPY_BUNDLES.en, key), `missing shared copy key ${key}, referenced by ${files[0]}`);
}

for (const requiredModule of [
  "src/features/app-shell/app-sidebar.js",
  "src/features/discover/discover-page.js",
  "src/features/search/search-page.js",
  "src/features/chat/chat-page.js",
  "src/features/create-character/create-character-page.js",
  "src/features/profile-modal/profile-modal.js",
  "src/pages/login/login-page.js",
  "src/pages/auth/register-page.js",
]) {
  const source = fs.readFileSync(requiredModule, "utf8");
  assert.match(source, /createSiteCopy|pageLanguage|copy\.t/, `${requiredModule} must remain connected to the shared site-language copy path`);
}

const composerTemplate = fs.readFileSync("src/features/chat/chat-composer-template.js", "utf8");
assert.match(composerTemplate, /chat\.disclaimerShort/, "chat disclaimer should use shared copy");
assert.doesNotMatch(composerTemplate, /isChineseLanguage/, "chat disclaimer must not maintain a second language branch");

const voiceComposer = fs.readFileSync("src/features/chat/chat-composer-voice.js", "utf8");
assert.match(voiceComposer, /chat\.voiceStopSend/, "voice controls should use shared copy");

const kitshopPage = fs.readFileSync("src/features/kitshop/kitshop-page.js", "utf8");
assert.match(kitshopPage, /resolveKitshopShelfTitle/, "Kitshop fixed shelf titles should resolve by stable shelf key");
assert.match(kitshopPage, /kitshop\.bestSellers/, "Kitshop best-seller title should use shared copy");

const discoverPage = fs.readFileSync("src/features/discover/discover-page.js", "utf8");
assert.match(discoverPage, /discoverCategoryLabel/, "Discover category taxonomy should resolve display labels through shared copy");
assert.match(discoverPage, /data-cat="\$\{escapeAttr\(cat\.label\)\}"/, "Discover filtering should keep the stable server category label instead of the translated display label");

const authRoutes = fs.readFileSync("server/auth-routes.js", "utf8");
assert.match(authRoutes, /resolveGooglePageCopy/, "Google auth error UI should use the trusted site language");
assert.doesNotMatch(authRoutes, /message:\s*sanitizeGoogleErrorMessage/, "Google auth error UI must not expose raw server errors");

const avatarCropper = fs.readFileSync("src/features/avatar-cropper/avatar-cropper.js", "utf8");
assert.doesNotMatch(avatarCropper, /avatarRejectedTitle"\), message: error\?\.message/, "avatar moderation errors must not expose raw server copy");

const imageStatusCopy = fs.readFileSync("src/features/chat/chat-image-status-copy.js", "utf8");
assert.match(imageStatusCopy, /createSiteCopy/, "chat image statuses should use the shared site copy bundle");
assert.doesNotMatch(imageStatusCopy, /STATUS_COPY|normalizeLanguage/, "chat image statuses must not maintain a second locale table");

const serverImageStatusCopy = fs.readFileSync("server/chat-image-copy-service.js", "utf8");
assert.match(serverImageStatusCopy, /createSiteCopy/, "server image statuses should use the same shared site copy bundle");
// Character conversations support more languages than the UI. The backend may
// extend those languages while retaining the shared copy for every UI locale.
for (const locale of Object.keys(SITE_COPY_BUNDLES)) {
  for (const [status, key] of Object.entries({ queued: "chat.imageQueued", generating: "chat.imageGenerating", ready: "chat.imageReady", failed: "chat.imageFailed", cancelled: "chat.imageCancelled" })) {
    assert.equal(getChatImageStatusCopy({ language: locale, status }), createSiteCopy(locale).t(key), `${locale}.${status} must preserve shared UI copy`);
  }
}

const chatMessageRenderer = fs.readFileSync("src/features/chat/chat-message-renderer.js", "utf8");
assert.match(chatMessageRenderer, /renderChatImageMessage\(\{ message, pageLanguage, copy,/, "chat image rendering should receive the active site language");

console.log("site language copy coverage self-check passed");

function walkJsFiles(root) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkJsFiles(file));
    else if (entry.isFile() && file.endsWith(".js")) output.push(file);
  }
  return output;
}
