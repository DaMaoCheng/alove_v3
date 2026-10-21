export const AVATAR_UPLOAD_POLICY = Object.freeze({
  accept: ".jpg,.jpeg,.jfif,.png,.webp",
  allowedImageTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
  maxSourceBytes: 12 * 1024 * 1024,
  cropBoxSize: 280,
  outputSize: 512,
  outputType: "image/webp",
  outputExtension: ".webp",
  outputQuality: 0.86,
});

export const CAROUSEL_UPLOAD_POLICY = Object.freeze({
  accept: ".jpg,.jpeg,.jfif,.png,.webp",
  allowedImageTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
  maxSourceBytes: 12 * 1024 * 1024,
  cropStageWidth: 420,
  cropStageHeight: 236,
  outputWidth: 1600,
  outputHeight: 900,
  outputType: "image/webp",
  outputExtension: ".webp",
  outputQuality: 0.86,
});

export const CHAT_ATTACHMENT_UPLOAD_POLICY = Object.freeze({
  accept: [
    ".jpg",
    ".jpeg",
    ".jfif",
    ".png",
    ".webp",
    ".gif",
    ".pdf",
    ".txt",
  ].join(","),
  maxBytes: 20 * 1024 * 1024,
  imageTypes: Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  documentTypes: Object.freeze([
    "application/pdf",
    "text/plain",
  ]),
  imageCompression: Object.freeze({
    maxSide: 1600,
    outputType: "image/webp",
    outputExtension: ".webp",
    outputQuality: 0.84,
  }),
});
