import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const imageGenerationSource = readFileSync(new URL("../server/image-generation-service.js", import.meta.url), "utf8");
const uploadSource = readFileSync(new URL("../server/upload-service.js", import.meta.url), "utf8");

assert.match(
  imageGenerationSource,
  /prepareGeneratedAvatarBuffer\(generated\.buffer\)/,
  "AI avatar generation should preserve the generated source image before the user cropper"
);
assert.doesNotMatch(
  imageGenerationSource,
  /compressAvatarBuffer/,
  "AI avatar generation should not call the old square-cover compression path"
);
assert.match(
  uploadSource,
  /export async function prepareGeneratedAvatarBuffer/,
  "upload service should expose a generated-avatar preparation helper"
);
assert.match(
  uploadSource,
  /fit:\s*"inside"/,
  "generated-avatar preparation should preserve aspect ratio instead of cover-cropping"
);
assert.doesNotMatch(
  uploadSource,
  /fit:\s*"cover",\s*position:\s*"center"/,
  "generated-avatar preparation should not center-crop to a square before the user cropper"
);

console.log("avatar generation source preservation self-check passed");
