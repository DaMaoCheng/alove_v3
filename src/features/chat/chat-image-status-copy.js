import { createSiteCopy } from "../../i18n/site-copy.js";

const STATUS_KEYS = Object.freeze({
  queued: "chat.imageQueued",
  generating: "chat.imageGenerating",
  ready: "chat.imageReady",
  failed: "chat.imageFailed",
  cancelled: "chat.imageCancelled",
});

export function getChatImageStatusCopy(status = "", language = "") {
  const normalizedStatus = String(status || "queued").trim().toLowerCase();
  const copy = createSiteCopy(language);
  return copy.t(STATUS_KEYS[normalizedStatus] || STATUS_KEYS.queued);
}

export function getChatImageReadyToastCopy(language = "") {
  return createSiteCopy(language).t("chat.imageReadyToast");
}
