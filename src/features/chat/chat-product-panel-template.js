import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function productPanelHtml({ includeSizeChartModal = true, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  return `
    <div class="pp-head"><span class="pp-title" data-product-panel-title>${copy.t("product.title")}</span><div class="pp-head-actions"><button class="pp-cart-open" data-product-cart-open type="button" aria-label="${copy.t("product.cartTitle")}">${ICONS.shop}<span data-product-cart-count hidden>0</span></button><button class="pp-close" aria-label="${copy.t("common.close")}">${ICONS.close}</button></div></div>
    <div class="pp-scroll">
      <div class="pp-hero">
        <span class="pc-tag" data-product-panel-tag hidden></span>
        <div class="pp-gallery-track" data-product-panel-track>
          <div class="pp-gallery-slide"><img src="/assets/jersey_product.png" alt="${copy.t("product.image")}" data-product-panel-image /></div>
        </div>
        <button class="pp-gallery-btn pp-gallery-prev" data-product-panel-prev type="button" aria-label="${copy.t("product.previousImage")}" hidden>${ICONS.back}</button>
        <button class="pp-gallery-btn pp-gallery-next" data-product-panel-next type="button" aria-label="${copy.t("product.nextImage")}" hidden>${ICONS.back}</button>
        <span class="pp-gallery-count" data-product-panel-count hidden></span>
      </div>
      <div class="pp-body">
        <div class="pp-name" data-product-panel-name>${copy.t("product.select")}</div>
        <div class="pp-sub" data-product-panel-subtitle></div>
        <div class="pp-price" data-product-panel-price></div>
        <section class="pp-offers" data-product-panel-offers hidden>
          <div class="pp-offers-title" data-product-panel-offers-title>${copy.t("product.offersTitle")}</div>
          <div class="pp-offers-list" data-product-panel-offers-list></div>
        </section>
        <div class="pp-code" data-product-panel-code hidden><div><span class="pp-code-k" data-product-panel-code-label>${copy.t("product.codeLabel")}</span><b></b></div><button class="pp-copy">${ICONS.copy}<span data-product-panel-copy-label>${copy.t("product.copy")}</span></button></div>
        <div class="pp-field" data-product-panel-size-field hidden>
          <div class="pp-size-heading"><label data-product-panel-size-label>${copy.t("product.size")}</label><button class="pp-size-chart-trigger" data-product-size-chart-open type="button" hidden><span data-product-size-chart-icon>${ICONS.ruler}</span><span>${copy.t("product.sizeChart")}</span></button></div>
          <div class="pp-sizes" data-product-panel-sizes></div>
        </div>
        <section class="pp-customization" data-product-panel-customization hidden>
          <div class="pp-customization-head">
            <div>
              <span class="pp-customization-kicker" data-product-customization-kicker>${copy.t("product.customizationKicker")}</span>
              <h3 data-product-customization-title>${copy.t("product.customizationTitle")}</h3>
            </div>
            <span class="pp-customization-total" data-product-customization-total hidden></span>
          </div>
          <div class="pp-customization-fields" data-product-customization-fields></div>
        </section>
        <div class="pp-field pp-quantity-field" data-product-panel-quantity-field>
          <label data-product-panel-quantity-label>${copy.t("product.quantity")}</label>
          <div class="pp-quantity-control" role="group" aria-label="${copy.t("product.quantity")}">
            <button type="button" data-product-quantity-action="decrease" aria-label="${copy.t("product.decreaseQuantity")}">−</button>
            <output data-product-panel-quantity>1</output>
            <button type="button" data-product-quantity-action="increase" aria-label="${copy.t("product.increaseQuantity")}">+</button>
          </div>
        </div>
        <ul class="pp-feat" data-product-panel-features></ul>
        <a class="pp-detail-link" data-product-panel-detail-link href="#" target="_blank" rel="noopener noreferrer" hidden>
          <span class="pp-detail-logo">
            <img data-product-panel-detail-logo alt="" hidden />
            <span data-product-panel-detail-logo-fallback>${ICONS.globe}</span>
          </span>
          <span data-product-panel-detail-site>${copy.t("product.store")}</span>
          <b data-product-panel-detail-label>${copy.t("product.viewDetails")}</b>
        </a>
      </div>
    </div>
    <div class="pp-soldout-hint" data-product-panel-soldout-hint role="status" aria-live="polite" hidden></div>
    <div class="pp-foot">
      <div class="pp-foot-main">
        <div class="pp-foot-price" data-product-panel-foot-price></div>
        <button class="btn btn-primary pp-buy" data-product-panel-buy type="button">${ICONS.shop} ${copy.t("product.addToCart")}</button>
      </div>
      <div class="pp-payment-strip" data-product-panel-payments hidden></div>
    <div class="pp-price-note" data-product-panel-price-note>${copy.t("product.priceNote")}</div>
    </div>
    ${includeSizeChartModal ? productSizeChartModalHtml({ pageLanguage }) : ""}
  `;
}

export function productSizeChartModalHtml({ pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  return `
    <div class="pp-size-chart-modal" data-product-size-chart-modal hidden>
      <div class="pp-size-chart-backdrop" data-product-size-chart-close></div>
      <section class="pp-size-chart-dialog" role="dialog" aria-modal="true" aria-labelledby="product-size-chart-title">
        <div class="pp-size-chart-head"><div><h2 id="product-size-chart-title" data-product-size-chart-title>${copy.t("product.sizeChart")}</h2><p data-product-size-chart-fit-tip hidden></p></div><button class="pp-size-chart-close" data-product-size-chart-close type="button" aria-label="${copy.t("product.closeSizeChart")}">${ICONS.close}</button></div>
        <div class="pp-size-chart-scroll"><table class="pp-size-chart-table"><thead data-product-size-chart-head></thead><tbody data-product-size-chart-body></tbody></table></div>
      </section>
    </div>`;
}
