(() => {
  const mounts = window.__aiovePromotionMounts || (window.__aiovePromotionMounts = new Set());
  for (const script of document.querySelectorAll('script[data-aiove-promotion]')) {
    const id = String(script.dataset.aiovePromotion || '').trim();
    if (!id) continue;
    let origin; try { origin = new URL(script.src).origin; } catch { continue; }
    const key = `${origin}:${id}`; if (mounts.has(key)) continue; mounts.add(key);
    void (async () => {
      try {
        const response = await fetch(`${origin}/api/embed/promotion?embed=${encodeURIComponent(id)}`, { credentials: 'omit', mode: 'cors', headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.promotion) { mounts.delete(key); return; }
        const { mountPromotion } = await import(`${origin}/embed/promotion-widget.js`);
        // Async installers can finish their fetch while the host is still parsing its head.
        if (!document.body && document.readyState === 'loading') {
          await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        if (!document.body || !mountPromotion(payload.promotion)) mounts.delete(key);
      } catch { mounts.delete(key); }
    })();
  }
})();
