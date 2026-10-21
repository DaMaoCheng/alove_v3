import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateCustomizationSurcharge,
  normalizeCustomizationOptions,
} from "../src/features/chat/chat-product-panel-customization.js";

const options = normalizeCustomizationOptions([
  {
    id: "customize",
    name: "CUSTOMIZE",
    type: "radio",
    values: [
      { id: "player", label: "Choose a player" },
      { id: "custom", label: "Add yours" },
    ],
  },
  {
    id: "player",
    name: "Choose a player",
    type: "dropdown",
    price: 10,
    dependsOnOptionId: "customize",
    showWhenValue: "player",
    values: [{ id: "player-19", label: "PLAYER #19" }],
  },
  {
    id: "name",
    name: "Name",
    type: "text",
    price: 5,
    dependsOnOptionId: "customize",
    showWhenValue: "custom",
  },
  {
    id: "patch",
    name: "Patch List",
    type: "dropdown_thumbnail",
    values: [{ id: "patch-1", label: "Patch", price: 8 }],
  },
]);

assert.equal(options.length, 4, "real customization fields should remain normalized");
assert.equal(
  calculateCustomizationSurcharge(options, {
    customize: "custom",
    name: "ALEX",
    player: "player-19",
    patch: "patch-1",
  }),
  13,
  "hidden player fields must not contribute to a custom name surcharge",
);
assert.equal(
  calculateCustomizationSurcharge(options, {
    customize: "player",
    player: "player-19",
    patch: "patch-1",
  }),
  18,
  "visible player and patch prices should be combined",
);

const rendererSource = readFileSync("src/features/chat/chat-product-panel-renderer.js", "utf8");
const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
assert.doesNotMatch(
  `${rendererSource}\n${panelSource}`,
  /customizationPreview|CUSTOMIZATION_PREVIEW|getProductPanelPreviewProduct/,
  "production product detail must not synthesize customization options from a public preview flag",
);

console.log("chat product panel customization self-check passed");
