import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCharacterEditorHtml } from "../src/features/admin-console/admin-character-editor-template.js";
import { adminCreatorCharactersHtml } from "../src/features/admin-console/admin-console-creator-characters-template.js";

const sites = [
  { id: "site_gg", name: "GG", slug: "gogoalshop" },
  { id: "site_fkk", name: "FKK", slug: "footballkituk" },
];

const pageHtml = adminCreatorCharactersHtml({ sites, activeSiteId: "site_fkk", query: "Dani" });
assert.match(pageHtml, /data-creator-new/, "creator page should expose a create button hook");
assert.match(pageHtml, /data-creator-new[\s\S]*data-creator-site-filter[\s\S]*data-creator-search/, "creator page actions should place create button before site filter and search");
assert.match(pageHtml, /name="creatorSiteFilter" value="site_fkk"/, "creator page should use a global select dropdown for site filtering");
assert.match(pageHtml, /data-creator-search/, "creator page should expose a search input hook");
assert.match(pageHtml, /value="Dani"/, "creator page should preserve search query in the input");
assert.doesNotMatch(pageHtml, /<div class="seg" data-creator-site-filter>/, "creator page should not keep the old segmented site filter");

const createModalHtml = adminCharacterEditorHtml({
  mode: "creator",
  title: "新建网红角色",
  isCreate: true,
  sites,
  creatorAccounts: [
    { id: "u_creator_1", name: "Creator One", email: "creator@example.local", siteName: "FKK", siteSlug: "footballkituk" },
  ],
  character: {
    name: "",
    roleTitle: "Creator · Football kits",
    ownerAccount: "未绑定",
    categoryId: "creator",
    siteId: "site_fkk",
    visibility: "public",
    status: "published",
    personality: "Cheeky banter",
    voice: "Bright & playful",
    language: "English",
    openingLine: "",
    backstory: "",
    avatarUrl: "",
  },
});
assert.match(createModalHtml, /新建网红角色/, "creator create modal should use creator create title");
assert.match(createModalHtml, /admin-creator-create-form/, "creator create modal should use create-page style form");
assert.match(createModalHtml, /class="[^"]*\bcf-field\b[^"]*"/, "creator create modal should reuse create-page field styling");
assert.match(createModalHtml, /name="category" value="creator"/, "creator create modal should lock category to creator");
assert.match(createModalHtml, /data-creator-account-picker/, "creator create modal should expose a bound account picker");
assert.match(createModalHtml, /name="ownerUid"/, "creator create modal should submit the selected creator account id");
assert.match(createModalHtml, /所属站点[\s\S]*data-creator-derived-site/, "creator create modal should show derived site as readonly information");
assert.doesNotMatch(createModalHtml, /name="siteId"/, "creator create modal should not submit an editable site id");
assert.doesNotMatch(createModalHtml, /填写后会创建一个新的网红角色。|修改后会同步保存到角色资料。/, "creator create modal should not show description under title");
assert.doesNotMatch(createModalHtml, /name="shortBio"/, "creator create modal should not ask for manual short bio");
assert.doesNotMatch(createModalHtml, /name="roleTitle"|角色定位/, "creator create modal should not ask for manual role title");
assert.match(createModalHtml, /data-character-avatar-generate/, "creator create modal should include AI avatar generation button");
assert.match(createModalHtml, /data-character-ai-polish/, "creator create modal should include AI polish button");
assert.match(createModalHtml, />头像</, "creator create modal should use Chinese avatar label");
assert.match(createModalHtml, /上传头像/, "creator create upload button should be Chinese");
assert.match(createModalHtml, /AI智能生成/, "creator create AI avatar button should be Chinese");
assert.match(createModalHtml, />绑定账号</, "creator create modal should use Chinese account label");
assert.match(createModalHtml, />所属站点</, "creator create modal should use Chinese derived site label");
assert.match(createModalHtml, />音色</, "creator create modal should use Chinese voice label");
assert.doesNotMatch(createModalHtml, /Avatar|Upload avatar|AI generate|Clone my voice|Character name|Opening line|Backstory|Voice|Language/, "creator create modal labels and buttons should not use English UI copy");
assert.doesNotMatch(createModalHtml, /data-admin-voice-clone/, "creator create modal should not show voice clone controls yet");

const editModalHtml = adminCharacterEditorHtml({
  mode: "creator",
  title: "编辑网红角色",
  character: {
    id: "char_creator_demo",
    name: "Creator Demo",
    avatarUrl: "",
    ownerUid: "u_creator_1",
    ownerAccount: "creator@example.local",
    categoryId: "creator",
    siteName: "FKK",
    siteId: "site_fkk",
    visibility: "public",
    status: "published",
    shortBio: "AI generated creator bio.",
    personality: "Cheeky banter",
    voice: "Bright & playful",
    language: "English",
    openingLine: "Hi",
    backstory: "Current creator story.",
  },
});
assert.match(editModalHtml, /admin-creator-edit-form/, "creator edit modal should use create-page style form");
assert.doesNotMatch(editModalHtml, /data-creator-account-picker/, "creator edit modal should not allow changing bound creator account");
assert.doesNotMatch(editModalHtml, /name="ownerUid"/, "creator edit modal should not submit a manually editable creator account");
assert.doesNotMatch(editModalHtml, /name="siteId"/, "creator edit modal should not submit a manually editable site id");
assert.doesNotMatch(editModalHtml, /name="roleTitle"|角色定位/, "creator edit modal should keep generated role title out of the form");
assert.doesNotMatch(editModalHtml, /name="shortBio"/, "creator edit modal should not submit generated short bio");
assert.match(editModalHtml, /knowledge-summary-text[\s\S]*AI generated creator bio\./, "creator edit modal should show generated short bio as readonly text");
assert.match(editModalHtml, />对应账号</, "creator edit modal should show bound account readonly");
assert.match(editModalHtml, />对应账号<\/label>\s*<input value="creator@example\.local" readonly/, "creator edit bound account should use a readonly input with normal control height");
assert.doesNotMatch(editModalHtml, />对应账号<\/label>\s*<p class="knowledge-summary-text"/, "creator edit bound account should not use the bio text block styling");
assert.match(editModalHtml, />所属站点</, "creator edit modal should show bound site readonly");
assert.match(editModalHtml, /data-dd-value="Bright &amp; playful"[\s\S]*is-active|is-active[\s\S]*data-dd-value="Bright &amp; playful"/, "creator edit modal should show legacy saved voice text when it is not a preset");
assert.doesNotMatch(editModalHtml, /填写后会创建一个新的网红角色。|修改后会同步保存到角色资料。/, "creator edit modal should not show description under title");

const controllerSource = readFileSync("src/features/admin-console/admin-creator-characters-controller.js", "utf8");
assert.match(controllerSource, /createAdminCharacter/, "creator controller should call the real admin create API");
assert.match(controllerSource, /listAdminCharacters\(\{ query: state\.query, type: "creator" \}\)/, "creator controller should request real creator search results");
assert.match(controllerSource, /input\[name="creatorSiteFilter"\][\s\S]*addEventListener\("change"/, "creator controller should bind dropdown site filter changes");
assert.match(controllerSource, /data-creator-search[\s\S]*setTimeout\(\(\) => load\?\.\(\{ keepFocus: true \}\), 300\)/, "creator search should debounce server requests and keep focus");
assert.match(controllerSource, /bindAdminCharacterAiControls\(host\)/, "creator controller should bind shared AI controls");

const serverSource = readFileSync("server/character-admin-service.js", "utf8");
assert.match(serverSource, /resolveCreatorOwnerForAdminCharacter/, "admin creator creation should resolve owner and site from creator account");
assert.match(serverSource, /assertCreatorHasNoActiveCharacter/, "admin creator creation should reject duplicate creator account binding");
assert.match(serverSource, /creatorOwner\?\.siteId/, "admin creator creation should persist site id from the creator account");
assert.match(serverSource, /deriveCharacterRoleTitle/, "admin creator creation should derive role title automatically");

const cssSource = [
  "src/features/app-shell/styles/admin-console.css",
  "src/features/app-shell/styles/admin-character-editor.css",
].map((path) => readFileSync(path, "utf8")).join("\n");
assert.match(cssSource, /\.creator-site-filter\{ min-width:170px; \}/, "creator site filter should have stable dropdown width");
assert.match(cssSource, /\.creator-account-picker\.is-open\{ z-index:10030; \}/, "creator account picker should rise above later form controls while open");
assert.match(cssSource, /\.creator-account-menu\{[^}]*z-index:10031;[^}]*\}/, "creator account picker menu should use a high overlay layer");
assert.match(cssSource, /\.creator-account-menu\{(?=[^}]*background:var\(--surface\);)[^}]*\}/, "creator account picker menu should use an opaque existing surface background");
assert.doesNotMatch(cssSource, /\.creator-account-menu\{[^}]*background:var\(--panel\);[^}]*\}/, "creator account picker menu must not use the undefined --panel token");
assert.match(cssSource, /\.admin-creator-create-form \.cf-field input,[\s\S]*\.admin-creator-edit-form \.cf-field input\{[^}]*height:48px;[^}]*\}/, "creator modal inputs should use the same fixed height");
assert.match(cssSource, /\.admin-creator-create-form \.agent-status-dd \.dd-select-trigger,[\s\S]*\.admin-creator-edit-form \.agent-status-dd \.dd-select-trigger\{(?=[^}]*height:48px;)(?=[^}]*min-height:48px;)(?=[^}]*padding:0 15px;)[^}]*\}/, "creator modal status dropdown should match input height");

console.log("admin creator character create/search self-check passed");
