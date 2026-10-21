import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function adminDateTimeFieldHtml(name, value, label) {
  const localValue = toLocalInputValue(value);
  return `
    <span class="promotion-datetime-control" data-admin-datetime-control>
      <span class="promotion-datetime-display${localValue ? "" : " is-placeholder"}" aria-hidden="true" data-admin-datetime-display>${escapeHtml(formatLocalDateTime(localValue))}</span>
      <input name="${escapeAttr(name)}" type="datetime-local" value="${escapeAttr(localValue)}" aria-label="${escapeAttr(label)}" data-admin-datetime />
    </span>
  `;
}

export function bindAdminDateTimeFields(host) {
  host.querySelectorAll("[data-admin-datetime]").forEach((input) => {
    const syncDisplay = () => syncAdminDateTimeDisplay(input);
    input.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || typeof input.showPicker !== "function") return;
      event.preventDefault();
      openDateTimePicker(input);
    });
    input.addEventListener("keydown", (event) => {
      if ((event.key !== "Enter" && event.key !== " ") || typeof input.showPicker !== "function") return;
      event.preventDefault();
      openDateTimePicker(input);
    });
    input.addEventListener("input", syncDisplay);
    input.addEventListener("change", syncDisplay);
    syncDisplay();
  });
}

export function readAdminDateTime(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? normalized : date.toISOString();
}

function openDateTimePicker(input) {
  try {
    input.showPicker();
  } catch {
    input.focus();
  }
}

function syncAdminDateTimeDisplay(input) {
  const display = input.closest("[data-admin-datetime-control]")?.querySelector("[data-admin-datetime-display]");
  if (!display) return;
  display.textContent = formatLocalDateTime(input.value);
  display.classList.toggle("is-placeholder", !input.value);
}

function formatLocalDateTime(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : "年/月/日 --:--";
}

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
