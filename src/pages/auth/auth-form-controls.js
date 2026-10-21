import { setCodeButtonBusy } from "./auth-form-state.js";

export function bindPasswordToggle(root, { copy = null } = {}) {
  root.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = root.querySelector(`#${button.dataset.passwordToggle}`);

      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      const shouldShow = target.type === "password";
      target.type = shouldShow ? "text" : "password";
      button.textContent = shouldShow ? (copy?.t("auth.hide") || "Hide") : (copy?.t("auth.show") || "Show");
    });
  });
}

export function bindCodeSender(root, onSendCode, { beforeSend, onResult, copy = null } = {}) {
  root.querySelectorAll("[data-code-send]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) {
        return;
      }

      const form = button.closest("form");
      const formData = form ? new FormData(form) : null;
      const canSend = await beforeSend?.({ formData, button });
      if (canSend === false) {
        return;
      }

      setCodeButtonBusy(button, true);
      const sent = await onSendCode?.({
        target: button.dataset.codeSend,
        email: String(formData?.get("email") || "").trim(),
      });
      onResult?.(sent);

      if (sent && typeof sent === "object" && sent.ok === false) {
        setCodeButtonBusy(button, false);
        return;
      }

      if (sent !== false) {
        startCountdown(button, copy);
        return;
      }

      setCodeButtonBusy(button, false);
    });
  });
}

function startCountdown(button, copy = null) {
  let seconds = 60;
  button.disabled = true;
  button.textContent = `${copy?.t("auth.resend") || "Resend"} (${seconds}s)`;

  const timer = window.setInterval(() => {
    seconds -= 1;

    if (seconds <= 0) {
      window.clearInterval(timer);
      button.disabled = false;
      button.textContent = copy?.t("auth.sendCode") || "Send code";
      return;
    }

    button.textContent = `${copy?.t("auth.resend") || "Resend"} (${seconds}s)`;
  }, 1000);
}
