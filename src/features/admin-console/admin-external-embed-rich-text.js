import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function externalEmbedRichTextEditorHtml({ name, value = "", marks = [], maxLength, multiline = false }) {
  const text = normalizeText(value, { maxLength, multiline });
  const normalizedMarks = normalizeRichText(marks, text);
  return `<div class="external-embed-rich-control" data-external-embed-rich-field="${escapeAttr(name)}" data-external-embed-rich-max-length="${Number(maxLength)}" data-external-embed-rich-multiline="${multiline ? "true" : "false"}">
    <div class="external-embed-rich-editor" contenteditable="true" role="textbox" aria-multiline="${multiline ? "true" : "false"}" spellcheck="true" data-external-embed-rich-editor data-external-embed-rich-text="${escapeAttr(JSON.stringify(normalizedMarks))}" data-external-embed-rich-value="${escapeAttr(text)}">${richTextHtml(text, normalizedMarks)}</div>
    <input name="${escapeAttr(name)}" type="hidden" value="${escapeAttr(text)}" />
    <input name="${escapeAttr(`${name}RichText`)}" type="hidden" value="${escapeAttr(JSON.stringify(normalizedMarks))}" />
  </div>`;
}

export function externalEmbedRichTextPopoverHtml() {
  return `<div class="external-embed-rich-popover" data-external-embed-rich-popover hidden>
    <label>颜色代码<input type="text" inputmode="text" autocomplete="off" maxlength="7" placeholder="#00E95C" data-external-embed-rich-color /></label>
    <button class="btn btn-ghost xs" type="button" data-external-embed-rich-clear>恢复默认</button>
  </div>`;
}

export function richTextHtml(value = "", marks = []) {
  const text = String(value || "");
  const normalizedMarks = normalizeRichText(marks, text);
  let cursor = 0;
  let html = "";
  for (const mark of normalizedMarks) {
    html += escapeHtml(text.slice(cursor, mark.start));
    html += `<span data-external-embed-rich-color="${escapeAttr(mark.color)}" style="color:${escapeAttr(mark.color)}">${escapeHtml(text.slice(mark.start, mark.end))}</span>`;
    cursor = mark.end;
  }
  return html + escapeHtml(text.slice(cursor));
}

export function normalizeRichText(value, text = "") {
  const raw = Array.isArray(value) ? value : parseRichText(value);
  const length = String(text || "").length;
  const marks = raw
    .map((mark) => ({ start: Number(mark?.start), end: Number(mark?.end), color: String(mark?.color || "").toUpperCase() }))
    .filter((mark) => Number.isInteger(mark.start) && Number.isInteger(mark.end)
      && mark.start >= 0 && mark.end > mark.start && mark.end <= length && COLOR_PATTERN.test(mark.color))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const normalized = [];
  for (const mark of marks) {
    const previous = normalized[normalized.length - 1];
    if (previous && mark.start < previous.end) continue;
    if (previous && previous.end === mark.start && previous.color === mark.color) previous.end = mark.end;
    else normalized.push(mark);
  }
  return normalized;
}

export function parseRichText(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function bindExternalEmbedRichTextControls(form, { onChanged } = {}) {
  if (!form) return;
  const popover = form.querySelector("[data-external-embed-rich-popover]");
  const colorInput = popover?.querySelector("[data-external-embed-rich-color]");
  let active = null;

  const notifyChanged = () => onChanged?.();
  form.querySelectorAll("[data-external-embed-rich-field]").forEach((field) => {
    const editor = field.querySelector("[data-external-embed-rich-editor]");
    if (!editor) return;
    editor.addEventListener("input", () => {
      syncEditorField(field, { adjustMarks: true });
      notifyChanged();
    });
    editor.addEventListener("mouseup", () => queueMicrotask(() => openForSelection(field)));
    editor.addEventListener("touchend", () => queueMicrotask(() => openForSelection(field)));
    editor.addEventListener("keyup", () => queueMicrotask(() => openForSelection(field)));
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hidePopover();
      if (event.key !== "Enter") return;
      event.preventDefault();
      insertPlainText(editor, field.dataset.externalEmbedRichMultiline === "true" ? "\n" : " ");
    });
    editor.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (text == null) return;
      event.preventDefault();
      insertPlainText(editor, field.dataset.externalEmbedRichMultiline === "true" ? text : text.replace(/[\r\n]+/g, " "));
    });
    editor.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!popover?.contains(document.activeElement)) hidePopover();
        syncEditorField(field, { adjustMarks: true, rerender: true });
      }, 0);
    });
  });

  colorInput?.addEventListener("input", () => {
    const color = String(colorInput.value || "").trim().toUpperCase();
    if (!active || !COLOR_PATTERN.test(color)) return;
    applySelectionColor(active.field, active.range, color);
    notifyChanged();
  });
  popover?.querySelector("[data-external-embed-rich-clear]")?.addEventListener("click", () => {
    if (!active) return;
    applySelectionColor(active.field, active.range, "");
    notifyChanged();
    hidePopover();
  });

  function openForSelection(field) {
    const selection = selectionForField(field);
    if (!selection) {
      hidePopover();
      return;
    }
    active = { field, range: { start: selection.start, end: selection.end } };
    if (!popover || !colorInput) return;
    colorInput.value = colorForRange(field, active.range) || "";
    positionPopover(popover, selection.rect);
    popover.hidden = false;
  }

  function hidePopover() {
    if (popover) popover.hidden = true;
    active = null;
  }
}

export function syncExternalEmbedRichTextFields(form) {
  form?.querySelectorAll("[data-external-embed-rich-field]").forEach((field) => syncEditorField(field, { adjustMarks: true }));
}

function syncEditorField(field, { adjustMarks = false, rerender = false } = {}) {
  const editor = field.querySelector("[data-external-embed-rich-editor]");
  const valueInput = field.querySelector("input[type='hidden']");
  const marksInput = field.querySelectorAll("input[type='hidden']")[1];
  if (!editor || !valueInput || !marksInput) return;
  const multiline = field.dataset.externalEmbedRichMultiline === "true";
  const maxLength = Number(field.dataset.externalEmbedRichMaxLength) || 0;
  const previousText = String(editor.dataset.externalEmbedRichValue || "");
  const text = normalizeText(editor.textContent, { maxLength, multiline });
  const existingMarks = normalizeRichText(editor.dataset.externalEmbedRichText, previousText);
  const marks = adjustMarks ? adjustMarksForTextChange(existingMarks, previousText, text) : normalizeRichText(existingMarks, text);
  editor.dataset.externalEmbedRichValue = text;
  editor.dataset.externalEmbedRichText = JSON.stringify(marks);
  valueInput.value = text;
  marksInput.value = JSON.stringify(marks);
  if (rerender && editor.innerHTML !== richTextHtml(text, marks)) editor.innerHTML = richTextHtml(text, marks);
}

function applySelectionColor(field, range, color) {
  const editor = field.querySelector("[data-external-embed-rich-editor]");
  if (!editor || range.end <= range.start) return;
  syncEditorField(field, { adjustMarks: true });
  const text = String(editor.dataset.externalEmbedRichValue || "");
  const marks = replaceMarksInRange(parseRichText(editor.dataset.externalEmbedRichText), range, color, text.length);
  editor.dataset.externalEmbedRichText = JSON.stringify(marks);
  const marksInput = field.querySelectorAll("input[type='hidden']")[1];
  if (marksInput) marksInput.value = JSON.stringify(marks);
  editor.innerHTML = richTextHtml(text, marks);
}

function replaceMarksInRange(marks, range, color, length) {
  const next = [];
  for (const mark of normalizeRichText(marks, "x".repeat(length))) {
    if (mark.end <= range.start || mark.start >= range.end) {
      next.push(mark);
      continue;
    }
    if (mark.start < range.start) next.push({ ...mark, end: range.start });
    if (mark.end > range.end) next.push({ ...mark, start: range.end });
  }
  if (COLOR_PATTERN.test(color)) next.push({ start: range.start, end: range.end, color });
  return normalizeRichText(next, "x".repeat(length));
}

function adjustMarksForTextChange(marks, previousText, nextText) {
  if (previousText === nextText) return normalizeRichText(marks, nextText);
  let start = 0;
  while (start < previousText.length && start < nextText.length && previousText[start] === nextText[start]) start += 1;
  let suffix = 0;
  while (suffix < previousText.length - start && suffix < nextText.length - start
    && previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix += 1;
  const previousEnd = previousText.length - suffix;
  const nextEnd = nextText.length - suffix;
  const delta = nextEnd - previousEnd;
  const adjusted = [];
  for (const mark of normalizeRichText(marks, previousText)) {
    if (mark.end <= start) adjusted.push(mark);
    else if (mark.start >= previousEnd) adjusted.push({ ...mark, start: mark.start + delta, end: mark.end + delta });
    else if (mark.start <= start && mark.end >= previousEnd) adjusted.push({ ...mark, end: mark.end + delta });
    else if (mark.start < start) adjusted.push({ ...mark, end: start });
    else if (mark.end > previousEnd) adjusted.push({ ...mark, start: nextEnd, end: mark.end + delta });
  }
  return normalizeRichText(adjusted, nextText);
}

function selectionForField(field) {
  const editor = field.querySelector("[data-external-embed-rich-editor]");
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  const start = offsetForNode(editor, range.startContainer, range.startOffset);
  const end = offsetForNode(editor, range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;
  return { start, end, rect: range.getBoundingClientRect() };
}

function offsetForNode(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function colorForRange(field, range) {
  const editor = field.querySelector("[data-external-embed-rich-editor]");
  const marks = normalizeRichText(editor?.dataset.externalEmbedRichText, editor?.dataset.externalEmbedRichValue || "");
  const mark = marks.find((item) => item.start <= range.start && item.end >= range.end);
  return mark?.color || "";
}

function positionPopover(popover, rect) {
  const width = 205;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
  const top = Math.max(12, Math.min(window.innerHeight - 48, rect.bottom + 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function insertPlainText(editor, value) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(value);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function normalizeText(value, { maxLength = 0, multiline = false } = {}) {
  const text = String(value || "").replace(/\r\n?/g, "\n");
  const normalized = multiline ? text : text.replace(/\n+/g, " ");
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
}
