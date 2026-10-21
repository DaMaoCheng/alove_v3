const DEFAULT_COPY = Object.freeze({
  customizationField: "Customization",
  customizationPlaceholder: "Select an option",
  customizationRequired: "Required",
});

export function normalizeCustomizationOptions(value = []) {
  return (Array.isArray(value) ? value : [])
    .filter((option) => option && typeof option === "object" && !Array.isArray(option))
    .map((option, index) => ({
      id: String(option.id || option.name || `customization-${index}`).trim(),
      name: String(option.name || "").trim(),
      type: String(option.type || "dropdown").trim(),
      required: option.required === true,
      price: Number(option.price) > 0 ? Number(option.price) : 0,
      placeholder: String(option.placeholder || "").trim(),
      dependsOnOptionId: String(option.dependsOnOptionId || "").trim(),
      showWhenValue: String(option.showWhenValue || "").trim(),
      values: (Array.isArray(option.values) ? option.values : [])
        .filter((value) => value && typeof value === "object")
        .map((value) => ({
          id: String(value.id || value.label || "").trim(),
          label: String(value.label || value.name || value.value || "").trim(),
          price: Number(value.price) > 0 ? Number(value.price) : 0,
          imageUrl: String(value.imageUrl || value.image_url || "").trim(),
        }))
        .filter((value) => value.id && value.label)
        .slice(0, 100),
    }))
    .filter((option) => option.id && (option.type === "text" || option.type === "number" || option.values.length))
    .slice(0, 20);
}

export function renderProductCustomization(container, total, fields, product = {}, copy = DEFAULT_COPY) {
  const options = normalizeCustomizationOptions(product.customizationOptions);
  if (!container || !fields) return;
  container.hidden = !options.length;
  if (!options.length) {
    fields.innerHTML = "";
    if (total) total.hidden = true;
    return;
  }
  const selections = normalizeCustomizationSelections(product.customizationSelections);
  fields.innerHTML = options
    .filter((option) => isCustomizationOptionVisible(option, selections))
    .map((option) => renderCustomizationField(option, selections, copy))
    .join("");
  updateCustomizationTotalNode(total, {
    options,
    selections,
    currency: product.currency,
  });
}

export function calculateCustomizationSurcharge(options = [], selections = {}) {
  return normalizeCustomizationOptions(options).reduce((total, option) => {
    const selected = String(selections[option.id] || "");
    if (!selected || !isCustomizationOptionVisible(option, selections)) return total;
    const selectedValue = (option.values || []).find((value) => value.id === selected);
    const optionPrice = option.type === "radio" ? 0 : Number(option.price) || 0;
    const valuePrice = Number(selectedValue?.price) || 0;
    return total + optionPrice + valuePrice;
  }, 0);
}

export function hasIncompleteRequiredCustomization(options = [], selections = {}) {
  const normalizedSelections = normalizeCustomizationSelections(selections);
  return normalizeCustomizationOptions(options).some((option) => (
    option.required
    && isCustomizationOptionVisible(option, normalizedSelections)
    && !String(normalizedSelections[option.id] || "").trim()
  ));
}

export function updateCustomizationTotalNode(total, { options = [], selections = {}, currency = "GBP" } = {}) {
  if (!total) return;
  const surcharge = calculateCustomizationSurcharge(options, selections);
  total.hidden = surcharge <= 0;
  total.textContent = surcharge > 0 ? `+${formatCustomizationPrice(surcharge, currency)}` : "";
}

export function normalizeCustomizationSelections(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function renderCustomizationField(option, selections, copy) {
  const selected = String(selections[option.id] || "");
  const label = option.name || copy.customizationField || DEFAULT_COPY.customizationField;
  if (option.type === "radio") {
    return `
      <div class="pp-custom-field pp-custom-choice-field">
        <div class="pp-custom-label-row"><label>${escapeHtml(label)}</label>${renderRequiredMark(option, copy)}</div>
        <div class="pp-custom-choice-list" role="group" aria-label="${escapeHtml(label)}">
          ${(option.values || []).map((value) => `
            <button class="pp-custom-choice${selected === value.id ? " is-selected" : ""}" type="button" data-product-customization-option="${escapeHtml(option.id)}" data-product-customization-value="${escapeHtml(value.id)}" aria-pressed="${selected === value.id ? "true" : "false"}">${escapeHtml(value.label)}</button>
          `).join("")}
        </div>
      </div>`;
  }
  if (option.type === "text" || option.type === "number") {
    const inputType = option.type === "number" ? "number" : "text";
    return `
      <div class="pp-custom-field">
        <div class="pp-custom-label-row"><label for="pp-custom-${escapeHtml(option.id)}">${escapeHtml(label)}${resolveOptionPriceLabel(option)}</label>${renderRequiredMark(option, copy)}</div>
        <input class="pp-custom-input" id="pp-custom-${escapeHtml(option.id)}" type="${inputType}" inputmode="${inputType === "number" ? "numeric" : "text"}" value="${escapeHtml(selected)}" placeholder="${escapeHtml(option.placeholder || "")}" data-product-customization-input data-product-customization-option="${escapeHtml(option.id)}" />
      </div>`;
  }
  return `
    <div class="pp-custom-field">
      <div class="pp-custom-label-row"><label for="pp-custom-${escapeHtml(option.id)}">${escapeHtml(label)}${resolveOptionPriceLabel(option)}</label>${renderRequiredMark(option, copy)}</div>
      <div class="pp-custom-select-wrap">
        <select class="pp-custom-select" id="pp-custom-${escapeHtml(option.id)}" data-product-customization-select data-product-customization-option="${escapeHtml(option.id)}">
          <option value="">${escapeHtml(copy.customizationPlaceholder || DEFAULT_COPY.customizationPlaceholder)}</option>
          ${(option.values || []).map((value) => `<option value="${escapeHtml(value.id)}"${selected === value.id ? " selected" : ""}>${escapeHtml(value.label)}${resolveValuePriceLabel(value)}</option>`).join("")}
        </select>
      </div>
    </div>`;
}

function renderRequiredMark(option, copy) {
  const label = copy.customizationRequired || DEFAULT_COPY.customizationRequired;
  return option.required ? `<span class="pp-custom-required">${escapeHtml(label)}</span>` : "";
}

function resolveOptionPriceLabel(option) {
  return Number(option.price) > 0 ? ` (+${escapeHtml(formatCustomizationPrice(option.price))})` : "";
}

function resolveValuePriceLabel(value) {
  return Number(value?.price) > 0 ? ` (+${escapeHtml(formatCustomizationPrice(value.price))})` : "";
}

function formatCustomizationPrice(value, currency = "GBP") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const code = String(currency || "GBP").toUpperCase();
  const symbol = code === "USD" ? "$" : code === "EUR" ? "€" : "£";
  return `${symbol}${amount.toFixed(2)}`;
}

function isCustomizationOptionVisible(option, selections = {}) {
  if (!option?.dependsOnOptionId || !option.showWhenValue) return true;
  return String(selections[option.dependsOnOptionId] || "") === String(option.showWhenValue);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
