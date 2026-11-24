// Demonstration of the supplied assets only; never reads or publishes a stored draft.
const frame = document.querySelector('iframe');
const config = { launcherImageUrl: '/assets/promotions/pj-gift.svg', popupImageUrl: '/assets/promotions/pj-black-friday-2026.png', label: 'Black Friday offers', desktopRightPx: 24, desktopBottomPx: 24, mobileRightPx: 16, mobileBottomPx: 24, autoAvoid: true };
const send = () => frame.contentWindow?.postMessage({ type: 'aiove-promotion-preview', config }, location.origin);
window.addEventListener('message', event => { if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'aiove-promotion-preview-ready') send(); });
frame.addEventListener('load', send);
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => { const mobile = button.dataset.mode === 'mobile'; frame.classList.toggle('mobile', mobile); for (const item of document.querySelectorAll('[data-mode]')) item.setAttribute('aria-pressed', String(item === button)); });
