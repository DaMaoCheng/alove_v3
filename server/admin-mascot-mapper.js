export function mapMascotSiteRow(row, template) {
  const override = mapMascotSetting({
    id: row.mascot_setting_id,
    character_id: row.mascot_setting_character_id,
    name: row.mascot_setting_name,
    avatar_url: row.mascot_setting_avatar_url,
    tone: row.mascot_setting_tone,
    greeting: row.mascot_setting_greeting,
    cta: row.mascot_setting_cta,
    knowledge_json: row.mascot_setting_knowledge_json,
    source_type: row.mascot_setting_source_type,
    source_ref: row.mascot_setting_source_ref,
    character_name: row.character_name,
    character_avatar_url: row.character_avatar_url,
    character_opening_line: row.character_opening_line,
    character_persona_prompt: row.character_persona_prompt,
    character_speaking_style: row.character_speaking_style,
  }, { source: `${row.name || "站点"}覆盖` });

  const mascot = override || {
    id: row.mascot_character_id || template.id,
    settingId: "",
    name: row.character_name || template.name,
    avatarUrl: row.character_avatar_url || template.avatarUrl,
    personaPrompt: row.character_persona_prompt || "",
    speakingStyle: row.character_speaking_style || "",
    tone: row.mascot_character_id && row.mascot_character_id !== template.id
      ? (row.character_speaking_style || row.character_persona_prompt || "")
      : template.tone,
    greeting: row.mascot_character_id && row.mascot_character_id !== template.id
      ? (row.character_opening_line || "")
      : template.greeting,
    cta: row.mascot_character_id && row.mascot_character_id !== template.id ? "" : template.cta,
    knowledge: row.mascot_character_id && row.mascot_character_id !== template.id ? [] : template.knowledge,
    source: row.mascot_character_id && row.mascot_character_id !== template.id ? `${row.name || "站点"}绑定` : "通用模板",
  };

  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    defaultLanguage: row.default_language || "",
    status: row.site_status || "active",
    isDefault: Boolean(row.is_default),
    mascotCharacterId: row.mascot_character_id || "",
    productApiUrl: row.product_api_url || "",
    description: row.description || "",
    userCount: Number(row.user_count || 0),
    sentAdCount: Number(row.sent_ad_count || 0),
    mascot,
  };
}

export function mapMascotSetting(row, { source } = {}) {
  if (!row?.id && !row?.character_id) return null;
  return {
    id: row.character_id || row.id || "",
    settingId: row.id || "",
    name: row.name || row.character_name || "",
    avatarUrl: row.avatar_url || row.character_avatar_url || "",
    personaPrompt: row.character_persona_prompt || "",
    speakingStyle: row.character_speaking_style || "",
    tone: row.tone || "",
    greeting: row.greeting || "",
    cta: row.cta || "",
    knowledge: parseJsonArray(row.knowledge_json),
    source: source || "通用模板",
  };
}

export function mapUnboundMascotRow(row) {
  return {
    id: row.id || "",
    settingId: "",
    name: row.name || "",
    avatarUrl: row.avatar_url || "",
    personaPrompt: row.persona_prompt || "",
    speakingStyle: row.speaking_style || "",
    tone: row.speaking_style || row.persona_prompt || "",
    greeting: row.opening_line || "",
    cta: "",
    knowledge: [],
    source: "未绑定",
  };
}

export function defaultTemplateMascot() {
  return {
    id: "mascot_template",
    settingId: "",
    name: "Kit",
    avatarUrl: "assets/char_coach.png",
    personaPrompt: "",
    speakingStyle: "友好、热情、热爱足球",
    tone: "友好、热情、热爱足球",
    greeting: "Hey! I am Kit, your personal football guide. Ready to explore?",
    cta: "Check out our jersey drops!",
    knowledge: ["How to chat with AI characters", "How to earn points", "General football trivia", "Site-wide promotions"],
    source: "通用模板",
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
