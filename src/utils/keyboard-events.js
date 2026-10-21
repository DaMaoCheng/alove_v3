export function isComposingText(event) {
  return Boolean(event?.isComposing || event?.keyCode === 229);
}

export function isPlainEnter(event) {
  return event?.key === "Enter" && !isComposingText(event);
}
