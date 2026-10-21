import { getAdminGuestConversationDetail, listAdminGuestConversations } from "../../services/admin-account-service.js";
import { openConversationModal } from "./admin-account-conversations.js";

export function openGuestSessionConversation(guestSession) {
  const guestId = String(guestSession?.id || "").trim();
  if (!guestId) return;
  openConversationModal({
    owner: "guest",
    account: {
      id: guestId,
      username: `游客 #${guestSession?.displayId || ""}`,
      email: "",
    },
    listConversations: listAdminGuestConversations,
    getConversation: getAdminGuestConversationDetail,
  });
}
