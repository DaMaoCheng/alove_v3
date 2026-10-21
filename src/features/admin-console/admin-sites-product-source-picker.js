export function bindSiteProductSourcePicker(root) {
  const select = root?.querySelector?.("[data-product-source-type]");
  if (!select) return;
  const sync = () => {
    const type = String(select.value || "");
    toggleFields(root, "[data-product-source-shopify]", type === "shopify_admin");
    toggleFields(root, "[data-product-source-ttmall]", type === "ttmall");
  };
  select.addEventListener("change", sync);
  sync();
}

function toggleFields(root, selector, visible) {
  root.querySelectorAll(selector).forEach((node) => {
    node.hidden = !visible;
    node.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = !visible;
      if (control.name === "productShopDomain" || control.name === "productTtmallApiBaseUrl" || control.name === "productTtmallWebsiteId") {
        control.required = visible;
      }
    });
  });
}
