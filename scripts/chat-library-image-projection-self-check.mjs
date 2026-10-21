import assert from "node:assert/strict";
import { mapMessageRow } from "../server/chat-message-store.js";
import { renderChatMessages } from "../src/features/chat/chat-message-renderer.js";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network forbidden in projection check"); };
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const base = { id: "isolated-message", session_id: "isolated-session", character_id: "isolated-character", sender_type: "character", delivery_status: "sent", display_order: 30 };
const validPayload = { imageId: "isolated-gallery", imageUrl: "/uploads/mascot-greetings/isolated.webp", mediaType: "image" };
const render = (message) => renderChatMessages({ character: { name: "Valeria" }, messages: [message], pageLanguage: "Spanish", escapeHtml: escape, escapeAttribute: escape });
let checks = 0;
try {
  for (const content_type of ["mascot_library_image", "mascot_greeting_image"]) {
    const mapped = mapMessageRow({ ...base, content_type, product_payload_json: JSON.stringify(validPayload) });
    assert.equal(mapped.image.status, "ready");
    assert.equal(mapped.image.imageUrl, validPayload.imageUrl);
    const html = render(mapped);
    assert.match(html, /class="chat-image-card is-ready"/);
    assert.match(html, /<img src="\/uploads\/mascot-greetings\/isolated.webp"/);
    assert.doesNotMatch(html, /data-voice-play|00:00|is-pending/); checks++;
    for (const imageUrl of ["https://untrusted.invalid/image.webp", "javascript:alert(1)", "/uploads/chat-images/private.webp", ""]) {
      const invalid = mapMessageRow({ ...base, content_type, product_payload_json: JSON.stringify({ ...validPayload, imageUrl }) });
      assert.equal(invalid.image.status, "failed");
      assert.equal(invalid.image.imageUrl, "");
      assert.equal(render(invalid), "", "invalid gallery URL preserves existing failed-image behavior"); checks++;
    }
  }
  const greetingVideo = mapMessageRow({ ...base, content_type: "mascot_greeting_image", product_payload_json: { ...validPayload, imageUrl: "/uploads/mascot-greetings/isolated.mp4", mediaType: "video" } });
  assert.equal(greetingVideo.image.mediaType, "video");
  assert.match(render(greetingVideo), /<video[^>]+controls playsinline/); checks++;
  const generated = mapMessageRow({ ...base, content_type: "image_generation", image_asset_id: "isolated-asset", image_status: "ready", image_storage_path: "/uploads/chat-images/isolated.webp", image_provider: "mock" });
  assert.equal(generated.image.status, "ready");
  assert.match(render(generated), /chat-image-card is-ready/);
  assert.doesNotMatch(render(generated), /data-voice-play|00:00/); checks++;
  const pending = mapMessageRow({ ...base, content_type: "image_generation", image_asset_id: "isolated-asset", image_status: "generating" });
  assert.match(render(pending), /chat-image-card is-pending/); checks++;
  const text = mapMessageRow({ ...base, content_type: "text", text_content: "Hola", product_payload_json: {
    publicField: "preserved", _replyRecovery: { private: true }, _productRequestScope: { private: true }, _productCandidateState: { private: true },
  } });
  assert.equal(text.image, null);
  assert.deepEqual(text.product, { publicField: "preserved" });
  const textHtml = render(text);
  assert.match(textHtml, /Hola/);
  assert.doesNotMatch(textHtml, /chat-image-card|private|_replyRecovery|_productCandidateState|_productRequestScope/); checks++;
  const voice = mapMessageRow({ ...base, content_type: "text", text_content: "Hola con voz", voice_asset_id: "isolated-voice", voice_asset_status: "ready", voice_audio_url: "/uploads/chat-voices/isolated.mp3", voice_duration_seconds: 3 });
  assert.equal(voice.image, null);
  assert.equal(voice.voice.assetStatus, "ready");
  assert.match(render(voice), /data-voice-play/);
  assert.match(render(voice), /Hola con voz/);
  assert.doesNotMatch(render(voice), /chat-image-card/); checks++;
  const user = mapMessageRow({ ...base, content_type: "text", sender_type: "user", text_content: "Buenas" });
  assert.match(render(user), /class="msg me"/);
  assert.doesNotMatch(render(user), /data-voice-play|chat-image-card/); checks++;
  console.log(`library image projection self-check passed: ${checks} map-to-render cases; no DB, model, network or CSS changes`);
} finally {
  globalThis.fetch = originalFetch;
}
