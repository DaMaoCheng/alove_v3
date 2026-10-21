import { activateUserCharacterForDb } from "./character-activation-service.js";

const TEMPLATE_MASCOT_ID = "mascot_template";

export async function activateRegistrationMascotForDb(db, { userId, siteId } = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return { ok: false, activated: false, characterId: "" };

  const characterId = await resolveMascotCharacterIdForSite(db, siteId);
  if (!characterId) return { ok: false, activated: false, characterId: "" };

  const result = await activateUserCharacterForDb(db, {
    userId: normalizedUserId,
    characterId,
    sourceType: "mascot_auto",
    sourceRef: "registration-mascot",
  });

  return {
    ok: true,
    characterId,
    activated: Boolean(result.activated),
    alreadyActivated: Boolean(result.alreadyActivated),
  };
}

async function resolveMascotCharacterIdForSite(db, siteId) {
  const normalizedSiteId = String(siteId || "").trim();
  const candidates = [];
  if (normalizedSiteId) {
    const [siteRows] = await db.execute(
      `SELECT COALESCE(ms.character_id, s.mascot_character_id) AS character_id
       FROM sites s
       LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
       WHERE s.id = ? AND s.site_status = 'active'
       LIMIT 1`,
      [normalizedSiteId]
    );
    const siteMascotId = String(siteRows[0]?.character_id || "").trim();
    if (siteMascotId) candidates.push(siteMascotId);
  }
  candidates.push(TEMPLATE_MASCOT_ID);

  for (const candidate of Array.from(new Set(candidates))) {
    if (await isPublishedMascot(db, candidate)) return candidate;
  }
  return "";
}

async function isPublishedMascot(db, characterId) {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) return false;
  const [rows] = await db.execute(
    `SELECT id
     FROM ai_characters
     WHERE id = ?
       AND category_id = 'mascot'
       AND visibility = 'public'
       AND character_status = 'published'
     LIMIT 1`,
    [normalizedId]
  );
  return Boolean(rows[0]);
}
