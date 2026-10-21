import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/chat/chat-page.js", "utf8");

assert.match(
  source,
  /const previousScroll = readCurrentChatScroll\(currentCharacter\.id\);/,
  "chat page should read the current scroll position before remounting"
);

assert.match(
  source,
  /wrap\.dataset\.characterId = String\(currentCharacter\.id \|\| ""\);/,
  "chat page should tag the current character for same-chat scroll preservation"
);

assert.match(
  source,
  /previousScroll && !previousScroll\.nearBottom[\s\S]*restoreChatScroll\(wrap, previousScroll\)/,
  "chat page should restore scroll when the user is reading history"
);

assert.match(
  source,
  /image\.addEventListener\("load", \(\) => \{[\s\S]*if \(isNearChatBottom\(body\)\) scrollChatToLatest\(root\);/,
  "image load auto-scroll should only run when the user is near the bottom"
);

assert.doesNotMatch(
  source,
  /image\.addEventListener\("load", \(\) => scrollChatToLatest\(root\)/,
  "image load should not unconditionally scroll to the latest message"
);

assert.match(
  source,
  /function isNearChatBottom\(body\)/,
  "chat page should keep a shared near-bottom check"
);

console.log("chat scroll position self-check passed");
