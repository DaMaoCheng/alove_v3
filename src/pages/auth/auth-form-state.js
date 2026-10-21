export function setAuthMessage(host, text = "", tone = "error") {
  const message = host?.querySelector?.("[data-auth-message]");
  if (!message) return;

  if (!text) {
    clearAuthMessage(host);
    return;
  }

  message.textContent = text;
  message.hidden = false;
  message.dataset.tone = tone;
}

export function clearAuthMessage(host) {
  const message = host?.querySelector?.("[data-auth-message]");
  if (!message) return;
  message.textContent = "";
  message.hidden = true;
  delete message.dataset.tone;
}

export function setSubmitButtonBusy(host, isBusy, idleText, busyText = "Please wait...") {
  const button = host?.querySelector?.("[data-auth-submit]");
  if (!button) return;

  button.disabled = Boolean(isBusy);
  button.textContent = isBusy ? busyText : idleText;
}

export function setCodeButtonBusy(button, isBusy, idleText = "Send code", busyText = "Sending...") {
  if (!button) return;
  button.disabled = Boolean(isBusy);
  button.textContent = isBusy ? busyText : idleText;
}
