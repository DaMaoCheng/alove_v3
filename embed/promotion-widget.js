// Shared by the installed promotion and its draft preview. No chat or account access.
const validImage = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try { const url = new URL(raw, location.href); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};
const bound = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : fallback;

// Fixed-corner mode still leaves room for real mobile actions, not empty wrappers.
function hasVisibleBarAction(bar, barRect) {
  const selector = 'button,a[href],input,select,textarea,[role="button"]';
  const roots = [bar];
  while (roots.length) {
    const tree = roots.pop();
    const actions = [...(tree.matches?.(selector) ? [tree] : []), ...tree.querySelectorAll(selector)];
    for (const action of actions) {
      const rect = action.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth
        || rect.right <= barRect.left || rect.left >= barRect.right || rect.bottom <= barRect.top || rect.top >= barRect.bottom) continue;
      let visible = true;
      for (let node = action; node; node = node.parentElement || node.getRootNode()?.host) {
        const css = getComputedStyle(node);
        if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) { visible = false; break; }
      }
      if (visible) return true;
    }
    for (const node of [tree, ...tree.querySelectorAll('*')]) if (node.shadowRoot) roots.push(node.shadowRoot);
  }
  return false;
}

export function mountPromotion(config = {}, { container = document.body } = {}) {
  const popupUrl = validImage(config.popupImageUrl);
  if (!popupUrl) return null;
  const mount = document.createElement('div');
  mount.setAttribute('data-aiove-promotion-widget', '');
  const root = mount.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial}*{box-sizing:border-box}.launcher{position:fixed;z-index:2147482999;width:60px;height:60px;padding:0;border:0;background:transparent;cursor:pointer;display:grid;place-items:center;touch-action:manipulation}.launcher img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}.launcher img[hidden],.poster[hidden]{display:none}.fallback{font-size:46px}.launcher:focus-visible,.close:focus-visible{outline:3px solid #bfff00;outline-offset:5px}.layer{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:28px 16px;background:rgba(0,0,0,.54)}.layer[hidden]{display:none}.picture{position:relative;max-width:min(580px,calc(100vw - 32px));max-height:calc(100dvh - 64px);line-height:0}.poster{display:block;max-width:100%;max-height:calc(100dvh - 64px);width:auto;height:auto;object-fit:contain;filter:drop-shadow(0 18px 42px rgba(0,0,0,.35))}.close{position:absolute;top:-16px;right:-8px;width:32px;height:32px;border:1px solid #ffffff59;border-radius:50%;background:#161b16;color:#fff;cursor:pointer;font:24px/26px Arial,sans-serif;padding:0;z-index:1}.error{margin:0;line-height:1.5;font:15px/1.5 Arial,sans-serif;color:#fff;padding:24px;background:#182018;border-radius:12px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;
  style.textContent += `@media(min-width:641px){.layer{display:block;padding:0;background:transparent;pointer-events:none}.picture{position:fixed;width:max-content;max-width:min(340px,calc(100vw - 32px));pointer-events:auto}.poster{max-width:min(340px,calc(100vw - 32px))}}`;
  const launcher = document.createElement('button'); launcher.type = 'button'; launcher.className = 'launcher';
  const label = String(config.label || 'View offers').slice(0, 96);
  launcher.setAttribute('aria-label', label); launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-haspopup', 'dialog');
  const icon = document.createElement('img'); icon.alt = '';
  const iconFallback = () => { icon.hidden = true; if (launcher.querySelector('.fallback')) return; const fallback = document.createElement('span'); fallback.className = 'fallback'; fallback.textContent = '🎁'; launcher.append(fallback); };
  icon.addEventListener('error', iconFallback, { once: true });
  const iconUrl = validImage(config.launcherImageUrl);
  if (iconUrl) icon.src = iconUrl; else iconFallback();
  launcher.append(icon);
  const layer = document.createElement('div'); layer.className = 'layer'; layer.hidden = true;
  const picture = document.createElement('section'); picture.className = 'picture'; picture.setAttribute('role', 'dialog'); picture.setAttribute('aria-modal', 'true'); picture.setAttribute('aria-label', label); picture.tabIndex = -1;
  const poster = document.createElement('img'); poster.className = 'poster'; poster.src = popupUrl; poster.alt = label;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close offers');
  picture.append(poster, close); layer.append(picture); root.append(style, launcher, layer); container.append(mount);
  let opened = false, destroyed = false, hovered = false, focused = false, motion = null, shake = null, shakeTimer = null, positionTimer = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  poster.addEventListener('load', positionPicture);
  poster.addEventListener('error', () => { poster.hidden = true; const error = document.createElement('p'); error.className = 'error'; error.textContent = 'This image could not be loaded.'; picture.prepend(error); positionPicture(); }, { once: true });
  const stopShake = () => { clearTimeout(shakeTimer); shake?.cancel(); shake = null; };
  function planShake(initial = false) {
    stopShake();
    if (destroyed || opened || hovered || focused || document.hidden || reduced.matches) return;
    shakeTimer = setTimeout(() => {
      const poses = [[0,0],[.08,-3.5],[.18,5.2],[.29,-4.1],[.39,3.5],[.5,-2.6],[.61,1.8],[.72,-1.1],[.81,.55],[.9,-.22],[1,0]];
      shake = icon.animate(poses.map(([offset, angle]) => ({ offset, transform: `rotate(${angle}deg)` })), { duration: 1320, easing: 'ease-in-out' });
      shake.finished.then(() => planShake()).catch(() => {});
    }, initial ? 650 : 3200);
  }
  function transformFromLauncher() {
    const a = launcher.getBoundingClientRect(), b = picture.getBoundingClientRect();
    return `translate(${a.left+a.width/2-b.left-b.width/2}px,${a.top+a.height/2-b.top-b.height/2}px) scale(${Math.min(a.width / Math.max(1,b.width),a.height / Math.max(1,b.height))})`;
  }
  function positionPicture() {
    if (destroyed) return;
    const desktop = innerWidth > 640;
    picture.setAttribute('aria-modal', String(!desktop));
    if (!desktop) { picture.style.removeProperty('left'); picture.style.removeProperty('top'); return; }
    if (layer.hidden) return;
    const anchor = launcher.getBoundingClientRect(), width = picture.offsetWidth, height = picture.offsetHeight;
    const limit = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
    let left = limit(anchor.right - width, 16, innerWidth - width - 16);
    let top = anchor.top - height - 12;
    if (top < 24) {
      // A high launcher leaves room beside it rather than above it.
      if (anchor.left - width - 12 >= 16) { left = anchor.left - width - 12; top = anchor.bottom - height; }
      else top = anchor.bottom + 12;
    }
    picture.style.left = `${left}px`;
    picture.style.top = `${limit(top, 24, innerHeight - height - 24)}px`;
  }
  function setOpen(next, { restoreFocus = true } = {}) {
    if (destroyed || next === opened) return;
    opened = next; launcher.setAttribute('aria-expanded', String(next)); motion?.cancel(); stopShake();
    if (next) {
      layer.hidden = false;
      positionPicture();
      const start = transformFromLauncher();
      motion = picture.animate([{ transform: start, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: reduced.matches ? 0 : 380, easing: 'cubic-bezier(.22,1,.36,1)' });
      close.focus({ preventScroll: true });
    } else {
      motion = picture.animate([{ transform: 'none', opacity: 1 }, { transform: transformFromLauncher(), opacity: 0 }], { duration: reduced.matches ? 0 : 290, easing: 'cubic-bezier(.5,0,.8,.45)' });
      const current = motion;
      motion.finished.then(() => { if (!opened && motion === current && !destroyed) { layer.hidden = true; planShake(); } }).catch(() => {});
      if (restoreFocus) launcher.focus({ preventScroll: true });
    }
  }
  const onLauncher = () => setOpen(!opened);
  const onClose = () => setOpen(false);
  const onLayer = event => { if (event.target === layer) setOpen(false); };
  const onOutside = event => { if (opened && innerWidth > 640 && !event.composedPath().includes(mount)) setOpen(false, { restoreFocus: false }); };
  const onKey = event => {
    if (!opened) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    if (event.key === 'Tab' && innerWidth <= 640) { event.preventDefault(); close.focus(); }
  };
  launcher.addEventListener('click', onLauncher); close.addEventListener('click', onClose); layer.addEventListener('click', onLayer); document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOutside);
  const onEnter = () => { hovered = true; stopShake(); }; const onLeave = () => { hovered = false; planShake(); };
  const onFocus = () => { focused = true; stopShake(); }; const onBlur = () => { focused = false; planShake(); };
  launcher.addEventListener('pointerenter', onEnter); launcher.addEventListener('pointerleave', onLeave); launcher.addEventListener('focus', onFocus); launcher.addEventListener('blur', onBlur);
  const onVisibility = () => document.hidden ? stopShake() : planShake();
  document.addEventListener('visibilitychange', onVisibility); reduced.addEventListener('change', onVisibility);

  const observers = new Map();
  const observedPeers = new Set();
  const resize = new ResizeObserver(() => schedulePosition());
  function schedulePosition() { if (!destroyed && !positionTimer) positionTimer = setTimeout(() => { positionTimer = null; position(); }, 120); }
  function observeTree(tree) {
    if (observers.has(tree)) return;
    const observer = new MutationObserver(changes => { if (changes.some(change => change.target !== mount && !mount.contains(change.target))) schedulePosition(); });
    observer.observe(tree, { subtree: true, childList: true, attributes: true, attributeFilter: ['style','class','hidden'] }); observers.set(tree, observer);
  }
  function position() {
    if (destroyed) return;
    const mobile = innerWidth <= 640, width = innerWidth, height = innerHeight;
    const right = bound(mobile ? config.mobileRightPx : config.desktopRightPx, mobile ? 16 : 24, mobile ? 120 : 160);
    let bottom = bound(mobile ? config.mobileBottomPx : config.desktopBottomPx, 24, 640);
    const roots = [document.body], peers = [];
    while (roots.length) {
      const tree = roots.pop(); if (!tree) continue; observeTree(tree);
      for (const el of tree.querySelectorAll('*')) {
        if (el === mount || mount.contains(el)) continue;
        if (el.shadowRoot) roots.push(el.shadowRoot);
        const css = getComputedStyle(el);
        if (!['fixed','sticky'].includes(css.position) || css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        const bottomBar = mobile && rect.width >= width*.7 && rect.height >= 20
          && rect.height <= (config.autoAvoid === false ? 160 : 112) && rect.bottom >= height-8 && rect.top < height;
        if (bottomBar && (config.autoAvoid !== false || hasVisibleBarAction(el, rect))) {
          bottom = Math.max(bottom, height-rect.top+12); peers.push(el); continue;
        }
        if (rect.width < 16 || rect.height < 16 || rect.width > 180 || rect.height > 240 || rect.left < Math.max(width*.6, width-right-200) || rect.left >= width || rect.bottom <= height*.35 || rect.top >= height) continue;
        if (config.autoAvoid !== false) { bottom = Math.max(bottom, height - rect.top + 12); peers.push(el); }
      }
    }
    for (const peer of observedPeers) if (!peers.includes(peer)) { resize.unobserve(peer); observedPeers.delete(peer); }
    for (const peer of peers) if (!observedPeers.has(peer)) { resize.observe(peer); observedPeers.add(peer); }
    // Keep the launcher visible even when another overlay leaves no stack space.
    launcher.style.right = `max(${Math.max(8, Math.min(right, width - 68))}px, env(safe-area-inset-right,0px))`;
    launcher.style.bottom = `max(${Math.max(8, Math.min(bottom, height - 76))}px, env(safe-area-inset-bottom,0px))`;
    positionPicture();
    for (const [tree, observer] of observers) if (tree !== document.body && !tree.host?.isConnected) { observer.disconnect(); observers.delete(tree); }
  }
  window.addEventListener('resize', schedulePosition); window.addEventListener('scroll', schedulePosition, { passive: true });
  position(); planShake(true);
  return { element: mount, setOpen, get isOpen() { return opened; }, destroy() {
    if (destroyed) return; destroyed = true; stopShake(); motion?.cancel(); clearTimeout(positionTimer); resize.disconnect();
    for (const observer of observers.values()) observer.disconnect(); observers.clear();
    document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onOutside); document.removeEventListener('visibilitychange', onVisibility); reduced.removeEventListener('change', onVisibility);
    window.removeEventListener('resize', schedulePosition); window.removeEventListener('scroll', schedulePosition); mount.remove();
  } };
}
