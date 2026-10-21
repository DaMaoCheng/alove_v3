import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { knowledgeBaseLogSnapshot, recordAdminOperationLog } from "../server/admin-operation-log-service.js";

const logId = `admin_op_self_check_${Date.now()}`;

await initializeDatabase();
try {
  await recordAdminOperationLog({
    id: logId,
    admin: {
      id: "admin_self_check",
      email: "admin@example.com",
      nickname: "Admin Check",
    },
    request: {
      method: "PATCH",
      endpoint: "/api/admin/knowledge-bases/kb_self_check",
      requestId: "req-self-check",
      userAgent: "self-check-agent",
      clientIp: "127.0.0.1",
    },
    action: "knowledge_update",
    targetType: "knowledge_base",
    targetId: "kb_self_check",
    targetLabel: "Self-check KB",
    summary: "Self-check admin operation log",
    before: knowledgeBaseLogSnapshot({
      id: "kb_self_check",
      label: "Before KB",
      category: "football",
      priority: 40,
      bindingCount: 1,
      sections: [{ content: "before content" }],
      keywords: ["before"],
    }),
    after: knowledgeBaseLogSnapshot({
      id: "kb_self_check",
      label: "After KB",
      category: "customer_service",
      priority: 80,
      bindingCount: 1,
      sections: [{ content: "after content" }],
      keywords: ["after"],
    }),
  });

  const [[row]] = await getDbPool().execute(
    "SELECT * FROM admin_operation_logs WHERE id = ? LIMIT 1",
    [logId]
  );

  assert.ok(row, "operation log row should exist");
  assert.equal(row.admin_user_id, "admin_self_check", "admin user id should be saved");
  assert.equal(row.admin_email, "admin@example.com", "admin email should be saved");
  assert.equal(row.admin_name, "Admin Check", "admin display name should be saved");
  assert.equal(row.action, "knowledge_update", "action should be saved");
  assert.equal(row.target_type, "knowledge_base", "target type should be saved");
  assert.equal(row.target_id, "kb_self_check", "target id should be saved");
  assert.equal(row.target_label, "Self-check KB", "target label should be saved");
  assert.equal(row.request_method, "PATCH", "request method should be saved");
  assert.equal(row.endpoint, "/api/admin/knowledge-bases/kb_self_check", "endpoint should be saved");
  assert.equal(row.request_id, "req-self-check", "request id should be saved");
  assert.equal(row.user_agent, "self-check-agent", "user agent should be saved");
  assert.equal(row.client_ip, "127.0.0.1", "client ip should be saved");

  const before = typeof row.before_json === "string" ? JSON.parse(row.before_json) : row.before_json;
  const after = typeof row.after_json === "string" ? JSON.parse(row.after_json) : row.after_json;
  assert.equal(before.label, "Before KB", "before snapshot should be saved");
  assert.equal(after.label, "After KB", "after snapshot should be saved");
  assert.equal(after.contentChars, "after content".length, "snapshot should store content char count, not full audit prose");

  console.log("admin operation log self-check passed");
} finally {
  await getDbPool().execute("DELETE FROM admin_operation_logs WHERE id = ?", [logId]).catch(() => {});
  await closeDbPool();
}
