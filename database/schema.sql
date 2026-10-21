CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  platform VARCHAR(32) NOT NULL DEFAULT 'web',
  platform_uid VARCHAR(128) NOT NULL,
  locale VARCHAR(8) NOT NULL DEFAULT 'cn',
  username VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(64) NULL,
  avatar_emoji VARCHAR(16) NULL,
  favorite_club VARCHAR(128) NULL,
  email VARCHAR(255) NOT NULL,
  email_verified_at DATETIME(3) NULL,
  email_auth_provider VARCHAR(32) NULL,
  auth_token VARCHAR(128) NULL,
  token_expires_at DATETIME(3) NULL,
  account_status VARCHAR(32) NOT NULL DEFAULT 'active',
  account_status_note VARCHAR(255) NULL,
  account_type VARCHAR(32) NOT NULL DEFAULT 'personal',
  site_id VARCHAR(64) NULL,
  referral_code VARCHAR(64) NULL,
  used_referral_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NULL,
  last_ip VARCHAR(64) NULL,
  last_ip_region VARCHAR(96) NULL,
  last_ip_at DATETIME(3) NULL,
  last_login_user_agent VARCHAR(500) NULL,
  UNIQUE KEY uniq_users_locale_username (locale, username),
  UNIQUE KEY uniq_users_locale_email (locale, email),
  UNIQUE KEY uniq_users_auth_token (auth_token),
  UNIQUE KEY uniq_users_referral_code (referral_code),
  KEY idx_users_login (locale, email),
  KEY idx_users_account_type (account_type),
  KEY idx_users_site (site_id),
  KEY idx_users_status (account_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS character_categories (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  label VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  avatar_url VARCHAR(512) NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  source_type VARCHAR(32) NOT NULL DEFAULT 'system',
  source_ref VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_character_categories_label (label),
  KEY idx_character_categories_active_order (is_active, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sites (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  slug VARCHAR(96) NOT NULL,
  site_url VARCHAR(512) NULL,
  site_logo_url VARCHAR(512) NULL,
  default_language VARCHAR(64) NOT NULL DEFAULT 'English',
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  time_zone VARCHAR(64) NULL,
  site_status VARCHAR(32) NOT NULL DEFAULT 'active',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  mascot_character_id VARCHAR(64) NULL,
  product_api_url VARCHAR(512) NULL,
  product_source_type VARCHAR(32) NULL,
  product_shop_domain VARCHAR(255) NULL,
  product_api_version VARCHAR(32) NULL,
  product_access_token_encrypted TEXT NULL,
  shopify_login_enabled TINYINT(1) NOT NULL DEFAULT 1,
  payment_methods_json JSON NULL,
  guest_chat_enabled TINYINT(1) NOT NULL DEFAULT 0,
  description VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_sites_slug (slug),
  KEY idx_sites_status_default (site_status, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sites (
  id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default,
  mascot_character_id, product_api_url, description
) VALUES
  ('site_gg', 'GG', 'gogoalshop', '', 'English', 'USD', 'UTC', 'active', 1, 'mascot_template', '', 'Default site for general traffic.'),
  ('site_fkk', 'FKK', 'footballkituk', '', 'English', 'USD', 'Europe/London', 'active', 0, 'mascot_template', '', 'UK football site.')
ON DUPLICATE KEY UPDATE
  id = id;

UPDATE sites
SET is_default = 1,
    updated_at = CURRENT_TIMESTAMP(3)
WHERE id = 'site_gg'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT id FROM sites WHERE is_default = 1 LIMIT 1
    ) existing_default_site
  );

CREATE TABLE IF NOT EXISTS geo_regions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  parent_id VARCHAR(64) NULL,
  level VARCHAR(32) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name_zh VARCHAR(128) NOT NULL,
  name_en VARCHAR(128) NOT NULL,
  aliases_json JSON NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_geo_regions_code (code),
  KEY idx_geo_regions_parent_order (parent_id, display_order),
  KEY idx_geo_regions_level_active (level, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_geo_regions (
  site_id VARCHAR(64) NOT NULL,
  region_id VARCHAR(64) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id, region_id),
  UNIQUE KEY uniq_site_geo_region_region (region_id),
  KEY idx_site_geo_regions_site (site_id, priority),
  CONSTRAINT fk_site_geo_regions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_site_geo_regions_region FOREIGN KEY (region_id) REFERENCES geo_regions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO geo_regions (id, parent_id, level, code, name_zh, name_en, aliases_json, display_order)
VALUES
  ('geo_asia', NULL, 'continent', 'AS', '亚洲', 'Asia', JSON_ARRAY('Asia'), 10),
  ('geo_europe', NULL, 'continent', 'EU', '欧洲', 'Europe', JSON_ARRAY('Europe'), 20),
  ('geo_north_america', NULL, 'continent', 'NA', '北美洲', 'North America', JSON_ARRAY('North America'), 30),
  ('geo_latin_america', NULL, 'continent', 'LATAM', '拉美', 'Latin America', JSON_ARRAY('Latam', 'LATAM'), 40),
  ('geo_japan_country', 'geo_asia', 'country', 'JP', '日本', 'Japan', JSON_ARRAY('Japan', '日本'), 101),
  ('geo_china_country', 'geo_asia', 'country', 'CN', '中国', 'China', JSON_ARRAY('China', 'PRC', '中国'), 102),
  ('geo_beijing', 'geo_china_country', 'subdivision', 'CN-BJ', '北京', 'Beijing', JSON_ARRAY('Beijing', 'Peking', '北京市'), 10201),
  ('geo_shanghai', 'geo_china_country', 'subdivision', 'CN-SH', '上海', 'Shanghai', JSON_ARRAY('Shanghai', '上海市'), 10202),
  ('geo_uk_country', 'geo_europe', 'country', 'GB', '英国', 'United Kingdom', JSON_ARRAY('UK', 'Great Britain', 'Britain', 'England', '英国'), 201),
  ('geo_london', 'geo_uk_country', 'subdivision', 'GB-LND', '伦敦', 'London', JSON_ARRAY('London', 'Greater London'), 20101),
  ('geo_germany_country', 'geo_europe', 'country', 'DE', '德国', 'Germany', JSON_ARRAY('Germany', 'Deutschland', '德国'), 202),
  ('geo_france_country', 'geo_europe', 'country', 'FR', '法国', 'France', JSON_ARRAY('France', '法国'), 203),
  ('geo_us_country', 'geo_north_america', 'country', 'US', '美国', 'United States', JSON_ARRAY('USA', 'United States of America', 'America', '美国'), 301),
  ('geo_new_york', 'geo_us_country', 'subdivision', 'US-NY', '纽约', 'New York', JSON_ARRAY('NY', 'New York City', '纽约州', '纽约市'), 30101),
  ('geo_california', 'geo_us_country', 'subdivision', 'US-CA', '加州', 'California', JSON_ARRAY('CA', 'California', '加利福尼亚'), 30102),
  ('geo_brazil_country', 'geo_latin_america', 'country', 'BR', '巴西', 'Brazil', JSON_ARRAY('Brazil', 'Brasil', '巴西'), 401),
  ('geo_mexico_country', 'geo_latin_america', 'country', 'MX', '墨西哥', 'Mexico', JSON_ARRAY('Mexico', 'México', '墨西哥'), 402)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id),
  level = VALUES(level),
  name_zh = VALUES(name_zh),
  name_en = VALUES(name_en),
  aliases_json = VALUES(aliases_json),
  display_order = VALUES(display_order),
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO character_categories (id, label, description, avatar_url, display_order, source_type, source_ref)
VALUES
  ('football_babe', 'Football Babe', 'Football-themed companion characters.', 'assets/char_fan.png', 10, 'system', 'create-character-category'),
  ('creator', 'Creator', 'Creator-backed AI personalities and official hosts.', 'assets/char_striker.png', 20, 'system', 'create-character-category'),
  ('pundit', 'Pundit', 'Analyst-style characters for opinions and match talk.', 'assets/char_pundit.png', 30, 'system', 'create-character-category'),
  ('fan', 'Fan', 'High-energy fan characters and community personas.', 'assets/char_fan.png', 40, 'system', 'create-character-category'),
  ('companion', 'Companion', 'General companion characters for ongoing conversations.', 'assets/char_coach.png', 50, 'system', 'create-character-category'),
  ('mascot', 'Mascot', 'Site mascot characters managed from the mascot console.', 'assets/char_coach.png', 55, 'system', 'mascot-category')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  description = VALUES(description),
  avatar_url = VALUES(avatar_url),
  display_order = VALUES(display_order),
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS ai_characters (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  category_id VARCHAR(64) NULL,
  owner_uid VARCHAR(64) NULL,
  site_id VARCHAR(64) NULL,
  slug VARCHAR(96) NOT NULL,
  name VARCHAR(96) NOT NULL,
  role_title VARCHAR(128) NULL,
  short_bio VARCHAR(255) NULL,
  avatar_url VARCHAR(512) NULL,
  cover_url VARCHAR(512) NULL,
  card_tag VARCHAR(32) NULL,
  card_tag_text VARCHAR(32) NULL,
  opening_line VARCHAR(512) NULL,
  persona_prompt TEXT NULL,
  speaking_style TEXT NULL,
  voice_provider VARCHAR(64) NULL,
  voice_id VARCHAR(128) NULL,
  voice_style VARCHAR(128) NULL,
  voice_sample_url VARCHAR(512) NULL,
  tags_json JSON NULL,
  profile_json JSON NULL,
  metrics_json JSON NULL,
  visibility VARCHAR(32) NOT NULL DEFAULT 'public',
  character_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  active_creator_marker TINYINT GENERATED ALWAYS AS (
    CASE
      WHEN category_id = 'creator' AND character_status <> 'archived' THEN 1
      ELSE NULL
    END
  ) VIRTUAL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(128) NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_ai_characters_slug (slug),
  UNIQUE KEY uniq_ai_characters_active_creator_owner (owner_uid, active_creator_marker),
  KEY idx_ai_characters_category_status (category_id, character_status, visibility),
  KEY idx_ai_characters_owner_status (owner_uid, character_status),
  KEY idx_ai_characters_site (site_id, character_status, visibility),
  KEY idx_ai_characters_source (source_type, source_ref),
  KEY idx_ai_characters_published (visibility, character_status, published_at),
  CONSTRAINT fk_ai_characters_category FOREIGN KEY (category_id) REFERENCES character_categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_characters_owner FOREIGN KEY (owner_uid) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO ai_characters (
  id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
  card_tag, card_tag_text, opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style,
  voice_sample_url, tags_json, profile_json, metrics_json, visibility, character_status,
  source_type, source_ref, published_at
) VALUES
  (
    'striker', 'creator', NULL, NULL, 'leo-marquez', 'Leo Marquez', 'Striker · Legend',
    'Club icon, match-winner, and premium drop host for big matchdays.',
    'assets/char_striker.png', 'assets/banner_hero.png',
    'live', 'Live',
    'Eyy, glad you are back. Ready for match talk and a fresh drop?',
    'Confident football legend with warm matchday energy, premium merch instinct, and fast banter.',
    'Warm, confident, quick with football banter, never stiff or corporate.',
    'system', 'warm_friendly', 'Warm & friendly', NULL,
    JSON_ARRAY('legend', 'matchday', 'drops'),
    JSON_OBJECT('favoriteClub', 'Emerald & Gold FC', 'style', 'Direct, charming, hyped'),
    JSON_OBJECT('chatCountLabel', '128k', 'ratingLabel', '4.9'),
    'public', 'published', 'system', 'demo-seed', NOW(3)
  ),
  (
    'coach', 'companion', NULL, NULL, 'coach-vale', 'Coach Vale', 'Tactician · Mentor',
    'Calm tactical guide who breaks down formations, pressing, and match decisions.',
    'assets/char_coach.png', 'assets/banner_hero.png',
    'gold', 'Pro',
    'Pull up the board and let us read the game together.',
    'Measured football tactician who explains strategy clearly and keeps the conversation calm.',
    'Calm, practical, tactical, with short explanations and clear examples.',
    'system', 'deep_calm', 'Deep & calm', NULL,
    JSON_ARRAY('tactics', 'mentor', 'analysis'),
    JSON_OBJECT('favoriteShape', '4-3-3', 'style', 'Analytical, patient, practical'),
    JSON_OBJECT('chatCountLabel', '74k', 'ratingLabel', '4.9'),
    'public', 'published', 'system', 'demo-seed', NOW(3)
  ),
  (
    'fan', 'creator', NULL, 'site_fkk', 'dani-ultra', 'Dani Ultra', 'Male Superfan · Hype',
    'Male football superfan built for chants, banter, predictions, and live-reaction match chat.',
    'assets/char_fan.png', 'assets/banner_hero.png',
    NULL, NULL,
    'Right then, give me your club and your boldest matchday take.',
    'You are Dani Ultra, a male football superfan host with sharp matchday energy. You are a loud but friendly football supporter who lives for fixtures, derbies, chants, kits, transfers, rival banter, late winners, and post-match arguments. Keep replies short, punchy, playful, and easy to hear as voice. Banter is fine; hate, slurs, harassment, illegal streaming links, betting certainty, and unsafe advice are not.\n\nLanguage guidance: Use English as the configured output language. Do not change output language just because the user''s message is written in another language. Change language only when the user explicitly asks you to reply, speak, or write in a specific language.',
    'Male football superfan voice: punchy, playful, warm, quick with banter, easy to hear aloud, never corporate.',
    'elevenlabs', 'IKne3meq5aSn9XLyUdCD', 'Rook', '/uploads/voice/presets/rook.mp3',
    JSON_ARRAY('fan', 'hype', 'banter'),
    JSON_OBJECT('favoriteRivalry', 'Derby Night', 'style', 'Male football superfan voice: punchy, playful, warm, quick with banter, easy to hear aloud, never corporate.', 'language', 'English', 'languageCode', 'en', 'languageLabel', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English', 'voicePreset', 'rook', 'voiceProvider', 'elevenlabs', 'voiceId', 'IKne3meq5aSn9XLyUdCD'),
    JSON_OBJECT('chatCountLabel', '96k', 'ratingLabel', '4.8'),
    'public', 'published', 'system', 'demo-seed', NOW(3)
  ),
  (
    'pundit', 'pundit', NULL, NULL, 'mara-voss', 'Mara Voss', 'Pundit · Analyst',
    'Sharp-tongued analyst for debates, hot takes, and post-match verdicts.',
    'assets/char_pundit.png', 'assets/char_pundit.png',
    'gold', 'Pro',
    'You want the real verdict or the polite one?',
    'Opinionated pundit voice with sharp analysis, debate instincts, and memorable one-liners.',
    'Sharp, concise, debate-ready, but still fair and grounded.',
    'system', 'husky_cool', 'Husky & cool', NULL,
    JSON_ARRAY('pundit', 'analysis', 'debate'),
    JSON_OBJECT('favoriteTopic', 'Big-game pressure', 'style', 'Sharp, concise, challenging'),
    JSON_OBJECT('chatCountLabel', '61k', 'ratingLabel', '4.9'),
    'public', 'published', 'system', 'demo-seed', NOW(3)
  ),
  (
    'keeper', 'fan', NULL, NULL, 'old-gloves', 'Old Gloves', 'Keeper · Veteran',
    'Veteran goalkeeper persona for classic stories, resilience, and no-nonsense advice.',
    'assets/char_keeper.png', 'assets/char_keeper.png',
    NULL, NULL,
    'You learn more from one bad goal than ten easy wins.',
    'Old-school veteran keeper with grounded advice, dry humor, and locker-room presence.',
    'Grounded, dry, experienced, direct, with old-school locker-room warmth.',
    'system', 'old_school', 'Old-school', NULL,
    JSON_ARRAY('veteran', 'goalkeeper', 'stories'),
    JSON_OBJECT('favoriteMoment', 'Penalty saves', 'style', 'Grounded, dry, experienced'),
    JSON_OBJECT('chatCountLabel', '52k', 'ratingLabel', '4.8'),
    'public', 'published', 'system', 'demo-seed', NOW(3)
  )
ON DUPLICATE KEY UPDATE
  id = id;

CREATE TABLE IF NOT EXISTS home_carousel_items (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  subtitle VARCHAR(500) NULL,
  eyebrow VARCHAR(64) NULL,
  image_url VARCHAR(512) NOT NULL,
  site_id VARCHAR(64) NULL,
  cta_text VARCHAR(64) NULL,
  cta_type VARCHAR(32) NOT NULL DEFAULT 'none',
  cta_target VARCHAR(512) NULL,
  display_order INT NOT NULL DEFAULT 100,
  item_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_home_carousel_site_status_order (site_id, item_status, display_order, starts_at, ends_at),
  KEY idx_home_carousel_status_order (item_status, display_order, starts_at, ends_at),
  KEY idx_home_carousel_source (source_type, source_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO home_carousel_items (
  id, title, subtitle, eyebrow, image_url, cta_text, cta_type, cta_target,
  display_order, item_status, source_type, source_ref
) VALUES (
  'banner_legends_kit',
  'The Legends Kit is here',
  'Chat with Leo and unlock the emerald-and-gold matchday jersey - members get an exclusive code.',
  'This week''s drop',
  'assets/banner_hero.png',
  'Chat & unlock',
  'character',
  'striker',
  10,
  'published',
  'system',
  'demo-seed'
) ON DUPLICATE KEY UPDATE
  id = id;

CREATE TABLE IF NOT EXISTS character_voice_assets (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  character_id VARCHAR(64) NOT NULL,
  asset_type VARCHAR(32) NOT NULL DEFAULT 'message_clip',
  title VARCHAR(128) NULL,
  transcript TEXT NULL,
  duration_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  provider VARCHAR(64) NULL,
  voice_id VARCHAR(128) NULL,
  model VARCHAR(128) NULL,
  language_code VARCHAR(32) NULL,
  language_label VARCHAR(128) NULL,
  audio_url VARCHAR(512) NULL,
  audio_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  character_count INT UNSIGNED NOT NULL DEFAULT 0,
  estimated_credits INT UNSIGNED NOT NULL DEFAULT 0,
  output_format VARCHAR(64) NULL,
  error_message VARCHAR(500) NULL,
  provider_request_id VARCHAR(128) NULL,
  provider_error_raw TEXT NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at DATETIME(3) NULL,
  attempt_token VARCHAR(64) NULL,
  message_id VARCHAR(64) NULL,
  waveform_json JSON NULL,
  asset_status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_type VARCHAR(32) NOT NULL DEFAULT 'system',
  source_ref VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_character_voice_assets_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE CASCADE,
  KEY idx_character_voice_assets_character_status (character_id, asset_status, asset_type),
  KEY idx_character_voice_assets_source (source_type, source_ref),
  KEY idx_character_voice_assets_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO character_voice_assets (
  id, character_id, asset_type, title, transcript, duration_seconds, provider, voice_id,
  audio_url, waveform_json, asset_status, source_type, source_ref
) VALUES
  (
    'voice_striker_intro_1', 'striker', 'message_clip', 'Leo intro',
    'Eyy, glad you are back. Ready for match talk and a fresh drop?',
    7, 'system', 'warm_friendly', NULL,
    JSON_ARRAY(0.22, 0.38, 0.56, 0.41, 0.67),
    'active', 'system', 'demo-chat-seed'
  ),
  (
    'voice_striker_intro_2', 'striker', 'message_clip', 'Leo kit pitch',
    'Haha, top corner, every time. Speaking of, the club just dropped the new Legends kit. Emerald and gold, proper clean. Want a look?',
    9, 'system', 'warm_friendly', NULL,
    JSON_ARRAY(0.19, 0.47, 0.62, 0.51, 0.33),
    'active', 'system', 'demo-chat-seed'
  ),
  (
    'voice_striker_intro_3', 'striker', 'message_clip', 'Leo signoff',
    'That code is just for you. Wear it to the next match and tag me.',
    6, 'system', 'warm_friendly', NULL,
    JSON_ARRAY(0.18, 0.36, 0.44, 0.31, 0.21),
    'active', 'system', 'demo-chat-seed'
  ),
  (
    'voice_coach_intro_1', 'coach', 'message_clip', 'Coach opener',
    'Pull up the board and let us read the game together.',
    6, 'system', 'deep_calm', NULL,
    JSON_ARRAY(0.15, 0.28, 0.31, 0.26, 0.18),
    'active', 'system', 'demo-chat-seed'
  ),
  (
    'voice_fan_intro_1', 'fan', 'message_clip', 'Fan opener',
    'Match starts in minutes. Give me your boldest prediction.',
    5, 'system', 'bright_playful', NULL,
    JSON_ARRAY(0.26, 0.42, 0.58, 0.49, 0.37),
    'active', 'system', 'demo-chat-seed'
  ),
  (
    'voice_pundit_intro_1', 'pundit', 'message_clip', 'Pundit opener',
    'You want the real verdict or the polite one?',
    5, 'system', 'husky_cool', NULL,
    JSON_ARRAY(0.24, 0.34, 0.39, 0.29, 0.17),
    'active', 'system', 'demo-chat-seed'
  ),
  (
    'voice_keeper_intro_1', 'keeper', 'message_clip', 'Keeper opener',
    'You learn more from one bad goal than ten easy wins.',
    6, 'system', 'old_school', NULL,
    JSON_ARRAY(0.12, 0.21, 0.34, 0.23, 0.16),
    'active', 'system', 'demo-chat-seed'
  )
ON DUPLICATE KEY UPDATE
  id = id;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  internal_uid VARCHAR(64) NULL,
  character_id VARCHAR(64) NOT NULL,
  session_title VARCHAR(128) NULL,
  session_status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_type VARCHAR(32) NOT NULL DEFAULT 'system',
  source_ref VARCHAR(128) NULL,
  preferred_language VARCHAR(128) NULL,
  last_message_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_chat_sessions_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_chat_sessions_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE CASCADE,
  KEY idx_chat_sessions_user_updated (internal_uid, updated_at),
  KEY idx_chat_sessions_character_status (character_id, session_status, last_message_at),
  KEY idx_chat_sessions_source (source_type, source_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO chat_sessions (
  id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
) VALUES
  ('demo_session_striker', NULL, 'striker', 'Leo Marquez demo conversation', 'active', 'system', 'demo-chat-seed', NULL, NOW(3)),
  ('demo_session_coach', NULL, 'coach', 'Coach Vale demo conversation', 'active', 'system', 'demo-chat-seed', NULL, NOW(3)),
  ('demo_session_fan', NULL, 'fan', 'Dani Ultra demo conversation', 'active', 'system', 'demo-chat-seed', NULL, NOW(3)),
  ('demo_session_pundit', NULL, 'pundit', 'Mara Voss demo conversation', 'active', 'system', 'demo-chat-seed', NULL, NOW(3)),
  ('demo_session_keeper', NULL, 'keeper', 'Old Gloves demo conversation', 'active', 'system', 'demo-chat-seed', NULL, NOW(3))
ON DUPLICATE KEY UPDATE
  id = id;

CREATE TABLE IF NOT EXISTS user_character_activations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  internal_uid VARCHAR(64) NULL,
  guest_session_id VARCHAR(64) NULL,
  character_id VARCHAR(64) NOT NULL,
  activation_status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_type VARCHAR(32) NOT NULL DEFAULT 'user',
  source_ref VARCHAR(128) NULL,
  preferred_language_code VARCHAR(32) NULL,
  preferred_language_label VARCHAR(128) NULL,
  activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_user_character_activation (internal_uid, character_id),
  KEY idx_user_character_activations_user_updated (internal_uid, updated_at),
  KEY idx_user_character_activations_character (character_id, activation_status),
  CONSTRAINT fk_user_character_activations_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_character_activations_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  guest_session_id VARCHAR(64) NULL,
  character_id VARCHAR(64) NULL,
  sender_type VARCHAR(32) NOT NULL,
  sender_label VARCHAR(96) NULL,
  content_type VARCHAR(32) NOT NULL DEFAULT 'text',
  text_content TEXT NULL,
  voice_asset_id VARCHAR(64) NULL,
  product_payload_json JSON NULL,
  display_order INT NOT NULL DEFAULT 0,
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'sent',
  source_type VARCHAR(32) NOT NULL DEFAULT 'system',
  source_ref VARCHAR(128) NULL,
  sent_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_chat_messages_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_messages_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL,
  CONSTRAINT fk_chat_messages_voice_asset FOREIGN KEY (voice_asset_id) REFERENCES character_voice_assets(id) ON DELETE SET NULL,
  KEY idx_chat_messages_session_order (session_id, display_order),
  KEY idx_chat_messages_session_sent (session_id, sent_at),
  KEY idx_chat_messages_guest_sent (guest_session_id, sent_at),
  KEY idx_chat_messages_character_type (character_id, content_type),
  KEY idx_chat_messages_source (source_type, source_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_image_assets (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  message_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  internal_uid VARCHAR(64) NULL,
  guest_session_id VARCHAR(64) NULL,
  character_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  storage_path VARCHAR(512) NULL,
  protected_path VARCHAR(512) NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  bytes INT UNSIGNED NULL,
  mime_type VARCHAR(64) NULL,
  prompt_summary VARCHAR(500) NULL,
  prompt_context_json JSON NULL,
  prompt_full_text MEDIUMTEXT NULL,
  provider VARCHAR(64) NULL,
  provider_request_id VARCHAR(128) NULL,
  error_message VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uniq_chat_image_assets_message (message_id),
  KEY idx_chat_image_assets_session_status (session_id, status, created_at),
  KEY idx_chat_image_assets_user_date (internal_uid, created_at),
  KEY idx_chat_image_assets_guest_status (guest_session_id, status),
  CONSTRAINT fk_chat_image_assets_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_image_assets_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_image_assets_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_image_assets_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_image_usage (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  internal_uid VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  character_id VARCHAR(64) NULL,
  usage_date DATE NOT NULL,
  message_id VARCHAR(64) NOT NULL,
  asset_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_chat_image_usage_message (message_id),
  KEY idx_chat_image_usage_user_session_date (internal_uid, session_id, usage_date),
  KEY idx_chat_image_usage_user_character_date (internal_uid, character_id, usage_date),
  CONSTRAINT fk_chat_image_usage_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_image_usage_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_image_usage_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL,
  CONSTRAINT fk_chat_image_usage_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_image_usage_asset FOREIGN KEY (asset_id) REFERENCES chat_image_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_image_quota_windows (
  internal_uid VARCHAR(64) NOT NULL,
  window_started_at DATETIME(3) NULL,
  image_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (internal_uid),
  KEY idx_chat_image_quota_windows_expiry (window_started_at),
  CONSTRAINT fk_chat_image_quota_windows_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_network_rate_limits (
  network_hash CHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  session_window_started_at DATETIME(3) NULL,
  session_window_count INT UNSIGNED NOT NULL DEFAULT 0,
  message_window_started_at DATETIME(3) NULL,
  message_window_count INT UNSIGNED NOT NULL DEFAULT 0,
  search_window_started_at DATETIME(3) NULL,
  search_window_count INT UNSIGNED NOT NULL DEFAULT 0,
  upload_window_started_at DATETIME(3) NULL,
  upload_window_count INT UNSIGNED NOT NULL DEFAULT 0,
  upload_window_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (network_hash, site_id),
  KEY idx_guest_network_limits_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  token_hash VARCHAR(128) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  mascot_character_id VARCHAR(64) NOT NULL,
  chat_session_id VARCHAR(64) NULL,
  session_status VARCHAR(32) NOT NULL DEFAULT 'active',
  message_window_started_at DATETIME(3) NULL,
  message_window_count INT UNSIGNED NOT NULL DEFAULT 0,
  rate_window_started_at DATETIME(3) NULL,
  rate_window_count INT UNSIGNED NOT NULL DEFAULT 0,
  attachment_window_started_at DATETIME(3) NULL,
  attachment_window_count INT UNSIGNED NOT NULL DEFAULT 0,
  attachment_window_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  call_window_started_at DATETIME(3) NULL,
  call_window_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active_call_id VARCHAR(64) NULL,
  claimed_user_id VARCHAR(64) NULL,
  claimed_at DATETIME(3) NULL,
  target_chat_session_id VARCHAR(64) NULL,
  external_source_context_json JSON NULL,
  last_ip VARCHAR(64) NULL,
  last_ip_region VARCHAR(96) NULL,
  last_ip_at DATETIME(3) NULL,
  last_user_agent VARCHAR(500) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_guest_sessions_token_hash (token_hash),
  UNIQUE KEY uniq_guest_sessions_chat_session (chat_session_id),
  KEY idx_guest_sessions_status_expires (session_status, expires_at),
  KEY idx_guest_sessions_site_status (site_id, session_status),
  KEY idx_guest_sessions_claimed_source (claimed_user_id, session_status, claimed_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_image_entitlements (
  guest_session_id VARCHAR(64) NOT NULL PRIMARY KEY,
  entitlement_status VARCHAR(32) NOT NULL DEFAULT 'available',
  asset_id VARCHAR(64) NULL,
  request_key VARCHAR(128) NULL,
  reserved_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_guest_image_asset (asset_id),
  UNIQUE KEY uniq_guest_image_request (guest_session_id, request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_image_network_quota_windows (
  site_id VARCHAR(64) NOT NULL,
  network_hash CHAR(64) NOT NULL,
  window_started_at DATETIME(3) NULL,
  window_expires_at DATETIME(3) NULL,
  used_count INT UNSIGNED NOT NULL DEFAULT 0,
  reserved_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id, network_hash),
  KEY idx_guest_image_network_window (window_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_image_network_quota_reservations (
  asset_id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  network_hash CHAR(64) NOT NULL,
  guest_session_id VARCHAR(64) NULL,
  request_key VARCHAR(128) NULL,
  reservation_status VARCHAR(32) NOT NULL DEFAULT 'reserved',
  reserved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumed_at DATETIME(3) NULL,
  KEY idx_guest_image_network_reservation_window (site_id, network_hash, reservation_status),
  KEY idx_guest_image_network_reservation_guest (guest_session_id, reservation_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_chat_attachments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  guest_session_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  character_id VARCHAR(64) NOT NULL,
  network_hash CHAR(64) NOT NULL,
  client_upload_id VARCHAR(128) NOT NULL,
  stored_name VARCHAR(180) NOT NULL,
  attempt_token VARCHAR(64) NULL,
  attachment_json JSON NOT NULL,
  asset_status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
  request_key VARCHAR(128) NULL,
  message_id VARCHAR(64) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_guest_chat_attachment_stored (stored_name),
  UNIQUE KEY uniq_guest_chat_attachment_request (guest_session_id, client_upload_id),
  KEY idx_guest_chat_attachments_guest_status (guest_session_id, asset_status, created_at),
  KEY idx_guest_chat_attachments_request (guest_session_id, request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_voice_requests (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  guest_session_id VARCHAR(64) NOT NULL,
  network_hash CHAR(64) NOT NULL,
  request_key VARCHAR(128) NOT NULL,
  request_status VARCHAR(32) NOT NULL DEFAULT 'processing',
  attempt_token VARCHAR(64) NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  transcript_text TEXT NULL,
  error_message VARCHAR(500) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_guest_voice_request (guest_session_id, request_key),
  KEY idx_guest_voice_requests_status_updated (request_status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guest_call_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  guest_session_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  character_id VARCHAR(64) NOT NULL,
  network_hash CHAR(64) NULL,
  lease_token VARCHAR(64) NOT NULL,
  call_status VARCHAR(32) NOT NULL DEFAULT 'active',
  duration_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  guarded_input_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  guarded_input_updated_at DATETIME(3) NULL,
  pending_input_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pending_input_epoch INT UNSIGNED NOT NULL DEFAULT 0,
  turn_count INT UNSIGNED NOT NULL DEFAULT 0,
  claimed_user_id VARCHAR(64) NULL,
  target_chat_session_id VARCHAR(64) NULL,
  started_at DATETIME(3) NOT NULL,
  last_accounted_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_guest_call_sessions_guest_status (guest_session_id, call_status, started_at),
  KEY idx_guest_call_sessions_network_active (network_hash, call_status, last_accounted_at),
  KEY idx_guest_call_sessions_claimed_user (claimed_user_id, ended_at),
  KEY idx_guest_call_sessions_expiry (expires_at, call_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO chat_messages (
  id, session_id, character_id, sender_type, sender_label, content_type, text_content,
  voice_asset_id, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
) VALUES
  (
    'demo_msg_striker_1', 'demo_session_striker', 'striker', 'character', 'Leo Marquez', 'text',
    'Eyy, glad you are back. Ready for match talk and a fresh drop?',
    'voice_striker_intro_1', NULL, 10, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_striker_2', 'demo_session_striker', NULL, 'user', 'You', 'text',
    'Of course! That free kick was insane. You used to score those all the time.',
    NULL, NULL, 20, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_striker_3', 'demo_session_striker', 'striker', 'character', 'Leo Marquez', 'text',
    'Haha, top corner, every time. Speaking of, the club just dropped the new Legends kit. Emerald and gold, proper clean. Want a look?',
    'voice_striker_intro_2', NULL, 30, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_striker_4', 'demo_session_striker', 'striker', 'character', 'Leo Marquez', 'product',
    NULL, NULL,
    JSON_OBJECT(
      'tag', 'Members only',
      'imageUrl', 'assets/jersey_product.png',
      'name', 'Legends Matchday Kit 25/26',
      'subtitle', 'Emerald / Gold · Authentic fit',
      'priceNow', '$59',
      'priceWas', '$89',
      'code', 'LEO33',
      'buttonText', 'View & buy →'
    ),
    40, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_striker_5', 'demo_session_striker', 'striker', 'character', 'Leo Marquez', 'text',
    'That code is just for you. Wear it to the next match and tag me.',
    'voice_striker_intro_3', NULL, 50, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_coach_1', 'demo_session_coach', 'coach', 'character', 'Coach Vale', 'text',
    'Pull up the board and let us read the game together.',
    'voice_coach_intro_1', NULL, 10, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_fan_1', 'demo_session_fan', 'fan', 'character', 'Dani Ultra', 'text',
    'Match starts in minutes. Give me your boldest prediction.',
    'voice_fan_intro_1', NULL, 10, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_pundit_1', 'demo_session_pundit', 'pundit', 'character', 'Mara Voss', 'text',
    'You want the real verdict or the polite one?',
    'voice_pundit_intro_1', NULL, 10, 'sent', 'system', 'demo-chat-seed', NOW(3)
  ),
  (
    'demo_msg_keeper_1', 'demo_session_keeper', 'keeper', 'character', 'Old Gloves', 'text',
    'You learn more from one bad goal than ten easy wins.',
    'voice_keeper_intro_1', NULL, 10, 'sent', 'system', 'demo-chat-seed', NOW(3)
  )
ON DUPLICATE KEY UPDATE
  id = id;

DELETE FROM ai_characters
WHERE source_type = 'system'
  AND source_ref = 'demo-seed'
  AND id <> 'fan';

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  scene VARCHAR(32) NOT NULL DEFAULT 'register',
  code_hash VARCHAR(255) NOT NULL,
  provider VARCHAR(32) NULL,
  request_ip VARCHAR(64) NULL,
  attempts_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_email_codes_lookup (email, scene, expires_at),
  KEY idx_email_codes_ip_created (request_ip, created_at),
  KEY idx_email_codes_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  internal_uid VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_user_id VARCHAR(128) NOT NULL,
  email VARCHAR(255) NULL,
  display_name VARCHAR(128) NULL,
  avatar_url VARCHAR(512) NULL,
  raw_profile_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_oauth_accounts_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_oauth_provider_user (provider, provider_user_id),
  KEY idx_oauth_email (provider, email),
  KEY idx_oauth_internal_uid (internal_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_accounts (
  internal_uid VARCHAR(64) NOT NULL PRIMARY KEY,
  balance DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  recharge_balance DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  bonus_balance DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  currency VARCHAR(16) NOT NULL DEFAULT 'credits',
  total_spent DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  last_charged_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_billing_accounts_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_orders (
  order_id VARCHAR(64) NOT NULL PRIMARY KEY,
  internal_uid VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'alipay',
  channel VARCHAR(32) NOT NULL DEFAULT 'page',
  plan_id VARCHAR(32) NULL,
  app_id VARCHAR(64) NULL,
  subject VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  rmb_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  credited_amount DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  trade_no VARCHAR(128) NULL,
  buyer_id VARCHAR(128) NULL,
  request_payload_json JSON NULL,
  notify_payload_json JSON NULL,
  return_payload_json JSON NULL,
  error_message VARCHAR(255) NULL,
  paid_at DATETIME(3) NULL,
  settled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_recharge_orders_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_recharge_orders_user_status (internal_uid, status),
  KEY idx_recharge_orders_trade_no (trade_no),
  KEY idx_recharge_orders_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  internal_uid VARCHAR(64) NOT NULL,
  message_type VARCHAR(64) NULL,
  delta DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  balance_before DECIMAL(18, 3) NULL,
  balance_after DECIMAL(18, 3) NULL,
  credited DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  charged DECIMAL(18, 3) NOT NULL DEFAULT 0.000,
  status VARCHAR(64) NULL,
  reason VARCHAR(64) NULL,
  ref_id VARCHAR(128) NULL,
  meta_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_billing_logs_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_billing_logs_user_created (internal_uid, created_at),
  KEY idx_billing_logs_reason_ref (internal_uid, reason, ref_id),
  KEY idx_billing_logs_reason_created (reason, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_message_index (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  internal_uid VARCHAR(64) NOT NULL,
  character_id VARCHAR(64) NULL,
  sender_type VARCHAR(32) NOT NULL,
  content_type VARCHAR(32) NOT NULL DEFAULT 'text',
  text_preview VARCHAR(500) NULL,
  keywords_json JSON NULL,
  topics_json JSON NULL,
  entities_json JSON NULL,
  emotion_tags_json JSON NULL,
  intent_tags_json JSON NULL,
  importance_score DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  retrieval_weight DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  indexed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_chat_message_index_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_message_index_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_message_index_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_message_index_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_chat_message_index_message (message_id),
  KEY idx_chat_message_index_user_character (internal_uid, character_id, importance_score),
  KEY idx_chat_message_index_session_created (session_id, created_at),
  KEY idx_chat_message_index_content (content_type, sender_type),
  KEY idx_chat_message_index_indexed (indexed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_memory_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  internal_uid VARCHAR(64) NOT NULL,
  character_id VARCHAR(64) NULL,
  scope VARCHAR(32) NOT NULL DEFAULT 'global',
  memory_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NULL,
  content TEXT NOT NULL,
  summary TEXT NULL,
  confidence_score DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  importance_score DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  freshness_score DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  privacy_level VARCHAR(32) NOT NULL DEFAULT 'normal',
  memory_status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_kind VARCHAR(32) NOT NULL DEFAULT 'chat_text',
  effective_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  last_used_at DATETIME(3) NULL,
  last_confirmed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_memory_records_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_memory_records_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL,
  KEY idx_user_memory_user_character_type (internal_uid, character_id, memory_type),
  KEY idx_user_memory_scope_status (scope, memory_status),
  KEY idx_user_memory_scores (internal_uid, importance_score, freshness_score),
  KEY idx_user_memory_expires (expires_at),
  KEY idx_user_memory_last_used (last_used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_memory_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  memory_id BIGINT UNSIGNED NOT NULL,
  source_message_id VARCHAR(64) NULL,
  source_session_id VARCHAR(64) NULL,
  relation_type VARCHAR(32) NOT NULL DEFAULT 'derived_from',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_memory_links_memory FOREIGN KEY (memory_id) REFERENCES user_memory_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_memory_links_message FOREIGN KEY (source_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_user_memory_links_session FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL,
  KEY idx_user_memory_links_memory (memory_id),
  KEY idx_user_memory_links_message (source_message_id),
  KEY idx_user_memory_links_session (source_session_id),
  KEY idx_user_memory_links_relation (relation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  internal_uid VARCHAR(64) NOT NULL,
  character_id VARCHAR(64) NULL,
  character_scope_id VARCHAR(64) NOT NULL DEFAULT '',
  period_type VARCHAR(16) NOT NULL,
  period_start DATETIME(3) NOT NULL,
  period_end DATETIME(3) NOT NULL,
  summary_text TEXT NULL,
  summary_json JSON NULL,
  source_message_count INT UNSIGNED NOT NULL DEFAULT 0,
  summary_status VARCHAR(32) NOT NULL DEFAULT 'active',
  generated_by VARCHAR(32) NOT NULL DEFAULT 'rule',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_conversation_summaries_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_summaries_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_conversation_summary_period (internal_uid, character_scope_id, period_type, period_start),
  KEY idx_conversation_summaries_user_character (internal_uid, character_id, period_type, period_start),
  KEY idx_conversation_summaries_status (summary_status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_summary_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  summary_id BIGINT UNSIGNED NOT NULL,
  source_message_id VARCHAR(64) NULL,
  source_session_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_conversation_summary_links_summary FOREIGN KEY (summary_id) REFERENCES conversation_summaries(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_summary_links_message FOREIGN KEY (source_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversation_summary_links_session FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL,
  KEY idx_conversation_summary_links_summary (summary_id),
  KEY idx_conversation_summary_links_message (source_message_id),
  KEY idx_conversation_summary_links_session (source_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS memory_jobs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  internal_uid VARCHAR(64) NULL,
  character_id VARCHAR(64) NULL,
  session_id VARCHAR(64) NULL,
  job_type VARCHAR(64) NOT NULL,
  job_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  priority INT NOT NULL DEFAULT 100,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  claimed_at DATETIME(3) NULL,
  claim_token VARCHAR(64) NULL,
  completed_at DATETIME(3) NULL,
  failed_at DATETIME(3) NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_retries INT UNSIGNED NOT NULL DEFAULT 3,
  last_error TEXT NULL,
  payload_json JSON NULL,
  result_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_memory_jobs_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_memory_jobs_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL,
  CONSTRAINT fk_memory_jobs_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL,
  KEY idx_memory_jobs_status_available (job_status, available_at, priority),
  KEY idx_memory_jobs_user_type (internal_uid, job_type, created_at),
  KEY idx_memory_jobs_session (session_id, created_at),
  KEY idx_memory_jobs_character (character_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mascot_settings (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_id VARCHAR(64) NULL,
  character_id VARCHAR(64) NOT NULL,
  name VARCHAR(96) NOT NULL,
  avatar_url VARCHAR(512) NULL,
  tone TEXT NULL,
  greeting VARCHAR(512) NULL,
  cta VARCHAR(512) NULL,
  currency VARCHAR(16) NULL,
  knowledge_json JSON NULL,
  setting_status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_mascot_settings_site (site_id),
  KEY idx_mascot_settings_character (character_id),
  KEY idx_mascot_settings_status (setting_status, site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mascot_ad_deliveries (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  mascot_character_id VARCHAR(64) NULL,
  campaign_id VARCHAR(64) NULL,
  title VARCHAR(128) NULL,
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'sent',
  active_key VARCHAR(191) NULL,
  campaign_snapshot_json JSON NULL,
  target_count INT UNSIGNED NOT NULL DEFAULT 0,
  sent_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_mascot_ad_active_key (active_key),
  KEY idx_mascot_ad_site_status (site_id, delivery_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mascot_ad_delivery_targets (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  delivery_id VARCHAR(64) NOT NULL,
  internal_uid VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  target_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  message_id VARCHAR(64) NULL,
  campaign_delivery_id VARCHAR(64) NULL,
  proactive_delivery_id VARCHAR(64) NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  failure_reason VARCHAR(255) NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_mascot_ad_target_user (delivery_id, internal_uid),
  KEY idx_mascot_ad_targets_status (delivery_id, target_status, created_at),
  KEY idx_mascot_ad_targets_ready (delivery_id, target_status, available_at, created_at),
  CONSTRAINT fk_mascot_ad_targets_delivery FOREIGN KEY (delivery_id) REFERENCES mascot_ad_deliveries(id) ON DELETE CASCADE,
  CONSTRAINT fk_mascot_ad_targets_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mascot_ad_targets_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS discount_codes (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  ownership_type VARCHAR(32) NOT NULL DEFAULT 'site',
  creator_uid VARCHAR(64) NULL,
  offer_description VARCHAR(255) NOT NULL,
  validity_mode VARCHAR(32) NOT NULL DEFAULT 'indefinite',
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  shopify_discount_id VARCHAR(255) NULL,
  shopify_discount_type VARCHAR(32) NULL,
  shopify_status VARCHAR(32) NULL,
  shopify_rule_json JSON NULL,
  shopify_synced_at DATETIME(3) NULL,
  created_by_uid VARCHAR(64) NULL,
  updated_by_uid VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_discount_codes_site_code (site_id, code),
  KEY idx_discount_codes_site_owner (site_id, ownership_type, creator_uid),
  KEY idx_discount_codes_status_time (is_enabled, starts_at, ends_at),
  KEY idx_discount_codes_shopify_id (shopify_discount_id),
  CONSTRAINT fk_discount_codes_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_discount_codes_creator FOREIGN KEY (creator_uid) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_discount_codes_created_by FOREIGN KEY (created_by_uid) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_discount_codes_updated_by FOREIGN KEY (updated_by_uid) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promotion_campaigns (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  role_target VARCHAR(32) NOT NULL DEFAULT 'all',
  product_id VARCHAR(128) NULL,
  product_title VARCHAR(255) NOT NULL,
  product_url VARCHAR(512) NULL,
  product_snapshot_json JSON NULL,
  discount_code VARCHAR(64) NULL,
  message_text TEXT NOT NULL,
  keywords_json JSON NULL,
  priority INT NOT NULL DEFAULT 100,
  campaign_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'admin',
  source_ref VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_promotion_campaigns_site_status_time (site_id, campaign_status, starts_at, ends_at),
  KEY idx_promotion_campaigns_priority (priority, ends_at, created_at),
  CONSTRAINT fk_promotion_campaigns_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promotion_campaign_deliveries (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  internal_uid VARCHAR(64) NOT NULL,
  character_id VARCHAR(64) NULL,
  session_id VARCHAR(64) NULL,
  message_id VARCHAR(64) NULL,
  site_id VARCHAR(64) NOT NULL,
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'reserved',
  match_score INT NOT NULL DEFAULT 0,
  match_reason VARCHAR(255) NULL,
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_promotion_campaign_user (campaign_id, internal_uid),
  KEY idx_promotion_deliveries_user_created (internal_uid, created_at),
  KEY idx_promotion_deliveries_site_created (site_id, created_at),
  KEY idx_promotion_deliveries_message (message_id),
  CONSTRAINT fk_promotion_deliveries_campaign FOREIGN KEY (campaign_id) REFERENCES promotion_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_promotion_deliveries_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS proactive_message_deliveries (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  internal_uid VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NULL,
  character_id VARCHAR(64) NULL,
  session_id VARCHAR(64) NULL,
  message_id VARCHAR(64) NULL,
  delivery_date VARCHAR(10) NOT NULL,
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'reserved',
  source_type VARCHAR(32) NOT NULL,
  source_ref VARCHAR(128) NULL,
  campaign_id VARCHAR(64) NULL,
  slot_index TINYINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_proactive_delivery_slot (internal_uid, delivery_date, slot_index),
  KEY idx_proactive_deliveries_user_date (internal_uid, delivery_date, delivery_status),
  KEY idx_proactive_deliveries_user_character (internal_uid, character_id, sent_at),
  KEY idx_proactive_deliveries_message (message_id),
  KEY idx_proactive_deliveries_campaign (campaign_id, internal_uid),
  CONSTRAINT fk_proactive_deliveries_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  label VARCHAR(128) NOT NULL,
  summary TEXT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'general',
  scope VARCHAR(32) NOT NULL DEFAULT 'global',
  site_id VARCHAR(64) NULL,
  knowledge_status VARCHAR(32) NOT NULL DEFAULT 'active',
  language VARCHAR(64) NULL,
  priority INT NOT NULL DEFAULT 50,
  max_sections INT UNSIGNED NOT NULL DEFAULT 6,
  max_chars_per_section INT UNSIGNED NOT NULL DEFAULT 1200,
  keywords_json JSON NULL,
  fuzzy_keywords_json JSON NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_knowledge_bases_status_category (knowledge_status, category),
  KEY idx_knowledge_bases_scope_site (scope, site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_sections (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  knowledge_base_id VARCHAR(64) NOT NULL,
  section_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary TEXT NULL,
  content MEDIUMTEXT NOT NULL,
  keywords_json JSON NULL,
  fuzzy_keywords_json JSON NULL,
  display_order INT NOT NULL DEFAULT 100,
  section_status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_heading VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_knowledge_section_key (knowledge_base_id, section_key),
  KEY idx_knowledge_sections_base_order (knowledge_base_id, display_order),
  KEY idx_knowledge_sections_status (section_status),
  CONSTRAINT fk_knowledge_sections_base FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_base_bindings (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  knowledge_base_id VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  binding_status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_knowledge_binding_target (knowledge_base_id, target_type, target_id),
  KEY idx_knowledge_bindings_base_status (knowledge_base_id, binding_status),
  KEY idx_knowledge_bindings_target (target_type, target_id, binding_status),
  CONSTRAINT fk_knowledge_bindings_base FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS app_error_logs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  source VARCHAR(32) NOT NULL DEFAULT 'server',
  level VARCHAR(32) NOT NULL DEFAULT 'error',
  error_type VARCHAR(96) NOT NULL DEFAULT 'app_error',
  action VARCHAR(128) NULL,
  status_code INT NULL,
  safe_message VARCHAR(500) NULL,
  raw_message VARCHAR(500) NULL,
  stack_trace TEXT NULL,
  page VARCHAR(255) NULL,
  endpoint VARCHAR(255) NULL,
  request_method VARCHAR(16) NULL,
  request_id VARCHAR(128) NULL,
  user_agent VARCHAR(500) NULL,
  client_ip VARCHAR(64) NULL,
  internal_uid VARCHAR(64) NULL,
  context_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_app_error_logs_created (created_at),
  KEY idx_app_error_logs_level_created (level, created_at),
  KEY idx_app_error_logs_type_created (error_type, created_at),
  KEY idx_app_error_logs_source_created (source, created_at),
  KEY idx_app_error_logs_user_created (internal_uid, created_at),
  KEY idx_app_error_logs_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_feedback (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  internal_uid VARCHAR(64) NULL,
  user_email VARCHAR(255) NULL,
  account_type VARCHAR(32) NULL,
  site_id VARCHAR(64) NULL,
  site_slug VARCHAR(96) NULL,
  client_ip VARCHAR(64) NULL,
  subject VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  page_path VARCHAR(512) NULL,
  user_agent VARCHAR(500) NULL,
  feedback_status VARCHAR(32) NOT NULL DEFAULT 'new',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_user_feedback_created (created_at),
  KEY idx_user_feedback_status_created (feedback_status, created_at),
  KEY idx_user_feedback_user_created (internal_uid, created_at),
  KEY idx_user_feedback_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_product_cache (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  site_slug VARCHAR(96) NOT NULL,
  external_product_key VARCHAR(191) NOT NULL,
  product_title VARCHAR(255) NOT NULL,
  product_subtitle VARCHAR(255) NULL,
  product_url VARCHAR(512) NULL,
  image_url VARCHAR(512) NULL,
  image_urls_json JSON NULL,
  price_now VARCHAR(64) NULL,
  price_was VARCHAR(64) NULL,
  stock_text VARCHAR(128) NULL,
  available TINYINT(1) NULL,
  sizes_json JSON NULL,
  features_json JSON NULL,
  product_payload_json JSON NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'site_source',
  source_rank INT NOT NULL DEFAULT 100,
  cached_status VARCHAR(32) NOT NULL DEFAULT 'active',
  last_synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_site_product_cache_external (site_id, external_product_key),
  KEY idx_site_product_cache_site_rank (site_id, cached_status, source_rank, updated_at),
  KEY idx_site_product_cache_slug_rank (site_slug, cached_status, source_rank, updated_at),
  KEY idx_site_product_cache_sync (site_id, last_synced_at),
  CONSTRAINT fk_site_product_cache_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_home_product_sections (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  site_slug VARCHAR(96) NOT NULL,
  theme_id VARCHAR(64) NULL,
  theme_name VARCHAR(128) NULL,
  section_key VARCHAR(128) NOT NULL,
  section_type VARCHAR(96) NOT NULL,
  section_title VARCHAR(255) NULL,
  collection_handles_json JSON NULL,
  product_handles_json JSON NULL,
  product_keys_json JSON NULL,
  source_rank INT NOT NULL DEFAULT 100,
  section_status VARCHAR(32) NOT NULL DEFAULT 'active',
  raw_section_json JSON NULL,
  last_synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_home_product_section_site_key (site_id, section_key),
  KEY idx_home_product_sections_site_rank (site_id, section_status, source_rank),
  KEY idx_home_product_sections_slug_rank (site_slug, section_status, source_rank),
  KEY idx_home_product_sections_sync (site_id, last_synced_at),
  CONSTRAINT fk_home_product_sections_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_kitshop_sales_cache (
  site_id VARCHAR(64) NOT NULL PRIMARY KEY,
  site_slug VARCHAR(96) NOT NULL,
  rank_30d_json JSON NULL,
  rank_60d_json JSON NULL,
  shuffle_seed VARCHAR(64) NOT NULL,
  included_order_count INT UNSIGNED NOT NULL DEFAULT 0,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'ready',
  last_attempt_at DATETIME(3) NULL,
  last_synced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_kitshop_sales_cache_slug_sync (site_slug, last_synced_at),
  CONSTRAINT fk_kitshop_sales_cache_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_operation_logs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  admin_user_id VARCHAR(64) NULL,
  admin_email VARCHAR(255) NULL,
  admin_name VARCHAR(128) NULL,
  action VARCHAR(96) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) NULL,
  target_label VARCHAR(255) NULL,
  summary VARCHAR(500) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  request_method VARCHAR(16) NULL,
  endpoint VARCHAR(255) NULL,
  request_id VARCHAR(128) NULL,
  user_agent VARCHAR(500) NULL,
  client_ip VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_admin_operation_logs_created (created_at),
  KEY idx_admin_operation_logs_admin_created (admin_user_id, created_at),
  KEY idx_admin_operation_logs_action_created (action, created_at),
  KEY idx_admin_operation_logs_target_created (target_type, target_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_quick_replies (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  quick_reply_type VARCHAR(32) NOT NULL,
  text VARCHAR(120) NOT NULL,
  locale VARCHAR(32) NOT NULL DEFAULT 'en',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  source_type VARCHAR(32) NOT NULL DEFAULT 'system',
  source_ref VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_chat_quick_replies_type_active (quick_reply_type, is_active, locale, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO chat_quick_replies (id, quick_reply_type, text, locale, is_active, display_order, source_type, source_ref)
VALUES
  ('daily_01', 'daily', 'How was your day', 'en', 1, 1, 'system', 'quick-reply-seed'),
  ('daily_02', 'daily', 'Any match thoughts today', 'en', 1, 2, 'system', 'quick-reply-seed'),
  ('daily_03', 'daily', 'Tell me something fun', 'en', 1, 3, 'system', 'quick-reply-seed'),
  ('daily_04', 'daily', 'What are you watching', 'en', 1, 4, 'system', 'quick-reply-seed'),
  ('daily_05', 'daily', 'Got any weekend plans', 'en', 1, 5, 'system', 'quick-reply-seed'),
  ('daily_06', 'daily', 'That sounds pretty wild', 'en', 1, 6, 'system', 'quick-reply-seed'),
  ('daily_07', 'daily', 'Give me your take', 'en', 1, 7, 'system', 'quick-reply-seed'),
  ('daily_08', 'daily', 'How are you feeling', 'en', 1, 8, 'system', 'quick-reply-seed'),
  ('daily_09', 'daily', 'What made you laugh', 'en', 1, 9, 'system', 'quick-reply-seed'),
  ('daily_10', 'daily', 'Any football hot takes', 'en', 1, 10, 'system', 'quick-reply-seed'),
  ('daily_11', 'daily', 'Talk me through it', 'en', 1, 11, 'system', 'quick-reply-seed'),
  ('daily_12', 'daily', 'What happened after that', 'en', 1, 12, 'system', 'quick-reply-seed'),
  ('daily_13', 'daily', 'Need a quick chat', 'en', 1, 13, 'system', 'quick-reply-seed'),
  ('daily_14', 'daily', 'Tell me the story', 'en', 1, 14, 'system', 'quick-reply-seed'),
  ('daily_15', 'daily', 'What are we thinking', 'en', 1, 15, 'system', 'quick-reply-seed'),
  ('daily_16', 'daily', 'Got a bold opinion', 'en', 1, 16, 'system', 'quick-reply-seed'),
  ('daily_17', 'daily', 'How did that feel', 'en', 1, 17, 'system', 'quick-reply-seed'),
  ('daily_18', 'daily', 'Want to debate football', 'en', 1, 18, 'system', 'quick-reply-seed'),
  ('daily_19', 'daily', 'Give me good vibes', 'en', 1, 19, 'system', 'quick-reply-seed'),
  ('daily_20', 'daily', 'What should we discuss', 'en', 1, 20, 'system', 'quick-reply-seed'),
  ('product_01', 'product', 'Show me fresh kits', 'en', 1, 1, 'system', 'quick-reply-seed'),
  ('product_02', 'product', 'Find a matchday shirt', 'en', 1, 2, 'system', 'quick-reply-seed'),
  ('product_03', 'product', 'Any new football shirts', 'en', 1, 3, 'system', 'quick-reply-seed'),
  ('product_04', 'product', 'Help me pick jerseys', 'en', 1, 4, 'system', 'quick-reply-seed'),
  ('product_05', 'product', 'Show me Messi shirts', 'en', 1, 5, 'system', 'quick-reply-seed'),
  ('product_06', 'product', 'Find AC Milan kits', 'en', 1, 6, 'system', 'quick-reply-seed'),
  ('product_07', 'product', 'Got any retro kits', 'en', 1, 7, 'system', 'quick-reply-seed'),
  ('product_08', 'product', 'Pick a home shirt', 'en', 1, 8, 'system', 'quick-reply-seed'),
  ('product_09', 'product', 'Show me away kits', 'en', 1, 9, 'system', 'quick-reply-seed'),
  ('product_10', 'product', 'Need a football look', 'en', 1, 10, 'system', 'quick-reply-seed'),
  ('product_11', 'product', 'Find a gift shirt', 'en', 1, 11, 'system', 'quick-reply-seed'),
  ('product_12', 'product', 'Show me popular jerseys', 'en', 1, 12, 'system', 'quick-reply-seed'),
  ('product_13', 'product', 'Any kit deals today', 'en', 1, 13, 'system', 'quick-reply-seed'),
  ('product_14', 'product', 'Help me choose size', 'en', 1, 14, 'system', 'quick-reply-seed'),
  ('product_15', 'product', 'Show me best sellers', 'en', 1, 15, 'system', 'quick-reply-seed'),
  ('product_16', 'product', 'Find something for matchday', 'en', 1, 16, 'system', 'quick-reply-seed'),
  ('product_17', 'product', 'Any player shirts available', 'en', 1, 17, 'system', 'quick-reply-seed'),
  ('product_18', 'product', 'Show me training tops', 'en', 1, 18, 'system', 'quick-reply-seed'),
  ('product_19', 'product', 'Find a classic jersey', 'en', 1, 19, 'system', 'quick-reply-seed'),
  ('product_20', 'product', 'Got shirts worth buying', 'en', 1, 20, 'system', 'quick-reply-seed')
ON DUPLICATE KEY UPDATE
  id = id;

CREATE TABLE IF NOT EXISTS product_analytics_events (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NULL,
  site_slug VARCHAR(96) NULL,
  character_id VARCHAR(64) NULL,
  character_name VARCHAR(128) NULL,
  owner_user_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  session_id VARCHAR(64) NULL,
  message_id VARCHAR(64) NULL,
  product_id VARCHAR(128) NULL,
  product_title VARCHAR(255) NULL,
  product_url VARCHAR(512) NULL,
  source VARCHAR(64) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_product_analytics_type_created (event_type, created_at),
  KEY idx_product_analytics_site_created (site_id, created_at),
  KEY idx_product_analytics_site_slug_created (site_slug, created_at),
  KEY idx_product_analytics_character_created (character_id, created_at),
  KEY idx_product_analytics_owner_created (owner_user_id, created_at),
  KEY idx_product_analytics_product_created (product_id, created_at),
  KEY idx_product_analytics_message_type (message_id, event_type),
  KEY idx_product_analytics_event_user_message (event_type, user_id, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_reply_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  internal_uid VARCHAR(64) NULL,
  session_id VARCHAR(64) NULL,
  character_id VARCHAR(64) NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'openai',
  model VARCHAR(96) NULL,
  base_url VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL,
  source_type VARCHAR(32) NULL,
  source_ref VARCHAR(128) NULL,
  degraded TINYINT(1) NOT NULL DEFAULT 0,
  degradation_reason VARCHAR(128) NULL,
  duration_ms INT UNSIGNED NULL,
  prompt_layer_count INT UNSIGNED NOT NULL DEFAULT 0,
  prompt_message_count INT UNSIGNED NOT NULL DEFAULT 0,
  system_prompt_chars INT UNSIGNED NOT NULL DEFAULT 0,
  input_chars INT UNSIGNED NOT NULL DEFAULT 0,
  output_chars INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ai_reply_logs_created (created_at),
  KEY idx_ai_reply_logs_status_created (status, created_at),
  KEY idx_ai_reply_logs_user_created (internal_uid, created_at),
  KEY idx_ai_reply_logs_character_created (character_id, created_at),
  KEY idx_ai_reply_logs_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
