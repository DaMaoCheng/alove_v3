export function bindProfileModalEvents(root, { onClose, onTabChange, onNavigate, onSave, onOrderOpen, onOrderBack, onLogout }) {
  root.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(".pm-scrim") || target.closest(".pm-close")) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    const tabButton = target.closest("[data-profile-tab]");
    if (tabButton) {
      event.preventDefault();
      event.stopPropagation();
      const nextTab = normalizeProfileTab(tabButton.dataset.profileTab);
      applyProfileTab(root, nextTab);
      onTabChange(nextTab);
      return;
    }

    const copyCodeButton = target.closest("[data-copy-invite-code]");
    if (copyCodeButton) {
      event.preventDefault();
      event.stopPropagation();
      copyInviteValue(root, copyCodeButton?.dataset?.inviteCode || root.querySelector(".ivc-val")?.textContent || "");
      return;
    }

    const copyLinkButton = target.closest("[data-copy-invite-link]");
    if (copyLinkButton) {
      event.preventDefault();
      event.stopPropagation();
      copyInviteValue(root, copyLinkButton?.dataset?.inviteLink || "");
      return;
    }

    const copyOrderButton = target.closest("[data-copy-order-number]");
    if (copyOrderButton) {
      event.preventDefault();
      event.stopPropagation();
      copyOrderNumber(copyOrderButton, copyOrderButton?.dataset?.orderNumber || "");
      return;
    }

    const orderButton = target.closest("[data-profile-order-id]");
    if (orderButton) {
      event.preventDefault();
      event.stopPropagation();
      onOrderOpen?.(orderButton.dataset.profileOrderId || "");
      return;
    }

    if (target.closest("[data-profile-orders-back]")) {
      event.preventDefault();
      event.stopPropagation();
      onOrderBack?.();
      return;
    }

    if (target.closest("[data-profile-logout]")) {
      event.preventDefault();
      event.stopPropagation();
      onLogout?.();
      return;
    }

    const saveButton = target.closest("[data-profile-save]");
    if (saveButton) {
      event.preventDefault();
      event.stopPropagation();
      onSave?.(readProfileForm(root));
      return;
    }

    const navButton = target.closest("[data-profile-nav]");
    if (navButton) {
      event.preventDefault();
      event.stopPropagation();
      onNavigate(navButton.dataset.profileNav);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element) || (event.key !== "Enter" && event.key !== " ")) return;
    const orderCard = event.target.closest("[data-profile-order-id]");
    if (!orderCard || event.target !== orderCard) return;
    event.preventDefault();
    event.stopPropagation();
    onOrderOpen?.(orderCard.dataset.profileOrderId || "");
  });
}

function applyProfileTab(root, tab) {
  root.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.profileTab === tab);
  });
  root.querySelectorAll("[data-profile-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.profilePanel !== tab;
  });
}

function normalizeProfileTab(tab = "profile") {
  return tab === "invite" || tab === "orders" ? tab : "profile";
}

function readProfileForm(root) {
  return {
    nickname: root.querySelector("[data-profile-nickname]")?.value || "",
    favoriteClub: root.querySelector("[data-profile-favorite-club]")?.value || "",
  };
}

async function copyInviteValue(root, value = "") {
  await copyProfileValue(value);
  const done = root.querySelector(".ivc-done");
  if (!done) return;

  done.classList.add("is-visible");
  window.setTimeout(() => {
    done.classList.remove("is-visible");
  }, 1400);
}

async function copyOrderNumber(button, value = "") {
  await copyProfileValue(value);
  button.classList.add("is-copied");
  button.setAttribute("aria-label", button.dataset.copiedLabel || button.dataset.copyLabel || "");
  window.clearTimeout(button.copyResetTimer);
  button.copyResetTimer = window.setTimeout(() => {
    button.classList.remove("is-copied");
    button.setAttribute("aria-label", button.dataset.copyLabel || "");
  }, 1400);
}

async function copyProfileValue(value = "") {
  if (value && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      fallbackCopy(value);
    }
  } else {
    fallbackCopy(value);
  }
}

function fallbackCopy(value) {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}
