import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

const AVATAR_COLORS = [
  "#E86F51",
  "#D99A2B",
  "#5B9C6B",
  "#3F8F91",
  "#4D7CC7",
  "#8A63B8",
  "#C35D8A",
  "#6C7A89",
];

export function characterAvatarHtml({ name = "", imageUrl = "", className = "", imageClassName = "", alt = "", placeholder = "" } = {}) {
  const normalizedImage = normalizeAssetUrl(imageUrl);
  const normalizedName = String(name || "AIOVE").trim() || "AIOVE";
  const classes = [className, imageClassName, normalizedImage ? "" : placeholder === "image" ? "avatar-image-placeholder" : "letter-avatar"].filter(Boolean).join(" ");
  if (normalizedImage) {
    return `<img${classes ? ` class="${escapeAttr(classes)}"` : ""} src="${escapeAttr(normalizedImage)}" alt="${escapeAttr(alt)}" />`;
  }
  if (placeholder === "image") {
    const copy = createSiteCopy(globalThis.document?.documentElement?.lang || "English");
    return `<span${classes ? ` class="${escapeAttr(classes)}"` : ""} aria-label="${escapeAttr(copy.t("common.imagePlaceholder"))}">${ICONS.image || ""}</span>`;
  }
  return `<span${classes ? ` class="${escapeAttr(classes)}"` : ""} style="--avatar-bg:${avatarColor(normalizedName)}" aria-label="${escapeAttr(normalizedName)}">${escapeHtml(firstAvatarLetter(normalizedName))}</span>`;
}

export function firstAvatarLetter(name = "") {
  const normalized = String(name || "AIOVE").trim();
  return Array.from(normalized)[0]?.toUpperCase() || "A";
}

export function normalizeAssetUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^(?:https?:)?\/\//i.test(normalized) || normalized.startsWith("data:") || normalized.startsWith("blob:")) return normalized;
  if (normalized.startsWith("/")) return normalized;
  if (normalized.startsWith("assets/") || normalized.startsWith("uploads/")) return `/${normalized}`;
  return normalized;
}

function avatarColor(seed) {
  let hash = 0;
  for (const char of String(seed || "AIOVE")) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
