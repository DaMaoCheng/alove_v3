import { createSidebar } from "./app-sidebar.js";
export { createTopbar } from "./app-topbar.js";

export function createAppShell({ view, agent, accountType, user, contacts, guestMode = false, pageLanguage = "English", onNavigate, onOpenProfile, content }) {
  const shell = document.createElement("div");
  shell.className = "shell";
  shell.append(createSidebar({ view, agent, accountType, user, contacts, guestMode, pageLanguage, onNavigate, onOpenProfile }), createMain({ content }));
  return shell;
}

function createMain({ content }) {
  const main = document.createElement("main");
  main.className = "main";
  main.append(content);
  return main;
}
