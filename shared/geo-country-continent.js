const CONTINENT_DEFINITIONS = Object.freeze({
  geo_antarctica: Object.freeze({ id: "geo_antarctica", code: "AN", nameZh: "南极洲", nameEn: "Antarctica" }),
  geo_africa: Object.freeze({ id: "geo_africa", code: "AF", nameZh: "非洲", nameEn: "Africa" }),
  geo_asia: Object.freeze({ id: "geo_asia", code: "AS", nameZh: "亚洲", nameEn: "Asia" }),
  geo_europe: Object.freeze({ id: "geo_europe", code: "EU", nameZh: "欧洲", nameEn: "Europe" }),
  geo_north_america: Object.freeze({ id: "geo_north_america", code: "NA", nameZh: "北美洲", nameEn: "North America" }),
  geo_latin_america: Object.freeze({ id: "geo_latin_america", code: "LATAM", nameZh: "拉美", nameEn: "Latin America" }),
  geo_oceania: Object.freeze({ id: "geo_oceania", code: "OC", nameZh: "大洋洲", nameEn: "Oceania" }),
});

const COUNTRY_CODES_BY_CONTINENT = Object.freeze({
  geo_antarctica: "AQ BV GS HM TF",
  geo_africa: "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
  geo_asia: "AE AF AM AZ BD BH BN BT CC CN CX GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
  geo_europe: "AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK",
  geo_north_america: "AI AG AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI",
  geo_latin_america: "AR BO BR CL CO EC FK GF GY PE PY SR UY VE",
  geo_oceania: "AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS",
});

const CONTINENT_BY_COUNTRY = Object.freeze(Object.fromEntries(
  Object.entries(COUNTRY_CODES_BY_CONTINENT).flatMap(([continentId, countryCodes]) => (
    countryCodes.split(" ").filter(Boolean).map((countryCode) => [countryCode, continentId])
  ))
));

const displayNames = new Map();

export function resolveGeoContinentForCountryCode(countryCode) {
  const normalized = normalizeCountryCode(countryCode);
  const continentId = CONTINENT_BY_COUNTRY[normalized];
  return continentId ? CONTINENT_DEFINITIONS[continentId] : null;
}

export function resolveGeoCountryDisplayNames(countryCode, fallbackName = "") {
  const normalized = normalizeCountryCode(countryCode);
  const fallback = String(fallbackName || normalized).trim() || normalized;
  return {
    nameZh: displayCountryName(normalized, "zh-CN") || fallback,
    nameEn: displayCountryName(normalized, "en") || fallback,
  };
}

function normalizeCountryCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
}

function displayCountryName(countryCode, locale) {
  if (!countryCode) return "";
  try {
    const formatter = getDisplayNames(locale);
    return String(formatter.of(countryCode) || "").trim();
  } catch {
    return "";
  }
}

function getDisplayNames(locale) {
  if (!displayNames.has(locale)) {
    displayNames.set(locale, new Intl.DisplayNames([locale], { type: "region" }));
  }
  return displayNames.get(locale);
}
