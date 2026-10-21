import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import {
  deleteAdminKnowledgeBase,
  getAdminKnowledgeBase,
  updateAdminKnowledgeBase,
  upsertKnowledgeBaseWithSections,
} from "../server/admin-knowledge-service.js";
import { normalizeManualSections } from "../server/admin-knowledge-normalizers.js";

const TEST_ID = "kb_manual_section_keys_self_check";

await initializeDatabase();

try {
  await cleanup();

  const normalized = normalizeManualSections([
    "## 第一段\n内容 A",
    "---",
    "## 第一段\n内容 B",
    "---",
    "## 第一段\n内容 C",
  ].join("\n\n"), []);
  const keys = normalized.map((section) => section.key);
  assert.equal(new Set(keys).size, keys.length, "manual section keys should be unique");
  assert.ok(!keys.includes("---"), "separator-only chunks should not produce section key ---");

  const existingSections = [
    section("intro", "目录", "目录内容"),
    section("part_a", "第一段", "第一段初始内容"),
    section("part_b", "第二段", "第二段初始内容"),
  ];
  const editorText = existingSections.map((item, index) => `${index + 1}. ${item.title}\n${item.content}\n\n---\n\n内部列表：\n1. 保留为正文\n2. 不拆成新 section`).join("\n\n");
  const editorNormalized = normalizeManualSections(editorText, existingSections);
  assert.equal(editorNormalized.length, existingSections.length, "editor formatted source should preserve existing section boundaries");
  assert.deepEqual(editorNormalized.map((item) => item.key), ["intro", "part_a", "part_b"], "editor formatted source should preserve existing section keys");

  await upsertKnowledgeBaseWithSections({
    id: TEST_ID,
    label: "Manual Section Key Self Check",
    category: "self_check",
    scope: "targeted",
    status: "active",
    language: "中文",
    priority: 1,
    maxSections: 8,
    maxCharsPerSection: 800,
    summary: "Temporary knowledge base for duplicate manual section key regression.",
    keywords: ["manual"],
    fuzzyKeywords: ["section"],
    sourceType: "self_check",
    sourceRef: "admin-knowledge-manual-section-keys-self-check",
    bindings: { characterIds: ["mascot_template"] },
    sections: [
      section("manual_intro", "目录", "目录内容"),
      section("manual_part", "第一段", "初始内容"),
      section("manual_second", "第二段", "第二段初始内容"),
    ],
  });

  await updateAdminKnowledgeBase(TEST_ID, {
    label: "Manual Section Key Self Check",
    category: "self_check",
    priority: 1,
    keywords: "manual",
    fuzzyKeywords: "section",
    scope: "targeted",
    characterIds: ["mascot_template"],
    sections: [
      "## 目录\n1. [第一段](#first)",
      "---",
      "## 第一段\n内容 A",
      "---",
      "## 第一段\n内容 B",
      "---",
      "## 第一段\n内容 C",
    ].join("\n\n"),
  });

  const detail = (await getAdminKnowledgeBase(TEST_ID)).item;
  const savedKeys = detail.sections.map((item) => item.key);
  assert.equal(new Set(savedKeys).size, savedKeys.length, "saved section keys should be unique");
  assert.ok(!savedKeys.includes("---"), "saved section keys should not include separator-only key");
  assert.ok(detail.characterIds.includes("mascot_template"), "targeted binding should survive manual update");

  await updateAdminKnowledgeBase(TEST_ID, {
    label: "Manual Section Key Self Check",
    category: "self_check",
    priority: 1,
    keywords: "manual",
    fuzzyKeywords: "section",
    scope: "targeted",
    characterIds: ["mascot_template"],
    sections: editorText,
  });

  const editorDetail = (await getAdminKnowledgeBase(TEST_ID)).item;
  assert.equal(editorDetail.sections.length, existingSections.length, "saved editor-formatted source should preserve section count");

  console.log("admin knowledge manual section keys self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

function section(key, title, content) {
  return {
    key,
    title,
    summary: content,
    content,
    keywords: ["manual"],
    fuzzyKeywords: ["section"],
    order: 10,
    status: "active",
    sourceHeading: title,
  };
}

async function cleanup() {
  const [rows] = await getDbPool().execute("SELECT id FROM knowledge_bases WHERE id = ? LIMIT 1", [TEST_ID]);
  if (rows.length) await deleteAdminKnowledgeBase(TEST_ID);
}
