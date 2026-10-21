import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canUseGuestView, resolveGuestChatAgent } from "../src/app/app-navigation.js";
import { resolveAppShellContacts } from "../src/app/guest-sidebar-state.js";

const guestState = {
  session: { authenticated: false },
  chat: { guest: { active: true, mascotCharacterId: "mascot_fkk" } },
};

assert.equal(resolveGuestChatAgent(guestState, "chat", "other-character"), "other-character", "browser history should preserve the guest's selected public role");
assert.equal(resolveGuestChatAgent(guestState, "discover", "other-character"), "other-character", "non-chat guest routes should not rewrite unrelated agent state");
assert.equal(resolveGuestChatAgent({ ...guestState, session: { authenticated: true } }, "chat", "other-character"), "other-character", "signed-in chat should preserve the requested character");

for (const view of ["discover", "search", "kitshop", "chat"]) {
  assert.equal(canUseGuestView(guestState, view), true, `guest should retain ${view} route access`);
}
assert.equal(canUseGuestView(guestState, "profile"), false, "guest should not gain profile access");
assert.equal(canUseGuestView(guestState, "create"), false, "guest should not gain character creation access");

const guestContacts = resolveAppShellContacts({
  ...guestState,
  characters: {
    current: null,
    items: [{ id: "mascot_fkk", name: "Millie", avatarUrl: "/millie.jpg" }],
  },
  chat: { ...guestState.chat, contacts: [] },
});
assert.deepEqual(guestContacts, [{ characterId: "mascot_fkk", name: "Millie", avatarUrl: "/millie.jpg" }], "guest sidebar should expose the frozen mascot as a contact");
assert.deepEqual(resolveAppShellContacts({
  ...guestState,
  characters: { current: null, items: [] },
  chat: { guest: { ...guestState.chat.guest, capability: { mascotName: "Millie", mascotAvatarUrl: "/millie.jpg" } }, contacts: [] },
}), [{ characterId: "mascot_fkk", name: "Millie", avatarUrl: "/millie.jpg" }], "guest capability should keep mascot contact details on direct browse-page refresh");

const sidebarSource = await readFile(new URL("../src/features/app-shell/app-sidebar.js", import.meta.url), "utf8");
const characterLoadSource = await readFile(new URL("../src/app/character-load-actions.js", import.meta.url), "utf8");
assert.match(sidebarSource, /guestMode \? "" : navItem\("create", ICONS\.spark, copy\.t\("nav\.create"\)/, "guest sidebar should hide the localized Create item from guests");
assert.match(sidebarSource, /SHOW_KIT_SHOP_ENTRY \? navItem\("kitshop"/, "guest sidebar should render Kitshop");
assert.doesNotMatch(sidebarSource, /SHOW_KIT_SHOP_ENTRY && !guestMode/, "Kitshop must not be hidden from guests");
assert.match(characterLoadSource, /\["discover", "search", "kitshop", "create"\]\.includes\(view\)/, "character data loading should retain the signed-in Create route");

console.log("guest navigation state self-check passed");
