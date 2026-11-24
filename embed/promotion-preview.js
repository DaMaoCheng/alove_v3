import { mountPromotion } from './promotion-widget.js';
const source = window.parent !== window ? window.parent : window.opener;
let widget = null;
window.addEventListener('message', event => {
  if (!source || event.source !== source || event.origin !== location.origin || event.data?.type !== 'aiove-promotion-preview') return;
  widget?.destroy();
  widget = mountPromotion(event.data.config || {});
  document.body.dataset.ready = widget ? 'true' : 'false';
});
source?.postMessage({ type: 'aiove-promotion-preview-ready' }, location.origin);
const peers = document.querySelector('.peers');
const names = { chat: ['☎','客服'], whatsapp: ['W','WhatsApp'], top: ['↑','返回顶部'] };
for (const input of document.querySelectorAll('[data-peer]')) {
  const update = () => {
    const key = input.dataset.peer;
    peers.querySelector(`[data-preview-peer="${key}"]`)?.remove();
    if (!input.checked) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = `peer-${key}`; button.dataset.previewPeer = key; button.textContent = names[key][0]; button.setAttribute('aria-label', names[key][1]); peers.append(button);
  };
  input.addEventListener('change', update); update();
}
window.addEventListener('pagehide', () => widget?.destroy(), { once: true });

const barToggle = document.querySelector('[data-buy-bar]');
barToggle.addEventListener('change', () => {
  document.getElementById('buy-bar')?.remove();
  if (barToggle.checked) { const bar = document.createElement('div'); bar.id = 'buy-bar'; bar.textContent = '固定购买条 · 预览'; document.body.append(bar); }
});
