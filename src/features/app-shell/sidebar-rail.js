export function collapseSidebarRail() {
  document.body.classList.add("rail");
}

export function expandSidebarRail() {
  document.body.classList.remove("rail");
}

export function collapseSidebarRailAfterMountIfExpanded() {
  if (document.body.classList.contains("rail")) return;
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      const collapseButton = document.querySelector(".rail-toggle");
      if (collapseButton) {
        collapseButton.click();
        return;
      }
      if (!document.body.classList.contains("rail")) {
        collapseSidebarRail();
      }
    }, 60);
  });
}
