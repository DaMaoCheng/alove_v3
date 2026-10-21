import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listCharacters({ category = "", siteSlug = "" } = {}) {
  const query = new URLSearchParams();
  if (category) {
    query.set("category", category);
  }
  if (siteSlug) {
    query.set("siteSlug", siteSlug);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(`${API_ENDPOINTS.characters.list}${suffix}`).then((result) => ({
    ...result,
    characters: Array.isArray(result.characters) ? result.characters : result.items || [],
  }));
}

export function getCharacterDetail(characterId, { siteSlug = "" } = {}) {
  const query = new URLSearchParams();
  if (siteSlug) query.set("siteSlug", siteSlug);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(`${buildCharacterDetailPath(characterId)}${suffix}`).then((result) => ({
    ...result,
    character: result.character || result.item || null,
  }));
}

export function createCharacter(payload) {
  return requestJson(API_ENDPOINTS.characters.list, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    character: result.character || result.item || null,
  }));
}

export function activateCharacter(characterId) {
  return requestJson(`${buildCharacterDetailPath(characterId)}/activate`, {
    method: "POST",
  });
}

export function polishCharacterBackstory(payload) {
  return requestJson(API_ENDPOINTS.characters.polish, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    text: result.text || "",
  }));
}

export function generateCharacterAvatar(payload) {
  return requestJson(API_ENDPOINTS.characters.generateAvatar, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    avatarUrl: result.avatarUrl || "",
  }));
}

export function buildCharacterDetailPath(characterId) {
  return `${API_ENDPOINTS.characters.detail}/${encodeURIComponent(String(characterId || "").trim())}`;
}
