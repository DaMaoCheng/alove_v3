import { ICONS } from "../../icons/icons.js";
import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";

const RANGE_OPTIONS = [
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["90d", "90 days"],
];

const TREND_OPTIONS = [
  ["conversations", "Conversations"],
  ["productTriggers", "Product triggers"],
  ["storeVisits", "Store visits"],
];

export function creatorDashboardHtml(state = {}) {
  const viewState = normalizeState(state);
  return `
    <div class="admin-body creator-dashboard" data-creator-dashboard>
      <div class="creator-dashboard-head">
        <div>
          <h2>Performance overview</h2>
          <p>See how people interact with your creator character.</p>
        </div>
        <div class="seg creator-range" data-creator-range aria-label="Performance date range">
          ${RANGE_OPTIONS.map(([value, label]) => `<button class="${viewState.range === value ? "active" : ""}" type="button" data-range="${value}">${label}</button>`).join("")}
        </div>
      </div>
      ${dashboardStatusHtml(viewState)}
      <div class="kpi-row creator-kpi-row">
        ${metricCardHtml({ label: "Conversations", value: viewState.summary.conversations, change: viewState.comparison.conversations, icon: ICONS.chat, status: viewState.status })}
        ${metricCardHtml({ label: "Product triggers", value: viewState.summary.productTriggers, change: viewState.comparison.productTriggers, icon: ICONS.shop, status: viewState.status })}
        ${metricCardHtml({ label: "Store visits", value: viewState.summary.storeVisits, change: viewState.comparison.storeVisits, icon: ICONS.globe, status: viewState.status })}
        ${metricCardHtml({ label: "Visit rate", value: viewState.summary.visitRate, change: viewState.comparison.visitRate, icon: ICONS.compass, percent: true, status: viewState.status })}
      </div>
      <section class="panel creator-trend-panel" aria-labelledby="creatorTrendTitle">
        <div class="creator-trend-head">
          <div>
            <h3 id="creatorTrendTitle">Performance trend</h3>
            <span>${rangeLabel(viewState.range)}</span>
          </div>
          <div class="seg creator-trend-switch" data-creator-trend-switch aria-label="Trend metric">
            ${TREND_OPTIONS.map(([value, label]) => `<button class="${viewState.metric === value ? "active" : ""}" type="button" data-metric="${value}">${label}</button>`).join("")}
          </div>
        </div>
        ${trendBodyHtml(viewState)}
      </section>
      <div class="creator-insights-grid">
        ${audienceLoyaltyHtml(viewState)}
        ${topProductsHtml(viewState)}
      </div>
    </div>
  `;
}

function normalizeState(state = {}) {
  return {
    range: RANGE_OPTIONS.some(([value]) => value === state.range) ? state.range : "30d",
    metric: TREND_OPTIONS.some(([value]) => value === state.metric) ? state.metric : "conversations",
    status: ["loading", "ready", "empty", "error", "pending"].includes(state.status) ? state.status : "pending",
    error: String(state.error || ""),
    character: state.character === null ? null : state.character || undefined,
    summary: state.summary || {},
    comparison: state.comparison || {},
    trend: Array.isArray(state.trend) ? state.trend : [],
    audience: state.audience || {},
    topProducts: Array.isArray(state.topProducts) ? state.topProducts.slice(0, 5) : [],
  };
}

function audienceLoyaltyHtml(state) {
  const ready = state.status === "ready";
  const uniqueChatters = ready ? Number(state.audience.uniqueChatters) : null;
  const newChatters = ready ? Number(state.audience.newChatters) : null;
  const returningChatters = ready ? Number(state.audience.returningChatters) : null;
  const averageMessages = ready ? Number(state.audience.averageMessages) : null;
  const returnRate = ready && Number.isFinite(Number(state.audience.returnRate)) ? Number(state.audience.returnRate) : null;
  const ringProgress = returnRate == null ? 0 : Math.min(Math.max(returnRate, 0), 100);
  return `
    <section class="panel creator-audience-panel" aria-labelledby="creatorAudienceTitle">
      <div class="creator-section-head">
        <div><h3 id="creatorAudienceTitle">Audience loyalty</h3><span>${rangeLabel(state.range)}</span></div>
      </div>
      <div class="creator-audience-overview">
        <div class="creator-audience-ring" style="--audience-progress:${ringProgress}" aria-label="${returnRate == null ? "Return rate unavailable" : `${formatPercent(returnRate)} return rate`}">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="creator-audience-ring-track" cx="60" cy="60" r="48"></circle>
            <circle class="creator-audience-ring-value" cx="60" cy="60" r="48"></circle>
          </svg>
          <div><strong>${returnRate == null ? "--" : formatPercent(returnRate)}</strong><span>Return rate</span></div>
        </div>
        <div class="creator-audience-split">
          ${audienceSplitHtml("New chatters", newChatters, "new")}
          ${audienceSplitHtml("Returning", returningChatters, "returning")}
        </div>
      </div>
      <div class="creator-audience-stats">
        ${audienceStatHtml("Unique chatters", uniqueChatters)}
        ${audienceStatHtml("Avg. messages", averageMessages, 1)}
      </div>
    </section>
  `;
}

function audienceSplitHtml(label, value, tone) {
  return `<div class="creator-audience-split-row"><i class="${escapeAttr(tone)}"></i><span>${escapeHtml(label)}</span><strong>${formatValue(value, false)}</strong></div>`;
}

function audienceStatHtml(label, value, decimals = 0) {
  const numeric = Number(value);
  const displayValue = Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "--";
  return `<div><span>${escapeHtml(label)}</span><strong>${displayValue}</strong></div>`;
}

function topProductsHtml(state) {
  return `
    <section class="panel creator-products-panel" aria-labelledby="creatorProductsTitle">
      <div class="creator-section-head">
        <div><h3 id="creatorProductsTitle">Top products</h3><span>Ranked by product triggers · ${rangeLabel(state.range)}</span></div>
      </div>
      ${state.status === "ready" && state.topProducts.length ? `
        <div class="creator-product-table">
          <div class="creator-product-table-head"><span>Product</span><span>Triggers</span><span>Visits</span><span>Visit rate</span></div>
          ${state.topProducts.map((product) => topProductRowHtml(product)).join("")}
        </div>
      ` : `<div class="creator-products-empty">${state.status === "pending" ? "Product ranking will appear after analytics is connected." : "No product activity in this period."}</div>`}
    </section>
  `;
}

function topProductRowHtml(product) {
  const productTriggers = Number(product.productTriggers);
  const storeVisits = Number(product.storeVisits);
  const visitRate = Number.isFinite(Number(product.visitRate)) ? Number(product.visitRate) : null;
  const imageUrl = normalizeAssetUrl(product.imageUrl || "/assets/jersey_product.png");
  return `
    <div class="creator-product-row">
      <div class="creator-product-identity"><span><img src="${escapeAttr(imageUrl)}" alt="" loading="lazy" /></span><strong>${escapeHtml(product.name || "Product")}</strong></div>
      <span data-label="Triggers">${formatValue(productTriggers, false)}</span>
      <span data-label="Visits">${formatValue(storeVisits, false)}</span>
      <span data-label="Visit rate">${visitRate == null ? "--" : formatPercent(visitRate)}</span>
    </div>
  `;
}

function dashboardStatusHtml(state) {
  if (state.status === "error") {
    return `<div class="creator-status error" role="alert"><span>${ICONS.warn}</span><div><strong>Performance data could not be loaded</strong><small>${escapeHtml(state.error || "Try again in a moment.")}</small></div><button type="button" data-creator-retry>Retry</button></div>`;
  }
  if (state.status === "pending") {
    return `<div class="creator-status pending"><span>${ICONS.spark}</span><div><strong>Analytics connection pending</strong><small>The dashboard layout is ready. Real performance data will appear after the reporting service is connected.</small></div></div>`;
  }
  if (state.status === "ready" && state.character === null) {
    return `<div class="creator-status pending"><span>${ICONS.spark}</span><div><strong>No creator character is linked yet</strong><small>Your performance will appear here after an active creator character is assigned to this account.</small></div></div>`;
  }
  return "";
}

function metricCardHtml({ label, value, change, icon, percent = false, status }) {
  const displayValue = status === "ready" ? formatValue(value, percent) : "--";
  return `
    <div class="kpi cw-kpi ${status === "loading" ? "is-loading" : ""}">
      <div class="cw-kpi-ic">${icon}</div>
      <div class="kpi-k">${escapeHtml(label)}</div>
      <div class="kpi-v">${displayValue}</div>
      ${comparisonHtml(change, status)}
    </div>
  `;
}

function comparisonHtml(change, status) {
  if (status === "loading") return `<div class="creator-skeleton creator-skeleton-short"></div>`;
  if (status !== "ready" || !change || change.percent == null) return `<div class="kpi-d neutral">Previous period: --</div>`;
  const direction = change.direction === "up" ? "up" : change.direction === "down" ? "down" : "neutral";
  const symbol = direction === "up" ? "+" : direction === "down" ? "-" : "";
  return `<div class="kpi-d ${direction}">${symbol}${formatPercent(Math.abs(Number(change.percent) || 0))} vs previous period</div>`;
}

function trendBodyHtml(state) {
  if (state.status === "loading") {
    return `<div class="creator-chart is-loading" aria-label="Loading performance trend"><div class="creator-chart-grid"></div><div class="creator-skeleton creator-skeleton-chart"></div></div>`;
  }
  if (state.status === "error") {
    return `<div class="creator-chart-empty"><span>${ICONS.warn}</span><strong>Trend unavailable</strong><small>Reload the dashboard to try again.</small></div>`;
  }
  if (state.status !== "ready" || !state.trend.length) {
    const pending = state.status === "pending";
    return `<div class="creator-chart-empty"><span>${pending ? ICONS.spark : ICONS.chat}</span><strong>${pending ? "Trend preview is ready" : "No activity in this period"}</strong><small>${pending ? "The selected metric will be plotted here after analytics is connected." : "Try a longer date range when more activity is available."}</small></div>`;
  }
  return lineChartHtml(state.trend, state.metric);
}

function lineChartHtml(points, metric) {
  const values = points.map((point) => Number(point?.[metric] || 0));
  const max = Math.max(...values, 1);
  const width = 900;
  const height = 240;
  const paddingX = 18;
  const paddingY = 20;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const chartPoints = values.map((value, index) => {
    const x = paddingX + (values.length === 1 ? usableWidth / 2 : index / (values.length - 1) * usableWidth);
    const y = paddingY + usableHeight - value / max * usableHeight;
    return { x, y };
  });
  const coordinates = chartPoints.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `
    <div class="creator-chart" role="img" aria-label="${escapeAttr(trendMetricLabel(metric))} trend for ${values.length} days">
      <div class="creator-chart-grid"></div>
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${coordinates}" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></polyline>
        ${chartPoints.map(({ x, y }, index) => `<circle class="creator-chart-hit-point" data-creator-chart-point data-index="${index}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1"></circle>`).join("")}
      </svg>
      <div class="creator-chart-guide" data-creator-chart-guide aria-hidden="true"></div>
      <div class="creator-chart-marker" data-creator-chart-marker aria-hidden="true"></div>
      <div class="creator-chart-labels"><span>${escapeHtml(points[0]?.label || "")}</span><span>${escapeHtml(points.at(-1)?.label || "")}</span></div>
    </div>
  `;
}

function trendMetricLabel(metric) {
  return TREND_OPTIONS.find(([value]) => value === metric)?.[1] || "Performance";
}

function rangeLabel(range) {
  return RANGE_OPTIONS.find(([value]) => value === range)?.[1] || "30 days";
}

function formatValue(value, percent) {
  if (percent) return value == null ? "--" : formatPercent(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US") : "--";
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "--";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
