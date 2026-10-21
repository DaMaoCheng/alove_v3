import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from "../../../shared/payment-methods.js";

const PAYMENT_METHOD_MAP = new Map(PAYMENT_METHOD_OPTIONS.map((option) => [option.key, option]));

export function bindSitePaymentMethodPicker(host) {
  const picker = host.querySelector("[data-site-payment-picker]");
  if (!picker) return;
  const input = picker.querySelector("[data-site-payment-value]");
  const touchedInput = picker.querySelector("[data-site-payment-touched]");
  const tags = picker.querySelector("[data-site-payment-tags]");
  const search = picker.querySelector("[data-site-payment-search]");
  const optionsHost = picker.querySelector("[data-site-payment-options]");
  const trigger = picker.querySelector("[data-site-payment-trigger]");
  const menu = picker.querySelector("[data-site-payment-menu]");
  const selected = new Set(normalizePaymentMethods(input?.value || ""));
  let open = false;

  const render = () => {
    const query = String(search?.value || "").trim().toLowerCase();
    const matches = PAYMENT_METHOD_OPTIONS.filter((option) => paymentSearchText(option).includes(query));
    if (input) input.value = Array.from(selected).join(",");
    renderTags(tags, selected);
    picker.classList.toggle("is-open", open);
    trigger?.setAttribute("aria-expanded", open ? "true" : "false");
    syncFloatingMenu({ picker, trigger, menu, open });
    if (!optionsHost) return;
    optionsHost.innerHTML = matches.length
      ? matches.map((option) => optionHtml(option, selected.has(option.key))).join("")
      : `<div class="log-empty">没有匹配的支付方式</div>`;
  };
  const markTouched = () => {
    if (touchedInput) touchedInput.value = "1";
  };

  optionsHost?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-site-payment-option]");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    const key = option.dataset.sitePaymentOption || "";
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    markTouched();
    open = true;
    render();
  });

  tags?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-site-payment-remove]");
    if (!remove) return;
    event.stopPropagation();
    selected.delete(remove.dataset.sitePaymentRemove || "");
    markTouched();
    render();
  });

  search?.addEventListener("input", () => {
    open = true;
    render();
  });
  search?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  menu?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  trigger?.addEventListener("click", () => {
    open = !open;
    render();
    if (open) window.setTimeout(() => search?.focus(), 0);
  });

  trigger?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    trigger.click();
  });

  const closeOnOutsideClick = (event) => {
    if (picker.contains(event.target) || menu?.contains(event.target)) return;
    if (!open) return;
    open = false;
    render();
  };
  const reposition = () => {
    if (!open) return;
    positionFloatingMenu(trigger, menu);
  };
  document.addEventListener("click", closeOnOutsideClick);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  const observer = new MutationObserver(() => {
    if (document.body.contains(host)) return;
    document.removeEventListener("click", closeOnOutsideClick);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
    removeFloatingMenu(menu);
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true });

  render();
}

function renderTags(host, selected) {
  if (!host) return;
  const selectedOptions = Array.from(selected).map((key) => PAYMENT_METHOD_MAP.get(key)).filter(Boolean);
  host.innerHTML = selectedOptions.length
    ? selectedOptions.map((option) => `<button type="button" data-site-payment-remove="${escapeAttr(option.key)}"><img src="${escapeAttr(option.icon)}" alt="" /><span>${escapeHtml(option.label)}</span><i>×</i></button>`).join("")
    : `<span class="muted">未配置，产品详情不展示支付方式</span>`;
}

function optionHtml(option, active) {
  return `<button class="site-payment-method-option ${active ? "is-active" : ""}" type="button" data-site-payment-option="${escapeAttr(option.key)}"><img src="${escapeAttr(option.icon)}" alt="" /><span>${escapeHtml(option.label)}</span><small>${active ? "已选" : ""}</small></button>`;
}

function paymentSearchText(option = {}) {
  return `${option.key || ""} ${option.label || ""}`.toLowerCase();
}

function syncFloatingMenu({ picker, trigger, menu, open }) {
  if (!menu) return;
  if (!open) {
    menu.hidden = true;
    removeFloatingMenu(menu, picker);
    return;
  }
  if (menu.parentElement !== document.body) {
    document.body.append(menu);
  }
  menu.hidden = false;
  menu.classList.add("is-floating");
  positionFloatingMenu(trigger, menu);
}

function positionFloatingMenu(trigger, menu) {
  if (!trigger || !menu || menu.hidden) return;
  const rect = trigger.getBoundingClientRect();
  const margin = 16;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin));
  const top = rect.bottom + 6;
  const maxHeight = Math.max(180, window.innerHeight - top - margin);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${rect.width}px`;
  menu.style.maxHeight = `${maxHeight}px`;
}

function removeFloatingMenu(menu, picker) {
  if (!menu) return;
  if (!picker) {
    menu.remove();
    return;
  }
  menu.classList.remove("is-floating");
  menu.removeAttribute("style");
  if (picker && menu.parentElement !== picker) {
    picker.append(menu);
  }
}

function escapeHtml(value = "") {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
