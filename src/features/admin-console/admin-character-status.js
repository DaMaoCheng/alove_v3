export const CHARACTER_STATUS_ITEMS = Object.freeze([
  ["published", "已上架"],
  ["archived", "已下架"],
]);

export function normalizeCharacterStatus(value) {
  return value === "archived" ? "archived" : "published";
}

export function isPrivateCharacter(character = {}) {
  return character.visibility === "private";
}

export function canArchiveCharacter(character = {}) {
  return !isPrivateCharacter(character) && normalizeCharacterStatus(character.status || character.characterStatus) !== "archived";
}

export function canPublishCharacter(character = {}) {
  return !isPrivateCharacter(character) && normalizeCharacterStatus(character.status || character.characterStatus) === "archived";
}

export function characterStatusLabel(characterOrStatus = {}) {
  const status = typeof characterOrStatus === "string"
    ? characterOrStatus
    : characterOrStatus.status || characterOrStatus.characterStatus;
  return normalizeCharacterStatus(status) === "archived" ? "已下架" : "已上架";
}

export function characterStatusTone(characterOrStatus = {}) {
  const status = typeof characterOrStatus === "string"
    ? characterOrStatus
    : characterOrStatus.status || characterOrStatus.characterStatus;
  return normalizeCharacterStatus(status) === "archived" ? "off" : "on";
}

export function characterStatusCellHtml(character = {}) {
  if (isPrivateCharacter(character)) return `<span class="muted-dash">-</span>`;
  return `<i class="pill ${characterStatusTone(character)}">${characterStatusLabel(character)}</i>`;
}

export function characterVisibilityLabel(characterOrVisibility = {}) {
  const visibility = typeof characterOrVisibility === "string"
    ? characterOrVisibility
    : characterOrVisibility.visibility;
  return visibility === "private" ? "私密" : "公开";
}

export function characterVisibilityTone(character = {}) {
  if (!isPrivateCharacter(character) && normalizeCharacterStatus(character.status || character.characterStatus) === "archived") {
    return "off";
  }
  return isPrivateCharacter(character) ? "private" : "public";
}

export function editableStatusItems() {
  return CHARACTER_STATUS_ITEMS.map((item) => [...item]);
}
