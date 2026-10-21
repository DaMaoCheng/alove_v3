import { join } from "node:path";
import { PROJECT_ROOT } from "./config.js";

export const AVATAR_UPLOAD_POLICY = Object.freeze({
  uploadDir: join(PROJECT_ROOT, "uploads", "avatars"),
  publicPath: "/uploads/avatars",
  maxBytes: 2 * 1024 * 1024,
  generatedMaxBytes: 8 * 1024 * 1024,
  fileNamePrefix: "avatar",
  allowedTypes: Object.freeze({
    "image/webp": { extension: ".webp", extensions: [".webp"], kind: "image" },
    "image/png": { extension: ".png", extensions: [".png"], kind: "image" },
    "image/jpeg": { extension: ".jpg", extensions: [".jpg", ".jpeg", ".jfif"], kind: "image" },
  }),
});

export const CAROUSEL_UPLOAD_POLICY = Object.freeze({
  uploadDir: join(PROJECT_ROOT, "uploads", "carousel"),
  publicPath: "/uploads/carousel",
  maxBytes: 3 * 1024 * 1024,
  fileNamePrefix: "carousel",
  allowedTypes: Object.freeze({
    "image/webp": { extension: ".webp", extensions: [".webp"], kind: "image" },
    "image/png": { extension: ".png", extensions: [".png"], kind: "image" },
    "image/jpeg": { extension: ".jpg", extensions: [".jpg", ".jpeg", ".jfif"], kind: "image" },
  }),
});

export const MASCOT_GREETING_IMAGE_UPLOAD_POLICY = Object.freeze({
  uploadDir: join(PROJECT_ROOT, "uploads", "mascot-greetings"),
  publicPath: "/uploads/mascot-greetings",
  maxBytes: 5 * 1024 * 1024,
  generatedMaxBytes: 8 * 1024 * 1024,
  fileNamePrefix: "mascot-greeting",
  allowedTypes: Object.freeze({
    "image/webp": { extension: ".webp", extensions: [".webp"], kind: "image" },
    "image/png": { extension: ".png", extensions: [".png"], kind: "image" },
    "image/jpeg": { extension: ".jpg", extensions: [".jpg", ".jpeg", ".jfif"], kind: "image" },
  }),
});

export const MASCOT_GREETING_VIDEO_UPLOAD_POLICY = Object.freeze({
  uploadDir: join(PROJECT_ROOT, "uploads", "mascot-greetings"),
  publicPath: "/uploads/mascot-greetings",
  maxBytes: 30 * 1024 * 1024,
  fileNamePrefix: "mascot-greeting-video",
  allowedTypes: Object.freeze({
    "video/mp4": { extension: ".mp4", extensions: [".mp4"], kind: "video" },
  }),
});

export const CHAT_ATTACHMENT_UPLOAD_POLICY = Object.freeze({
  uploadDir: join(PROJECT_ROOT, "uploads", "chat"),
  publicPath: "/uploads/chat",
  maxBytes: 20 * 1024 * 1024,
  fileNamePrefix: "chat",
  allowedTypes: Object.freeze({
    "image/jpeg": { extension: ".jpg", extensions: [".jpg", ".jpeg", ".jfif"], kind: "image" },
    "image/png": { extension: ".png", extensions: [".png"], kind: "image" },
    "image/webp": { extension: ".webp", extensions: [".webp"], kind: "image" },
    "image/gif": { extension: ".gif", extensions: [".gif"], kind: "image" },
    "application/pdf": { extension: ".pdf", extensions: [".pdf"], kind: "document" },
    "text/plain": { extension: ".txt", extensions: [".txt"], kind: "document" },
  }),
});

export const CHAT_IMAGE_UPLOAD_POLICY = Object.freeze({
  uploadDir: join(PROJECT_ROOT, "uploads", "chat-images"),
  publicPath: "/uploads/chat-images",
  maxBytes: 5 * 1024 * 1024,
  fileNamePrefix: "chat-image",
  allowedTypes: Object.freeze({
    "image/webp": { extension: ".webp", extensions: [".webp"], kind: "image" },
  }),
});

export const CHAT_VOICE_UPLOAD_POLICY = Object.freeze({
  uploadDir: join(PROJECT_ROOT, "uploads", "voice"),
  publicPath: "/uploads/voice",
  maxBytes: 10 * 1024 * 1024,
  maxDurationSeconds: 120,
  fileNamePrefix: "voice",
  allowedTypes: Object.freeze({
    "audio/webm": { extension: ".webm", extensions: [".webm"], kind: "voice" },
    "audio/ogg": { extension: ".ogg", extensions: [".ogg"], kind: "voice" },
    "audio/mp4": { extension: ".m4a", extensions: [".m4a", ".mp4"], kind: "voice", mimeType: "audio/mp4" },
    "audio/x-m4a": { extension: ".m4a", extensions: [".m4a", ".mp4"], kind: "voice", mimeType: "audio/mp4" },
    "video/mp4": { extension: ".m4a", extensions: [".m4a", ".mp4"], kind: "voice", mimeType: "audio/mp4" },
    "audio/mpeg": { extension: ".mp3", extensions: [".mp3"], kind: "voice" },
    "audio/wav": { extension: ".wav", extensions: [".wav"], kind: "voice" },
    "audio/x-wav": { extension: ".wav", extensions: [".wav"], kind: "voice" },
  }),
});
