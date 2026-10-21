import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function getCharacterMessages(characterId) {
  return requestJson(buildCharacterMessagesPath(characterId)).then((result) => ({
    ...result,
    messages: Array.isArray(result.messages) ? result.messages : result.items || [],
  }));
}

export function getChatContacts({ siteSlug = "" } = {}) {
  const query = new URLSearchParams();
  if (siteSlug) query.set("siteSlug", siteSlug);
  const path = `${API_ENDPOINTS.chat.contacts}${query.toString() ? `?${query.toString()}` : ""}`;
  return requestJson(path).then((result) => ({
    ...result,
    contacts: Array.isArray(result.contacts) ? result.contacts : result.items || [],
  }));
}

export function sendCharacterMessage(characterId, { text, attachments = [] }) {
  return requestJson(buildCharacterMessagesPath(characterId), {
    method: "POST",
    body: { text, attachments },
  }).then((result) => ({
    ...result,
    messages: Array.isArray(result.messages) ? result.messages : result.items || [],
  }));
}

export function sendCharacterReply(characterId, { sinceMessageId, productTrigger = "", siteSlug = "" }) {
  return requestJson(`${buildCharacterMessagesPath(characterId)}/reply`, {
    method: "POST",
    body: { sinceMessageId, productTrigger, siteSlug },
  }).then((result) => ({
    ...result,
    messages: Array.isArray(result.messages) ? result.messages : result.items || [],
  }));
}

export function buildCharacterMessagesPath(characterId) {
  return `${API_ENDPOINTS.characters.messages}/${encodeURIComponent(String(characterId || "").trim())}/messages`;
}
