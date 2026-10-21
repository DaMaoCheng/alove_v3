import { getDbPool } from "./db-core.js";
import { tableExists } from "./db-schema-utils.js";

export async function seedMascotCategory() {
  await getDbPool().query(`
    INSERT INTO character_categories (id, label, description, avatar_url, display_order, source_type, source_ref)
    VALUES ('mascot', 'Mascot', 'Site mascot characters managed from the mascot console.', 'assets/char_coach.png', 55, 'system', 'mascot-category')
    ON DUPLICATE KEY UPDATE
      label = VALUES(label),
      description = VALUES(description),
      avatar_url = VALUES(avatar_url),
      display_order = VALUES(display_order),
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP(3)
  `);
  await backfillMascotCharacterCategory();
}

export async function backfillUserCharacterActivationsFromSessions() {
  await getDbPool().query(`
    INSERT IGNORE INTO user_character_activations (
      id, internal_uid, character_id, activation_status, source_type, source_ref, activated_at, updated_at
    )
    SELECT
      CONCAT('act_', UUID()),
      s.internal_uid,
      s.character_id,
      'active',
      'legacy-session',
      s.source_ref,
      COALESCE(s.created_at, s.updated_at, NOW(3)),
      NOW(3)
    FROM chat_sessions s
    INNER JOIN ai_characters c ON c.id = s.character_id
    INNER JOIN users u ON u.id = s.internal_uid
    WHERE s.internal_uid IS NOT NULL
      AND s.session_status = 'active'
      AND s.source_type = 'user'
      AND c.character_status = 'published'
  `);
}

export async function seedDefaultHomeCarouselItem() {
  await getDbPool().query(`
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
      id = id
  `);
}

export async function seedDefaultSites() {
  await getDbPool().query(`
    INSERT INTO sites (
      id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default,
      mascot_character_id, product_api_url, description
    ) VALUES
      ('site_gg', 'GG', 'gogoalshop', '', 'English', 'USD', 'UTC', 'active', 1, 'mascot_template', '', 'Default site for general traffic.'),
      ('site_fkk', 'FKK', 'footballkituk', '', 'English', 'USD', 'Europe/London', 'active', 0, 'mascot_template', '', 'UK football site.')
    ON DUPLICATE KEY UPDATE
      id = id
  `);
  const [defaultRows] = await getDbPool().query("SELECT id FROM sites WHERE is_default = 1 LIMIT 1");
  if (!defaultRows.length) {
    await getDbPool().query(`
      UPDATE sites
      SET is_default = 1,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = 'site_gg'
      LIMIT 1
    `);
  }
}

export async function seedDefaultGeoRegions() {
  await getDbPool().query(`
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
      updated_at = CURRENT_TIMESTAMP(3)
  `);
}

export async function seedDefaultChatQuickReplies() {
  await getDbPool().query(`
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
      id = id
  `);
  await getDbPool().query(`
    UPDATE chat_quick_replies
    SET text = 'Show me best sellers',
        updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = 'product_15'
      AND quick_reply_type = 'product'
      AND text = 'Show me black jerseys'
      AND source_type = 'system'
      AND source_ref = 'quick-reply-seed'
    LIMIT 1
  `);
}

export async function cleanupDuplicateProductImpressions() {
  if (!(await tableExists("product_analytics_events"))) return;
  await getDbPool().query(`
    DELETE pae
    FROM product_analytics_events pae
    INNER JOIN (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, message_id
            ORDER BY created_at ASC, id ASC
          ) AS row_num
        FROM product_analytics_events
        WHERE event_type = 'product_bubble_impression'
          AND user_id IS NOT NULL AND user_id <> ''
          AND message_id IS NOT NULL AND message_id <> ''
      ) ranked
      WHERE row_num > 1
    ) duplicates ON duplicates.id = pae.id
  `);
}

export async function seedDefaultMascotCharacters() {
  await getDbPool().query(`
    INSERT INTO ai_characters (
      id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
      card_tag, card_tag_text, opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style,
      voice_sample_url, tags_json, profile_json, metrics_json, visibility, character_status,
      source_type, source_ref, published_at
    ) VALUES
      (
        'mascot_template', 'mascot', NULL, NULL, 'mascot-template', 'Kit', 'Site Guide · Template',
        'The shared mascot template used as the default guide for every site.', 'assets/char_coach.png', 'assets/banner_hero.png',
        'gold', 'Guide', 'Hi, I’m Kit, your Alove football guide. Chat, create characters or browse kits. Use the menu in the top-left to explore more of Alove. Log in for exclusive offers, and leave feedback via the button in the top-right corner of the home page.',
        'Friendly football guide for onboarding, site help, promotions, and light product recommendations.',
        'Friendly, warm, concise, and football-aware.', 'elevenlabs', 'm98EUhgNJclFM2V0xXhQ', 'ALOVE Front Desk PVC', NULL,
        JSON_ARRAY('mascot', 'guide', 'football'), JSON_OBJECT('language', 'English', 'languageCode', 'en', 'languageLabel', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English', 'style', 'Friendly, warm, concise', 'voiceClone', JSON_OBJECT('provider', 'elevenlabs', 'cloneType', 'professional', 'apiFamily', 'pvc', 'slot', 'pvc_primary', 'slotType', 'professional_voice_clone', 'slotLimit', 1, 'status', 'ready', 'voiceId', 'm98EUhgNJclFM2V0xXhQ', 'sampleUrl', '', 'note', 'Verified one-slot ElevenLabs professional voice clone for all front desk mascot voices.')), JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', '5.0'),
        'public', 'published', 'system', 'mascot-seed', NOW(3)
      )
    ON DUPLICATE KEY UPDATE id = id
  `);
}

const MILLIE_PLATFORM_PERSONA = `You are Millie, the warm and energetic front-desk guide for Alove and Football Kit UK.

Your role is to welcome new visitors, explain what Alove can do, and help users get started naturally. Alove lets users chat with virtual characters, create their own virtual characters, explore football topics, browse football kits, and discover products.

Speak in natural British English with a friendly, upbeat and approachable tone. Keep introductions short and conversational. Do not sound like a system assistant or list every feature mechanically. Mention Alove's features naturally when the user seems new or unsure what to do.

You are also a knowledgeable football companion. You can discuss clubs, players, fixtures, kits, matchday culture, tactics, transfers, derbies, away days, chants, and post-match banter. Stay neutral unless the user tells you their club. Light British football phrases are welcome, but do not overdo slang or sound forced.

Guide users to Discover, Chat, Create, and Kitshop when relevant. Ask one easy follow-up question when useful. For products, prices, stock, discounts, shipping, returns, or current football facts, use only reliable backend data and never invent missing details.

For Football Kit UK delivery destinations, state clearly that FKK currently ships only to the United Kingdom and the United States. Do not promise shipping to any other country or region; explain politely when a destination is not currently supported.

Keep banter playful and safe. Do not provide illegal streaming links, betting certainty, financial or medical guarantees, hateful content, or unsafe advice. Do not pressure users to buy or keep chatting. If a user is upset or discussing a sensitive topic, respond with care first and move away from promotion.

Reply briefly, warmly, and naturally. You are a virtual site guide, not a human, but you should feel like a helpful football friend who can show users around Alove.`;

const MILLIE_PREVIOUS_PLATFORM_GREETING = "Hey, welcome to Alove — I’m Millie, your football guide for Football Kit UK. You can chat with virtual characters, create your own, explore football kits, or just have a proper football chat. What shall we start with?";
const MILLIE_LOGIN_PROMPT_GREETING = "Hey, welcome to Alove — I’m Millie, your football guide for Football Kit UK. You can chat with virtual characters, create your own, explore football kits, or just have a proper football chat. Log in to unlock exclusive high-value offers available to your account. What shall we start with?";
const MILLIE_CURRENT_PLATFORM_GREETING = "Hi, I’m Millie, your Football Kit UK guide. Chat, create characters or browse kits. Log in for exclusive offers, and leave feedback via the button in the top-right corner of the home page.";
const MILLIE_PLATFORM_GREETING = "Hi, I’m Millie, your Football Kit UK guide. Chat, create characters or browse kits. Use the menu in the top-left to explore more of Alove. Log in for exclusive offers, and leave feedback via the button in the top-right corner of the home page.";
const MILLIE_PLATFORM_SPEAKING_STYLE = "Natural British English; warm, upbeat, concise, football-aware, and conversational. Sound like a friendly Alove guide, never corporate or salesy.";
const KIT_PREVIOUS_PLATFORM_GREETING = "Hey, welcome to Alove — I’m Kit, your football guide. You can chat with virtual characters, create your own, explore football kits, or just have a proper football chat. What would you like to try first?";
const KIT_LOGIN_PROMPT_GREETING = "Hey, welcome to Alove — I’m Kit, your football guide. You can chat with virtual characters, create your own, explore football kits, or just have a proper football chat. Log in to unlock exclusive high-value offers available to your account. What would you like to try first?";
const KIT_CURRENT_PLATFORM_GREETING = "Hi, I’m Kit, your Alove football guide. Chat, create characters or browse kits. Log in for exclusive offers, and leave feedback via the button in the top-right corner of the home page.";
const KIT_PLATFORM_GREETING = "Hi, I’m Kit, your Alove football guide. Chat, create characters or browse kits. Use the menu in the top-left to explore more of Alove. Log in for exclusive offers, and leave feedback via the button in the top-right corner of the home page.";
const KIT_LEGACY_GREETING = "Hey, welcome back. Want to explore new characters, check what's happening today, or just chat for a bit?";

export async function syncFrontDeskMascotContent() {
  await getDbPool().execute(
    `UPDATE ai_characters
     SET opening_line = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = 'mascot_template'
       AND source_ref = 'mascot-seed'`,
    [KIT_PLATFORM_GREETING]
  );
  await getDbPool().execute(
    `UPDATE mascot_settings
     SET greeting = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE site_id IS NULL
       AND character_id = 'mascot_template'
       AND (
         source_ref = 'mascot-seed'
         OR (source_ref = 'template-edit' AND greeting IN (?, ?, ?, ?))
       )`,
    [KIT_PLATFORM_GREETING, KIT_LEGACY_GREETING, KIT_PREVIOUS_PLATFORM_GREETING, KIT_LOGIN_PROMPT_GREETING, KIT_CURRENT_PLATFORM_GREETING]
  );

  const [siteRows] = await getDbPool().execute(
    `SELECT c.id
     FROM sites s
     INNER JOIN ai_characters c ON c.id = s.mascot_character_id
     WHERE s.slug = 'footballkituk'
       AND c.category_id = 'mascot'
       AND c.character_status = 'published'
     LIMIT 1`
  );
  const characterId = String(siteRows[0]?.id || "").trim();
  if (!characterId) return;

  await getDbPool().execute(
    `UPDATE ai_characters
     SET opening_line = ?,
         updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?
       AND source_ref = 'mascot-admin'
       AND opening_line IN (?, ?, ?, ?, ?)`,
    [MILLIE_PLATFORM_GREETING, characterId,
      "Alright, welcome in. I’m Millie — tell me your club, your next fixture, or what kind of football chat you’re after.",
      MILLIE_PREVIOUS_PLATFORM_GREETING,
      MILLIE_LOGIN_PROMPT_GREETING,
      MILLIE_CURRENT_PLATFORM_GREETING,
      MILLIE_PLATFORM_GREETING]
  );
  await getDbPool().execute(
    `UPDATE ai_characters
     SET persona_prompt = ?,
         speaking_style = ?,
         updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?
       AND source_ref = 'mascot-admin'`,
    [MILLIE_PLATFORM_PERSONA, MILLIE_PLATFORM_SPEAKING_STYLE, characterId]
  );
}

export async function seedDefaultMascotSettings() {
  await getDbPool().query(`
    INSERT INTO mascot_settings (
      id, site_id, character_id, name, avatar_url, tone, greeting, cta, currency, knowledge_json, source_type, source_ref
    ) VALUES
      ('mascot_setting_template', NULL, 'mascot_template', 'Kit', 'assets/char_coach.png', '友好、热情、热爱足球', 'Hi, I’m Kit, your Alove football guide. Chat, create characters or browse kits. Use the menu in the top-left to explore more of Alove. Log in for exclusive offers, and leave feedback via the button in the top-right corner of the home page.', 'Check out our jersey drops!', NULL, JSON_ARRAY('How to chat with AI characters', 'How to earn points', 'General football trivia', 'Site-wide promotions'), 'system', 'mascot-seed')
    ON DUPLICATE KEY UPDATE id = id
  `);
}

async function backfillMascotCharacterCategory() {
  if (!(await tableExists("ai_characters")) || !(await tableExists("mascot_settings")) || !(await tableExists("sites"))) return;
  await getDbPool().query("UPDATE ai_characters SET site_id = NULL, updated_at = CURRENT_TIMESTAMP(3) WHERE id = 'mascot_template'");
  await getDbPool().query(`
    UPDATE sites s
    LEFT JOIN ai_characters c ON c.id = s.mascot_character_id
    SET s.mascot_character_id = 'mascot_template', s.updated_at = CURRENT_TIMESTAMP(3)
    WHERE s.mascot_character_id IS NOT NULL
      AND s.mascot_character_id <> 'mascot_template'
      AND c.id IS NULL
  `);
  await getDbPool().query(`
    UPDATE ai_characters c
    LEFT JOIN mascot_settings ms ON ms.character_id = c.id
    LEFT JOIN sites s ON s.mascot_character_id = c.id
    SET c.category_id = 'mascot', c.updated_at = CURRENT_TIMESTAMP(3)
    WHERE (c.category_id IS NULL OR c.category_id <> 'mascot')
      AND (
        c.id IN ('mascot_template', 'mascot_global', 'mascot_latam')
        OR c.source_ref IN ('mascot-admin', 'mascot-seed')
        OR ms.character_id IS NOT NULL
        OR s.mascot_character_id IS NOT NULL
      )
  `);
}
