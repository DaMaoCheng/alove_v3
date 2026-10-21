import assert from "node:assert/strict";
import {
  CHAT_IMAGE_BLOCK_REASONS,
  analyzeChatImageTrigger,
  isImageInspectionOnly,
  isMockChatImageRequest,
} from "../server/chat-image-trigger-service.js";

const allowed = [
  "take a photo with this kit",
  "show me you wearing this jersey",
  "can you try it on?",
  "Try this on",
  "try that on",
  "can you wear this kit?show for me",
  "can you wear this kit and show me?",
  "put on this jersey and show it to me",
  "你穿给我看",
  "拍张照看看上身效果",
  "Mándame una foto de ti",
  "Envíame una imagen tuya",
  "Mostre uma foto sua",
  "Envoie-moi une photo de toi",
  "Zeig mir ein Foto von dir",
  "あなたの写真を見せて",
  "Please take a test photo #mock-image",
];

for (const text of allowed) {
  const result = analyzeChatImageTrigger(text);
  assert.equal(result.hasIntent, true, `${text} should be an image intent`);
  assert.equal(result.allowed, true, `${text} should be allowed`);
}

const deferredToSemanticClassifier = [
  "发照片看看",
  "给我发张照片",
  "show me a photo",
  "send me a photo",
];

for (const text of deferredToSemanticClassifier) {
  const result = analyzeChatImageTrigger(text);
  assert.equal(result.hasIntent, false, `${text} should be deferred to semantic intent classification`);
}

assert.equal(analyzeChatImageTrigger("发照片看看").detectionSource, "deterministic_deferred");
assert.equal(analyzeChatImageTrigger("给我发张照片").detectionSource, "deterministic_deferred");

const disallowed = [
  "make a white background product photo",
  "generate 3 ad creative images",
  "remove background from this product image",
  "做一张商品主图",
  "批量生成多张广告素材",
];

for (const text of disallowed) {
  const result = analyzeChatImageTrigger(text);
  assert.equal(result.hasIntent, true, `${text} should still be detected as image intent`);
  assert.equal(result.allowed, false, `${text} should be blocked`);
  assert.equal(result.reason, CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST);
}

const noIntent = [
  "do you like this kit?",
  "what size should I buy?",
  "tell me about the match",
  "look this pic",
  "look at this image",
  "what is this picture?",
  "describe this photo",
  "看看这张图",
];

for (const text of noIntent) {
  const result = analyzeChatImageTrigger(text);
  assert.equal(result.hasIntent, false, `${text} should not trigger image generation`);
}

assert.equal(isImageInspectionOnly("look this pic"), true);
assert.equal(isImageInspectionOnly("can you wear this pic for me?"), false);
assert.equal(isMockChatImageRequest("hello #mock-image"), true);
assert.equal(isMockChatImageRequest("hello"), false);

const explicitGeneration = [
  "Genera una imagen de ti con esta camiseta",
  "Gere uma foto sua usando esta camisa",
  "Génère une photo de toi avec ce maillot",
  "生成一张你穿这件球衣的照片",
];
for (const text of explicitGeneration) {
  const result = analyzeChatImageTrigger(text);
  assert.equal(result.hasIntent, true, `${text} should be an image intent`);
  assert.equal(result.allowed, true, `${text} should be allowed`);
  assert.equal(result.explicitGeneration, true, `${text} should bypass the library`);
}

console.log("chat image trigger self-check passed");
