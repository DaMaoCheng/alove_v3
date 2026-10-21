const DISCOUNT_CLASSES = new Set(["PRODUCT", "ORDER", "SHIPPING"]);

/**
 * Shopify requires each discount in a pair to allow the other discount's
 * class. This is an advisory UI guard and a server-side integrity guard; the
 * final calculation still belongs to Shopify.
 */
export function areShopifyDiscountsPairwiseCombinable(discounts = []) {
  const rows = normalizeDiscountCombinations(discounts);
  if (rows.length < 2) return true;
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      if (!isPairCombinable(rows[leftIndex], rows[rightIndex])) return false;
    }
  }
  return true;
}

function normalizeDiscountCombinations(discounts = []) {
  const unique = new Map();
  for (const discount of Array.isArray(discounts) ? discounts : []) {
    const source = discount?.shopifyRule || discount?.combination || {};
    const code = String(discount?.code || discount?.id || "").trim().toUpperCase();
    if (!code || unique.has(code)) continue;
    const discountClasses = [...new Set((Array.isArray(source?.discountClasses) ? source.discountClasses : [])
      .map((item) => String(item || "").trim().toUpperCase())
      .filter((item) => DISCOUNT_CLASSES.has(item)))];
    const combinesWith = source?.combinesWith && typeof source.combinesWith === "object" ? source.combinesWith : null;
    unique.set(code, discountClasses.length && combinesWith
      ? { discountClasses, combinesWith }
      : { invalid: true });
  }
  return [...unique.values()];
}

function isPairCombinable(left, right) {
  if (left.invalid || right.invalid) return false;
  return left.discountClasses.some((leftClass) => right.discountClasses.some((rightClass) => (
    allowsClass(left.combinesWith, rightClass) && allowsClass(right.combinesWith, leftClass)
  )));
}

function allowsClass(combinesWith, discountClass) {
  return combinesWith?.[{
    PRODUCT: "productDiscounts",
    ORDER: "orderDiscounts",
    SHIPPING: "shippingDiscounts",
  }[discountClass]] === true;
}
