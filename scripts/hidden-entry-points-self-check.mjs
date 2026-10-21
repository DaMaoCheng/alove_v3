import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync("src/features/app-shell/app-sidebar.js", "utf8");
const profileModalSource = readFileSync("src/features/profile-modal/profile-modal-content.js", "utf8");
const viewFactorySource = readFileSync("src/app/app-view-factory.js", "utf8");

assert.match(sidebarSource, /const SHOW_KIT_SHOP_ENTRY = false;/, "Kit Shop sidebar entry should stay hidden behind a restore flag");
assert.match(sidebarSource, /const SHOW_CREATOR_WORKSPACE_ENTRY = false;/, "Creator Workspace sidebar entry should stay hidden behind a restore flag");
assert.match(profileModalSource, /const SHOW_CREATOR_WORKSPACE_ENTRY = false;/, "Creator Workspace profile entry should stay hidden behind a restore flag");
assert.match(sidebarSource, /SHOW_KIT_SHOP_ENTRY \?/, "Kit Shop markup should remain available for later restore");
assert.match(sidebarSource, /SHOW_CREATOR_WORKSPACE_ENTRY && canSeeCreator/, "Creator Workspace sidebar markup should remain available for later restore");
assert.match(profileModalSource, /SHOW_CREATOR_WORKSPACE_ENTRY && canSeeCreator/, "Creator Workspace profile markup should remain available for later restore");
assert.match(viewFactorySource, /createCreatorWorkspacePage/, "Creator Workspace page route should remain available");

console.log("hidden entry points self-check passed");
