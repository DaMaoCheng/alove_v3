export function bindSiteMascotPicker(host) {
  const picker = host.querySelector("[data-site-mascot-picker]");
  if (!picker) return;
  const input = picker.querySelector("[data-site-mascot-input]");
  const trigger = picker.querySelector("[data-site-mascot-trigger]");
  const menu = picker.querySelector("[data-site-mascot-menu]");
  const options = picker.querySelector("[data-site-mascot-options]");
  const empty = picker.querySelector("[data-site-mascot-empty]");
  let open = false;

  const render = () => {
    const query = String(input?.value || "").trim().toLowerCase();
    let visibleCount = 0;
    options?.querySelectorAll("[data-site-mascot-option]").forEach((option) => {
      const matches = !query || String(option.dataset.search || "").includes(query);
      option.hidden = !matches;
      option.classList.toggle("is-active", option.dataset.siteMascotOption === String(input?.value || "").trim());
      if (matches) visibleCount += 1;
    });
    picker.classList.toggle("is-open", open);
    input?.setAttribute("aria-expanded", open ? "true" : "false");
    trigger?.setAttribute("aria-expanded", open ? "true" : "false");
    if (menu) menu.hidden = !open;
    if (empty) empty.hidden = visibleCount > 0;
  };

  const openMenu = () => {
    open = true;
    render();
  };

  input?.addEventListener("focus", openMenu);
  input?.addEventListener("input", openMenu);
  trigger?.addEventListener("click", () => {
    open = !open;
    render();
    if (open) window.setTimeout(() => input?.focus(), 0);
  });
  options?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-site-mascot-option]");
    if (!option || !input) return;
    input.value = option.dataset.siteMascotOption || "";
    open = false;
    render();
  });
  host.addEventListener("click", (event) => {
    if (!open || picker.contains(event.target)) return;
    open = false;
    render();
  });
  render();
}
