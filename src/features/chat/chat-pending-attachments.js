import { createSiteCopy } from "../../i18n/site-copy.js";

export function renderPendingAttachmentChips(attachments = [], { pageLanguage = "English", escapeAttribute, escapeHtml } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const rows = Array.isArray(attachments) ? attachments.filter(Boolean).slice(0, 5) : [];
  if (!rows.length) return "";
  return rows.map((attachment, index) => {
    const name = String(attachment?.name || attachment?.file?.name || "Attachment").trim();
    return `
      <span class="pending-attachment-chip" title="${escapeAttribute(name)}">
        <span class="pending-attachment-name">${escapeHtml(name)}</span>
        <button type="button" aria-label="${copy.t("chat.attachRemove")}" data-remove-pending-attachment="${index}">×</button>
      </span>
    `;
  }).join("");
}
