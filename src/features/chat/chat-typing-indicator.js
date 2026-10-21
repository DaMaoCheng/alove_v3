import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function appendTypingIndicator(root, character = {}) {
  const body = root.querySelector("#chatBody");
  const container = root.querySelector(".chat-message-frame");
  if (!body || !container) return;

  removeTypingIndicator(root);
  container.append(createTypingIndicator(character, root.dataset.pageLanguage || "English"));
  scrollChatToBottom(body);
}

export function removeTypingIndicator(root) {
  root.querySelector("[data-chat-typing]")?.remove();
}

function createTypingIndicator(character, pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  const row = document.createElement("div");
  row.className = "msg them typing-msg";
  row.dataset.chatTyping = "1";
  row.innerHTML = `
    ${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl, className: "av" })}
    <div>
      <div class="bubble typing-bubble">
        <span class="typing-dots" aria-label="${copy.t("chat.typing")}"><i></i><i></i><i></i></span>
      </div>
    </div>
  `;
  return row;
}

function scrollChatToBottom(body) {
  body.scrollTop = body.scrollHeight;
}
