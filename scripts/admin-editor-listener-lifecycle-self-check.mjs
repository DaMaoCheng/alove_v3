import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindAdminCharacterEditorControls } from "../src/features/admin-console/admin-character-editor-controls.js";
import { bindAdminCreatorAccountPicker } from "../src/features/admin-console/admin-creator-account-picker.js";

const carouselController = readFileSync("src/features/admin-console/admin-carousel-controller.js", "utf8");
const characterControls = readFileSync("src/features/admin-console/admin-character-editor-controls.js", "utf8");
const commonController = readFileSync("src/features/admin-console/admin-common-characters-controller.js", "utf8");
const creatorController = readFileSync("src/features/admin-console/admin-creator-characters-controller.js", "utf8");
const creatorPicker = readFileSync("src/features/admin-console/admin-creator-account-picker.js", "utf8");

assert.match(carouselController, /editorAbortController\?\.abort\(\)/, "carousel editor should abort listeners when it closes");
assert.match(carouselController, /bindCarouselForm\(host, item, closeEditor, editorAbortController\.signal\)/, "carousel editor should pass its lifecycle signal to form bindings");
assert.match(carouselController, /signal \? \{ capture: true, signal \} : \{ capture: true \}/, "carousel document listener should use the editor lifecycle signal");

assert.match(commonController, /commonEditorAbortController\?\.abort\(\)/, "common character editor should abort listeners when it closes");
assert.match(commonController, /signal: commonEditorAbortController\.signal/, "common character editor should pass its lifecycle signal to controls");
assert.match(creatorController, /creatorEditorAbortController\?\.abort\(\)/, "creator character editor should abort listeners when it closes");
assert.match(creatorController, /bindAdminCreatorAccountPicker\(host, \{ signal: creatorEditorAbortController\.signal \}\)/, "creator account picker should receive the editor lifecycle signal");
assert.match(creatorController, /signal: creatorEditorAbortController\.signal/, "creator character controls should receive the editor lifecycle signal");

assert.match(characterControls, /bindAdminLanguagePicker\(form, \{ signal \}\)/, "character controls should forward the lifecycle signal to the language picker");
assert.match(characterControls, /signal \? \{ capture: true, signal \} : \{ capture: true \}/, "language picker document listener should use the editor lifecycle signal");
assert.match(creatorPicker, /signal \? \{ capture: true, signal \} : \{ capture: true \}/, "creator picker document listener should use the editor lifecycle signal");

const originalDocument = globalThis.document;
const fakeDocument = new EventTarget();
globalThis.document = fakeDocument;
let outsideCloseCalls = 0;
try {
  for (let index = 0; index < 20; index += 1) {
    const controller = new AbortController();
    bindAdminCharacterEditorControls(createCharacterHost(() => {
      outsideCloseCalls += 1;
    }), { signal: controller.signal });
    bindAdminCreatorAccountPicker(createCreatorHost(() => {
      outsideCloseCalls += 1;
    }), { signal: controller.signal });

    fakeDocument.dispatchEvent(new Event("click"));
    assert.equal(outsideCloseCalls, (index + 1) * 2, "each active editor picker should handle one outside click");
    controller.abort();
    fakeDocument.dispatchEvent(new Event("click"));
    assert.equal(outsideCloseCalls, (index + 1) * 2, "closed editor listeners should no longer handle outside clicks");
  }
} finally {
  globalThis.document = originalDocument;
}

console.log("admin editor listener lifecycle self-check passed");

function createCharacterHost(onOutsideClose) {
  const picker = createPicker(onOutsideClose);
  const form = {
    querySelector(selector) {
      if (selector === "[data-admin-language-picker]") return picker;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return {
    querySelector(selector) {
      return selector === "[data-character-editor-form]" ? form : null;
    },
  };
}

function createCreatorHost(onOutsideClose) {
  const picker = createPicker(onOutsideClose);
  return {
    querySelector(selector) {
      if (selector === "[data-creator-account-picker]") return picker;
      return null;
    },
  };
}

function createPicker(onOutsideClose) {
  return {
    classList: {
      add() {},
      remove() {
        onOutsideClose();
      },
      toggle() {},
    },
    contains() {
      return false;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}
