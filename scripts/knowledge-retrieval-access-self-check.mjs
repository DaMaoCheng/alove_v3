import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { deleteAdminKnowledgeBase, upsertKnowledgeBaseWithSections } from "../server/admin-knowledge-service.js";
import { retrieveKnowledgeSections } from "../server/knowledge-retrieval-service.js";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const IDS = {
  global: "kb_retrieval_global_self_check",
  site: "kb_retrieval_site_self_check",
  targeted: "kb_retrieval_targeted_self_check",
  inaccessible: "kb_retrieval_inaccessible_self_check",
  legacyMascot: "kb_retrieval_legacy_mascot_self_check",
  genericDelivery: "kb_retrieval_generic_delivery_self_check",
  fkkDelivery: "kb_retrieval_fkk_delivery_self_check",
  ggDelivery: "kb_retrieval_gg_delivery_self_check",
};

// Execute the real access SQL before restricting the result to this test's
// namespace. Existing global policies may legitimately outrank the generic
// fixture; they must not determine this fixture's ranking assertions. Keep ALL
// fixture IDs here, including inaccessible ones, so access leaks still fail.
const fixtureIds = new Set(Object.values(IDS));
const fixtureDb = {
  async execute(sql, params) {
    assert(/FROM knowledge_sections ks\s+INNER JOIN knowledge_bases kb/.test(sql), "fixture reader must only scope the real knowledge access query");
    const [rows, fields] = await getDbPool().execute(sql, params);
    return [rows.filter(row => fixtureIds.has(row.knowledge_base_id)), fields];
  },
};

function retrieveFixtureKnowledgeSections(options) {
  return retrieveKnowledgeSections({ ...options, db: fixtureDb });
}

async function main() {
  await initializeDatabase();
  await cleanup();

  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.global,
    scope: "global",
    keywords: ["alpha-global"],
    title: "Alpha global section",
    content: "alpha-global reference for every character.",
  }));
  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.site,
    scope: "site",
    bindings: { siteIds: ["site_gg"] },
    keywords: ["beta-site"],
    title: "Beta site section",
    content: "beta-site reference for GG site characters.",
  }));
  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.targeted,
    scope: "targeted",
    bindings: { characterIds: ["mascot_template"] },
    keywords: ["gamma-character"],
    title: "Gamma character section",
    content: "gamma-character reference for mascot template.",
  }));
  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.inaccessible,
    scope: "site",
    bindings: { siteIds: ["site_fkk"] },
    keywords: ["delta-private"],
    title: "Delta inaccessible section",
    content: "delta-private should not be visible to site_gg.",
  }));
  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.legacyMascot,
    scope: "targeted",
    keywords: ["epsilon-legacy-mascot"],
    title: "Epsilon legacy mascot section",
    content: "epsilon-legacy-mascot should not be visible through legacy mascot bindings.",
  }));
  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.genericDelivery,
    category: "customer_service",
    scope: "global",
    keywords: ["shipping", "delivery", "refund", "return"],
    title: "Generic delivery fallback",
    content: "generic delivery fallback and generic return guidance.",
  }));
  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.fkkDelivery,
    category: "customer_service",
    scope: "site",
    bindings: { siteIds: ["site_delivery_test_fkk"] },
    keywords: ["shipping", "delivery"],
    title: "FKK Shipping Policy",
    content: "FKK site-specific delivery policy.",
  }));
  await upsertKnowledgeBaseWithSections(basePayload({
    id: IDS.ggDelivery,
    category: "customer_service",
    scope: "site",
    bindings: { siteIds: ["site_delivery_test_gg"] },
    keywords: ["shipping", "delivery"],
    title: "GG Shipping Policy",
    content: "GG site-specific delivery policy.",
  }));
  await getDbPool().execute(
    `INSERT INTO knowledge_base_bindings (id, knowledge_base_id, target_type, target_id, binding_status)
     VALUES ('kb_bind_retrieval_legacy_mascot_self_check', ?, 'mascot', 'mascot_template', 'active')
     ON DUPLICATE KEY UPDATE binding_status = 'active'`,
    [IDS.legacyMascot]
  );

  const character = { id: "mascot_template", site_id: "site_gg", name: "Kit", category_id: "mascot" };
  await expectHit("alpha-global please", character, IDS.global);
  await expectHit("beta-site please", character, IDS.site);
  await expectHit("gamma-character please", character, IDS.targeted);
  await expectNoHit("delta-private please", character, IDS.inaccessible);
  await expectNoHit("epsilon-legacy-mascot please", character, IDS.legacyMascot);
  await expectNoHit("totally unrelated chat", character);
  await expectSiteDeliveryPriority({
    character: { ...character, site_id: "site_delivery_test_fkk" },
    expectedKnowledgeBaseId: IDS.fkkDelivery,
    forbiddenKnowledgeBaseId: IDS.ggDelivery,
    query: "How long do packages take to delivery?",
  });
  await expectSiteDeliveryPriority({
    character: { ...character, site_id: "site_delivery_test_gg" },
    expectedKnowledgeBaseId: IDS.ggDelivery,
    forbiddenKnowledgeBaseId: IDS.fkkDelivery,
  });
  const fallbackDelivery = await retrieveFixtureKnowledgeSections({
    query: "How long is shipping?",
    character: { id: "no_policy_character", site_id: "site_without_delivery_policy" },
    limit: 4,
  });
  assert(fallbackDelivery.items[0]?.knowledgeBaseId === IDS.genericDelivery, "delivery should fall back to generic knowledge when the site has no policy");
  const returns = await retrieveFixtureKnowledgeSections({ query: "I need a refund", character: { ...character, site_id: "site_delivery_test_fkk" }, limit: 4 });
  assert(returns.customerServiceTopic === "returns", "return topic should keep its existing route");
  assert(!returns.items.some((item) => item.knowledgeBaseId === IDS.fkkDelivery), "site shipping policy must not replace return guidance");

  const knowledgeContext = await retrieveFixtureKnowledgeSections({ query: "alpha-global please", character, limit: 2 });
  const prompt = buildChatReplyPrompt({
    character,
    userText: "alpha-global please",
    knowledgeContext,
  });
  assert(prompt.layers.some((layer) => layer.id === "knowledge_context"), "prompt should include knowledge context layer for matched knowledge");

  const noKnowledgePrompt = buildChatReplyPrompt({
    character,
    userText: "totally unrelated chat",
    knowledgeContext: await retrieveFixtureKnowledgeSections({ query: "totally unrelated chat", character, limit: 2 }),
  });
  assert(!noKnowledgePrompt.layers.some((layer) => layer.id === "knowledge_context"), "prompt should omit knowledge context layer without keyword trigger");

  await cleanup();
  console.log("knowledge retrieval access self-check passed");
}

function basePayload({ id, scope, bindings = {}, keywords, title, content, category = "self_check" }) {
  return {
    id,
    label: `Retrieval ${id}`,
    category,
    scope,
    status: "active",
    language: "中文",
    priority: 100,
    maxSections: 2,
    maxCharsPerSection: 800,
    summary: content,
    keywords,
    fuzzyKeywords: keywords,
    sourceType: "self_check",
    sourceRef: "knowledge-retrieval-access-self-check",
    bindings,
    sections: [{
      key: `${id}_section`,
      title,
      summary: content,
      content,
      keywords,
      fuzzyKeywords: keywords,
      order: 10,
      status: "active",
      sourceHeading: title,
    }],
  };
}

async function expectSiteDeliveryPriority({ character, expectedKnowledgeBaseId, forbiddenKnowledgeBaseId, query = "How long is shipping?" }) {
  const result = await retrieveFixtureKnowledgeSections({ query, character, limit: 4 });
  assert(result.customerServiceTopic === "delivery", "shipping question should select the delivery route");
  assert(result.items.length > 0, "shipping question should return a policy reference");
  const knowledgeBaseIds = [...new Set(result.items.map((item) => item.knowledgeBaseId))];
  assert(knowledgeBaseIds.every((id) => id === expectedKnowledgeBaseId), `site policy should be the only delivery source when present: ${knowledgeBaseIds.join(", ")}`);
  assert(!result.items.some((item) => item.knowledgeBaseId === forbiddenKnowledgeBaseId), "another site's policy must never leak into this site");
}

async function expectHit(query, character, expectedKnowledgeBaseId) {
  const result = await retrieveFixtureKnowledgeSections({ query, character, category: "self_check", limit: 4 });
  assert(result.items.some((item) => item.knowledgeBaseId === expectedKnowledgeBaseId), `${query} should hit ${expectedKnowledgeBaseId}`);
}

async function expectNoHit(query, character, forbiddenKnowledgeBaseId = "") {
  const result = await retrieveFixtureKnowledgeSections({ query, character, category: "self_check", limit: 4 });
  if (forbiddenKnowledgeBaseId) {
    assert(!result.items.some((item) => item.knowledgeBaseId === forbiddenKnowledgeBaseId), `${query} should not hit ${forbiddenKnowledgeBaseId}`);
    return;
  }
  assert(!result.items.length, `${query} should not return knowledge without keyword trigger`);
}

async function cleanup() {
  for (const id of Object.values(IDS)) {
    const [rows] = await getDbPool().execute("SELECT id FROM knowledge_bases WHERE id = ? LIMIT 1", [id]);
    if (rows.length) await deleteAdminKnowledgeBase(id);
  }
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
