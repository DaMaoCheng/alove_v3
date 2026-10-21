import { creatorDashboardHtml } from "./creator-dashboard-template.js";

const METRIC_LABELS = {
  conversations: "Conversations",
  productTriggers: "Product triggers",
  storeVisits: "Store visits",
};

export function mountCreatorDashboard(root, initialState = {}, { loadRangeState = null } = {}) {
  if (!root) return () => {};
  const tooltip = createChartTooltip();
  let cleanupChartHover = () => {};
  let requestSequence = 0;
  const state = {
    range: "30d",
    metric: "conversations",
    status: "pending",
    summary: {},
    comparison: {},
    trend: [],
    ...initialState,
  };

  const render = () => {
    cleanupChartHover();
    hideChartTooltip(tooltip);
    root.innerHTML = creatorDashboardHtml(state);
    bindEvents();
  };

  const bindEvents = () => {
    root.querySelectorAll("[data-creator-range] [data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        const range = button.dataset.range || "30d";
        const metric = state.metric;
        loadRange(range, metric);
      });
    });
    root.querySelectorAll("[data-creator-trend-switch] [data-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        state.metric = button.dataset.metric || "conversations";
        render();
      });
    });
    root.querySelector("[data-creator-retry]")?.addEventListener("click", () => loadRange(state.range, state.metric));
    cleanupChartHover = bindChartHover(root.querySelector(".creator-chart"), state, tooltip);
  };

  const loadRange = async (range, metric = state.metric) => {
    const requestId = ++requestSequence;
    Object.assign(state, { range, metric, status: "loading", error: "" });
    render();
    if (typeof loadRangeState !== "function") {
      Object.assign(state, { status: "error", error: "Analytics service is unavailable." });
      render();
      return;
    }
    try {
      const result = await loadRangeState(range);
      if (requestId !== requestSequence) return;
      Object.assign(state, result || {}, { range, metric, status: "ready", error: "" });
    } catch (error) {
      if (requestId !== requestSequence) return;
      Object.assign(state, { range, metric, status: "error", error: error?.message || "Try again in a moment." });
    }
    render();
  };

  loadRange(state.range, state.metric);
  return () => {
    requestSequence += 1;
    cleanupChartHover();
    tooltip.remove();
    root.replaceChildren();
  };
}

function createChartTooltip() {
  document.querySelectorAll(".creator-chart-tooltip").forEach((existingTooltip) => existingTooltip.remove());
  const tooltip = document.createElement("div");
  tooltip.className = "creator-chart-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;

  const label = document.createElement("span");
  label.className = "creator-chart-tooltip-label";
  const value = document.createElement("strong");
  value.className = "creator-chart-tooltip-value";
  tooltip.append(label, value);
  document.body.append(tooltip);
  return tooltip;
}

function bindChartHover(chart, state, tooltip) {
  if (!chart || state.status !== "ready" || !state.trend.length) return () => {};
  const svg = chart.querySelector("svg");
  const guide = chart.querySelector("[data-creator-chart-guide]");
  const marker = chart.querySelector("[data-creator-chart-marker]");
  const pointElements = [...chart.querySelectorAll("[data-creator-chart-point]")];
  if (!svg || !guide || !marker || !pointElements.length) return () => {};

  chart.addEventListener("pointermove", (event) => {
    const chartRect = chart.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const progress = clamp((event.clientX - svgRect.left) / svgRect.width, 0, 1);
    const index = Math.round(progress * (state.trend.length - 1));
    const point = state.trend[index];
    const pointElement = pointElements[index];
    if (!point || !pointElement) return;

    const viewBox = svg.viewBox.baseVal;
    const x = Number(pointElement.getAttribute("cx")) / viewBox.width * svgRect.width + svgRect.left - chartRect.left;
    const y = Number(pointElement.getAttribute("cy")) / viewBox.height * svgRect.height + svgRect.top - chartRect.top;
    guide.style.left = `${x}px`;
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    guide.hidden = false;
    marker.hidden = false;

    tooltip.querySelector(".creator-chart-tooltip-label").textContent = point.label || "";
    tooltip.querySelector(".creator-chart-tooltip-value").textContent = `${METRIC_LABELS[state.metric] || "Performance"}: ${formatMetricValue(point[state.metric])}`;
    tooltip.hidden = false;
    positionChartTooltip(tooltip, event.clientX, event.clientY);
  });

  const hideHoverState = () => {
    hideChartTooltip(tooltip);
    guide.hidden = true;
    marker.hidden = true;
  };
  chart.addEventListener("pointerleave", hideHoverState);
  chart.addEventListener("mouseleave", hideHoverState);
  const hideWhenOutsideChart = (event) => {
    if (!chart.isConnected) {
      document.removeEventListener("pointermove", hideWhenOutsideChart);
      return;
    }
    if (!chart.contains(event.target)) hideHoverState();
  };
  document.addEventListener("pointermove", hideWhenOutsideChart);
  return () => {
    document.removeEventListener("pointermove", hideWhenOutsideChart);
    hideHoverState();
  };
}

function positionChartTooltip(tooltip, clientX, clientY) {
  const gap = 14;
  const edge = 10;
  const rect = tooltip.getBoundingClientRect();
  let left = clientX + gap;
  let top = clientY - rect.height - gap;
  if (left + rect.width > window.innerWidth - edge) left = clientX - rect.width - gap;
  if (top < edge) top = clientY + gap;
  tooltip.style.left = `${clamp(left, edge, window.innerWidth - rect.width - edge)}px`;
  tooltip.style.top = `${clamp(top, edge, window.innerHeight - rect.height - edge)}px`;
}

function hideChartTooltip(tooltip) {
  tooltip.hidden = true;
}

function formatMetricValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US") : "--";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
