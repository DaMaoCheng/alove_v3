import assert from "node:assert/strict";
import {
  canArchiveCharacter,
  characterStatusCellHtml,
  characterStatusLabel,
  characterStatusTone,
  characterVisibilityLabel,
  characterVisibilityTone,
  editableStatusItems,
  isPrivateCharacter,
  normalizeCharacterStatus,
} from "../src/features/admin-console/admin-character-status.js";

const publicPublished = { id: "public-published", visibility: "public", status: "published" };
const publicArchived = { id: "public-archived", visibility: "public", status: "archived" };
const privatePublished = { id: "private-published", visibility: "private", status: "published" };
const privateArchived = { id: "private-archived", visibility: "private", status: "archived" };
const legacyDraft = { id: "legacy-draft", visibility: "public", status: "draft" };

assert.equal(normalizeCharacterStatus("published"), "published");
assert.equal(normalizeCharacterStatus("archived"), "archived");
assert.equal(normalizeCharacterStatus("draft"), "published");
assert.equal(normalizeCharacterStatus(""), "published");

assert.equal(isPrivateCharacter(privatePublished), true);
assert.equal(isPrivateCharacter(publicPublished), false);

assert.equal(canArchiveCharacter(publicPublished), true);
assert.equal(canArchiveCharacter(publicArchived), false);
assert.equal(canArchiveCharacter(privatePublished), false);
assert.equal(canArchiveCharacter(privateArchived), false);
assert.equal(canArchiveCharacter(legacyDraft), true);

assert.equal(characterStatusLabel(publicPublished), "已上架");
assert.equal(characterStatusLabel(publicArchived), "已下架");
assert.equal(characterStatusLabel(legacyDraft), "已上架");
assert.equal(characterStatusTone(publicPublished), "on");
assert.equal(characterStatusTone(publicArchived), "off");
assert.equal(characterStatusTone(legacyDraft), "on");

assert.equal(characterVisibilityLabel(publicPublished), "公开");
assert.equal(characterVisibilityLabel(privatePublished), "私密");
assert.equal(characterVisibilityTone(publicPublished), "public");
assert.equal(characterVisibilityTone(publicArchived), "off");
assert.equal(characterVisibilityTone(privatePublished), "private");
assert.equal(characterVisibilityTone(privateArchived), "private");

assert.match(characterStatusCellHtml(publicPublished), /已上架/);
assert.match(characterStatusCellHtml(publicArchived), /已下架/);
assert.equal(characterStatusCellHtml(privatePublished), '<span class="muted-dash">-</span>');
assert.equal(characterStatusCellHtml(privateArchived), '<span class="muted-dash">-</span>');
assert.deepEqual(editableStatusItems(), [["published", "已上架"], ["archived", "已下架"]]);

console.log(JSON.stringify({ ok: true, checked: "admin character status rules" }, null, 2));
