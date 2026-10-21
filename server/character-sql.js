export const PUBLIC_CHARACTER_SELECT = `SELECT
  c.id,
  c.slug,
  c.owner_uid,
  c.site_id,
  c.name,
  c.role_title,
  c.short_bio,
  c.avatar_url,
  c.cover_url,
  c.card_tag,
  c.card_tag_text,
  c.opening_line,
  c.localized_content,
  c.voice_style,
  c.tags_json,
  c.profile_json,
  c.metrics_json,
  COALESCE(stats.user_message_count, 0) AS user_message_count,
  COALESCE(activations.activation_count, 0) AS activation_count,
  c.visibility,
  c.character_status,
  c.source_type,
  c.published_at,
  u.nickname AS owner_nickname,
  u.email AS owner_email,
  s.name AS site_name,
  cat.id AS category_id,
  cat.label AS category_label,
  cat.avatar_url AS category_avatar_url
FROM ai_characters c
LEFT JOIN character_categories cat ON cat.id = c.category_id
LEFT JOIN users u ON u.id = c.owner_uid
LEFT JOIN sites s ON s.id = c.site_id
LEFT JOIN (
  SELECT s.character_id, COUNT(*) AS user_message_count
  FROM chat_sessions s
  INNER JOIN chat_messages m ON m.session_id = s.id
  WHERE s.source_type = 'user'
    AND m.sender_type = 'user'
    AND m.delivery_status = 'sent'
  GROUP BY s.character_id
) stats ON stats.character_id = c.id
LEFT JOIN (
  SELECT character_id, COUNT(DISTINCT internal_uid) AS activation_count
  FROM user_character_activations
  WHERE activation_status = 'active'
  GROUP BY character_id
) activations ON activations.character_id = c.id`;

export const FULL_CHARACTER_SELECT = `SELECT
  c.id,
  c.slug,
  c.owner_uid,
  c.site_id,
  c.name,
  c.role_title,
  c.short_bio,
  c.avatar_url,
  c.cover_url,
  c.card_tag,
  c.card_tag_text,
  c.opening_line,
  c.localized_content,
  c.persona_prompt,
  c.speaking_style,
  c.voice_provider,
  c.voice_id,
  c.voice_style,
  c.voice_sample_url,
  c.tags_json,
  c.profile_json,
  c.metrics_json,
  COALESCE(stats.user_message_count, 0) AS user_message_count,
  COALESCE(activations.activation_count, 0) AS activation_count,
  c.visibility,
  c.character_status,
  c.source_type,
  c.source_ref,
  c.published_at,
  u.nickname AS owner_nickname,
  u.email AS owner_email,
  s.name AS site_name,
  cat.id AS category_id,
  cat.label AS category_label,
  cat.avatar_url AS category_avatar_url
FROM ai_characters c
LEFT JOIN character_categories cat ON cat.id = c.category_id
LEFT JOIN users u ON u.id = c.owner_uid
LEFT JOIN sites s ON s.id = c.site_id
LEFT JOIN (
  SELECT s.character_id, COUNT(*) AS user_message_count
  FROM chat_sessions s
  INNER JOIN chat_messages m ON m.session_id = s.id
  WHERE s.source_type = 'user'
    AND m.sender_type = 'user'
    AND m.delivery_status = 'sent'
  GROUP BY s.character_id
) stats ON stats.character_id = c.id
LEFT JOIN (
  SELECT character_id, COUNT(DISTINCT internal_uid) AS activation_count
  FROM user_character_activations
  WHERE activation_status = 'active'
  GROUP BY character_id
) activations ON activations.character_id = c.id`;
