export const ACTIVE_CREATOR_OWNER_UNIQUE_INDEX = "uniq_ai_characters_active_creator_owner";

export function isActiveCreatorOwnerConflict(error) {
  if (error?.code !== "ER_DUP_ENTRY") return false;
  return String(error?.message || "").includes(ACTIVE_CREATOR_OWNER_UNIQUE_INDEX);
}
