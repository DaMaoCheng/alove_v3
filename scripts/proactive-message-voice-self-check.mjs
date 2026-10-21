import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import {
  createProactiveCharacterMessage,
  createProactivePromotionCampaignMessages,
} from "../server/chat-proactive-message-service.js";

await initializeDatabase();

const suffix = Date.now();
const ids = {
  site: `site_proactive_voice_${suffix}`,
  user: `u_proactive_voice_${suffix}`,
  character: `creator_proactive_voice_${suffix}`,
  session: `chat_proactive_voice_${suffix}`,
  seedMessage: `msg_proactive_voice_seed_${suffix}`,
};

try {
  await seed();

  const proactive = await createProactiveCharacterMessage({
    userId: ids.user,
    characterId: ids.character,
    text: "Quick check-in, bro. Hope your day is moving alright.",
    proactivePolicy: { state: "neutral", candidateKind: "care", latestUserMessageId: ids.seedMessage, candidateText: "Quick check-in, bro. Hope your day is moving alright." },
    generateVoiceAudio: async ({ speechText }) => ({
      status: "ready",
      audioUrl: `/uploads/voice/ai/${speechText.length}-proactive.mp3`,
      audioBytes: 1111,
      durationSeconds: 4,
      outputFormat: "mp3_44100_128",
    }),
  });
  const proactiveMessage = proactive.items[0];
  assert.ok(proactiveMessage?.voice?.id, "plain proactive message should include attached voice metadata");
  assert.equal(proactiveMessage.voice.assetStatus, "ready", "plain proactive voice should be ready when generator succeeds");

  const campaign = await createProactivePromotionCampaignMessages({
    userId: ids.user,
    characterId: ids.character,
    text: "Quick one, bro. AC Milan shirts are on promo today.",
    proactivePolicy: { state: "shopping", latestUserMessageId: ids.seedMessage, candidateText: "Quick one, bro. AC Milan shirts are on promo today." },
    campaign: {
      id: `campaign_voice_${suffix}`,
      siteId: ids.site,
      siteSlug: `proactive-voice-${suffix}`,
      title: "AC Milan promo",
      productId: "acm-voice-001",
      productTitle: "AC Milan Home Shirt",
      productUrl: "https://footballkituk.example/products/ac-milan-home-shirt",
      productSnapshot: {
        id: "acm-voice-001",
        name: "AC Milan Home Shirt",
        price: "£49.99",
        url: "https://footballkituk.example/products/ac-milan-home-shirt",
      },
    },
    generateVoiceAudio: async () => ({
      status: "ready",
      audioUrl: "/uploads/voice/ai/campaign-proactive.mp3",
      audioBytes: 2222,
      durationSeconds: 5,
      outputFormat: "mp3_44100_128",
    }),
  });
  assert.ok(campaign.textMessage?.voice?.id, "campaign proactive text message should include attached voice metadata");
  assert.equal(campaign.textMessage.voice.assetStatus, "ready", "campaign proactive text voice should be ready when generator succeeds");
  assert.equal(campaign.productMessage?.voice?.id || "", "", "campaign product bubble should not receive a voice asset");

  const [assets] = await getDbPool().execute(
    `SELECT message_id, transcript, asset_status, audio_url
     FROM character_voice_assets
     WHERE character_id = ?
     ORDER BY created_at ASC`,
    [ids.character]
  );
  assert.equal(assets.length, 2, "plain proactive and campaign proactive text should create two voice assets");
  assert.equal(assets[0].message_id, proactiveMessage.id, "plain proactive voice asset should point to the text message");
  assert.equal(assets[0].transcript, proactiveMessage.text, "plain proactive voice transcript should match visible text");
  assert.equal(assets[1].message_id, campaign.textMessage.id, "campaign proactive voice asset should point to the campaign text message");
  assert.equal(assets[1].transcript, campaign.textMessage.text, "campaign proactive voice transcript should match visible text");

  console.log("proactive message voice self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Proactive Voice Site', ?, '', 'English', 'GBP', 'Europe/London', 'active', 0, NULL, '', 'proactive voice self-check')`,
    [ids.site, `proactive-voice-${suffix}`]
  );
  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
     VALUES (?, ?, ?, 'x', ?, 'active', 'personal', ?)`,
    [ids.user, ids.user, ids.user, `${ids.user}@example.local`, ids.site]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'creator', NULL, ?, ?, 'Proactive Voice Creator', 'Self Check', 'self-check', 'assets/char_fan.png', 'assets/banner_hero.png',
       'hello', 'self-check prompt', 'friendly', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Nova',
       JSON_ARRAY('creator'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'), JSON_OBJECT(),
       'public', 'published', 'self-check', 'proactive-voice-self-check', NOW(3))`,
    [ids.character, ids.site, `${ids.character}-slug`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, ?, ?, 'proactive voice self-check', 'active', 'user', 'proactive-voice-self-check', 'English', DATE_SUB(NOW(3), INTERVAL 5 HOUR))`,
    [ids.session, ids.user, ids.character]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'user', 'You', 'text', 'hello', 10, 'sent', 'user', 'self-check', DATE_SUB(NOW(3), INTERVAL 5 HOUR))`,
    [ids.seedMessage, ids.session, ids.character]
  );
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM character_voice_assets WHERE character_id = ?", [ids.character]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [ids.session]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [ids.session]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [ids.character]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [ids.site]).catch(() => {});
}
