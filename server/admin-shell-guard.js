import { sendHtml } from "./http-utils.js";
import { requireAdmin } from "./route-utils.js";

export async function guardAdminShellRoute(req, res) {
  if (!isAdminShellRequest(req)) return false;
  try {
    await requireAdmin(req);
    return false;
  } catch (error) {
    sendHtml(res, normalizeStatusCode(error?.statusCode), renderForbiddenAdminShell(error));
    return true;
  }
}

function isAdminShellRequest(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  return requestUrl.pathname === "/admin";
}

function renderForbiddenAdminShell(error) {
  const statusCode = normalizeStatusCode(error?.statusCode);
  const title = statusCode === 401 ? "Sign in required" : "Admin access required";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <h1>${title}</h1>
  </body>
</html>`;
}

function normalizeStatusCode(value) {
  const statusCode = Number(value || 403);
  return statusCode === 401 ? 401 : 403;
}
