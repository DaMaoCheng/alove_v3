import { getDbPool, withTransaction } from "./db.js";
import { createId } from "./security.js";
import { listAdminMascotSettings } from "./admin-mascot-query-service.js";
import {
  assertSiteCanCreateMascot,
  createSiteMascotId,
  ensureMascotCategory,
  getExistingSite,
  getExistingUnboundMascot,
  normalizeMascotPayload,
  replaceKnowledgeBindings,
  safeString,
  throwUserError,
  upsertMascotCharacter,
} from "./admin-mascot-shared.js";

export async function saveAdminMascotTemplate(payload = {}) {
  const fields = normalizeMascotPayload(payload, { fallbackCharacterId: "mascot_template" });
  await withTransaction(async (db) => {
    await ensureMascotCategory(db);
    await upsertMascotCharacter(db, { ...fields, characterId: fields.characterId, siteId: null });
    await upsertMascotSetting(db, { settingId: "mascot_setting_template", siteId: null, fields, sourceRef: "template-edit" });
    await replaceKnowledgeBindings(db, { targetType: "mascot", targetId: fields.characterId, knowledgeIds: fields.knowledge });
  });
  return listAdminMascotSettings();
}

export async function createAdminMascot(payload = {}) {
  const siteId = safeString(payload.siteId || payload.site_id);
  const site = siteId ? await getExistingSite(siteId) : null;
  const fields = normalizeMascotPayload({ ...payload, characterId: "", character_id: "" }, { fallbackCharacterId: createId("mascot") });
  await withTransaction(async (db) => {
    await ensureMascotCategory(db);
    if (site) await assertSiteCanCreateMascot(db, site.id);
    await upsertMascotCharacter(db, { ...fields, characterId: fields.characterId, siteId: site?.id || null });
    if (site) {
      const settingId = `mascot_setting_${site.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      await upsertMascotSetting(db, { settingId, siteId: site.id, fields, sourceRef: "site-override-create" });
      await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [fields.characterId, site.id]);
    }
    await replaceKnowledgeBindings(db, { targetType: "mascot", targetId: fields.characterId, knowledgeIds: fields.knowledge });
  });
  return listAdminMascotSettings();
}

export async function updateAdminMascot(mascotId, payload = {}) {
  const existing = await getExistingUnboundMascot(mascotId);
  const siteId = safeString(payload.siteId || payload.site_id);
  const site = siteId ? await getExistingSite(siteId) : null;
  const fields = normalizeMascotPayload({ ...payload, characterId: existing.id, character_id: existing.id }, { fallbackCharacterId: existing.id });
  await withTransaction(async (db) => {
    await ensureMascotCategory(db);
    if (site) await assertSiteCanCreateMascot(db, site.id);
    await upsertMascotCharacter(db, { ...fields, characterId: existing.id, siteId: site?.id || null });
    if (site) {
      const settingId = `mascot_setting_${site.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      await upsertMascotSetting(db, { settingId, siteId: site.id, fields: { ...fields, characterId: existing.id }, sourceRef: "unbound-bind" });
      await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [existing.id, site.id]);
    }
    await replaceKnowledgeBindings(db, { targetType: "mascot", targetId: existing.id, knowledgeIds: fields.knowledge });
  });
  return listAdminMascotSettings();
}

export async function saveAdminSiteMascot(siteId, payload = {}) {
  const site = await getExistingSite(siteId);
  const fallbackCharacterId = createSiteMascotId(site);
  const fields = normalizeMascotPayload(payload, { fallbackCharacterId });
  const settingId = `mascot_setting_${site.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  await withTransaction(async (db) => {
    await ensureMascotCategory(db);
    await upsertMascotCharacter(db, { ...fields, characterId: fields.characterId, siteId: site.id });
    await upsertMascotSetting(db, { settingId, siteId: site.id, fields, sourceRef: "site-override-edit" });
    await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [fields.characterId, site.id]);
    await replaceKnowledgeBindings(db, { targetType: "mascot", targetId: fields.characterId, knowledgeIds: fields.knowledge });
  });
  return listAdminMascotSettings();
}

export async function disableAdminSiteMascot(siteId) {
  const site = await getExistingSite(siteId);
  const [settings] = await getDbPool().execute(
    "SELECT id, character_id FROM mascot_settings WHERE site_id = ? AND setting_status = 'active' LIMIT 1",
    [site.id]
  );
  const setting = settings[0];
  if (!setting) throwUserError("该站点当前没有专属前台");
  await withTransaction(async (db) => {
    await db.execute(
      "UPDATE mascot_settings SET setting_status = 'disabled', updated_at = NOW(3) WHERE id = ? LIMIT 1",
      [setting.id]
    );
    if (setting.character_id && setting.character_id !== "mascot_template") {
      await db.execute(
        "UPDATE ai_characters SET character_status = 'archived', updated_at = NOW(3) WHERE id = ? LIMIT 1",
        [setting.character_id]
      );
    }
    await db.execute(
      "UPDATE sites SET mascot_character_id = 'mascot_template', updated_at = NOW(3) WHERE id = ? LIMIT 1",
      [site.id]
    );
  });
  return listAdminMascotSettings();
}

async function upsertMascotSetting(db, { settingId, siteId, fields, sourceRef }) {
  await db.execute(
    `INSERT INTO mascot_settings (
       id, site_id, character_id, name, avatar_url, tone, greeting, cta, knowledge_json, source_type, source_ref
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 'admin', ?)
     ON DUPLICATE KEY UPDATE
       character_id = VALUES(character_id),
       name = VALUES(name),
       avatar_url = VALUES(avatar_url),
       tone = IF(?, VALUES(tone), tone),
       greeting = VALUES(greeting),
       cta = VALUES(cta),
       knowledge_json = VALUES(knowledge_json),
       source_type = VALUES(source_type),
       source_ref = VALUES(source_ref),
       setting_status = 'active',
       updated_at = CURRENT_TIMESTAMP(3)`,
    [
      settingId,
      siteId,
      fields.characterId,
      fields.name,
      fields.avatarUrl,
      fields.tone,
      fields.greeting,
      fields.cta,
      JSON.stringify(fields.knowledge),
      sourceRef,
      fields.hasTone ? 1 : 0,
    ]
  );
}
