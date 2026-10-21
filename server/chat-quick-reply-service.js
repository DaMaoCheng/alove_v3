import { getDbPool } from "./db.js";
import { PRODUCT_TRIGGER_QUICK } from "./mascot-product-context-service.js";

const DAILY_TYPE = "daily";
const PRODUCT_TYPE = "product";
const PRODUCT_QUICK_REPLY_LIMIT = 3;
const DAILY_QUICK_REPLY_LIMIT = 3;

export async function listQuickRepliesForCharacter(characterId) {
  const character = await findCharacter(characterId);
  const categoryId = String(character?.category_id || "").trim();
  const canUseProductReplies = categoryId === "creator" || categoryId === "mascot";

  if (canUseProductReplies) {
    const productReplies = await listQuickRepliesByType(PRODUCT_TYPE, PRODUCT_QUICK_REPLY_LIMIT);
    return shuffleQuickReplies(productReplies).slice(0, 3);
  }

  return listQuickRepliesByType(DAILY_TYPE, DAILY_QUICK_REPLY_LIMIT);
}

async function findCharacter(characterId) {
  const id = String(characterId || "").trim();
  if (!id) return null;
  const [rows] = await getDbPool().execute(
    `SELECT id, category_id
     FROM ai_characters
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function listQuickRepliesByType(type, limit) {
  const normalizedType = type === PRODUCT_TYPE ? PRODUCT_TYPE : DAILY_TYPE;
  const safeLimit = Math.max(1, Math.min(3, Number(limit) || 1));
  const [rows] = await getDbPool().query(
    `SELECT id, quick_reply_type, text
     FROM chat_quick_replies
     WHERE quick_reply_type = ?
       AND is_active = 1
       AND locale = 'en'
     ORDER BY RAND()
     LIMIT ${safeLimit}`,
    [normalizedType]
  );
  return rows.map(mapQuickReply);
}

function mapQuickReply(row = {}) {
  const type = String(row.quick_reply_type || "").trim();
  if (type === PRODUCT_TYPE) {
    return {
      id: row.id || "",
      text: row.text || "",
      type,
      productTrigger: PRODUCT_TRIGGER_QUICK,
    };
  }

  return {
    id: row.id || "",
    text: row.text || "",
    type,
    productTrigger: "",
  };
}

function shuffleQuickReplies(replies = []) {
  const items = [...replies];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}
