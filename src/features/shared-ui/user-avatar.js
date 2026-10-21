import { normalizeAssetUrl } from "./character-avatar.js";

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

export function userAvatarHtml({ user = {}, name = "", email = "", imageUrl = "", className = "", alt = "" } = {}) {
  const displayName = resolveDisplayName({ user, name, email });
  const normalizedImage = normalizeAssetUrl(imageUrl || user.avatarUrl || "");
  const classes = [className, normalizedImage ? "" : "letter-avatar"].filter(Boolean).join(" ");

  if (normalizedImage) {
    return `<img${classes ? ` class="${escapeAttr(classes)}"` : ""} src="${escapeAttr(normalizedImage)}" alt="${escapeAttr(alt)}" />`;
  }

  return `<span${classes ? ` class="${escapeAttr(classes)}"` : ""} style="--avatar-bg:${avatarColor(displayName)}" aria-label="${escapeAttr(displayName)}">${escapeHtml(firstAvatarLetter(displayName))}</span>`;
}

export function resolveUserDisplayName(user = {}) {
  return resolveDisplayName({ user });
}

function resolveDisplayName({ user = {}, name = "", email = "" } = {}) {
  const nickname = String(name || user.nickname || "").trim();
  if (nickname) return nickname;
  const emailName = String(email || user.email || "").split("@")[0]?.trim();
  return emailName || "AIOVE User";
}

function firstAvatarLetter(name = "") {
  const normalized = String(name || "AIOVE").trim();
  return Array.from(normalized)[0]?.toUpperCase() || "A";
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
