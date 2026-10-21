import { createId } from "./security.js";
import { getDbPool } from "./db.js";

const MAX_SUMMARY_LENGTH = 500;
const MAX_JSON_LENGTH = 8000;

export async function recordAdminOperationLog(payload = {}) {
  try {
    const admin = normalizeAdmin(payload.admin);
    const request = normalizeRequest(payload.request);
    await getDbPool().execute(
      `INSERT INTO admin_operation_logs (
         id, admin_user_id, admin_email, admin_name, action, target_type, target_id,
         target_label, summary, before_json, after_json, request_method, endpoint,
         request_id, user_agent, client_ip
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizeString(payload.id) || createId("admin_op"),
        admin.id,
        admin.email,
        admin.name,
        normalizeString(payload.action).slice(0, 96),
        normalizeString(payload.targetType).slice(0, 64),
        normalizeString(payload.targetId).slice(0, 128) || null,
        normalizeString(payload.targetLabel).slice(0, 255) || null,
        normalizeString(payload.summary).slice(0, MAX_SUMMARY_LENGTH) || null,
        safeJson(payload.before),
        safeJson(payload.after),
        normalizeString(request.method).slice(0, 16) || null,
        normalizeString(request.endpoint).slice(0, 255) || null,
        normalizeString(request.requestId).slice(0, 128) || null,
        normalizeString(request.userAgent).slice(0, 500) || null,
        normalizeString(request.clientIp).slice(0, 64) || null,
      ]
    );
  } catch (error) {
    console.warn("[aiove] admin operation log write failed:", error.message);
  }
}

export function knowledgeBaseLogSnapshot(item = {}) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || "",
    label: item.label || "",
    category: item.category || "",
    priority: Number(item.priority || 0),
    status: item.status || "",
    bindingCount: Number(item.bindingCount || 0),
    sectionCount: Number(item.sectionCount || item.sections?.length || 0),
    keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 20) : [],
    fuzzyKeywords: Array.isArray(item.fuzzyKeywords) ? item.fuzzyKeywords.slice(0, 20) : [],
    summaryChars: String(item.summary || "").length,
    contentChars: Number(item.contentChars || totalSectionContentChars(item.sections)),
  };
}

function totalSectionContentChars(sections) {
  return Array.isArray(sections) ? sections.reduce((sum, section) => sum + String(section?.content || "").length, 0) : 0;
}

function normalizeAdmin(admin = {}) {
  const name = normalizeString(admin.nickname || admin.username || admin.name);
  return {
    id: normalizeString(admin.id).slice(0, 64) || null,
    email: normalizeString(admin.email).slice(0, 255) || null,
    name: name.slice(0, 128) || null,
  };
}

function normalizeRequest(request = {}) {
  return request && typeof request === "object" && !Array.isArray(request) ? request : {};
}

function safeJson(value) {
  if (value == null) return null;
  try {
    const json = JSON.stringify(value);
    return json.length > MAX_JSON_LENGTH ? JSON.stringify({ truncated: true, preview: json.slice(0, MAX_JSON_LENGTH) }) : json;
  } catch {
    return JSON.stringify({ unavailable: true });
  }
}

function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}
