import assert from "node:assert/strict";
import { normalizeAvisOptionSets } from "../server/product-customization-service.js";
import { toClientProduct } from "../server/product-response-sanitizer.js";
import { toGuestSafeProduct } from "../server/guest-product-sanitizer.js";

const options = normalizeAvisOptionSets({ optionSets: [{ status: "TRUE", options: [
  {
    option_id: "customize",
    label_product: "CUSTOMIZE",
    option_type: "radio",
    required: "FALSE",
    values: [{ value_id: "player", value: "Choose a player" }, { value_id: "custom", value: "Add yours" }],
  },
  {
    option_id: "player",
    label_product: "Choose a player",
    option_type: "select",
    required: "FALSE",
    values: [{ value_id: "lamine", value: "LAMINE YAMAL #19", price: "10" }],
  },
  {
    option_id: "name",
    label_product: "Name",
    option_type: "text",
    required: "FALSE",
    place_holder: "Enter your name",
  },
] }] });

assert.equal(options.length, 3, "Avis option sets should normalize supported options");
assert.equal(options[0].type, "radio");
assert.equal(options[1].values[0].price, 10);
assert.equal(options[2].type, "text");

const product = { id: "p1", name: "Spain shirt", url: "https://footballkituk.com/products/spain", customizationOptions: options };
const client = toClientProduct(product);
const guest = toGuestSafeProduct(product, { id: "site-1", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" });
assert.equal(client.customizationOptions.length, 3, "formal product response should preserve customization options");
assert.equal(guest.customizationOptions.length, 3, "guest product response should preserve customization options");
assert.equal(guest.customizationOptions[1].values[0].price, 10);

console.log("product customization self-check passed");
