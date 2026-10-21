import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminKnowledgeBases() {
  return requestJson(API_ENDPOINTS.admin.knowledgeBases).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function getAdminKnowledgeBase(knowledgeBaseId) {
  return requestJson(`${API_ENDPOINTS.admin.knowledgeBases}/${encodeURIComponent(String(knowledgeBaseId || "").trim())}`).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function createAdminKnowledgeBase(payload) {
  return requestJson(API_ENDPOINTS.admin.knowledgeBases, {
    method: "POST",
    body: payload || {},
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function updateAdminKnowledgeBase(knowledgeBaseId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.knowledgeBases}/${encodeURIComponent(String(knowledgeBaseId || "").trim())}`, {
    method: "PATCH",
    body: payload || {},
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function deleteAdminKnowledgeBase(knowledgeBaseId) {
  return requestJson(`${API_ENDPOINTS.admin.knowledgeBases}/${encodeURIComponent(String(knowledgeBaseId || "").trim())}`, {
    method: "DELETE",
  });
}
