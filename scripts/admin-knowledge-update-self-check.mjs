import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { createKnowledgeBaseFromAi, updateAdminKnowledgeBase } from "../server/admin-knowledge-service.js";

const knowledgeBaseId = `kb_update_self_check_${Date.now()}`;

await initializeDatabase();
try {
  await createKnowledgeBaseFromAi({
    id: knowledgeBaseId,
    label: "Update Self-check Knowledge",
    category: "football",
    priority: 80,
    keywords: "旧关键词",
    fuzzyKeywords: "旧模糊词",
    sourceText: "第一段旧内容用于创建测试知识库。第二段旧内容用于确认后续更新会替换知识片段。",
  }, {
    ai: async () => ({
      summary: "AI summary should stay after manual edit",
      sections: [{
        title: "旧片段",
        summary: "旧摘要",
        content: "第一段旧内容用于创建测试知识库。第二段旧内容用于确认后续更新会替换知识片段。",
        exactKeywords: ["旧关键词"],
        fuzzyKeywords: ["旧模糊词"],
        order: 10,
      }],
    }),
  });

  const result = await updateAdminKnowledgeBase(knowledgeBaseId, {
    label: "Updated Knowledge Title",
    category: "customer_service",
    priority: 20,
    keywords: "新关键词, 售后",
    fuzzyKeywords: "新模糊词, 退换货",
    sourceText: `第一段新正文，说明售后问题如何处理，确保超过二十个字。

第二段新正文，说明退款和换货的处理步骤，也要被保存成新的片段。`,
  });

  assert.equal(result.ok, true, "update result should be ok");
  assert.equal(result.item.id, knowledgeBaseId, "updated id should match");
  assert.equal(result.item.label, "Updated Knowledge Title", "label should update");
  assert.equal(result.item.category, "customer_service", "category should update");
  assert.equal(result.item.priority, 20, "priority should update");
  assert.equal(result.item.summary, "AI summary should stay after manual edit", "AI summary should remain readonly/preserved");
  assert.deepEqual(result.item.keywords, ["新关键词", "售后"], "exact keywords should update");
  assert.deepEqual(result.item.fuzzyKeywords, ["新模糊词", "退换货"], "fuzzy keywords should update");
  assert.equal(result.item.sections.length, 2, "manual content paragraphs should rebuild sections");
  assert.match(result.item.sections[0].content, /第一段新正文/, "first updated section content should persist");
  assert.match(result.item.sections[1].content, /第二段新正文/, "second updated section content should persist");

  const [sectionRows] = await getDbPool().execute(
    "SELECT title, content FROM knowledge_sections WHERE knowledge_base_id = ? ORDER BY display_order ASC",
    [knowledgeBaseId]
  );
  assert.equal(sectionRows.length, 2, "database should contain rebuilt sections only");
  assert.ok(sectionRows.every((row) => !String(row.content || "").includes("旧内容")), "old section content should be replaced");

  console.log("admin knowledge update self-check passed");
} finally {
  await getDbPool().execute("DELETE FROM knowledge_bases WHERE id = ?", [knowledgeBaseId]).catch(() => {});
  await closeDbPool();
}
