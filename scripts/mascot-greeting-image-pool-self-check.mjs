import assert from "node:assert/strict";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import {
  ensureMascotGreetingImageMessageForSession,
  createMascotLibraryImageMessage,
  generateMascotGreetingImage,
  listMascotGreetingImages,
  uploadMascotGreetingImage,
} from "../server/mascot-greeting-image-service.js";
import { ensureOpeningMessageForSession, listMessagesForSessionWithDb, mapMessageRow } from "../server/chat-message-store.js";
import { mapConversationMessageRow } from "../server/admin-account-mapper.js";

const suffix = Date.now();
const characterId = `mascot_greeting_pool_${suffix}`;
const emptyCharacterId = `mascot_greeting_empty_${suffix}`;
const sessionId = `chat_mascot_greeting_pool_${suffix}`;
const librarySessionId = `chat_mascot_library_exclusion_${suffix}`;
const emptySessionId = `chat_mascot_greeting_empty_${suffix}`;
const videoPrioritySessionId = `chat_mascot_greeting_video_priority_${suffix}`;
const imageId = `mascot_greeting_image_${suffix}`;
const greetingUrl = `/uploads/mascot-greetings/self-check-${suffix}.webp`;
let uploadedGreetingPath = "";
let uploadedGreetingVideoPath = "";

await initializeDatabase();
const pool = getDbPool();

try {
  await pool.execute(
    `INSERT INTO ai_characters (
       id, category_id, slug, name, role_title, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', ?, 'Greeting Check', 'Site Guide', 'public', 'published', 'self-check', 'mascot-greeting-image-pool', NOW(3))`,
    [characterId, `mascot-greeting-pool-${suffix}`]
  );
  await pool.execute(
    `INSERT INTO ai_characters (
       id, category_id, slug, name, role_title, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', ?, 'Empty Greeting Check', 'Site Guide', 'public', 'published', 'self-check', 'mascot-greeting-image-pool', NOW(3))`,
    [emptyCharacterId, `mascot-greeting-empty-${suffix}`]
  );
  await pool.execute(
    `INSERT INTO chat_sessions (id, character_id, session_title, session_status, source_type, source_ref, last_message_at)
     VALUES (?, ?, 'Greeting pool check', 'active', 'system', 'mascot-greeting-image-pool', NOW(3)),
            (?, ?, 'Greeting pool empty check', 'active', 'system', 'mascot-greeting-image-pool', NOW(3)),
            (?, ?, 'Greeting video priority check', 'active', 'system', 'mascot-greeting-image-pool', NOW(3)),
            (?, ?, 'Greeting/library exclusion check', 'active', 'system', 'mascot-greeting-image-pool', NOW(3))`,
    [sessionId, characterId, emptySessionId, emptyCharacterId, videoPrioritySessionId, characterId, librarySessionId, characterId]
  );
  await pool.execute(
    `INSERT INTO mascot_greeting_images (
       id, character_id, slot_index, image_url, generation_status, source_type
     ) VALUES (?, ?, 1, ?, 'ready', 'self-check')`,
    [imageId, characterId, greetingUrl]
  );

  const first = await pool.getConnection();
  const second = await pool.getConnection();
  try {
    await first.beginTransaction();
    const firstMessageId = await ensureMascotGreetingImageMessageForSession(first, {
      sessionId,
      character: { id: characterId, name: "Greeting Check", category_id: "mascot" },
    });
    const secondAttempt = (async () => {
      await second.beginTransaction();
      try {
        const messageId = await ensureMascotGreetingImageMessageForSession(second, {
          sessionId,
          character: { id: characterId, name: "Greeting Check", category_id: "mascot" },
        });
        await second.commit();
        return messageId;
      } catch (error) {
        await second.rollback();
        throw error;
      }
    })();
    await first.commit();
    const secondMessageId = await secondAttempt;
    assert.equal(secondMessageId, firstMessageId, "concurrent first loads must reuse one gallery message");
  } finally {
    first.release();
    second.release();
  }

  const messages = await listMessagesForSessionWithDb(pool, sessionId);
  const galleryMessages = messages.filter((message) => message.contentType === "mascot_greeting_image");
  assert.equal(galleryMessages.length, 1, "a session must receive at most one greeting image");
  assert.equal(galleryMessages[0].image?.imageUrl, greetingUrl, "greeting image should expose its public snapshot URL");
  assert.equal(galleryMessages[0].product?.slotIndex, 1, "greeting image should preserve its selected slot snapshot");
  assert.equal(galleryMessages[0].product?.publicGreetingImage, true, "greeting image should remain distinct from product payloads");

  const greetingOnly = await pool.getConnection();
  try {
    await greetingOnly.beginTransaction();
    const greetingMessageId = await ensureMascotGreetingImageMessageForSession(greetingOnly, {
      sessionId: librarySessionId,
      character: { id: characterId, name: "Greeting Check", category_id: "mascot" },
    });
    await greetingOnly.commit();
    assert.ok(greetingMessageId, "the exclusion fixture must first deliver a greeting image");
  } finally {
    greetingOnly.release();
  }
  await pool.execute(
    `INSERT INTO mascot_greeting_images (
       id, character_id, slot_index, image_url, generation_status, source_type
     ) VALUES (?, ?, 2, ?, 'ready', 'self-check')`,
    [`mascot_greeting_image_library_${suffix}`, characterId, `/uploads/mascot-greetings/self-check-library-${suffix}.webp`]
  );
  const libraryMessage = await createMascotLibraryImageMessage(pool, {
    sessionId: librarySessionId,
    character: { id: characterId, name: "Greeting Check", category_id: "mascot" },
  });
  assert.equal(libraryMessage?.product?.slotIndex, 2, "library delivery must skip an image already sent as a greeting");
  const noMoreLibraryMessage = await createMascotLibraryImageMessage(pool, {
    sessionId: librarySessionId,
    character: { id: characterId, name: "Greeting Check", category_id: "mascot" },
  });
  assert.equal(noMoreLibraryMessage, null, "a session must not resend greeting or library images");

  const [messageRows] = await pool.execute(
    `SELECT m.*, NULL AS image_asset_id FROM chat_messages m WHERE m.id = ? LIMIT 1`,
    [galleryMessages[0].id]
  );
  const adminMessage = mapConversationMessageRow(messageRows[0]);
  assert.equal(adminMessage.image?.imageUrl, greetingUrl, "admin conversation details should render the same greeting image snapshot");

  const adminLibraryMessage = mapConversationMessageRow({
    ...messageRows[0],
    id: `msg_mascot_library_${suffix}`,
    content_type: "mascot_library_image",
  });
  assert.equal(adminLibraryMessage.image?.imageUrl, greetingUrl, "admin conversation details should render mascot library image snapshots");

  await ensureOpeningMessageForSession(pool, {
    sessionId: emptySessionId,
    characterId: emptyCharacterId,
    senderLabel: "Empty Greeting Check",
    openingLine: "Text-only welcome.",
  });
  const emptyResult = await pool.getConnection();
  try {
    await emptyResult.beginTransaction();
    const messageId = await ensureMascotGreetingImageMessageForSession(emptyResult, {
      sessionId: emptySessionId,
      character: { id: emptyCharacterId, name: "Empty Greeting Check", category_id: "mascot" },
    });
    await emptyResult.commit();
    assert.equal(messageId, null, "empty gallery should fall back to text-only greeting");
  } finally {
    emptyResult.release();
  }
  const emptyMessages = await listMessagesForSessionWithDb(pool, emptySessionId);
  assert.equal(emptyMessages.length, 1, "empty greeting materials must leave exactly the text opening");
  assert.equal(emptyMessages[0].text, "Text-only welcome.", "empty greeting materials must preserve the text opening");
  assert.equal(
    emptyMessages.filter((message) => message.contentType === "mascot_greeting_image").length,
    0,
    "empty greeting materials must not create an empty media bubble"
  );

  const listed = await listMascotGreetingImages(characterId);
  assert.equal(listed.items.length, 5, "admin gallery must expose five fixed slots");
  assert.equal(listed.items[0].imageUrl, greetingUrl, "admin gallery should return ready slot data");

  const uploadBuffer = await sharp({
    create: { width: 80, height: 120, channels: 3, background: { r: 12, g: 160, b: 90 } },
  }).jpeg().toBuffer();
  const uploaded = await uploadMascotGreetingImage({
    characterId,
    slotIndex: 2,
    buffer: uploadBuffer,
    contentType: "image/jpeg",
    filename: "greeting-source.jpg",
  });
  assert.equal(uploaded.item.sourceType, "upload", "uploaded gallery image should keep its upload source");
  assert.match(uploaded.item.imageUrl, /\.webp$/, "uploaded gallery images must be stored as WebP");
  uploadedGreetingPath = join(process.cwd(), uploaded.item.imageUrl.replace(/^\//, ""));
  const uploadedMetadata = await sharp(await readFile(uploadedGreetingPath)).metadata();
  assert.equal(uploadedMetadata.format, "webp", "uploaded gallery image bytes must be WebP");

  const mp4Buffer = await createCompressibleMp4();
  const uploadedVideo = await uploadMascotGreetingImage({
    characterId,
    slotIndex: 5,
    buffer: mp4Buffer,
    contentType: "video/mp4",
    filename: "greeting-video.mp4",
  });
  assert.equal(uploadedVideo.item.mediaType, "video", "the fifth greeting slot must be stored as video");
  assert.equal(uploadedVideo.item.mimeType, "video/mp4", "the fifth greeting slot must expose its MP4 type");
  assert.match(uploadedVideo.item.imageUrl, /\.mp4$/, "the fifth greeting slot must retain an MP4 URL");
  uploadedGreetingVideoPath = join(process.cwd(), uploadedVideo.item.imageUrl.replace(/^\//, ""));
  const compressedVideo = await readFile(uploadedGreetingVideoPath);
  assert.ok(compressedVideo.length < mp4Buffer.length, "uploaded greeting video must be compressed before final storage");
  assert.notDeepEqual(compressedVideo, mp4Buffer, "stored greeting video bytes must be the compressed output");
  await assert.rejects(
    () => generateMascotGreetingImage({ characterId, slotIndex: 5 }),
    /只支持管理员上传 MP4 视频/,
    "AI image generation must not write into the greeting video slot"
  );

  await ensureOpeningMessageForSession(pool, {
    sessionId: videoPrioritySessionId,
    characterId,
    senderLabel: "Greeting Check",
    openingLine: "Welcome before video.",
  });
  const videoPriorityResult = await pool.getConnection();
  try {
    await videoPriorityResult.beginTransaction();
    const messageId = await ensureMascotGreetingImageMessageForSession(videoPriorityResult, {
      sessionId: videoPrioritySessionId,
      character: { id: characterId, name: "Greeting Check", category_id: "mascot" },
    });
    await videoPriorityResult.commit();
    assert.ok(messageId, "a ready greeting video should create a greeting message");
  } finally {
    videoPriorityResult.release();
  }
  const videoMessages = await listMessagesForSessionWithDb(pool, videoPrioritySessionId);
  assert.equal(videoMessages.length, 2, "video greeting flow should contain one text opening and one video message");
  assert.equal(videoMessages[0].contentType, "mascot_greeting_image", "greeting video must appear before text opening");
  assert.equal(videoMessages.find((message) => message.contentType === "text")?.text, "Welcome before video.", "text opening must remain present after greeting video");
  const videoMessage = videoMessages.find((message) => message.contentType === "mascot_greeting_image");
  assert.equal(videoMessage?.image?.mediaType, "video", "ready video must win over ready greeting images");
  assert.equal(videoMessage?.image?.imageUrl, uploadedVideo.item.imageUrl, "video priority must use the ready fifth slot");

  await pool.execute(
    "INSERT INTO mascot_greeting_images (id, character_id, slot_index, image_url, generation_status, source_type) VALUES (?, ?, 2, ?, 'ready', 'self-check')",
    [`mascot_greeting_image_second_${suffix}`, emptyCharacterId, `/uploads/mascot-greetings/self-check-second-${suffix}.webp`]
  );
  await pool.execute(
    "DELETE FROM mascot_greeting_message_deliveries WHERE session_id = ?",
    [emptySessionId]
  );
  const imageResult = await pool.getConnection();
  try {
    await imageResult.beginTransaction();
    const messageId = await ensureMascotGreetingImageMessageForSession(imageResult, {
      sessionId: emptySessionId,
      character: { id: emptyCharacterId, name: "Empty Greeting Check", category_id: "mascot" },
    });
    await imageResult.commit();
    assert.ok(messageId, "an image-only greeting library should create a greeting message");
  } finally {
    imageResult.release();
  }
  const randomImageMessages = await listMessagesForSessionWithDb(pool, emptySessionId);
  const randomImageMessage = randomImageMessages.find((message) => message.contentType === "mascot_greeting_image");
  assert.equal(randomImageMessage?.image?.mediaType, "image", "image-only gallery should create an image greeting");
  assert.equal(randomImageMessage?.product?.slotIndex, 2, "image-only gallery should select one of the ready image slot numbers");
  const [videoMessageRows] = await pool.execute(
    `SELECT m.*, NULL AS image_asset_id FROM chat_messages m WHERE m.id = ? LIMIT 1`,
    [videoMessage.id]
  );
  const mappedAdminVideo = mapConversationMessageRow(videoMessageRows[0]);
  assert.equal(mappedAdminVideo.image?.mediaType, "video", "admin conversation mapping must preserve greeting video media type");

  const [deliveryRows] = await pool.execute(
    "SELECT message_id, image_id FROM mascot_greeting_message_deliveries WHERE session_id = ?",
    [sessionId]
  );
  assert.equal(deliveryRows.length, 1, "delivery table must have one idempotency row per session");
  assert.equal(deliveryRows[0].image_id, imageId, "delivery should keep the selected image id");

  console.log("mascot greeting image pool self-check passed");
} finally {
  await pool.execute("DELETE FROM mascot_greeting_message_deliveries WHERE session_id IN (?, ?, ?, ?)", [sessionId, emptySessionId, videoPrioritySessionId, librarySessionId]).catch(() => {});
  await pool.execute("DELETE FROM chat_messages WHERE session_id IN (?, ?, ?, ?)", [sessionId, emptySessionId, videoPrioritySessionId, librarySessionId]).catch(() => {});
  await pool.execute("DELETE FROM mascot_greeting_images WHERE character_id IN (?, ?)", [characterId, emptyCharacterId]).catch(() => {});
  if (uploadedGreetingPath) await unlink(uploadedGreetingPath).catch(() => {});
  if (uploadedGreetingVideoPath) await unlink(uploadedGreetingVideoPath).catch(() => {});
  await pool.execute("DELETE FROM chat_sessions WHERE id IN (?, ?, ?, ?)", [sessionId, emptySessionId, videoPrioritySessionId, librarySessionId]).catch(() => {});
  await pool.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await pool.execute("DELETE FROM ai_characters WHERE id = ?", [emptyCharacterId]).catch(() => {});
  await closeDbPool();
}

async function createCompressibleMp4() {
  const workspace = await mkdtemp(join(tmpdir(), "alove-greeting-video-source-"));
  const outputPath = join(workspace, "source.mp4");
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "lavfi",
      "-i", "testsrc=size=1280x720:rate=30",
      "-t", "1",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "0",
      "-pix_fmt", "yuv420p",
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += String(chunk || "");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}
