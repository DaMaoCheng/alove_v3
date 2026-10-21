import { getDbPool } from "./db.js";
import { defaultTemplateMascot, mapMascotSetting, mapMascotSiteRow, mapUnboundMascotRow } from "./admin-mascot-mapper.js";

export async function listAdminMascotSettings() {
  const [templateRows] = await getDbPool().execute(
    `SELECT ms.*, c.name AS character_name, c.avatar_url AS character_avatar_url,
            c.opening_line AS character_opening_line,
            c.persona_prompt AS character_persona_prompt,
            c.speaking_style AS character_speaking_style
     FROM mascot_settings ms
     LEFT JOIN ai_characters c ON c.id = ms.character_id
     WHERE ms.site_id IS NULL
       AND ms.setting_status = 'active'
     ORDER BY ms.updated_at DESC
     LIMIT 1`
  );

  const template = mapMascotSetting(templateRows[0] || null, { source: "通用模板" }) || defaultTemplateMascot();

  const [siteRows] = await getDbPool().execute(
    `SELECT s.*,
            ms.id AS mascot_setting_id,
            ms.character_id AS mascot_setting_character_id,
            ms.name AS mascot_setting_name,
            ms.avatar_url AS mascot_setting_avatar_url,
            ms.tone AS mascot_setting_tone,
            ms.greeting AS mascot_setting_greeting,
            ms.cta AS mascot_setting_cta,
            ms.knowledge_json AS mascot_setting_knowledge_json,
            ms.source_type AS mascot_setting_source_type,
            ms.source_ref AS mascot_setting_source_ref,
            ms.updated_at AS mascot_setting_updated_at,
            c.name AS character_name,
            c.avatar_url AS character_avatar_url,
            c.opening_line AS character_opening_line,
            c.persona_prompt AS character_persona_prompt,
            c.speaking_style AS character_speaking_style,
            COALESCE(users.user_count, 0) AS user_count,
            COALESCE(ads.sent_ad_count, 0) AS sent_ad_count
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     LEFT JOIN ai_characters c ON c.id = COALESCE(ms.character_id, s.mascot_character_id)
     LEFT JOIN (
       SELECT users.site_id, COUNT(DISTINCT sessions.internal_uid) AS user_count
       FROM users
       INNER JOIN sites target_sites
         ON target_sites.id = users.site_id
        AND target_sites.site_status = 'active'
        AND target_sites.mascot_character_id IS NOT NULL
       INNER JOIN chat_sessions sessions
         ON sessions.internal_uid = users.id
        AND sessions.character_id = target_sites.mascot_character_id
        AND sessions.session_status = 'active'
        AND sessions.source_type = 'user'
       INNER JOIN user_character_activations activations
         ON activations.internal_uid = users.id
        AND activations.character_id = sessions.character_id
        AND activations.activation_status = 'active'
       WHERE users.account_status = 'active'
       GROUP BY users.site_id
     ) users ON users.site_id = s.id
     LEFT JOIN (
       SELECT site_id, COUNT(*) AS sent_ad_count
       FROM mascot_ad_deliveries
       WHERE delivery_status IN ('sent', 'completed', 'failed')
         AND sent_count > 0
       GROUP BY site_id
     ) ads ON ads.site_id = s.id
     ORDER BY s.is_default DESC, s.created_at ASC, s.name ASC`
  );

  const [unboundRows] = await getDbPool().execute(
    `SELECT c.*
     FROM ai_characters c
     LEFT JOIN mascot_settings ms ON ms.character_id = c.id AND ms.setting_status = 'active'
     LEFT JOIN sites s ON s.mascot_character_id = c.id
     WHERE c.category_id = 'mascot'
       AND c.id <> 'mascot_template'
       AND c.site_id IS NULL
       AND ms.character_id IS NULL
       AND s.mascot_character_id IS NULL
       AND c.character_status = 'published'
     ORDER BY c.created_at DESC, c.name ASC`
  );

  return {
    ok: true,
    template,
    sites: siteRows.map((row) => mapMascotSiteRow(row, template)),
    unboundMascots: unboundRows.map(mapUnboundMascotRow),
  };
}
