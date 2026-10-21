// Storage retention and client visibility are deliberately independent.
export const CHAT_RETENTION_DAYS = Object.freeze({
  RAW_MESSAGES: 180,
  USER_VISIBLE_MESSAGES: 30,
  GUEST_VISIBLE_MESSAGES: 14,
  ADMIN_CONVERSATION_DEFAULT: 30,
});
