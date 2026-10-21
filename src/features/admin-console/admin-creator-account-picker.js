import { escapeHtml } from "./admin-console-utils.js";

export function bindAdminCreatorAccountPicker(host, { signal } = {}) {
  const picker = host.querySelector("[data-creator-account-picker]");
  if (!picker) return;
  const searchInput = picker.querySelector("[data-creator-account-search]");
  const valueInput = picker.querySelector("[data-creator-account-value]");
  const menu = picker.querySelector("[data-creator-account-menu]");
  const siteInput = host.querySelector("[data-creator-derived-site]");
  const options = Array.from(picker.querySelectorAll("[data-creator-account-option]"));

  searchInput?.addEventListener("input", () => renderMatches(options, searchInput.value));
  searchInput?.addEventListener("focus", () => picker.classList.add("is-open"));
  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) picker.classList.remove("is-open");
  }, signal ? { capture: true, signal } : { capture: true });

  options.forEach((option) => {
    option.addEventListener("click", () => {
      const label = option.dataset.accountLabel || "";
      const siteName = option.dataset.siteName || "未绑定站点";
      const siteSlug = option.dataset.siteSlug || "";
      if (valueInput) valueInput.value = option.dataset.accountId || "";
      if (searchInput) searchInput.value = label;
      if (siteInput) siteInput.value = siteSlug ? `${siteName} / ${siteSlug}` : siteName;
      picker.classList.remove("is-open");
    });
  });

  renderMatches(options, "");
  if (menu && !options.length) menu.hidden = false;
}

function renderMatches(options, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  let visibleCount = 0;
  options.forEach((option) => {
    const haystack = String(option.dataset.accountSearch || "").toLowerCase();
    const visible = !normalizedQuery || haystack.includes(normalizedQuery);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
    renderOptionLabel(option, normalizedQuery);
  });
  const picker = options[0]?.closest("[data-creator-account-picker]");
  picker?.classList.toggle("has-no-match", Boolean(normalizedQuery) && visibleCount === 0);
}

function renderOptionLabel(option, query) {
  const label = option.dataset.accountLabel || "";
  const small = option.querySelector("small")?.textContent || "";
  const labelHtml = query ? highlight(label, query) : escapeHtml(label);
  option.querySelector("b").innerHTML = labelHtml;
  const smallNode = option.querySelector("small");
  if (smallNode) smallNode.innerHTML = query ? highlight(small, query) : escapeHtml(small);
}

function highlight(text, query) {
  const value = String(text || "");
  const target = String(query || "").trim();
  if (!target) return escapeHtml(value);
  const lowerValue = value.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const index = lowerValue.indexOf(lowerTarget);
  if (index < 0) return escapeHtml(value);
  return `${escapeHtml(value.slice(0, index))}<mark>${escapeHtml(value.slice(index, index + target.length))}</mark>${escapeHtml(value.slice(index + target.length))}`;
}
