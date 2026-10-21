import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCarouselEditorModalHtml, adminCarouselHtml, adminCarouselListHtml } from "../src/features/admin-console/admin-console-carousel-template.js";

const items = [
  {
    id: "banner_one",
    title: "Matchday Drop",
    subtitle: "Latest kit release",
    eyebrow: "New",
    imageUrl: "/uploads/carousel/banner.webp",
    siteId: "site_fkk",
    siteName: "FKK",
    siteSlug: "footballkituk",
    ctaText: "Shop",
    ctaType: "url",
    ctaTarget: "https://example.com/drop",
    displayOrder: 10,
    status: "published",
  },
  {
    id: "banner_two",
    title: "Leo Chat",
    subtitle: "Open character chat",
    eyebrow: "Creator",
    imageUrl: "/assets/banner_hero.png",
    ctaText: "Chat",
    ctaType: "character",
    ctaTarget: "leo_2026",
    displayOrder: 20,
    status: "archived",
  },
];
const sites = [
  { id: "site_fkk", name: "FKK", slug: "footballkituk", mascotCharacterId: "mascot_fkk" },
  { id: "site_gg", name: "GG", slug: "gogoalshop", mascotCharacterId: "mascot_template" },
];
const characters = [
  { id: "mascot_template", name: "Kit", siteId: "", avatarUrl: "/assets/char_coach.png", category: { id: "mascot" } },
  { id: "mascot_fkk", name: "Millie", siteId: "site_fkk", avatarUrl: "/uploads/avatars/millie.webp", category: { id: "mascot" } },
  { id: "creator_fkk", name: "Dani", siteId: "site_fkk", avatarUrl: "/uploads/avatars/dani.webp", category: { id: "creator" } },
  { id: "char_common", name: "Bro", siteId: "", category: { id: "football" } },
];

const pageHtml = adminCarouselHtml();
assert.match(pageHtml, /data-table admin-carousel-table/, "carousel page should allocate a table container");
assert.match(pageHtml, /<div class="panel">\s*<div class="data-table admin-carousel-table" data-carousel-list>/, "carousel table should sit directly inside a plain panel like site management");
assert.doesNotMatch(pageHtml, /panel-head|轮播列表|carousel-list-panel/, "carousel page should not render an extra list title above the table");
assert.doesNotMatch(pageHtml, /banner-admin-grid/, "carousel page should not use card grid container");
assert.doesNotMatch(pageHtml, /carousel-form-panel/, "carousel page should not keep the old right-side settings panel");
assert.match(pageHtml, /data-carousel-modal-host/, "carousel page should allocate a modal host for create and edit forms");

const tableHtml = adminCarouselListHtml(items, "banner_one");
assert.match(tableHtml, /<div class="dt-head">/, "carousel list should render table header");
assert.doesNotMatch(tableHtml, /\bactive\b/, "carousel table rows should not render a selected green outline state");
assert.match(tableHtml, /轮播图/, "carousel table should have image/title column");
assert.match(tableHtml, /绑定站点/, "carousel table should have a bound site column");
assert.doesNotMatch(tableHtml, />标签</, "carousel table should not keep the old tag column");
assert.match(tableHtml, /点击目标/, "carousel table should show CTA target column");
assert.match(tableHtml, /data-carousel-id="banner_one"/, "carousel table rows should keep row identity for active state");
assert.doesNotMatch(tableHtml, /role="button"|tabindex="0"/, "carousel rows should not behave like full-row buttons after matching site table style");
assert.match(tableHtml, /carousel-table-media[\s\S]*carousel-table-thumb/, "carousel table should show thumbnails inside a stable 2:1 media container");
assert.match(tableHtml, /carousel-table-title/, "carousel table should constrain long title text");
assert.match(tableHtml, /carousel-site-cell[\s\S]*FKK[\s\S]*\/footballkituk/, "carousel table should show bound site name and slug");
assert.match(tableHtml, /carousel-table-target/, "carousel table should constrain long target text");
assert.match(tableHtml, /pill on[\s\S]*已上架/, "published status should use existing on pill style");
assert.match(tableHtml, /pill off[\s\S]*已下架/, "archived status should use existing off pill style");
assert.match(tableHtml, /dt-act[\s\S]*编辑/, "carousel table should expose an edit action in the action column");
assert.doesNotMatch(tableHtml, /ba-card|ba-img|ba-body/, "carousel list should not render old card classes");

const emptyHtml = adminCarouselListHtml([], "");
assert.match(emptyHtml, /暂无轮播图/, "empty carousel table should keep readable empty state");

const editModalHtml = adminCarouselEditorModalHtml(items[0], { sites, characters });
assert.match(editModalHtml, /dialog-scrim[\s\S]*data-carousel-editor-close/, "carousel editor should render a closable modal scrim");
assert.match(editModalHtml, /class="dlg common-character-modal carousel-editor-modal"/, "carousel editor should use the shared admin dialog layout");
assert.match(editModalHtml, /编辑轮播图/, "editing an existing carousel should use edit modal title");
assert.match(editModalHtml, /data-carousel-form/, "carousel modal should keep the existing form hook");
assert.match(editModalHtml, /name="siteId" value="site_fkk"/, "carousel editor should render a bound site dropdown field");
assert.match(editModalHtml, /FKK \/footballkituk/, "carousel editor site dropdown should list admin sites");
assert.match(editModalHtml, /data-carousel-character-target/, "character CTA target should render a searchable target picker");
assert.match(editModalHtml, /data-carousel-url-target/, "URL CTA target should keep a dedicated URL input");
assert.match(editModalHtml, /data-carousel-character-option="mascot_fkk"[\s\S]*Millie/, "carousel character target picker should list mascot targets");
assert.match(editModalHtml, /data-carousel-character-option="creator_fkk"[\s\S]*Dani/, "carousel character target picker should list creator targets");
assert.match(editModalHtml, /data-carousel-character-option="mascot_fkk"[\s\S]*carousel-character-avatar[\s\S]*\/uploads\/avatars\/millie\.webp/, "carousel character target picker should show target avatars");
assert.doesNotMatch(editModalHtml, /data-carousel-character-option="char_common"/, "carousel target picker should not list common characters");

const createModalHtml = adminCarouselEditorModalHtml(null);
assert.match(createModalHtml, /新增轮播图/, "creating a carousel should use create modal title");
assert.match(createModalHtml, /data-carousel-editor-close/, "create carousel modal should expose close hooks");
assert.match(createModalHtml, /carousel-image-preview is-empty/, "create carousel modal should show an empty fixed-size image placeholder");
assert.match(createModalHtml, /<svg[\s\S]*data-carousel-image-preview hidden/, "empty carousel image placeholder should show an image icon before upload");
assert.doesNotMatch(createModalHtml, /banner_hero\.png/, "create carousel modal should not prefill the image with the default banner");

const styleSource = readFileSync("src/features/app-shell/styles/admin-console.css", "utf8");
assert.match(styleSource, /\.data-table\.admin-carousel-table \.dt-head,\.data-table\.admin-carousel-table \.dt-row/, "carousel table should define its grid columns");
assert.doesNotMatch(styleSource, /\.carousel-settings-shell|\.banner-admin-grid|\.ba-card|\.ba-img|\.ba-body/, "carousel CSS should not keep obsolete card or split-panel classes");
assert.match(styleSource, /\.carousel-editor-modal\{[^}]*width:min\(760px/, "carousel editor modal should use a stable admin modal width");
assert.doesNotMatch(styleSource, /\.carousel-row\.active/, "carousel CSS should not render a green selected outline for table rows");
assert.match(styleSource, /\.carousel-table-media\{[^}]*width:180px[^}]*aspect-ratio:2 \/ 1/, "carousel thumbnails should be enlarged with a stable 2:1 table container");
assert.match(styleSource, /\.carousel-table-media \.carousel-table-thumb\{[^}]*width:100%[^}]*height:100%/, "carousel thumbnail images should override the shared dt-cell image size");
assert.match(styleSource, /\.carousel-image-preview\.is-empty/, "empty carousel image placeholder should keep the preview slot stable");
assert.match(styleSource, /\.carousel-image-preview img\[hidden\]\{[^}]*display:none !important/, "hidden empty preview image should not render as a broken image");
assert.match(styleSource, /\.carousel-table-title small\{[^}]*max-width:260px/, "carousel description line should have a lower max width");
assert.match(styleSource, /\.carousel-table-title b/, "carousel title text should be constrained for ellipsis");
assert.match(styleSource, /\.carousel-table-target/, "carousel target text should be constrained for ellipsis");
assert.match(styleSource, /\.carousel-character-target\[hidden\]/, "character CTA target picker should hide when the CTA type is not character");
assert.match(styleSource, /\.carousel-character-option\[hidden\]\{[^}]*display:none !important/, "filtered character target options should stay hidden");
assert.match(styleSource, /\.carousel-character-option\{[^}]*grid-template-columns:34px minmax\(0,1fr\)/, "character target options should reserve an avatar column");
assert.match(styleSource, /\.carousel-character-avatar\{[^}]*width:34px[^}]*height:34px/, "character target option avatars should have a stable size");

const controllerSource = readFileSync("src/features/admin-console/admin-carousel-controller.js", "utf8");
assert.match(controllerSource, /listAdminCharacters/, "carousel editor should load admin characters for CTA target picker");
assert.match(controllerSource, /categoryId !== "mascot" && categoryId !== "creator"/, "carousel target picker should only allow mascots and creators");
assert.match(controllerSource, /getEffectiveMascotIdForSite/, "carousel target picker should resolve site-specific mascot fallback");
assert.match(controllerSource, /targetInput\.value === "mascot_template"|targetInput\.value = mascotOption/, "carousel target picker should replace template mascot with site mascot when needed");

console.log("admin carousel table UI self-check passed");
