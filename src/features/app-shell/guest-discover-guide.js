const GUIDE_DURATION_MS = 4000;
const GUIDE_POINTER_CLEARANCE_PX = 16;
const DESKTOP_BREAKPOINT_QUERY = "(min-width: 901px)";

export function shouldRenderGuestDiscoverGuide() {
  if (window.__aioveGuestDiscoverGuideDismissed) return false;
  const now = Date.now();
  const startedAt = Number(window.__aioveGuestDiscoverGuideStartedAt || 0);
  if (!startedAt) return true;
  if (now - startedAt >= GUIDE_DURATION_MS) {
    window.__aioveGuestDiscoverGuideDismissed = true;
    return false;
  }
  return true;
}

export function guestDiscoverGuideHtml(label = "") {
  return `<div class="guest-discover-guide" data-guest-discover-guide role="status"><span>${escapeHtml(label)}</span></div>`;
}

let disposeActiveGuide = null;

export function bindGuestDiscoverGuide(root) {
  // A route render replaces the owner, but never restarts the window deadline.
  disposeActiveGuide?.();
  const guide = root.querySelector("[data-guest-discover-guide]");
  const sidebar = root.querySelector(".sidebar");
  const discoverItem = root.querySelector('[data-view="discover"]');
  if (!guide || !sidebar || !discoverItem) return;
  const focus = document.createElement("div");
  focus.className = "guest-discover-guide-focus";
  const maskId = `guest-discover-guide-mask-${Math.random().toString(36).slice(2)}`;
  focus.innerHTML = guestDiscoverGuideMaskHtml(maskId);
  const maskHole = focus.querySelector(".guest-discover-guide-mask-hole");
  focus.setAttribute("aria-hidden", "true");
  let frame;
  let mounted = false;
  const cleanup = () => {
    cancelAnimationFrame(frame);
    discoverItem.removeEventListener("click", dismiss, true);
    sidebar.classList.remove("has-guest-discover-guide");
    guide.remove();
    focus.remove();
    if (disposeActiveGuide === cleanup) disposeActiveGuide = null;
  };
  const dismiss = () => {
    window.__aioveGuestDiscoverGuideDismissed = true;
    cleanup();
  };
  disposeActiveGuide = cleanup;
  discoverItem.addEventListener("click", dismiss, true);
  const update = () => {
    if (window.__aioveGuestDiscoverGuideDismissed) return cleanup();
    if (!sidebar.isConnected) { frame = requestAnimationFrame(update); return; }
    const elapsed = Date.now() - Number(window.__aioveGuestDiscoverGuideStartedAt);
    if (elapsed >= GUIDE_DURATION_MS) return dismiss();
    if (!mounted) {
      // Sidebar construction happens before its new shell is attached.
      sidebar.closest(".shell").append(focus);
      document.body.append(guide);
      window.__aioveGuestDiscoverGuideStartedAt = Date.now();
      mounted = true;
    }
    const desktop = window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches;
    const menuMode = !desktop && !document.body.classList.contains("drawer-open");
    const target = menuMode ? document.querySelector(".menu-btn") : discoverItem;
    if (target) {
      const rect = target.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      focus.style.setProperty("--focus-left", `${left}px`);
      focus.style.setProperty("--focus-top", `${top}px`);
      focus.style.setProperty("--focus-width", `${Math.max(0, Math.min(window.innerWidth, rect.right) - left)}px`);
      focus.style.setProperty("--focus-height", `${Math.max(0, Math.min(window.innerHeight, rect.bottom) - top)}px`);
      const radiusValue = getComputedStyle(target).borderTopLeftRadius || "10px";
      const parsedRadius = Number.parseFloat(radiusValue);
      const radius = radiusValue.includes("%")
        ? Math.min(rect.width, rect.height) * parsedRadius / 100
        : Math.min(parsedRadius || 10, rect.width / 2, rect.height / 2);
      focus.style.setProperty("--focus-radius", `${radius}px`);
      maskHole?.setAttribute("x", String(left));
      maskHole?.setAttribute("y", String(top));
      maskHole?.setAttribute("width", String(Math.max(0, Math.min(window.innerWidth, rect.right) - left)));
      maskHole?.setAttribute("height", String(Math.max(0, Math.min(window.innerHeight, rect.bottom) - top)));
      maskHole?.setAttribute("rx", String(radius));
      maskHole?.setAttribute("ry", String(radius));
      guide.classList.toggle("guest-discover-guide--mobile", menuMode);
      guide.classList.toggle("guest-discover-guide--drawer", !desktop && !menuMode);
      const rtl = getComputedStyle(sidebar).direction === "rtl";
      const labelRect = target.querySelector("span")?.getBoundingClientRect();
      const iconRect = target.querySelector("svg")?.getBoundingClientRect();
      const anchorRect = labelRect?.width && labelRect.height ? labelRect : (iconRect || rect);
      const edge = menuMode ? rect.left + rect.width / 2 : (rtl ? anchorRect.left - GUIDE_POINTER_CLEARANCE_PX : anchorRect.right + GUIDE_POINTER_CLEARANCE_PX);
      guide.style.top = `${menuMode ? rect.bottom + 8 : rect.top + rect.height / 2}px`;
      guide.style.left = rtl ? "auto" : `${Math.max(0, edge)}px`;
      guide.style.right = rtl ? `${Math.max(0, window.innerWidth - edge)}px` : "auto";
      guide.style.maxWidth = `${Math.max(0, (rtl ? edge : window.innerWidth - edge) - 12)}px`;
    }
    // One clock controls fade even across class changes and route remounts.
    const opacity = String(Math.max(0, Math.min(1, (GUIDE_DURATION_MS - elapsed) / 500)));
    guide.style.opacity = opacity;
    focus.style.opacity = opacity;
    // Rectangles must follow CSS transforms as well as rail width transitions.
    frame = requestAnimationFrame(update);
  };
  frame = requestAnimationFrame(update);
}

function guestDiscoverGuideMaskHtml(maskId) {
  return `<svg aria-hidden="true" focusable="false" width="100%" height="100%" preserveAspectRatio="none">
    <defs><mask id="${maskId}" maskUnits="userSpaceOnUse">
      <rect class="guest-discover-guide-mask-fill" width="100%" height="100%" fill="white"></rect>
      <rect class="guest-discover-guide-mask-hole" fill="black"></rect>
    </mask></defs>
    <rect class="guest-discover-guide-mask-layer" width="100%" height="100%" mask="url(#${maskId})"></rect>
  </svg>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}
