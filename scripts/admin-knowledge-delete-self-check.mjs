import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { createKnowledgeBaseFromAi, deleteAdminKnowledgeBase } from "../server/admin-knowledge-service.js";

const knowledgeBaseId = `kb_delete_self_check_${Date.now()}`;
const bindingId = `kb_bind_self_check_${Date.now()}`;

await initializeDatabase();
try {
  await createKnowledgeBaseFromAi({
    id: knowledgeBaseId,
    label: "Delete Self-check Knowledge",
    category: "football",
    priority: 40,
    keywords: "删除测试",
    sourceText: "这是一条用于删除测试的知识库内容，长度超过二十个字，方便验证绑定和片段会一起删除。",
  }, {
    ai: async () => ({
      summary: "Delete self-check summary",
      sections: [{
        title: "删除测试片段",
        summary: "验证删除会清理片段。",
        content: "这是一条用于删除测试的知识库内容，长度超过二十个字，方便验证绑定和片段会一起删除。",
        exactKeywords: ["删除测试"],
        fuzzyKeywords: [],
        order: 10,
      }],
    }),
  });

  await getDbPool().execute(
    "INSERT INTO knowledge_base_bindings (id, knowledge_base_id, target_type, target_id, binding_status) VALUES (?, ?, ?, ?, ?)",
    [bindingId, knowledgeBaseId, "mascot", "mascot_template", "active"]
  );

  const result = await deleteAdminKnowledgeBase(knowledgeBaseId);
  assert.equal(result.ok, true, "delete result should be ok");
  assert.equal(result.deletedId, knowledgeBaseId, "deleted id should match");

  const [[baseCount]] = await getDbPool().execute("SELECT COUNT(*) AS count FROM knowledge_bases WHERE id = ?", [knowledgeBaseId]);
  const [[sectionCount]] = await getDbPool().execute("SELECT COUNT(*) AS count FROM knowledge_sections WHERE knowledge_base_id = ?", [knowledgeBaseId]);
  const [[bindingCount]] = await getDbPool().execute("SELECT COUNT(*) AS count FROM knowledge_base_bindings WHERE knowledge_base_id = ?", [knowledgeBaseId]);

  assert.equal(Number(baseCount.count), 0, "knowledge base should be deleted");
  assert.equal(Number(sectionCount.count), 0, "knowledge sections should be deleted");
  assert.equal(Number(bindingCount.count), 0, "knowledge bindings should be deleted");

  console.log("admin knowledge delete self-check passed");
} finally {
  await getDbPool().execute("DELETE FROM knowledge_base_bindings WHERE knowledge_base_id = ? OR id = ?", [knowledgeBaseId, bindingId]).catch(() => {});
  await getDbPool().execute("DELETE FROM knowledge_bases WHERE id = ?", [knowledgeBaseId]).catch(() => {});
  await closeDbPool();
}
