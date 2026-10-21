export function accountSiteFilterItems(sites = [], siteCounts = []) {
  const normalizedCounts = Array.isArray(siteCounts) ? siteCounts : [];
  const counts = new Map(normalizedCounts.map((item) => [String(item?.siteId || ""), item]));
  const countFor = (siteId) => counts.get(siteId) || { active: 0, total: 0 };
  return [
    ["all", "全部站点", null, countFor("all")],
    ...normalizeSites(sites).map((site) => [site.id, site.name, null, countFor(site.id)]),
    ["unassigned", "未指定", null, countFor("unassigned")],
  ];
}

export function accountWritableSiteItems(sites = []) {
  return [
    ...normalizeSites(sites).map((site) => [site.id, site.name]),
    ["unassigned", "未指定"],
  ];
}

export function accountSiteLabel(account) {
  return account?.siteId ? account.siteName || account.siteId : "未指定";
}

export function accountSiteDetail(account) {
  if (!account?.siteId) return "未指定";
  return account.siteSlug ? `${accountSiteLabel(account)} /${account.siteSlug}` : accountSiteLabel(account);
}

function normalizeSites(sites = []) {
  return (Array.isArray(sites) ? sites : [])
    .map((site) => ({
      id: String(site?.id || "").trim(),
      name: String(site?.name || site?.id || "").trim(),
    }))
    .filter((site) => site.id && site.name);
}
