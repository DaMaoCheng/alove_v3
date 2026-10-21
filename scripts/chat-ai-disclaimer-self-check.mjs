import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composerHtml } from "../src/features/chat/chat-composer-template.js";

const templateSource = readFileSync("src/features/chat/chat-composer-template.js", "utf8");
const pageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const stylesSource = readFileSync("src/features/app-shell/styles/chat.css", "utf8");

const englishHtml = composerHtml("Millie", { pageLanguage: "English" });
const chineseHtml = composerHtml("Millie", { pageLanguage: "中文" });

assert.match(templateSource, /createSiteCopy\(pageLanguage\)/, "composer should choose disclaimer copy from the shared site language bundle");
assert.match(templateSource, /<details class="ai-disclaimer">/, "composer should render an expandable AI disclaimer");
assert.match(templateSource, /<summary>/, "short disclaimer should be the clickable summary");
assert.match(templateSource, /ai-disclaimer-short/, "short disclaimer should be replaceable inside the summary");
assert.match(templateSource, /ai-disclaimer-long/, "expanded disclaimer should replace the short summary text");
assert.match(pageSource, /pageLanguage/, "chat page should pass page language into the composer");
assert.match(stylesSource, /\.ai-disclaimer/, "AI disclaimer should have dedicated styling");
assert.match(stylesSource, /\.composer-frame:has\(\.voice-rec\.on\) \.ai-disclaimer/, "AI disclaimer should hide while voice recording UI is active");
assert.match(stylesSource, /\.composer-frame:has\(\.composer-inner\.voice-mode\) \.ai-disclaimer/, "AI disclaimer should hide while mobile voice mode is active");
assert.match(stylesSource, /text-align: center/, "AI disclaimer should be centered under the composer");
assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.ai-disclaimer\[open\] summary/, "expanded disclaimer should be allowed to wrap on mobile");
assert.doesNotMatch(templateSource, /<p>\$\{escapeHtml\(disclaimer\.long\)\}<\/p>/, "expanded disclaimer should not render as a second paragraph");

assert.match(englishHtml, /AI chat, not a real person\. Treat replies as fictional →/, "English short disclaimer should render");
assert.match(englishHtml, /not facts or advice/, "English expanded disclaimer should mention facts and advice");
assert.match(chineseHtml, /这是 AI，不是真人。请把回复视为虚构 →/, "Chinese short disclaimer should render");
assert.match(chineseHtml, /不应当作事实或建议/, "Chinese expanded disclaimer should mention facts and advice");

console.log("chat AI disclaimer self-check passed");
