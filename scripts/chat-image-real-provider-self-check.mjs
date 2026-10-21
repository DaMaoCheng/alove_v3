import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChatImagePrompt } from "../server/chat-image-provider-service.js";
import { SERVER_CONFIG } from "../server/config.js";

const providerSource = readFileSync("server/chat-image-provider-service.js", "utf8");
const sharedProviderSource = readFileSync("server/image-generation-provider-service.js", "utf8");
const avatarSource = readFileSync("server/image-generation-service.js", "utf8");
const jobSource = readFileSync("server/chat-image-job-service.js", "utf8");
const assetSource = readFileSync("server/chat-image-asset-service.js", "utf8");

assert.match(sharedProviderSource, /\/images\/generations/, "shared image provider should call image generations endpoint");
assert.match(sharedProviderSource, /\/image\/edit/, "Venice image provider should call the native single-image edit endpoint");
assert.match(sharedProviderSource, /\/image\/multi-edit/, "Venice image provider should call the native multi-image edit endpoint");
assert.match(sharedProviderSource, /IMAGE_GENERATION_EDIT_MODEL|resolveImageEditModel/, "reference-image requests should use a dedicated edit model");
assert.match(sharedProviderSource, /referenceImages/, "shared image provider should accept optional reference image inputs");
assert.match(sharedProviderSource, /b64_json/, "shared image provider should read base64 image payload");
assert.match(providerSource, /requestGeneratedImage/, "chat image provider should reuse shared image generation request path");
assert.match(providerSource, /referenceImages/, "chat image provider should pass resolved image references to the shared provider");
assert.match(avatarSource, /requestGeneratedImage/, "avatar generation should reuse shared image generation request path");
assert.match(providerSource, /count:\s*1/, "chat image provider should request a single image");
assert.match(providerSource, /1024x1792/, "chat image provider should keep 9:16 1k default size");
assert.match(jobSource, /phase:\s*payload\.phase/, "job should honor mock vs real phase from queued payload");
assert.match(jobSource, /isRealChatImageProviderConfigured/, "job should fallback to mock when real provider is not configured");
assert.match(jobSource, /collectChatImageReferenceImages/, "real chat image job should collect eligible character, product, and user reference images");
assert.match(assetSource, /resize\(CHAT_IMAGE_WIDTH,\s*CHAT_IMAGE_HEIGHT/, "saved chat images should be normalized to 9:16 dimensions");

const prompt = buildChatImagePrompt({
  character: {
    name: "Millie",
    role_title: "Mascot",
    short_bio: "Warm football shop host.",
    persona_prompt: "Friendly matchday companion.",
    speaking_style: "Natural and playful.",
  },
  userText: "Can you try this Barcelona kit on?",
  recentMessages: [
    { sender_type: "user", text_content: "show me Barcelona Third Away Football kit" },
    { sender_type: "character", text_content: "Nice, medium got you." },
  ],
  latestProduct: {
    name: "Barcelona Third Away Football Shirt - UCL",
    subtitle: "Barcelona",
    imageUrl: "/assets/jersey_product.png",
    sizes: [{ label: "M" }, { label: "L" }],
  },
});

assert.match(prompt, /Generate one English-prompted chat photo/, "prompt should describe chat photo task");
assert.match(prompt, /Millie/, "prompt should include character name");
assert.match(prompt, /Barcelona Third Away Football Shirt/, "prompt should include product context");
assert.match(prompt, /Product image reference: \/assets\/jersey_product\.png/, "prompt should include product image reference URL");
assert.match(prompt, /not an ecommerce product image/i, "prompt should prevent ecommerce main-image output");
assert.match(prompt, /I am wearing Barcelona Third Away Football Shirt/, "prompt should use first-person try-on wording");
assert.match(prompt, /photorealistic, natural color grading, shot on 50mm f\/1\.4/, "prompt should include fixed camera style");
assert.match(prompt, /Maintain the same character identity/, "prompt should preserve character identity from reference image");
assert.match(prompt, /Keep facial features, face shape, eyes, nose, lips, skin tone/, "prompt should keep recognizable facial features stable");
assert.match(prompt, /Fixed variation code: \d+-\d+-\d+-\d+-\d+-\d+/, "prompt should use a deterministic six-dimension variation code");
assert.match(prompt, /Do not invent another random pose, expression, camera, scene, wardrobe, or lighting choice/, "prompt should forbid provider-selected randomness");
assert.doesNotMatch(prompt, /choose a natural variation|may vary naturally/i, "prompt must not delegate random visual choices to the provider");
assert.match(prompt, /9:16/, "prompt should enforce vertical composition");

assert.equal(SERVER_CONFIG.imageGeneration.openai.count, 1, "configured chat image count should be 1");
assert.match(SERVER_CONFIG.imageGeneration.openai.size, /^\d+x\d+$/, "configured image size should be valid");

console.log("chat image real provider self-check passed");
