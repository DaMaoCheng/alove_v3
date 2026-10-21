import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr } from "./admin-console-utils.js";

export const ADMIN_DATE_RANGE_ITEMS = Object.freeze([
  ["all", "全部时间"],
  ["today", "今天"],
  ["7d", "近7天"],
  ["30d", "近1个月"],
  ["custom", "自定义时间"],
]);

export function adminDateRangeLabel(value = "all") {
  return ADMIN_DATE_RANGE_ITEMS.find(([item]) => item === value)?.[1] || "全部时间";
}

export function adminDateRangeFilterHtml({ name, value = "all", startDate = "", endDate = "", open = false } = {}) {
  const safeValue = ADMIN_DATE_RANGE_ITEMS.some(([item]) => item === value) ? value : "all";
  const popoverOpen = safeValue === "custom" && open;
  return `
    <div class="account-date-filter${popoverOpen ? " is-open" : ""}" data-admin-date-filter>
      ${selectDropdownHtml({
        name,
        value: safeValue,
        placeholder: "时间筛选",
        items: ADMIN_DATE_RANGE_ITEMS,
        className: "account-date-dd",
      })}
      <div class="account-date-popover" data-admin-date-popover ${popoverOpen ? "" : "hidden"} role="dialog" aria-label="自定义时间">
        <div class="account-date-popover-head"><strong>自定义时间</strong><button type="button" class="dlg-x" data-admin-date-cancel aria-label="关闭">×</button></div>
        <div class="account-date-popover-fields">
          <label class="log-filter-field"><span>开始日期</span><input type="date" data-admin-date-field data-admin-date-start value="${escapeAttr(startDate)}" max="${escapeAttr(endDate)}" /></label>
          <label class="log-filter-field"><span>结束日期</span><input type="date" data-admin-date-field data-admin-date-end value="${escapeAttr(endDate)}" min="${escapeAttr(startDate)}" /></label>
        </div>
        <div class="account-date-error" data-admin-date-error hidden></div>
        <div class="account-date-popover-actions"><button class="btn btn-ghost sm" type="button" data-admin-date-cancel>取消</button><button class="btn btn-primary sm" type="button" data-admin-date-apply>应用</button></div>
      </div>
    </div>
  `;
}

export function bindAdminDateRangeFilter(root, {
  state,
  rangeKey = "dateRange",
  startKey = "startDate",
  endKey = "endDate",
  openKey = "datePickerOpen",
  onPreset,
  onOpenCustom,
  onCancelCustom,
  onApplyCustom,
} = {}) {
  const filter = root.querySelector("[data-admin-date-filter]");
  const input = filter?.querySelector("[data-dd-input]");
  if (input && input.dataset.dateFilterBound !== "true") {
    input.dataset.dateFilterBound = "true";
    input.addEventListener("change", () => {
      const value = input.value || "all";
      state[rangeKey] = value;
      if (value === "custom") {
        state[openKey] = true;
        onOpenCustom?.();
        return;
      }
      state[startKey] = "";
      state[endKey] = "";
      state[openKey] = false;
      onPreset?.();
    });
  }

  root.querySelectorAll("[data-admin-date-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      state[openKey] = false;
      if (!state[startKey] || !state[endKey]) state[rangeKey] = "all";
      onCancelCustom?.();
    });
  });
  root.querySelectorAll("[data-admin-date-field]").forEach((field) => {
    field.addEventListener("click", () => {
      if (typeof field.showPicker !== "function") return;
      try {
        field.showPicker();
      } catch {
        // The browser may already have opened its native picker.
      }
    });
  });
  const startField = root.querySelector("[data-admin-date-start]");
  const endField = root.querySelector("[data-admin-date-end]");
  const syncDateConstraints = () => {
    if (!startField || !endField) return;
    startField.max = endField.value || "";
    endField.min = startField.value || "";
  };
  startField?.addEventListener("change", syncDateConstraints);
  endField?.addEventListener("change", syncDateConstraints);
  syncDateConstraints();
  root.querySelector("[data-admin-date-apply]")?.addEventListener("click", () => {
    const startDate = startField?.value || "";
    const endDate = endField?.value || "";
    if (!startDate || !endDate || startDate > endDate) {
      const error = root.querySelector("[data-admin-date-error]");
      if (error) {
        error.textContent = !startDate || !endDate ? "请选择开始和结束日期。" : "结束日期不能早于开始日期。";
        error.hidden = false;
      }
      return;
    }
    state[startKey] = startDate;
    state[endKey] = endDate;
    state[rangeKey] = "custom";
    state[openKey] = false;
    onApplyCustom?.();
  });
}
