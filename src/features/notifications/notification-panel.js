import { ICONS } from "../../icons/icons.js";
import { submitFeedback } from "../../services/feedback-service.js";
import { showToast } from "../shared-ui/toast.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export const FEEDBACK_ICON = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 3V7a2 2 0 012-2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13 8.6v3.7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="13" cy="15.1" r="1" fill="currentColor"/></svg>';

export function notificationBellHtml({ guestMode = false, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  return `
    <div class="notif-wrap">
      <button class="icon-btn notif-btn" type="button" aria-label="${copy.t("feedback.send")}" title="${copy.t("feedback.send")}" data-notif-toggle>
        ${FEEDBACK_ICON}
      </button>
      ${feedbackPanelHtml({ guestMode, pageLanguage })}
    </div>
  `;
}

function feedbackPanelHtml({ guestMode = false, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  return `
    <div class="feedback-layer" data-notif-panel data-feedback-guest-mode="${guestMode ? "1" : "0"}" data-feedback-language="${copy.language.code}" hidden>
      <div class="dialog-scrim feedback-scrim" data-feedback-close></div>
      <form class="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" novalidate data-feedback-form>
        <button class="dlg-x" type="button" aria-label="${copy.t("feedback.close")}" data-feedback-close>${ICONS.close}</button>
        <div class="feedback-kicker">${FEEDBACK_ICON}<span>${copy.t("feedback.kicker")}</span></div>
        <h3 id="feedback-title">${copy.t("feedback.title")}</h3>
        <p class="feedback-copy">${copy.t("feedback.body")}</p>
        <label class="feedback-field">
          <span>${copy.t("feedback.subject")}</span>
          <input name="subject" maxlength="120" placeholder="${copy.t("feedback.subjectPlaceholder")}" autocomplete="off" data-feedback-subject />
        </label>
        <label class="feedback-field">
          <span>${copy.t("feedback.details")}</span>
          <textarea name="content" rows="5" maxlength="1200" placeholder="${copy.t("feedback.detailsPlaceholder")}" data-feedback-content></textarea>
        </label>
        ${guestMode ? `
          <label class="feedback-field feedback-email-field">
            <span>${copy.t("feedback.email")} <em>${copy.t("feedback.required")}</em><small data-feedback-email-status aria-live="polite"></small></span>
            <input name="contactEmail" type="email" inputmode="email" maxlength="255" placeholder="you@example.com" autocomplete="email" required data-feedback-contact-email />
          </label>` : ""}
        <div class="feedback-error" data-feedback-error hidden>${copy.t("feedback.missing")}</div>
        <div class="feedback-actions">
          <button class="btn btn-ghost" type="button" data-feedback-close>${copy.t("feedback.cancel")}</button>
          <button class="btn btn-primary" type="submit" data-feedback-submit>${ICONS.check}<span data-feedback-submit-label data-idle-label="${copy.t("feedback.send")}" data-sending-label="${copy.t("feedback.sending")}">${copy.t("feedback.send")}</span></button>
        </div>
      </form>
    </div>`;
}

export function bindNotifications(root = document, { guestMode = false, pageLanguage = "English" } = {}) {
  const wrap = root.querySelector(".notif-wrap");
  if (!wrap) return;
  const incomingPanel = root.querySelector("[data-notif-panel]");
  const expectedMode = guestMode ? "1" : "0";
  const languageCode = createSiteCopy(pageLanguage).language.code;
  const existingPanel = document.querySelector(`body > [data-notif-panel][data-feedback-guest-mode="${expectedMode}"][data-feedback-language="${languageCode}"]`);
  if (existingPanel && incomingPanel && incomingPanel !== existingPanel) incomingPanel.remove();
  const panel = prepareFeedbackPanel(existingPanel || incomingPanel, { guestMode, pageLanguage });
  if (!panel) return;
  root.querySelector("[data-notif-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (panel.hasAttribute("hidden")) openFeedbackDialog({ guestMode, pageLanguage });
    else closeNotifications();
  });
}

export function openFeedbackDialog({ guestMode = false, pageLanguage = "English" } = {}) {
  const panel = ensureFeedbackPanel({ guestMode, pageLanguage });
  if (!panel) return;
  panel.removeAttribute("hidden");
  document.body.classList.add("feedback-open");
  updateFeedbackSubmitAvailability(panel, { emailValidationPending: false });
  window.setTimeout(() => panel.querySelector("[data-feedback-subject]")?.focus(), 80);
}

function ensureFeedbackPanel({ guestMode = false, pageLanguage = "English" } = {}) {
  const expectedMode = guestMode ? "1" : "0";
  const languageCode = createSiteCopy(pageLanguage).language.code;
  let panel = document.querySelector(`body > [data-notif-panel][data-feedback-guest-mode="${expectedMode}"][data-feedback-language="${languageCode}"]`);
  if (panel) return prepareFeedbackPanel(panel, { guestMode });
  document.querySelectorAll("body > [data-notif-panel]").forEach((item) => item.remove());
  const host = document.createElement("div");
  host.innerHTML = feedbackPanelHtml({ guestMode, pageLanguage });
  panel = host.firstElementChild;
  document.body.appendChild(panel);
  return prepareFeedbackPanel(panel, { guestMode, pageLanguage });
}

function prepareFeedbackPanel(panel, { guestMode = false, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  if (!panel) return null;
  const expectedMode = guestMode ? "1" : "0";
  if (panel.dataset.feedbackGuestMode !== expectedMode) {
    panel.remove();
    return ensureFeedbackPanel({ guestMode, pageLanguage });
  }
  document.querySelectorAll("body > [data-notif-panel]").forEach((item) => {
    if (item !== panel) item.remove();
  });
  if (panel.parentElement !== document.body) document.body.appendChild(panel);
  if (panel.dataset.feedbackBound === "1") return panel;
  panel.dataset.feedbackBound = "1";
  const contactEmail = panel?.querySelector("[data-feedback-contact-email]");
  const emailStatus = panel?.querySelector("[data-feedback-email-status]");
  let emailValidationTimer = null;
  let emailValidationPending = false;
  updateFeedbackSubmitAvailability(panel, { emailValidationPending });
  panel?.addEventListener("click", (event) => event.stopPropagation());
  panel?.querySelectorAll("[data-feedback-close]").forEach((item) => {
    item.addEventListener("click", closeNotifications);
  });
  contactEmail?.addEventListener("input", () => {
    if (emailValidationTimer) window.clearTimeout(emailValidationTimer);
    emailValidationPending = true;
    setGuestFeedbackEmailStatus(emailStatus, "");
    updateFeedbackSubmitAvailability(panel, { emailValidationPending });
    emailValidationTimer = window.setTimeout(() => {
      emailValidationPending = false;
      const valid = isValidEmail(contactEmail.value);
      setGuestFeedbackEmailStatus(emailStatus, valid ? "" : copy.t("feedback.emailInvalid"));
      contactEmail.classList.toggle("is-invalid", !valid);
      updateFeedbackSubmitAvailability(panel, { emailValidationPending });
    }, 500);
  });
  panel?.querySelector("[data-feedback-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const subject = form.querySelector("[data-feedback-subject]");
    const content = form.querySelector("[data-feedback-content]");
    const error = form.querySelector("[data-feedback-error]");
    const submitButton = form.querySelector("[data-feedback-submit]");
    const submitLabel = form.querySelector("[data-feedback-submit-label]");
    const emailInput = form.querySelector("[data-feedback-contact-email]");
    if (emailValidationPending) return;
    const emailValid = !emailInput || isValidEmail(emailInput.value);
    const isValid = Boolean(subject?.value.trim() && content?.value.trim() && emailValid);
    subject?.classList.toggle("is-invalid", !subject?.value.trim());
    content?.classList.toggle("is-invalid", !content?.value.trim());
    emailInput?.classList.toggle("is-invalid", !emailValid);
    if (!isValid) {
      showFeedbackError(error, emailValid ? copy.t("feedback.missing") : copy.t("feedback.emailInvalid"));
      (emailValid ? (subject?.value.trim() ? content : subject) : emailInput)?.focus();
      return;
    }
    setFeedbackSubmitting(form, true, submitButton, submitLabel);
    let submitted = false;
    try {
      await submitFeedback({
        subject: subject.value,
        content: content.value,
        contactEmail: emailInput?.value || "",
        pagePath: `${window.location.pathname}${window.location.search}`,
      });
      submitted = true;
      window.dispatchEvent(new CustomEvent("aiove:feedback-submitted"));
      error.hidden = true;
      form.reset();
      subject?.classList.remove("is-invalid");
      content?.classList.remove("is-invalid");
      closeNotifications();
      showToast(copy.t("feedback.received"));
    } catch (feedbackError) {
      showFeedbackError(error, resolveFeedbackErrorMessage(feedbackError, copy));
    } finally {
      if (!submitted) {
        setFeedbackSubmitting(form, false, submitButton, submitLabel);
        updateFeedbackSubmitAvailability(panel, { emailValidationPending });
      }
    }
  });

  if (!window.__aioveNotifEscBound) {
    window.__aioveNotifEscBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeNotifications();
    });
  }
  return panel;
}

function updateFeedbackSubmitAvailability(panel, { emailValidationPending = false } = {}) {
  const submitButton = panel?.querySelector("[data-feedback-submit]");
  const emailInput = panel?.querySelector("[data-feedback-contact-email]");
  if (!submitButton) return;
  const emailInvalid = Boolean(emailInput && !isValidEmail(emailInput.value));
  submitButton.disabled = emailValidationPending || emailInvalid;
}

function setGuestFeedbackEmailStatus(statusElement, message) {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.hidden = !message;
}

function isValidEmail(value) {
  const email = String(value || "").trim();
  return email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function closeNotifications() {
  document.querySelectorAll(".notif-wrap.open").forEach((item) => item.classList.remove("open"));
  document.querySelectorAll("[data-notif-panel]").forEach((item) => item.setAttribute("hidden", ""));
  document.querySelectorAll("[data-feedback-form]").forEach((form) => {
    setFeedbackSubmitting(
      form,
      false,
      form.querySelector("[data-feedback-submit]"),
      form.querySelector("[data-feedback-submit-label]")
    );
  });
  document.body.classList.remove("feedback-open");
}

function showFeedbackError(errorElement, message) {
  if (!errorElement) return;
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function resolveFeedbackErrorMessage(error, copy) {
  if (error?.status === 409) {
    return copy.t("feedback.duplicate");
  }
  if (error?.status === 429) {
    return copy.t("feedback.rateLimited");
  }
  return copy.t("feedback.failed");
}

function setFeedbackSubmitting(form, submitting, submitButton, submitLabel) {
  form?.classList.toggle("is-submitting", submitting);
  if (submitButton) submitButton.disabled = submitting;
  if (submitLabel) submitLabel.textContent = submitting ? submitLabel.dataset.sendingLabel : submitLabel.dataset.idleLabel;
}
