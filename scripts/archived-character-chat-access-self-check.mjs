import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCommonCharactersHtml } from "../src/features/admin-console/admin-console-common-characters-template.js";

const chatQuerySource = readFileSync("server/chat-query-service.js", "utf8");
assert.doesNotMatch(
  chatQuerySource,
  /listUserChatContacts[\s\S]*AND c\.character_status = 'published'/,
  "activated archived characters should remain in the chat contacts list"
);
assert.match(
  chatQuerySource,
  /c\.character_status/,
  "chat contacts should select the character status for client-side unavailable UI"
);

const messageStoreSource = readFileSync("server/chat-message-store.js", "utf8");
assert.match(messageStoreSource, /characterStatus: row\.character_status/, "contact mapping should expose characterStatus");

const publicCharacterSource = readFileSync("server/character-public-service.js", "utf8");
assert.match(publicCharacterSource, /user_character_activations/, "activated users should be able to read archived character details for history view");
assert.match(publicCharacterSource, /c\.character_status = 'published'[\s\S]*OR EXISTS/, "archived detail access should be limited to activated users");

const sidebarSource = readFileSync("src/features/app-shell/app-sidebar.js", "utf8");
assert.match(sidebarSource, /unavailable-tag/, "archived contacts should show an icon tag");
assert.match(sidebarSource, /aria-label="This character is unavailable"/, "archived contact icon should expose accessible text");
assert.doesNotMatch(sidebarSource, />Unavailable</, "archived contact should not render a long unavailable word");

const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const quickRepliesSource = readFileSync("src/features/chat/chat-quick-replies.js", "utf8");
assert.match(chatPageSource, /is-unavailable/, "archived chat page should enter unavailable state");
assert.match(chatPageSource, /该角色已下架，暂时不能聊天。|This character is unavailable for chat\./, "archived chat page should explain that chat is disabled");
assert.match(chatPageSource, /renderQuickReplies\(quickReplies,[\s\S]*disabled: unavailable/, "chat page should pass unavailable state into quick replies");
assert.match(quickRepliesSource, /data-quick="\$\{escapeAttribute\(text\)\}"[\s\S]*disabledAttr/, "quick product actions should render disabled when unavailable");
assert.match(chatPageSource, /call-btn[\s\S]*disabled/, "call button should be disabled");

const composerTemplateSource = readFileSync("src/features/chat/chat-composer-template.js", "utf8");
assert.match(composerTemplateSource, /data-chat-unavailable="true"/, "archived chat page should expose disabled state");
assert.match(composerTemplateSource, /id="msgInput"[\s\S]*disabled/, "message input should be disabled");
assert.match(composerTemplateSource, /data-attach-toggle[\s\S]*disabled/, "attachment button should be disabled");
assert.match(composerTemplateSource, /id="voiceBtnMain"[\s\S]*disabled/, "voice button should be disabled");

const adminHtml = adminCommonCharactersHtml({
  items: [{
    id: "char_public_archived",
    name: "Archived Public",
    creator: { nickname: "Admin", account: "admin@example.local" },
    category: "Football Babe",
    categoryId: "football_babe",
    status: "archived",
    visibility: "public",
    chats: "0",
    avatarUrl: "",
  }],
});
assert.match(adminHtml, /data-common-publish="char_public_archived"/, "public archived characters should expose publish action");
assert.match(adminHtml, />上架</, "public archived characters should show publish label");
assert.match(adminHtml, /class="[^"]*\brestore\b[^"]*"/, "publish action should use a neutral white style");
assert.doesNotMatch(adminHtml, /data-common-archive="char_public_archived"/, "archived characters should not show archive action");

const adminCss = readFileSync("src/features/app-shell/styles/admin-console.css", "utf8");
assert.match(adminCss, /\.dt-act a\.restore\{\s*color:var\(--ink\);\s*\}/, "publish action should only change text color");
assert.doesNotMatch(adminCss, /\.dt-act a\.restore\{[^}]*border|\.dt-act a\.restore\{[^}]*border-radius|\.dt-act a\.restore\{[^}]*padding/, "publish action should not use capsule styling");

console.log("archived character chat access self-check passed");
