import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/discover/discover-page.js", "utf8");
const styleSource = readFileSync("src/features/app-shell/styles/discover.css", "utf8");

assert.doesNotMatch(source, /Trending legends/, "discover page should not render the Trending legends subtitle");
assert.doesNotMatch(source, /Fresh on the pitch/, "discover page should not render the Fresh on the pitch subtitle");
assert.doesNotMatch(source, /\[\.{3}visibleCharacters\]\.reverse/, "discover page should not render a second reversed character row");
assert.match(source, /renderCharacterSection\(\{ characters: visibleCharacters, loading, error, copy \}\)/, "discover page should render one character section with the current localized copy");
assert.doesNotMatch(
  source,
  /pointerdown[\s\S]*?track\.setPointerCapture\?\.\(event\.pointerId\)[\s\S]*?pointermove/,
  "discover rail should not capture the pointer before a real drag starts"
);
assert.match(
  source,
  /if \(Math\.max\(0, track\.scrollWidth - track\.clientWidth\) <= 2\) \{[\s\S]*?finishDrag\(\);[\s\S]*?suppressClick = false;[\s\S]*?return;/,
  "discover rail should not enable mouse dragging when the character row does not overflow"
);
assert.match(
  source,
  /if \(!isDragging && Math\.abs\(delta\) <= 5\) return;[\s\S]*?track\.setPointerCapture\?\.\(event\.pointerId\)/,
  "discover rail should capture the pointer only after crossing the drag threshold"
);
assert.match(
  source,
  /if \(\(event\.buttons & 1\) === 0\) \{[\s\S]*?finishDrag\(\);[\s\S]*?suppressClick = false;[\s\S]*?return;/,
  "discover rail should clear an uncaptured drag when the primary mouse button is no longer pressed"
);
assert.match(styleSource, /\.chips-row \{[^}]*margin: 18px 0 24px;/s, "discover category chips should keep enough spacing before the character row");

console.log("discover single-row self-check passed");
