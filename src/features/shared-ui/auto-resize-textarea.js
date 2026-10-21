export function bindAutoResizeTextareas(root) {
  root.querySelectorAll("textarea[data-auto-resize]").forEach((textarea) => {
    resizeTextarea(textarea);
    textarea.addEventListener("input", () => resizeTextarea(textarea));
  });
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}
