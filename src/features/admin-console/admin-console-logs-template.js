import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml, formatNumber, paginationButtonsHtml } from "./admin-console-utils.js";

const LEVEL_FILTERS = Object.freeze([
  ["all", "异常全部"],
  ["error", "错误"],
  ["warn", "警告"],
]);
const DEFAULT_SOURCE_OPTIONS = Object.freeze([["all", "全部来源"]]);

export function adminLogsHtml(state = {}) {
  const safeState = normalizeLogState(state);
  return `
    <div class="admin-body logs-page">
      <div class="admin-actions logs-actions">
        <label class="log-filter-field"><span>级别</span>${logDropdownHtml("level", safeState.level, LEVEL_FILTERS, "全部级别")}</label>
        <label class="log-filter-field"><span>开始日期</span><input type="date" data-log-start value="${escapeAttr(safeState.startDate)}" /></label>
        <label class="log-filter-field"><span>结束日期</span><input type="date" data-log-end value="${escapeAttr(safeState.endDate)}" /></label>
        <label class="log-filter-field"><span>来源</span>${logDropdownHtml("source", safeState.source, safeState.sourceOptions, "全部来源")}</label>
        <button class="btn btn-ghost sm" type="button" data-log-reset>重置</button>
      </div>
      <div class="panel logs-panel" data-admin-log-panel>${adminLogsPanelHtml(safeState)}</div>
    </div>
  `;
}

export function adminLogsLoadingHtml() {
  return `<div class="log-empty">正在加载日志...</div>`;
}

export function adminLogsErrorHtml(message) {
  return `<div class="log-empty">${escapeHtml(message || "日志读取失败，请稍后再试")}</div>`;
}

export function adminLogsPanelHtml(state = {}) {
  const safeState = normalizeLogState(state);
  return `
    <div class="log-list" data-admin-log-list>
      ${safeState.loading ? adminLogsLoadingHtml() : safeState.error ? adminLogsErrorHtml(safeState.error) : adminLogsRowsHtml(safeState.items)}
    </div>
    ${adminLogsPagerHtml(safeState)}
  `;
}

export function adminLogsRowsHtml(logs = []) {
  if (!logs.length) {
    return `<div class="log-empty">暂无日志记录</div>`;
  }

  return `
    <div class="log-head"><span>日期</span><span>级别</span><span>报错内容</span><span>来源</span></div>
    ${logs.map((log) => {
      const level = normalizeLevel(log.level);
      const message = buildLogMessage(log);
      const source = resolveLogSource(log);
      const time = formatLogTimeParts(log.createdAt);
      return `
        <div class="log-row">
          <span class="log-t"><b>${escapeHtml(time.time)}</b><small>${escapeHtml(time.date)}</small></span>
          <i class="pill ${levelClass(level)}">${level}</i>
          <span class="log-m" title="${escapeAttr(message)}">${escapeHtml(message)}</span>
          <span class="log-src" title="${escapeAttr(source)}">${escapeHtml(source)}</span>
        </div>
      `;
    }).join("")}
  `;
}

function adminLogsPagerHtml(state) {
  const page = Math.max(1, Number(state.page || 1));
  const pages = Math.max(1, Number(state.pages || 1));
  const limit = Math.max(1, Number(state.limit || 20));
  const itemCount = Number(state.items?.length || 0);
  const total = Math.max(Number(state.total || 0), itemCount);
  const rangeFrom = total && itemCount ? (page - 1) * limit + 1 : 0;
  const rangeTo = total && itemCount ? Math.min(total, rangeFrom + itemCount - 1) : 0;
  return `
    <div class="dt-pager log-pager">
      <span class="dt-pager-info">显示 ${formatNumber(rangeFrom)}-${formatNumber(rangeTo)}，共 ${formatNumber(total)} 条</span>
      <div class="dt-pager-btns">
        <button class="pg-btn" type="button" data-log-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
        ${paginationButtonsHtml(page, pages, "data-log-page")}
        <button class="pg-btn" type="button" data-log-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button>
      </div>
    </div>
  `;
}

function logDropdownHtml(name, value, items, placeholder) {
  return selectDropdownHtml({
    name: `log${name.slice(0, 1).toUpperCase()}${name.slice(1)}`,
    value,
    placeholder,
    items,
    className: `log-${name}-dd`,
  });
}

function normalizeLogState(state = {}) {
  const filters = state.filters || {};
  return {
    items: Array.isArray(state.items) ? state.items : [],
    loading: Boolean(state.loading),
    error: state.error || "",
    page: Number(state.page || 1),
    pages: Number(state.pages || 1),
    total: Number(state.total || 0),
    limit: Number(state.limit || 20),
    level: state.level || "all",
    source: state.source || "all",
    startDate: state.startDate || "",
    endDate: state.endDate || "",
    sourceOptions: normalizeSourceOptions(filters.sources, state.items),
  };
}

function normalizeOptions(items, fallback) {
  if (!Array.isArray(items) || !items.length) return fallback;
  const normalized = items.map((item) => Array.isArray(item) ? [String(item[0] || ""), String(item[1] || item[0] || "")] : [String(item.value || ""), String(item.label || item.value || "")]).filter(([value]) => value);
  return normalized.length ? normalized : fallback;
}

function normalizeSourceOptions(items, logs = []) {
  const options = normalizeOptions(items, []);
  const values = new Map(options.map(([value, label]) => [value, label]));
  (Array.isArray(logs) ? logs : []).forEach((log) => {
    const source = resolveLogSource(log);
    if (source && source !== "AI") values.set(source, source);
  });
  values.delete("all");
  return [["all", "全部来源"], ...Array.from(values.entries()).sort((left, right) => left[1].localeCompare(right[1]))];
}

function buildLogMessage(log) {
  if (log.logType === "app") {
    const type = log.type || "app_error";
    const status = log.statusCode ? `HTTP ${log.statusCode}` : "应用异常";
    const endpoint = log.endpoint || log.page || "未记录位置";
    const reason = log.errorMessage || log.safeMessage || "未记录错误详情";
    return `${type} · ${status} · ${endpoint} · ${reason}`;
  }

  const statusText = resolveStatusText(log.status);
  const model = log.model ? `模型 ${log.model}` : "模型未记录";
  const duration = log.durationMs ? `${log.durationMs}ms` : "耗时未记录";
  const reason = log.errorMessage || log.degradationReason || "";
  const operation = log.sourceRef ? ` · ${log.sourceRef}` : "";
  const suffix = reason ? ` · ${reason}` : "";
  return `${model} · ${statusText} · ${duration}${operation}${suffix}`;
}

function resolveLogSource(log) {
  if (log.logType === "app") return log.source || "server";
  return log.provider || log.sourceRef || log.source || "AI";
}

function resolveStatusText(status) {
  if (status === "provider_success") return "调用成功";
  if (status === "provider_error") return "调用失败";
  if (status === "error") return "调用失败";
  if (status === "quality_block") return "质量拦截";
  if (status === "quality_warn") return "质量警告";
  return "已降级";
}

function formatLogTimeParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { time: "--:--", date: "----/--/--" };
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const day = date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replaceAll("/", "-");
  return { time, date: day };
}

function normalizeLevel(level) {
  const normalized = String(level || "").toUpperCase();
  return ["INFO", "WARN", "ERROR"].includes(normalized) ? normalized : "INFO";
}

function levelClass(level) {
  if (level === "ERROR") return "off";
  if (level === "WARN") return "mid";
  return "on";
}
