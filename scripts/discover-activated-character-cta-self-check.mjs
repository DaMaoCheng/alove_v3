import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const viewFactorySource = readFileSync("src/app/app-view-factory.js", "utf8");
const discoverSource = readFileSync("src/features/discover/discover-page.js", "utf8");
const confirmSource = readFileSync("src/features/discover/discover-character-confirm.js", "utf8");

assert.match(
  viewFactorySource,
  /activatedCharacterIds:\s*appState\.chat\.contacts\.map\(\(contact\) => contact\.characterId\)\.filter\(Boolean\)/,
  "Discover should derive activated character ids from the existing contacts state"
);
assert.match(
  discoverSource,
  /confirmText:\s*activatedCharacterIdSet\.has\(characterId\) \? copy\.t\("common\.continue"\) : copy\.t\("common\.start"\)/,
  "character previews should use compact state-aware labels"
);
assert.match(
  discoverSource,
  /if \(alreadyActivated\) \{\s*onNavigate\?\.\("chat", characterId\);\s*return;/s,
  "known activated characters should navigate without another activation request"
);
assert.match(
  discoverSource,
  /if \(result\?\.alreadyActivated\) \{\s*onNavigate\?\.\("chat", characterId\);\s*return;/s,
  "a stale contacts state should still continue to chat when the API reports an existing activation"
);
assert.match(
  confirmSource,
  /confirmText = ""[\s\S]*?<span>\$\{escapeHtml\(confirmText \|\| copy\.t\("common\.start"\)\)\}<\/span>/,
  "the preview should safely render its localized state-aware confirmation label"
);

console.log("discover activated character CTA self-check passed");
