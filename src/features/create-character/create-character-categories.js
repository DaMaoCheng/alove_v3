import { CREATE_CATS } from "../../data/demo-data.js";

export function getVisibleCreateCategories(user = {}) {
  const accountType = String(user.accountType || "personal").toLowerCase();
  if (accountType === "creator" || accountType === "admin") return CREATE_CATS;
  return CREATE_CATS.filter((item) => item.key !== "Creator");
}

export function resolveCreateCategory(createState = {}, user = {}) {
  const visibleCats = getVisibleCreateCategories(user);
  const selectedCat = visibleCats.some((item) => item.key === createState.cat) ? createState.cat : visibleCats[0]?.key;
  return {
    visibleCats,
    selectedCat,
    category: visibleCats.find((item) => item.key === selectedCat) || null,
  };
}
