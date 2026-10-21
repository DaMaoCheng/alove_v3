import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appChatActionsSource = readFileSync("src/app/app-chat-actions.js", "utf8");
const chatDataActionsSource = readFileSync("src/app/chat-data-actions.js", "utf8");
const chatReplySchedulerSource = readFileSync("src/app/chat-reply-scheduler.js", "utf8");

assert.match(
  appChatActionsSource,
  /const dataActions = createChatDataActions\(\{[\s\S]*\.\.\.replyScheduler,[\s\S]*\}\);/,
  "chat data loading should receive the shared reply scheduler"
);
assert.match(
  chatDataActionsSource,
  /recoverUnansweredUserMessage\(normalizedId\)/,
  "chat loading should recover an unanswered latest user text message"
);
assert.match(
  chatDataActionsSource,
  /findLatestUnansweredUserTextMessage/,
  "chat data actions should explicitly detect the latest unanswered user text message"
);
assert.match(
  chatDataActionsSource,
  /scheduleDelayedReply\?\.\(characterId,\s*unansweredMessage\.id/,
  "unanswered user text recovery should schedule the normal AI reply path"
);
assert.match(
  chatReplySchedulerSource,
  /completedSinceMessageIds/,
  "reply scheduler should remember completed message ids to avoid duplicate recovery replies"
);
assert.match(
  chatReplySchedulerSource,
  /completedSinceMessageIds\.has\(messageId\)/,
  "reply scheduler should ignore already completed message ids"
);

console.log("chat unanswered user recovery self-check passed");
