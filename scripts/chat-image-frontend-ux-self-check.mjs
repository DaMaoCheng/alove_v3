import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSiteCopy } from "../src/i18n/site-copy.js";
import { renderChatImageMessage } from "../src/features/chat/chat-image-message.js";
import { getChatImageReadyToastCopy, getChatImageStatusCopy } from "../src/features/chat/chat-image-status-copy.js";
import { hasActiveChatImage } from "../src/app/chat-image-status-poller.js";

const pollerSource = readFileSync("src/app/chat-image-status-poller.js", "utf8");
const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const toastSource = readFileSync("src/features/chat/chat-image-ready-toast.js", "utf8");
const chatCss = readFileSync("src/features/app-shell/styles/chat.css", "utf8");
const appChatActions = readFileSync("src/app/app-chat-actions.js", "utf8");
const appViewFactory = readFileSync("src/app/app-view-factory.js", "utf8");
const textActions = readFileSync("src/app/chat-text-actions.js", "utf8");
const voiceActions = readFileSync("src/app/chat-voice-actions.js", "utf8");
const dataActions = readFileSync("src/app/chat-data-actions.js", "utf8");

assert.equal(getChatImageStatusCopy("queued", "English"), "Taking the shot...");
assert.equal(getChatImageStatusCopy("generating", "中文"), "等我拍张照……");
assert.equal(getChatImageReadyToastCopy("English"), "Photo ready · View");
assert.equal(getChatImageReadyToastCopy("zh-CN"), "照片好了 · 查看");

const chineseGeneratingCard = renderChatImageMessage({
  message: {
    id: "msg_image_language",
    contentType: "image_generation",
    text: "Taking the shot...",
    image: { status: "generating" },
  },
  pageLanguage: "Chinese (Mandarin)",
  copy: createSiteCopy("Chinese (Mandarin)"),
  escapeHtml: String,
  escapeAttribute: String,
});
assert.match(chineseGeneratingCard, /等我拍张照……/, "active site language should override a persisted image status from another locale");
assert.doesNotMatch(chineseGeneratingCard, /Taking the shot/, "persisted image status copy must not override the active site language");
assert.equal(renderChatImageMessage({
  message: { id: "failed-image", contentType: "image_generation", image: { status: "failed", errorMessage: "Not found" } },
  pageLanguage: "English",
  copy: createSiteCopy("English"),
  escapeHtml: String,
  escapeAttribute: String,
}), "", "failed generation cards must disappear from the user chat");

assert.equal(hasActiveChatImage([
  { contentType: "image_generation", image: { status: "queued" } },
]), true, "queued image should activate polling");
assert.equal(hasActiveChatImage([
  { content_type: "image_generation", delivery_status: "generating" },
]), true, "snake_case generating image should activate polling");
assert.equal(hasActiveChatImage([
  { contentType: "image_generation", image: { status: "ready" } },
]), false, "ready image should not keep polling");
assert.equal(hasActiveChatImage([
  { contentType: "text", deliveryStatus: "queued" },
]), false, "non-image messages should not activate polling");

assert.equal(hasActiveChatImage([{ contentType: "image_generation", image: { status: "failed", failureReplyPending: true, updatedAt: "2020-01-01" } }]), true, "server-confirmed pending failure reply keeps observation alive beyond old one-minute grace");
assert.equal(hasActiveChatImage([{ contentType: "image_generation", image: { status: "failed", failureReplyPending: false, updatedAt: "2020-01-01" } }]), false, "finished/absent failure reply does not indefinitely keep polling");

assert.match(pollerSource, /getCharacterMessages/, "poller should refresh messages from the chat API");
assert.match(pollerSource, /readyImageToast/, "poller should raise a ready-image toast state");
assert.match(pollerSource, /scrollRestore/, "poller should preserve scroll while refreshing image state");
assert.match(pollerSource, /collectImageStatusSnapshot/, "poller should track image status snapshots");
assert.match(pollerSource, /hasImageStatusChanged/, "poller should compare image status snapshots before remounting");
assert.match(pollerSource, /if \(hasImageStatusChanged\([\s\S]*?mountApp\?\.\(\);[\s\S]*?\}/, "poller should only remount the chat page when image state changes");
assert.match(pollerSource, /hasActiveReplyScheduler\?\.\(characterId\)[\s\S]*?appendCurrentChatTypingIndicator\?\.\(\)/, "poller should restore the typing indicator after image status remounts while a text reply is pending");
assert.match(pollerSource, /isViewingChatImageCharacter/, "poller should tolerate chat view render timing when deciding whether to refresh");
assert.doesNotMatch(pollerSource, /collectReadyImageIds\([^)]*\)\.filter/, "poller must convert Set results to arrays before filtering");
assert.match(appChatActions, /createChatImageStatusPoller/, "chat actions should create image status poller");
assert.ok(
  appChatActions.indexOf("const replyScheduler = createChatReplyScheduler") < appChatActions.indexOf("const imageStatusPoller = createChatImageStatusPoller"),
  "reply scheduler should be created before image poller so typing state can be restored after image remounts"
);
assert.match(appChatActions, /scheduleChatImageStatusPoll: imageStatusPoller\.scheduleChatImageStatusPoll/, "chat actions should expose image status polling to the view layer");
assert.match(textActions, /scheduleChatImageStatusPoll/, "text messages should start image status polling");
assert.match(voiceActions, /scheduleChatImageStatusPoll/, "voice messages should start image status polling");
assert.match(dataActions, /scheduleChatImageStatusPoll/, "loaded conversations should recover pending image polling");
assert.match(appViewFactory, /onPendingChatImageRendered/, "view factory should pass pending image render hook into chat page");

assert.match(chatPageSource, /bindChatImageReadyToast/, "chat page should bind ready image toast");
assert.match(chatPageSource, /restoreChatScroll/, "chat page should restore scroll during image status refresh");
assert.match(chatPageSource, /hasPendingChatImage/, "chat page should recover polling when pending image cards are rendered");
assert.ok(
  chatPageSource.indexOf("restoreChatScroll(wrap, scrollRestore)") < chatPageSource.indexOf("bindChatImageReadyToast(wrap"),
  "chat page should restore scroll before deciding whether ready toast is visible"
);
assert.match(toastSource, /scrollIntoView\(\{ block: "center", behavior: "smooth" \}\)/, "toast should scroll back to the ready image");
assert.match(toastSource, /isElementMostlyVisible/, "toast should only show when the image is not visible");
assert.match(toastSource, /!root\.isConnected/, "toast should wait until the chat page is mounted before measuring visibility");
assert.match(chatCss, /\.chat-image-ready-toast/, "chat CSS should style ready image toast");
assert.match(chatCss, /aspect-ratio:\s*4\/7/, "chat image preview should match 1024x1792 ratio");

console.log("chat image frontend UX self-check passed");

assert.equal(hasActiveChatImage([{contentType:"image_generation",image:{status:"ready",terminalReplyPending:true}}]),true,"ready image must continue existing polling while its caption job is pending");
assert.equal(hasActiveChatImage([{contentType:"image_generation",image:{status:"ready",terminalReplyPending:false}}]),false,"finished ready caption stops polling");

const {mapMessageRow}=await import("../server/chat-message-store.js");
const readyPending=mapMessageRow({content_type:"image_generation",image_asset_id:"fixture",image_status:"ready",image_terminal_reply_pending:1});
assert.equal(readyPending.image.terminalReplyPending,true);
assert.equal(readyPending.image.failureReplyPending,false);
const failedPending=mapMessageRow({content_type:"image_generation",image_asset_id:"fixture",image_status:"failed",image_terminal_reply_pending:1});
assert.equal(failedPending.image.failureReplyPending,true,"legacy failed API flag stays compatible");
assert(!JSON.stringify(readyPending.image).includes("_terminalReply"),"private ledger must not become public");

const pendingHookSource=chatPageSource.match(/function hasPendingChatImage\([^]*?\n}/)[0];
const pendingHook=Function(`${pendingHookSource}; return hasPendingChatImage;`)();
const noPendingCard={querySelector:()=>null};
assert.equal(pendingHook(noPendingCard,[{contentType:"image_generation",image:{status:"ready",terminalReplyPending:true}}]),true,"ready-before-initial-reply must restart existing polling from render hook");
assert.equal(pendingHook(noPendingCard,[{contentType:"image_generation",image:{status:"ready",terminalReplyPending:false}}]),false);
assert.equal(pendingHook(noPendingCard,[{contentType:"text",image:{status:"ready",terminalReplyPending:true}}]),false);
