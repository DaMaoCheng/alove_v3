import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminLogsHtml, adminLogsPanelHtml, adminLogsRowsHtml } from "../src/features/admin-console/admin-console-logs-template.js";

const sampleLog = {
  logType: "app",
  level: "ERROR",
  type: "server_error",
  statusCode: 500,
  endpoint: "/api/demo",
  errorMessage: "Demo server error",
  source: "server",
  createdAt: "2026-06-16T03:25:00.000Z",
};

const pageHtml = adminLogsHtml({
  items: [sampleLog],
  loading: false,
  page: 1,
  pages: 1,
  total: 0,
  limit: 20,
  level: "warn",
  source: "ai-error",
  startDate: "2026-06-01",
  endDate: "2026-06-16",
  filters: {
    sources: [["all", "全部来源"], ["ai-error", "ai-error"]],
  },
});

assert.match(pageHtml, /class="admin-body logs-page"/, "logs page should use dedicated page class");
assert.match(pageHtml, /data-admin-log-panel/, "logs page should expose a replaceable table panel");
assert.doesNotMatch(pageHtml, /data-log-filter/, "logs page should not render the old segmented level filter");
assert.doesNotMatch(pageHtml, /data-log-type/, "logs page should not render the removed type filter");
assert.match(pageHtml, /<span>级别<\/span>/, "logs page should render level dropdown label");
assert.match(pageHtml, /data-dd-select/, "logs page filters should use global dropdowns");
assert.match(pageHtml, /name="logLevel" value="warn"/, "level filter should use hidden input state");
assert.match(pageHtml, /class="dd dd-select log-level-dd"/, "level filter should use global dropdown class");
assert.match(pageHtml, /name="logSource" value="ai-error"/, "source filter should use hidden input state");
assert.match(pageHtml, /class="dd dd-select log-source-dd"/, "source filter should use global dropdown class");
assert.match(pageHtml, /data-dd-action="ai-error"/, "source dropdown should render source options");
assert.match(pageHtml, /data-log-start/, "logs page should render start date filter");
assert.match(pageHtml, /data-log-end/, "logs page should render end date filter");
assert.match(pageHtml, /data-log-reset/, "logs page should render reset button");
assert.match(pageHtml, /显示 1-1，共 1 条/, "pager should fall back to rendered item count when total is missing");

const panelHtml = adminLogsPanelHtml({ items: [sampleLog], total: 1, page: 1, pages: 1, limit: 20 });
assert.match(panelHtml, /data-admin-log-list/, "panel render should include only the replaceable log list");
assert.doesNotMatch(panelHtml, /data-log-start|data-log-end|name="logLevel"|name="logSource"/, "panel render should not rebuild filter controls");

const rowsHtml = adminLogsRowsHtml([
  sampleLog,
  {
    logType: "ai_reply",
    level: "WARN",
    status: "fallback",
    model: "gpt-5.6-luna",
    durationMs: 1200,
    sourceRef: "ai-error",
    degradationReason: "fallback used",
    createdAt: "2026-06-15T20:10:00.000Z",
  },
  {
    logType: "ai_reply",
    level: "INFO",
    status: "provider_success",
    provider: "venice",
    model: "gemma-4-uncensored",
    sourceRef: "order-intent-classifier",
    durationMs: 350,
    createdAt: "2026-06-15T20:11:00.000Z",
  },
]);

assert.match(rowsHtml, /class="log-head"/, "logs table should render a header row");
assert.match(rowsHtml, /<span class="log-t"><b>\d{2}:\d{2}<\/b><small>2026-06-16<\/small><\/span>/, "date column should split time and date into separate containers");
assert.match(rowsHtml, /title="server_error · HTTP 500 · \/api\/demo · Demo server error"/, "message cell should expose full text in title");
assert.match(rowsHtml, /class="log-src"[^>]*>ai-error<\/span>/, "source cell should render AI source label");
assert.match(rowsHtml, /模型 gemma-4-uncensored · 调用成功 · 350ms · order-intent-classifier/, "provider calls should show success status and operation");
assert.match(rowsHtml, /class="log-src"[^>]*>venice<\/span>/, "provider calls should display the supplier as their source");

const css = readFileSync(new URL("../src/features/app-shell/styles/admin-logs.css", import.meta.url), "utf8");
assert.match(css, /\.logs-page\{[^}]*height:calc\(100vh - 76px\);[^}]*overflow:hidden;[^}]*\}/s, "logs page should occupy available viewport height");
assert.match(css, /\.logs-panel \.log-list\{[^}]*flex:1;[^}]*height:100%;[^}]*overflow:auto;[^}]*\}/s, "log list should fill panel height and own scrolling");
assert.match(css, /\.log-filter-field \.dd-select-trigger\{ min-height:36px; height:36px;/, "log dropdowns should use compact global dropdown styling");
assert.match(css, /grid-template-columns:112px 64px minmax\(220px,1fr\) 112px/, "log grid should allocate wider date and narrower source/message columns");
assert.match(css, /\.log-t small\{[^}]*font-size:9\.5px/, "log date should use smaller date text");

const controller = readFileSync(new URL("../src/features/admin-console/admin-logs-controller.js", import.meta.url), "utf8");
assert.match(controller, /bindDropdowns\(main\)/, "controller should bind global dropdown interactions after full page render");
assert.match(controller, /renderPanel/, "controller should support table-only refreshes");
assert.match(controller, /panel\.innerHTML = adminLogsPanelHtml\(logPageState\)/, "controller should refresh only the log panel during filtering");
assert.match(controller, /input\[name="logLevel"\]/, "controller should bind level dropdown hidden input");
assert.match(controller, /input\[name="logSource"\]/, "controller should bind source dropdown hidden input");
assert.match(controller, /scrollTo\(\{ top: 0 \}\)/, "pagination and filters should reset log scroll to top");
assert.match(controller, /limit = 20/, "controller should keep page size capped at 20");
assert.doesNotMatch(controller, /data-log-type/, "controller should not bind removed type filter");

const service = readFileSync(new URL("../src/services/admin-log-service.js", import.meta.url), "utf8");
assert.match(service, /params\.set\("page"/, "log service should send page parameter");
assert.match(service, /params\.set\("limit", "20"\)/, "log service should always request 20 rows per page");
assert.doesNotMatch(service, /params\.set\("type"/, "log service should not send removed type filter");
assert.match(service, /params\.set\("source"/, "log service should send source filter");
assert.match(service, /startDate/, "log service should send start date filter");
assert.match(service, /endDate/, "log service should send end date filter");

const server = readFileSync(new URL("../server/ai-reply-log-service.js", import.meta.url), "utf8");
assert.match(server, /UNION ALL/, "admin logs should merge AI and app logs before pagination");
assert.match(server, /COUNT\(\*\) AS total/, "admin logs should return total count");
assert.match(server, /source_label = \?/, "admin logs should support source filtering");
assert.match(server, /created_at >= \?/, "admin logs should support start date filtering");
assert.match(server, /created_at < \?/, "admin logs should support end date filtering");
assert.match(server, /status_code IS NULL OR status_code = 429 OR status_code >= 500/, "admin logs should hide expected historical 4xx records while retaining rate-limit warnings and server failures");

console.log("admin error log filters and pagination self-check passed");
