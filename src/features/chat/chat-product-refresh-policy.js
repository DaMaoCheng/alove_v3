export const PRODUCT_DYNAMIC_REFRESH_TTL_MS = 4 * 60 * 60 * 1000;

export function hasFreshProductSnapshot(product = {}, now = Date.now()) {
  return isFreshTimestamp(product.livePriceFetchedAt, now);
}

export function hasFreshSizeChartResolution(product = {}, _now = Date.now()) {
  const chart = product?.sizeChart;
  return product?.sizeChartResolved === true || Boolean(
    chart
    && Array.isArray(chart.columns)
    && chart.columns.length >= 2
    && Array.isArray(chart.rows)
    && chart.rows.length > 0,
  );
}

function isFreshTimestamp(value, now) {
  const fetchedAt = Date.parse(value || "");
  if (!Number.isFinite(fetchedAt)) return false;
  return now - fetchedAt >= 0 && now - fetchedAt < PRODUCT_DYNAMIC_REFRESH_TTL_MS;
}
