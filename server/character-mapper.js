export function mapCharacterRow(row, { includeSettings = false } = {}) {
  const tags = parseJsonValue(row.tags_json, []);
  const profile = parseJsonValue(row.profile_json, {});
  const metrics = parseJsonValue(row.metrics_json, {});
  const userMessageCount = Number(row.user_message_count || 0);
  const activationCount = Number(row.activation_count || 0);

  const character = {
    id: row.id,
    slug: row.slug,
    ownerUid: row.owner_uid || "",
    ownerNickname: row.owner_nickname || "",
    ownerEmail: row.owner_email || "",
    siteId: row.site_id || "",
    siteName: row.site_name || "",
    name: row.name,
    roleTitle: row.role_title || "",
    shortBio: row.short_bio || "",
    avatarUrl: row.avatar_url || "",
    coverUrl: row.cover_url || "",
    cardTag: row.card_tag || "",
    cardTagText: row.card_tag_text || "",
    openingLine: row.opening_line || "",
    voiceProvider: row.voice_provider || "",
    voiceId: row.voice_id || "",
    voiceStyle: row.voice_style || "",
    voiceSampleUrl: row.voice_sample_url || "",
    tags,
    profile,
    language: profile.language || "",
    languageCode: profile.defaultLanguageCode || profile.languageCode || "",
    languageLabel: profile.defaultLanguageLabel || profile.languageLabel || profile.language || "",
    metrics: {
      ...metrics,
      userMessageCount,
      activationCount,
      chatCountLabel: formatCountLabel(userMessageCount),
      activationCountLabel: formatCountLabel(activationCount),
    },
    visibility: row.visibility,
    characterStatus: row.character_status,
    sourceType: row.source_type || "",
    sourceRef: row.source_ref || "",
    publishedAt: row.published_at,
    category: {
      id: row.category_id || "",
      label: row.category_label || "",
      avatarUrl: row.category_avatar_url || "",
    },
  };

  if (includeSettings) {
    character.personaPrompt = row.persona_prompt || "";
    character.speakingStyle = row.speaking_style || "";
  }

  return character;
}

function formatCountLabel(value) {
  const count = Math.max(0, Number(value || 0));
  if (count < 1000) return String(count);
  if (count < 10000) return `${trimTrailingZero(count / 1000)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${trimTrailingZero(count / 1000000)}m`;
}

function trimTrailingZero(value) {
  return Number(value.toFixed(1)).toString();
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
