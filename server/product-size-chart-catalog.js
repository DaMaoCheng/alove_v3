const MAX_NEAREST_AGE_DISTANCE_YEARS = 2;

const SIZE_CHART_CATALOG = Object.freeze([
  {
    id: "fan_short_sleeve",
    label: "Fan Version Short Sleeve",
    prefixes: ["CS", "NS", "CT", "NT", "CG", "NG", "FCS", "FNS", "CS,CK", "CT,CK", "GCS,CK", "NS,NK", "NT,NK"],
    chart: chart(
      ["Size", "Length", "Chest", "Height", "Weight"],
      [
        ["S", "70–72", "100–103", "160–170", "55–60"],
        ["M", "72–75", "104–108", "170–175", "60–70"],
        ["L", "75–77", "108–112", "175–180", "70–80"],
        ["XL", "77.5–80", "112–116", "180–185", "80–88"],
        ["2XL", "80–82", "116–120", "185–188", "88–92"],
        ["3XL", "82–84", "120–124", "188–192", "92–96"],
        ["4XL", "84–86", "124–128", "188–192", "96–102"],
      ],
    ),
  },
  {
    id: "order_fan_short_sleeve",
    label: "Order Fan Version Short Sleeve",
    prefixes: ["DCS", "DNS", "DCS,DCK", "DNS,DNK"],
    chart: chart(
      ["Size", "Back Body Length", "Chest", "Waist", "Hip", "Shoulder Slope"],
      [
        ["S", "73", "98", "95", "98", "43"],
        ["M", "75", "106", "103", "106", "45"],
        ["L", "77", "114", "111", "114", "47"],
        ["XL", "79", "122", "119", "122", "49"],
        ["2XL", "82", "131", "128", "131", "52"],
        ["3XL", "85", "140", "137", "140", "55"],
        ["4XL", "88", "149", "146", "149", "58"],
        ["5XL", "91", "158", "155", "158", "61"],
      ],
    ),
  },
  {
    id: "player_short_sleeve",
    label: "Player Version Short Sleeve",
    prefixes: ["NPV", "CPV", "CPV,CPVK", "NPV,NPVK"],
    chart: chart(
      ["Size", "Length", "Chest", "Height", "Weight"],
      [
        ["S", "70–72", "90–96", "160–165", "49–61"],
        ["M", "73–75", "96–100", "165–170", "61–70"],
        ["L", "75–77", "100–104", "170–175", "70–77"],
        ["XL", "77–79", "104–108", "175–180", "77–87"],
        ["2XL", "79–81", "108–112", "180–185", "87–92"],
        ["3XL", "81–83", "112–116", "185–190", "92–97"],
        ["4XL", "83–85", "116–120", "190–195", "97–107"],
      ],
    ),
  },
  {
    id: "order_player_short_sleeve",
    label: "Order Player Version Short Sleeve",
    prefixes: ["DNPV", "DCPV", "DCPV,CPVK", "DNPV,NPVK"],
    chart: chart(
      ["Size", "Waist", "Chest", "Height", "Weight"],
      [
        ["S", "92–98", "96–102", "160–170", "55–60"],
        ["M", "100–104", "104–110", "170–175", "60–70"],
        ["L", "106–112", "112–116", "175–180", "70–88"],
        ["XL", "114–118", "118–126", "180–185", "88–96"],
        ["2XL", "118–124", "128–132", "185–188", "96–110"],
        ["3XL", "126–134", "134–144", "188–192", "110–130"],
      ],
    ),
  },
  {
    id: "women",
    label: "Women",
    prefixes: ["NN", "CN"],
    chart: chart(
      ["Size", "Length", "Chest", "Height", "Weight"],
      [
        ["S", "65–68", "82–88", "155–165", "40–53"],
        ["M", "68–70", "89–94", "165–170", "53–58"],
        ["L", "70–72", "94–99", "170–175", "58–65"],
        ["XL", "72–74", "99–104", "175–180", "65–70"],
        ["2XL", "74–76", "104–108", "180–185", "70–75"],
      ],
    ),
  },
  {
    id: "fan_kids",
    label: "Fan Version Kids",
    prefixes: ["CTZ", "NTZ", "CTZ,CTW", "NTZ,NTW"],
    chart: chart(
      ["Size", "Age ref", "Height", "Weight", "Length", "Chest", "Shorts Length"],
      [
        ["#16", "2–3", "90–100", "15–20", "49–51", "67–69", "30–32"],
        ["#18", "4–5", "100–110", "20–25", "51–53", "69–73", "32–34"],
        ["#20", "6–7", "110–120", "25–30", "53–55", "73–77", "34–36"],
        ["#22", "8–9", "120–130", "30–35", "55–57", "77–81", "36–38"],
        ["#24", "10–11", "130–140", "35–40", "57–59", "81–85", "38–40"],
        ["#26", "12–13", "140–150", "40–45", "59–61", "85–89", "40–42"],
        ["#28", "14–15", "150–160", "45–50", "61–63", "89–93", "42–44"],
      ],
    ),
  },
  {
    id: "order_fan_kids",
    label: "Order Fan Version Kids",
    prefixes: ["DCTZ", "DNTZ", "DCTZ,CTW", "DNTZ,NTW"],
    chart: chart(
      ["Size", "Age ref", "Height", "Weight", "Length", "Chest", "Shorts Length"],
      [
        ["#14", "1–2", "80–90", "10–15", "47–49", "65–67", "28–30"],
        ["#16", "2–3", "90–100", "15–20", "49–51", "67–69", "30–32"],
        ["#18", "4–5", "100–110", "20–25", "51–53", "69–73", "32–34"],
        ["#20", "6–7", "110–120", "25–30", "53–55", "73–77", "34–36"],
        ["#22", "8–9", "120–130", "30–35", "55–57", "77–81", "36–38"],
        ["#24", "10–11", "130–140", "35–40", "57–59", "81–85", "38–40"],
        ["#26", "12–13", "140–150", "40–45", "59–61", "85–89", "40–42"],
        ["#28", "14–15", "150–160", "45–50", "61–63", "89–93", "42–44"],
      ],
    ),
  },
  {
    id: "fan_long_sleeve",
    label: "Fan Version Long Sleeve",
    prefixes: ["CLS", "NLS", "FCLS", "FNLS"],
    chart: chart(
      ["Size", "Chest", "Length", "Sleeve Length"],
      [
        ["S", "49–51", "69–71", "76–78"],
        ["M", "51–53", "71–73", "78–80"],
        ["L", "53–55", "73–75", "80–82"],
        ["XL", "55–57", "75–77", "82–84"],
        ["2XL", "57–59", "77–79", "84–86"],
        ["3XL", "59–61", "79–81", "86–88"],
        ["4XL", "61–63", "81–83", "88–90"],
      ],
    ),
  },
  {
    id: "adult_shorts",
    label: "Adult Shorts",
    prefixes: ["CK", "NK"],
    chart: chart(
      ["Size", "Height", "Weight"],
      [
        ["S", "160–170", "55–60"],
        ["M", "170–175", "60–70"],
        ["L", "175–180", "70–80"],
        ["XL", "180–185", "80–88"],
        ["2XL", "185–188", "88–92"],
      ],
    ),
  },
  {
    id: "jacket",
    label: "Jacket",
    prefixes: ["CJ", "CTJ", "NTJ", "CCTJ", "CSWT", "NSWT", "CCWT", "NCWT"],
    chart: chart(
      ["Size", "Length", "Chest Width", "Pants length", "Height", "Weight"],
      [
        ["S", "66–69", "102–106", "100–102", "155–170", "55–65"],
        ["M", "69–72", "106–110", "102.5–105", "165–175", "60–75"],
        ["L", "72–75", "110–114", "105–107", "170–185", "70–85"],
        ["XL", "75–78", "114–118", "107.5–110", "180–195", "80–100"],
        ["2XL", "78–80", "110–122", "110–113", "185–200", "85–105"],
      ],
    ),
  },
]);

const PREFIX_RULES = Object.freeze(
  SIZE_CHART_CATALOG
    .flatMap((entry) => entry.prefixes.map((prefix) => ({ prefix, entry })))
    .sort((left, right) => right.prefix.length - left.prefix.length),
);

export function resolveLocalProductSizeChart(product = {}) {
  const entry = classifyLocalProductSizeChart(product);
  return entry ? cloneChart(entry.chart) : null;
}

export function classifyLocalProductSizeChart(product = {}) {
  const skuValues = collectSkuValues(product);
  for (const value of skuValues) {
    const match = PREFIX_RULES.find(({ prefix }) => value.startsWith(prefix) && isPrefixBoundary(value, prefix));
    if (match) return match.entry;
  }
  return null;
}

export function resolveLocalProductAgeRangeRequirement(product = {}, requestedAgeRange = "") {
  const entry = classifyLocalProductSizeChart(product);
  const requestedAge = parseRequestedAgeRange(requestedAgeRange);
  if (!entry || !requestedAge) return null;
  const ageColumnIndex = entry.chart.columns.findIndex((column) => String(column || "").trim().toLowerCase() === "age ref");
  if (ageColumnIndex < 0) return null;
  const row = entry.chart.rows.find((item) => {
    const chartAge = parseChartAgeRange(item?.[ageColumnIndex]);
    return chartAge && requestedAge.minYears >= chartAge.minYears && requestedAge.maxYears <= chartAge.maxYears;
  });
  return row?.[0] ? { chartId: entry.id, sizeLabel: String(row[0]).trim() } : null;
}

export function resolveNearestLocalProductAgeRequirement(product = {}, requestedAgeRange = "") {
  const entry = classifyLocalProductSizeChart(product);
  const requestedAge = parseRequestedAgeRange(requestedAgeRange);
  if (!entry || !requestedAge) return null;
  const ageColumnIndex = entry.chart.columns.findIndex((column) => String(column || "").trim().toLowerCase() === "age ref");
  if (ageColumnIndex < 0) return null;
  const availableSizeLabels = new Set(
    (Array.isArray(product.sizes) ? product.sizes : [])
      .filter((size) => size?.available !== false)
      .map((size) => String(size?.label || size?.name || "").trim())
      .filter(Boolean),
  );
  const candidates = entry.chart.rows.map((row, index) => {
    const sizeLabel = String(row?.[0] || "").trim();
    const age = parseChartAgeRange(row?.[ageColumnIndex]);
    if (!sizeLabel || !age || ![...availableSizeLabels].some((label) => matchesSizeLabel(label, sizeLabel))) return null;
    return { sizeLabel, ageReference: String(row[ageColumnIndex] || "").trim(), distance: ageDistance(requestedAge, age), index };
  }).filter(Boolean).sort((left, right) => left.distance - right.distance || left.index - right.index);
  const nearest = candidates[0];
  if (!nearest || nearest.distance > MAX_NEAREST_AGE_DISTANCE_YEARS) return null;
  return nearest ? {
    chartId: entry.id,
    sizeLabel: nearest.sizeLabel,
    ageReference: nearest.ageReference,
    requestedAgeRange: String(requestedAgeRange || "").trim(),
    distance: nearest.distance,
  } : null;
}

export function listLocalSizeChartCatalog() {
  return SIZE_CHART_CATALOG.map(({ id, label, prefixes }) => ({ id, label, prefixes: [...prefixes] }));
}

function collectSkuValues(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return [
    product.sku,
    ...variants.map((variant) => variant?.sku),
  ]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
}

function isPrefixBoundary(value, prefix) {
  const next = value.slice(prefix.length, prefix.length + 1);
  return !next || /[\d,]/.test(next);
}

function parseRequestedAgeRange(value = "") {
  const text = String(value || "").trim();
  const monthRange = text.match(/\b(\d{1,2})\s*(?:months?|mos?)?\s*(?:to|[-–—])\s*(\d{1,2})\s*(?:months?|mos?)\b/i);
  if (monthRange) return { minYears: Number(monthRange[1]) / 12, maxYears: Number(monthRange[2]) / 12 };
  const yearRange = text.match(/\b(\d{1,2})\s*(?:years?|yrs?)?\s*(?:to|[-–—])\s*(\d{1,2})\s*(?:years?|yrs?)\b/i);
  if (yearRange) return { minYears: Number(yearRange[1]), maxYears: Number(yearRange[2]) };
  const singleYear = text.match(/^\s*(\d{1,2})\s*(?:years?|yrs?)\s*$/i);
  if (singleYear) return { minYears: Number(singleYear[1]), maxYears: Number(singleYear[1]) };
  return null;
}

function parseChartAgeRange(value = "") {
  const match = String(value || "").match(/(\d{1,2})\s*(?:to|[-–—])\s*(\d{1,2})/);
  return match ? { minYears: Number(match[1]), maxYears: Number(match[2]) } : null;
}

function ageDistance(requestedAge, chartAge) {
  if (requestedAge.maxYears < chartAge.minYears) return chartAge.minYears - requestedAge.maxYears;
  if (requestedAge.minYears > chartAge.maxYears) return requestedAge.minYears - chartAge.maxYears;
  return 0;
}

function matchesSizeLabel(value = "", expectedLabel = "") {
  const actual = String(value || "").trim().replace(/\s+/g, " ");
  const expected = String(expectedLabel || "").trim().replace(/\s+/g, " ");
  return Boolean(actual && expected && new RegExp(`(?:^|\\s)${escapeRegExp(expected)}(?:\\s|$)`, "i").test(actual));
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chart(columns, rows) {
  return {
    title: "Size Chart",
    fitTip: "Please check the size chart before ordering.",
    unit: "CM / KG",
    columns,
    rows,
  };
}

function cloneChart(value) {
  return value
    ? {
        ...value,
        columns: [...value.columns],
        rows: value.rows.map((row) => [...row]),
      }
    : null;
}
