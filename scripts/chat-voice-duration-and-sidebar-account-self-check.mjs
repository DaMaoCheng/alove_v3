import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveEncodedAudioDurationSeconds } from "../server/encoded-audio-duration-service.js";
import { mapMessageRow } from "../server/chat-message-store.js";

const chineseGreetingBytes = 158450;
assert.equal(
  resolveEncodedAudioDurationSeconds({ audioBytes: chineseGreetingBytes, outputFormat: "mp3_44100_128" }),
  10,
  "128 kbps Chinese greeting audio should display its encoded duration instead of a text-length guess"
);

const message = mapMessageRow({
  id: "msg_voice_duration_check",
  session_id: "chat_voice_duration_check",
  character_id: "mascot_voice_duration_check",
  sender_type: "character",
  sender_label: "Voice Check",
  content_type: "text",
  text_content: "你好，我是小爱。你可以在这里聊天、浏览角色和商品，也可以通过左上角菜单探索更多页面。",
  voice_asset_id: "voice_duration_check",
  voice_duration_seconds: 0,
  voice_audio_bytes: chineseGreetingBytes,
  voice_output_format: "mp3_44100_128",
  voice_audio_url: "/uploads/voice/ai/voice-duration-check.mp3",
  voice_asset_status: "ready",
  product_payload_json: null,
  display_order: 1,
  delivery_status: "sent",
  sent_at: "2026-08-02T09:17:29.296Z",
});
assert.equal(message.voice?.durationSeconds, 10, "all chat message clients should receive the resolved audio duration");

const shellCss = await readFile(new URL("../src/features/app-shell/styles/shell.css", import.meta.url), "utf8");
assert.match(shellCss, /\.user-tile \.ut-text\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s, "account text container should be allowed to shrink without wrapping the tile");
assert.match(shellCss, /\.user-tile \.u-name,\s*\.user-tile \.u-meta\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s, "account email should remain on one line and ellipsize");

console.log("chat voice duration and sidebar account self-check passed");
