import { createKnowledgeBaseFromAi, deleteAdminKnowledgeBase, getAdminKnowledgeBase, listAdminKnowledgeBases, updateAdminKnowledgeBase } from "./admin-knowledge-service.js";
import { knowledgeBaseLogSnapshot, recordAdminOperationLog } from "./admin-operation-log-service.js";
import { buildRequestLogContext } from "./app-error-log-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminKnowledgeRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/knowledge-bases") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminKnowledgeBases());
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/knowledge-bases") {
    const admin = await requireAdmin(req, ADMIN_SCOPES.KNOWLEDGE_WRITE);
    const result = await createKnowledgeBaseFromAi(await readJson(req, 256 * 1024));
    await recordKnowledgeOperationLog({
      admin,
      req,
      requestUrl,
      action: "knowledge_create",
      after: result.item,
      summary: `新建知识库：${result.item?.label || result.item?.id || ""}`,
    });
    sendJson(res, 201, result);
    return true;
  }
  const knowledgeBaseMatch = path.match(/^\/api\/admin\/knowledge-bases\/([^/]+)$/);
  if (req.method === "GET" && knowledgeBaseMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await getAdminKnowledgeBase(decodeURIComponent(knowledgeBaseMatch[1])));
    return true;
  }
  if (req.method === "PATCH" && knowledgeBaseMatch) {
    const admin = await requireAdmin(req, ADMIN_SCOPES.KNOWLEDGE_WRITE);
    const knowledgeBaseId = decodeURIComponent(knowledgeBaseMatch[1]);
    const before = (await getAdminKnowledgeBase(knowledgeBaseId)).item;
    const result = await updateAdminKnowledgeBase(knowledgeBaseId, await readJson(req, 256 * 1024));
    await recordKnowledgeOperationLog({
      admin,
      req,
      requestUrl,
      action: "knowledge_update",
      before,
      after: result.item,
      summary: `编辑知识库：${result.item?.label || knowledgeBaseId}`,
    });
    sendJson(res, 200, result);
    return true;
  }
  if (req.method === "DELETE" && knowledgeBaseMatch) {
    const admin = await requireAdmin(req, ADMIN_SCOPES.KNOWLEDGE_WRITE);
    const knowledgeBaseId = decodeURIComponent(knowledgeBaseMatch[1]);
    const before = (await getAdminKnowledgeBase(knowledgeBaseId)).item;
    const result = await deleteAdminKnowledgeBase(knowledgeBaseId);
    await recordKnowledgeOperationLog({
      admin,
      req,
      requestUrl,
      action: "knowledge_delete",
      before,
      after: null,
      summary: `删除知识库并清理绑定：${before?.label || knowledgeBaseId}`,
    });
    sendJson(res, 200, result);
    return true;
  }
  return false;
}

async function recordKnowledgeOperationLog({ admin, req, requestUrl, action, before = null, after = null, summary = "" }) {
  const target = after || before || {};
  await recordAdminOperationLog({
    admin,
    request: buildRequestLogContext(req, requestUrl),
    action,
    targetType: "knowledge_base",
    targetId: target.id || "",
    targetLabel: target.label || "",
    summary,
    before: knowledgeBaseLogSnapshot(before),
    after: knowledgeBaseLogSnapshot(after),
  });
}
