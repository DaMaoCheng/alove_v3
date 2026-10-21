import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const discoverSource = readFileSync("src/features/discover/discover-page.js", "utf8");
const confirmSource = readFileSync("src/features/discover/discover-character-confirm.js", "utf8");

assert.match(
  discoverSource,
  /const guestMascot = guestMode \? characters\.find\(\(item\) => item\.id === guestMascotCharacterId\) : null;\s*const visibleCharacters = \[guestMascot, \.\.\.filterCharacters\(discoverCharacters, activeCategory\)\]\.filter\(Boolean\);/s,
  "guest mascot should remain fixed before category-sorted characters"
);
assert.match(
  discoverSource,
  /character\.cardTag \? `<span class="card-badge[^`]*\$\{character\.cardTagText\}<\/span>` : "";/,
  "guest mascot guide badge should continue to render from character card metadata"
);
assert.match(
  discoverSource,
  /if \(guestMode\) \{\s*onNavigate\?\.\("chat", characterId\);\s*return;/s,
  "guest users should enter a selected public Discover character chat directly"
);
assert.doesNotMatch(
  discoverSource,
  /guestMode && characterId !== guestMascotCharacterId|openGuestCharacterAuthPrompt/,
  "guest Discover navigation should not restore the retired non-mascot login gate"
);
assert.doesNotMatch(confirmSource, /dcm-voice|voiceStyle|ICONS\.mic/, "discover character preview should not show voice style");
assert.doesNotMatch(confirmSource, /dcm-tags|chatCountLabel/, "discover character preview should not show metadata tags");

console.log("discover guest character access self-check passed");
