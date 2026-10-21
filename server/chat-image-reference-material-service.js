import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import sharp from "sharp";
import { PROJECT_ROOT } from "./config.js";
import { assertSafeProductSourceFetchUrl } from "./product-source-http-service.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY, CHAT_IMAGE_UPLOAD_POLICY, AVATAR_UPLOAD_POLICY } from "./upload-policies.js";
import { normalizeContentType, validateUploadForPolicy } from "./upload-security.js";
import { extractFileName } from "./protected-upload-url-service.js";

const MAX_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
const REFERENCE_IMAGE_MAX_EDGE = 1024;
const REFERENCE_IMAGE_ALLOWED_TYPES = Object.freeze({
  "image/jpeg": { extension: ".jpg", extensions: [".jpg", ".jpeg", ".jfif"], kind: "image" },
  "image/png": { extension: ".png", extensions: [".png"], kind: "image" },
  "image/webp": { extension: ".webp", extensions: [".webp"], kind: "image" },
});

export async function collectChatImageReferenceImages(context = {}) {
  const candidates = buildReferenceCandidates(context);
  const requiredProduct = context.imageRequestConstraints?.productReferenceRequired === true
    || context.imageRequestConstraints?.usesProductReference === true;
  if (requiredProduct && !candidates.some((candidate) => candidate.kind === "product")) {
    throw requiredProductError("is missing");
  }
  const images = [];
  const failures = [];

  for (const candidate of candidates) {
    try {
      const image = await loadReferenceImage(candidate);
      if (image) images.push(image);
    } catch (error) {
      failures.push(`${candidate.kind}: ${error.message || "failed"}`);
    }
  }

  if (requiredProduct && !images.some((image) => image.kind === "product")) {
    throw requiredProductError(`could not be loaded: ${failures.filter((failure) => failure.startsWith("product:")).join("; ") || "no usable product image"}`);
  }

  if (!images.length && candidates.length) {
    throw new Error(`图片素材读取失败：${failures.join("; ") || "no usable image reference"}`);
  }

  return images;
}

function buildReferenceCandidates(context = {}) {
  const rows = [
    {
      kind: "character",
      url: context.character?.avatarUrl || context.character?.avatar_url || "",
      filename: "character-reference.png",
    },
    {
      kind: "product",
      url: context.imageRequestConstraints?.usesProductReference
        ? (context.latestProduct?.imageUrl || context.latestProduct?.imageUrls?.[0] || "")
        : "",
      filename: "product-reference.png",
    },
    {
      kind: "user",
      url: context.imageRequestConstraints?.usesUserImageReference
        ? (context.latestUserImage?.imageUrl || "")
        : "",
      filename: "user-reference.png",
    },
  ];
  const seen = new Set();
  return rows
    .map((row) => ({ ...row, url: String(row.url || "").trim() }))
    .filter((row) => {
      const key = `${row.kind}:${row.url}`;
      if (!row.url || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function requiredProductError(reason) {
  const error = new Error(`Required product reference ${reason}`);
  error.retryable = false;
  return error;
}

async function loadReferenceImage(candidate) {
  const loaded = isRemoteUrl(candidate.url)
    ? await fetchRemoteReferenceImage(candidate)
    : await readLocalReferenceImage(candidate);
  if (!loaded?.buffer?.length) return null;
  return normalizeReferenceImage({
    ...candidate,
    ...loaded,
  });
}

async function readLocalReferenceImage(candidate) {
  const mapped = resolveLocalReferencePath(candidate.url);
  if (!mapped) throw new Error("unsupported local image path");
  const buffer = await readFile(mapped.filePath);
  return {
    buffer,
    contentType: mapped.contentType,
    uploadFilename: mapped.uploadFilename,
  };
}

async function fetchRemoteReferenceImage(candidate) {
  await assertSafeProductSourceFetchUrl(candidate.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(candidate.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_REFERENCE_IMAGE_BYTES) throw new Error("image is too large");
    const contentType = normalizeContentType(response.headers.get("content-type") || inferContentTypeFromPath(candidate.url));
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) throw new Error("image is too large");
    return {
      buffer,
      contentType,
      uploadFilename: extractFileNameFromUrl(candidate.url) || `${candidate.kind}${extensionForContentType(contentType)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function normalizeReferenceImage({ kind, buffer, contentType, uploadFilename, filename }) {
  const normalizedType = normalizeContentType(contentType || inferContentTypeFromPath(uploadFilename));
  validateUploadForPolicy({
    buffer,
    contentType: normalizedType,
    uploadFilename: uploadFilename || `${kind}${extensionForContentType(normalizedType)}`,
    allowedTypes: REFERENCE_IMAGE_ALLOWED_TYPES,
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
    emptyMessage: "图片素材不能为空",
    tooLargeMessage: "图片素材过大",
    unsupportedMessage: "图片素材格式不支持",
  });

  const output = await sharp(buffer)
    .rotate()
    .resize(REFERENCE_IMAGE_MAX_EDGE, REFERENCE_IMAGE_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  return {
    kind,
    buffer: output,
    contentType: "image/png",
    filename: filename || `${kind}-reference.png`,
  };
}

function resolveLocalReferencePath(value = "") {
  const url = String(value || "").split("?")[0].split("#")[0];
  const routes = [
    { prefixes: ["/api/uploads/chat/", "/uploads/chat/"], dir: CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir },
    { prefixes: ["/api/uploads/chat-images/", "/uploads/chat-images/"], dir: CHAT_IMAGE_UPLOAD_POLICY.uploadDir },
    { prefixes: ["/uploads/avatars/"], dir: AVATAR_UPLOAD_POLICY.uploadDir },
    { prefixes: ["/assets/"], dir: join(PROJECT_ROOT, "assets") },
  ];
  for (const route of routes) {
    const prefix = route.prefixes.find((item) => url.startsWith(item));
    if (!prefix) continue;
    const fileName = extractFileName(url);
    if (!fileName) return null;
    const filePath = resolve(route.dir, fileName);
    if (!isWithinDirectory(filePath, route.dir)) return null;
    return {
      filePath,
      uploadFilename: fileName,
      contentType: inferContentTypeFromPath(fileName),
    };
  }
  return null;
}

function isWithinDirectory(filePath = "", directory = "") {
  const normalizedFile = resolve(filePath);
  const normalizedDir = resolve(directory);
  return normalizedFile === normalizedDir || normalizedFile.startsWith(`${normalizedDir}${sep}`);
}

function isRemoteUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function extractFileNameFromUrl(value = "") {
  try {
    return extractFileName(new URL(value).pathname);
  } catch {
    return extractFileName(value);
  }
}

function inferContentTypeFromPath(value = "") {
  const extension = extname(String(value || "").split("?")[0].split("#")[0]).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg" || extension === ".jfif") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "";
}

function extensionForContentType(value = "") {
  const normalized = normalizeContentType(value);
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  return ".png";
}
