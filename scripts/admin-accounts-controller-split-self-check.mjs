import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const files = {
  controller: "src/features/admin-console/admin-accounts-controller.js",
  state: "src/features/admin-console/admin-accounts-state.js",
  listActions: "src/features/admin-console/admin-accounts-list-actions.js",
  bulkActions: "src/features/admin-console/admin-accounts-bulk-actions.js",
  bulkModal: "src/features/admin-console/admin-accounts-bulk-modal.js",
};

for (const path of Object.values(files)) {
  assert.ok(existsSync(path), `admin accounts split file should exist: ${path}`);
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);

assert.match(source.controller, /export\s+function\s+bindAdminAccounts/, "controller should keep bindAdminAccounts entry");
assert.match(source.controller, /createAdminAccountsBulkActions/, "controller should wire bulk actions module");
assert.match(source.controller, /bindAdminAccountsListActions/, "controller should wire list actions module");
assert.match(source.controller, /accountPageState/, "controller should use shared page state module");
assert.doesNotMatch(source.controller, /openBulkSelectModal|selectAllMatchingAccounts|applyBulkOperation|confirmAccountStatusChange/, "controller should not keep bulk or status action sink logic");

for (const name of ["selectedAccounts", "visibleAccounts", "pruneSelectionToCurrentItems", "updateAccountInState", "resetAccountListView"]) {
  assert.match(source.state, new RegExp(`export\\s+function\\s+${name}`), `state module should export ${name}`);
}
assert.match(source.state, /selectedIds: new Set\(\)/, "state module should own selection state");

assert.match(source.listActions, /export\s+function\s+bindAdminAccountsListActions/, "list actions module should export list binder");
assert.match(source.listActions, /openAccountConversations/, "list actions module should own conversation open action");
assert.match(source.listActions, /openAccountFormModal/, "list actions module should own edit and password modal entry");
assert.match(source.listActions, /confirmAccountStatusChange/, "list actions module should own row status action");

assert.match(source.bulkActions, /export\s+function\s+createAdminAccountsBulkActions/, "bulk actions module should export action factory");
assert.match(source.bulkActions, /openBulkSelectModal/, "bulk actions module should use bulk modal helper");
assert.match(source.bulkActions, /selectAllMatchingAccounts/, "bulk actions module should own select-all action");
assert.match(source.bulkActions, /applyBulkOperation/, "bulk actions module should own bulk updater loop");

assert.match(source.bulkModal, /export\s+function\s+openBulkSelectModal/, "bulk modal module should export modal open helper");
assert.match(source.bulkModal, /export\s+function\s+closeBulkSelectModal/, "bulk modal module should export modal close helper");
assert.doesNotMatch(source.bulkModal, /updateAdminAccountSite|updateAdminAccountProfile|updateAdminAccountStatus/, "bulk modal module should not own account write logic");

console.log("admin accounts controller split self-check passed");
