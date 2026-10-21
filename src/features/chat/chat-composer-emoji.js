export const EMOJIS = ["⚽", "🥅", "🏆", "🔥", "💪", "👕", "👟", "😎", "😄", "😂", "😍", "🤩", "😉", "😊", "😏", "🤯", "🥳", "🙌", "👏", "👍", "👊", "✌️", "🤝", "🙏", "❤️", "💚", "⭐", "⚡", "🎉", "💯", "🚀", "👀", "😤", "😮", "🤔", "🎟️", "💰", "✅"];

export function bindEmojiPicker(root, { onChange } = {}) {
  bindEmojiOutsideClose();
  root.querySelector("[data-emoji-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    root.querySelector("#emojiPop")?.classList.toggle("open");
  });
  root.querySelectorAll("[data-emoji]").forEach((button) => {
    button.addEventListener("click", () => {
      insertEmoji(root, button.dataset.emoji);
      onChange?.();
    });
  });
}

function bindEmojiOutsideClose() {
  if (window.__aioveEmojiOutsideCloseBound) return;
  window.__aioveEmojiOutsideCloseBound = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest(".emoji-pop") || event.target.closest("[data-emoji-toggle]")) {
      return;
    }
    closeEmojiPopups();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeEmojiPopups();
    }
  });
}

function closeEmojiPopups() {
  document.querySelectorAll(".emoji-pop.open").forEach((popup) => popup.classList.remove("open"));
}

function insertEmoji(root, emoji) {
  const input = root.querySelector("#msgInput");
  if (!input) return;
  input.value += emoji;
  input.focus();
}
