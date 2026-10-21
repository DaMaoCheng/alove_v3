import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { collectChatImageReferenceImages } from "../server/chat-image-reference-material-service.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "../server/upload-policies.js";

const TEMP_UPLOAD_NAME = "chat-image-reference-self-check.png";
const TEMP_UPLOAD_PATH = join(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, TEMP_UPLOAD_NAME);

await mkdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { recursive: true });
await writeFile(TEMP_UPLOAD_PATH, await sharp({
  create: {
    width: 96,
    height: 128,
    channels: 4,
    background: "#14f26d",
  },
}).png().toBuffer());

try {
  const images = await collectChatImageReferenceImages({
    character: {
      avatarUrl: "/assets/char_fan.png",
    },
    latestProduct: {
      imageUrl: "/assets/jersey_product.png",
    },
    latestUserImage: {
      imageUrl: `/api/uploads/chat/${TEMP_UPLOAD_NAME}`,
    },
    imageRequestConstraints: {
      usesProductReference: true,
      usesUserImageReference: true,
    },
  });

  assert.equal(images.length, 3, "reference collector should resolve character, product, and user images");
  assert.deepEqual(images.map((image) => image.kind), ["character", "product", "user"], "reference images should preserve stable input order");
  for (const image of images) {
    assert.equal(image.contentType, "image/png", "reference images should be normalized to PNG");
    assert.ok(image.buffer.length > 100, "reference image buffer should not be empty");
    assert.match(image.filename, /reference\.png$/, "reference image should have a stable filename");
  }

  const characterOnly = await collectChatImageReferenceImages({
    character: { avatarUrl: "/assets/char_fan.png" },
    latestProduct: { imageUrl: "/assets/jersey_product.png" },
    imageRequestConstraints: { usesProductReference: false },
  });
  assert.deepEqual(characterOnly.map((image) => image.kind), ["character"], "ordinary photos should not load an unrelated product reference");

  await assert.rejects(
    () => collectChatImageReferenceImages({
      latestProduct: {
        imageUrl: "http://127.0.0.1:4173/internal-product-image.png",
      },
      imageRequestConstraints: {
        usesProductReference: true,
      },
    }),
    /Product API URL must use a public http\/https host|图片素材读取失败/,
    "remote reference image collector should reject loopback/private image URLs"
  );

  console.log("chat image reference material self-check passed");
} finally {
  await rm(TEMP_UPLOAD_PATH, { force: true }).catch(() => {});
}
