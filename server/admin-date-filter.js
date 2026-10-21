const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_RANGES = new Set(["all", "today", "7d", "30d", "custom"]);

export function normalizeAdminDateFilter({ dateRange = "all", startDate = "", endDate = "" } = {}) {
  const range = DATE_RANGES.has(String(dateRange || "").trim()) ? String(dateRange || "").trim() : "all";
  const normalizedStart = normalizeDate(startDate);
  const normalizedEnd = normalizeDate(endDate);
  if (range !== "custom") return { dateRange: range, startDate: "", endDate: "" };
  if (!normalizedStart || !normalizedEnd || normalizedStart > normalizedEnd) {
    return { dateRange: "all", startDate: "", endDate: "" };
  }
  return { dateRange: range, startDate: normalizedStart, endDate: normalizedEnd };
}

export function appendAdminDateFilter(where, params, {
  dateRange = "all",
  startDate = "",
  endDate = "",
  expression,
} = {}) {
  const normalized = normalizeAdminDateFilter({ dateRange, startDate, endDate });
  if (!expression || normalized.dateRange === "all") return normalized;
  if (normalized.dateRange === "today") {
    where.push(`${expression} >= CURRENT_DATE AND ${expression} < DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY)`);
    return normalized;
  }
  if (normalized.dateRange === "7d") {
    where.push(`${expression} >= DATE_SUB(CURRENT_DATE, INTERVAL 6 DAY) AND ${expression} < DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY)`);
    return normalized;
  }
  if (normalized.dateRange === "30d") {
    where.push(`${expression} >= DATE_SUB(CURRENT_DATE, INTERVAL 29 DAY) AND ${expression} < DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY)`);
    return normalized;
  }
  where.push(`${expression} >= ? AND ${expression} < DATE_ADD(?, INTERVAL 1 DAY)`);
  params.push(normalized.startDate, normalized.endDate);
  return normalized;
}

function normalizeDate(value) {
  const normalized = String(value || "").trim();
  return DATE_PATTERN.test(normalized) ? normalized : "";
}
