import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { deleteAdminKnowledgeBase, getAdminKnowledgeBase, updateAdminKnowledgeBase, upsertKnowledgeBaseWithSections } from "../server/admin-knowledge-service.js";

const TEST_ID = "kb_scope_self_check";

async function main() {
  await initializeDatabase();
  await cleanup();

  await upsertKnowledgeBaseWithSections({
    id: TEST_ID,
    label: "Knowledge Scope Self Check",
    category: "self_check",
    scope: "targeted",
    status: "active",
    language: "中文",
    priority: 1,
    maxSections: 2,
    maxCharsPerSection: 800,
    summary: "Temporary knowledge base used by scope self-check.",
    keywords: ["scope"],
    fuzzyKeywords: ["权限"],
    sourceType: "self_check",
    sourceRef: "knowledge-access-scope-self-check",
    bindings: { characterIds: ["mascot_template"] },
    sections: [section("scope_targeted", "指定对象知识", "指定对象知识内容用于验证 character binding。")],
  });

  let detail = (await getAdminKnowledgeBase(TEST_ID)).item;
  assert(detail.scope === "targeted", "targeted scope should be returned");
  assert(detail.characterIds.includes("mascot_template"), "targeted scope should return character binding");
  assert(!detail.siteIds.length, "targeted scope should not return site bindings");
  assert(detail.bindingCount === 1, "targeted binding count should include active character bindings");

  await getDbPool().execute(
    `INSERT INTO knowledge_base_bindings (id, knowledge_base_id, target_type, target_id, binding_status)
     VALUES ('kb_bind_scope_self_check_legacy_mascot', ?, 'mascot', 'mascot_template', 'active')
     ON DUPLICATE KEY UPDATE binding_status = 'active'`,
    [TEST_ID]
  );
  detail = (await getAdminKnowledgeBase(TEST_ID)).item;
  assert(detail.bindingCount === 1, "legacy mascot bindings should not be counted as active object bindings");
  assert(detail.legacyTargetIds.includes("mascot_template"), "legacy mascot binding should still be visible as legacy data before cleanup");

  await updateAdminKnowledgeBase(TEST_ID, {
    label: "Knowledge Scope Self Check",
    category: "self_check",
    priority: 1,
    keywords: "scope",
    fuzzyKeywords: "权限",
    scope: "targeted",
    characterIds: "mascot_template",
    sections: "指定对象知识保存\n\n用于验证保存时清理 legacy mascot binding。",
  });

  const [legacyRows] = await getDbPool().execute(
    "SELECT id FROM knowledge_base_bindings WHERE knowledge_base_id = ? AND target_type = 'mascot'",
    [TEST_ID]
  );
  assert(!legacyRows.length, "saving knowledge scope should remove legacy mascot bindings");

  await updateAdminKnowledgeBase(TEST_ID, {
    label: "Knowledge Scope Self Check",
    category: "self_check",
    priority: 1,
    keywords: "scope",
    fuzzyKeywords: "权限",
    scope: "site",
    siteIds: "site_gg",
    sections: "站点知识\n\n用于验证 site binding。",
  });

  detail = (await getAdminKnowledgeBase(TEST_ID)).item;
  assert(detail.scope === "site", "site scope should be returned");
  assert(detail.siteIds.includes("site_gg"), "site scope should return site binding");
  assert(!detail.characterIds.length, "site scope should replace old character binding");

  await updateAdminKnowledgeBase(TEST_ID, {
    label: "Knowledge Scope Self Check",
    category: "self_check",
    priority: 1,
    keywords: "scope",
    fuzzyKeywords: "权限",
    sections: "不提交 scope 时保留原绑定。\n\n用于验证旧 PATCH 兼容。",
  });

  detail = (await getAdminKnowledgeBase(TEST_ID)).item;
  assert(detail.scope === "site", "legacy update without scope should preserve current scope");
  assert(detail.siteIds.includes("site_gg"), "legacy update without scope should preserve site binding");

  await updateAdminKnowledgeBase(TEST_ID, {
    label: "Knowledge Scope Self Check",
    category: "self_check",
    priority: 1,
    keywords: "scope",
    fuzzyKeywords: "权限",
    scope: "global",
    sections: "全局知识\n\n用于验证 global scope clears direct bindings。",
  });

  detail = (await getAdminKnowledgeBase(TEST_ID)).item;
  assert(detail.scope === "global", "global scope should be returned");
  assert(!detail.siteIds.length && !detail.characterIds.length, "global scope should clear direct access bindings");

  await cleanup();
  console.log("knowledge access scope self-check passed");
}

function section(key, title, content) {
  return {
    key,
    title,
    summary: content,
    content,
    keywords: ["scope"],
    fuzzyKeywords: ["权限"],
    order: 10,
    status: "active",
    sourceHeading: title,
  };
}

async function cleanup() {
  const [rows] = await getDbPool().execute("SELECT id FROM knowledge_bases WHERE id = ? LIMIT 1", [TEST_ID]);
  if (rows.length) await deleteAdminKnowledgeBase(TEST_ID);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main()
  .catch(async (error) => {
    try {
      await cleanup();
    } catch {}
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
