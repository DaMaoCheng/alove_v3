import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modalSource = readFileSync("src/features/call-modal/call-modal.js", "utf8");
const clientSource = [
  "src/features/call-modal/call-realtime-client.js",
  "src/features/call-modal/call-state-machine.js",
  "src/features/call-modal/call-audio-capture.js",
  "src/features/call-modal/call-websocket-client.js",
  "src/features/call-modal/call-playback-guard.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const appSource = [
  "src/app/main.js",
  "src/app/app-call-actions.js",
  "src/app/app-create-actions.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const viewFactorySource = readFileSync("src/app/app-view-factory.js", "utf8");
const stylesSource = readFileSync("src/features/app-shell/styles/call-modal.css", "utf8");
const siteCopySource = readFileSync("src/i18n/site-copy.js", "utf8");

assert.match(modalSource, /id="callPause"/, "call modal should render pause/resume button");
assert.match(modalSource, /id="callShop"/, "call modal should render shop placeholder button");
assert.match(modalSource, /ICONS\.mic/, "active microphone state should use microphone icon");
assert.match(modalSource, /ICONS\.micOff/, "paused microphone state should use muted microphone icon");
assert.match(modalSource, /copy\.t\("call\.micOn"\)/, "active microphone label should use localized call copy");
assert.match(modalSource, /copy\.t\("call\.micOff"\)/, "paused microphone label should use localized call copy");
assert.match(siteCopySource, /"call\.micOn": "Mic: on"/, "English call copy should retain Mic: on");
assert.match(siteCopySource, /"call\.micOff": "Mic: off"/, "English call copy should retain Mic: off");
assert.match(modalSource, /ICONS\.shop/, "shop button should use shop icon");
assert.doesNotMatch(modalSource, />Speaker<|aria-label="Speaker"|ICONS\.speaker|callMute|onToggleMute/, "speaker/mute controls should be removed from call modal");
assert.match(modalSource, /onTogglePause/, "call modal should bind pause control");
assert.match(modalSource, /onShopClick/, "call modal should bind shop placeholder control");

assert.match(clientSource, /setPaused\(nextPaused\)/, "call client should expose setPaused");
assert.match(clientSource, /if \(this\.paused\) stopAssistantPlayback\(this\)/, "pausing should stop current assistant playback");
assert.match(clientSource, /this\.paused \|\| this\.pausedForAssistant/, "paused calls should stop sending mic audio");

assert.match(appSource, /toggleCallPause/, "app should expose call pause action");
assert.match(appSource, /handleCallShopClick/, "app should expose shop placeholder action");
assert.match(appSource, /client\?\.setPaused/, "pause action should call client setPaused");
assert.match(viewFactorySource, /paused: appState\.call\.paused/, "view factory should pass paused state");
assert.match(viewFactorySource, /onTogglePause: actions\.toggleCallPause/, "view factory should pass pause action");
assert.match(viewFactorySource, /onShopClick: actions\.handleCallShopClick/, "view factory should pass shop action");

assert.match(stylesSource, /\.cc-btn\.shop/, "shop button should have dedicated style hook");
assert.match(stylesSource, /\.cc-btn\.mic-on \.cc-ic\{ background:var\(--accent-soft\); color:var\(--accent\); \}/, "active microphone button should use green accent styling");
assert.match(stylesSource, /\.cc-btn\.off \.cc-ic\{ background:var\(--tile-hover\); color:var\(--ink-3\); \}/, "muted microphone button should use neutral gray styling");

console.log("call controls self-check passed");
