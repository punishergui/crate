const OFFSET = 20;
const EDGE_GUTTER = 10;
const TOUCH_MEDIA = '(hover: none), (pointer: coarse)';
const ART_SELECTOR = '[data-art-hover="1"], img[data-art-hover="1"]';
const PRELOAD_CACHE_LIMIT = 800;
const preloadCache = new Map();

function isTouchOnly() {
  return window.matchMedia(TOUCH_MEDIA).matches;
}

function getHoverArtSize() {
  const root = getComputedStyle(document.documentElement);
  const sizeVar = Number(root.getPropertyValue('--hover-art-size').replace('px', '').trim());
  if (Number.isFinite(sizeVar) && sizeVar > 0) return sizeVar;
  return Math.max(220, Math.min(320, Math.floor(window.innerWidth * 0.24)));
}

function clampPosition(cx, cy, artSize, totalHeight) {
  const maxX = window.innerWidth - artSize - EDGE_GUTTER;
  const maxY = window.innerHeight - totalHeight - EDGE_GUTTER;
  return {
    x: Math.max(EDGE_GUTTER, Math.min(maxX, cx + OFFSET)),
    y: Math.max(EDGE_GUTTER, Math.min(maxY, cy + OFFSET))
  };
}

function runDevSafetyCheck(root = document) {
  if (!import.meta?.env?.DEV) return;
  const route = `${window.location.pathname}${window.location.search}`;
  const riskySelectors = '[class*="cover" i], [class*="thumb" i], .artwork';
  root.querySelectorAll(riskySelectors).forEach((el) => {
    if (el.dataset?.artHover === '1') return;
    if ((el.dataset?.artSrc || '').trim()) return;
    if (el.querySelector('[data-art-src]')) return;
    // eslint-disable-next-line no-console
    console.warn('[artHover] Artwork-like element is missing data-art-src for hover preview', { route, element: el });
  });
}

function trimCache() {
  if (preloadCache.size <= PRELOAD_CACHE_LIMIT) return;
  const first = preloadCache.keys().next();
  if (!first.done) preloadCache.delete(first.value);
}

function preloadImage(src) {
  if (!src) return Promise.resolve(false);
  if (preloadCache.has(src)) return preloadCache.get(src);

  const promise = new Promise((resolve) => {
    const test = new Image();
    test.decoding = 'async';
    test.onload = () => resolve(true);
    test.onerror = () => resolve(false);
    test.src = src;
  });
  preloadCache.set(src, promise);
  trimCache();
  return promise;
}

async function resolveHoverArtSource(primarySrc = '', fallbackSrc = '') {
  if (primarySrc && await preloadImage(primarySrc)) return primarySrc;
  if (fallbackSrc && await preloadImage(fallbackSrc)) return fallbackSrc;
  return '';
}

export function initArtHover() {
  if (isTouchOnly()) return null;
  let overlay = document.getElementById('artHoverPreview');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'artHoverPreview';
  overlay.hidden = true;
  overlay.innerHTML = '<div id="artHoverArtBox"><img id="artHoverImg" alt="" /><div id="artHoverFallback" aria-hidden="true"><span>♪</span></div></div><div id="artHoverMeta"><strong id="artHoverTitle"></strong><span id="artHoverSubtitle"></span></div>';
  document.body.appendChild(overlay);
  return overlay;
}

export function attachArtHover(root = document) {
  const overlay = initArtHover();
  if (!overlay) return () => {};
  runDevSafetyCheck(root);

  const image = overlay.querySelector('#artHoverImg');
  const fallback = overlay.querySelector('#artHoverFallback');
  const titleEl = overlay.querySelector('#artHoverTitle');
  const subtitleEl = overlay.querySelector('#artHoverSubtitle');
  const meta = overlay.querySelector('#artHoverMeta');
  let activeTarget = null;
  let rafId = 0;
  let debounceTimer = 0;
  let renderToken = 0;
  let targetPoint = { x: -9999, y: -9999 };
  let renderedPoint = { x: -9999, y: -9999 };
  let routeCheckTimer = 0;
  let lastRoute = `${window.location.pathname}${window.location.search}`;

  const hide = () => {
    activeTarget = null;
    window.clearTimeout(debounceTimer);
    overlay.hidden = true;
  };

  const renderPosition = () => {
    renderedPoint.x += (targetPoint.x - renderedPoint.x) * 0.28;
    renderedPoint.y += (targetPoint.y - renderedPoint.y) * 0.28;
    overlay.style.transform = `translate3d(${renderedPoint.x}px, ${renderedPoint.y}px, 0)`;
    if (!overlay.hidden) rafId = window.requestAnimationFrame(renderPosition);
    else rafId = 0;
  };

  const moveTo = (event) => {
    const artSize = getHoverArtSize();
    const metaHeight = meta.hidden ? 0 : Math.max(38, meta.offsetHeight || 0);
    targetPoint = clampPosition(event.clientX, event.clientY, artSize, artSize + metaHeight);
    if (!rafId && !overlay.hidden) {
      renderedPoint = { ...targetPoint };
      overlay.style.transform = `translate3d(${renderedPoint.x}px, ${renderedPoint.y}px, 0)`;
      rafId = window.requestAnimationFrame(renderPosition);
    }
  };

  const show = (target, event) => {
    if (!target || isTouchOnly()) return;
    const src = target.dataset.artSrc || '';
    const fallbackSrc = target.dataset.artFallbackSrc || '';
    const title = target.dataset.artTitle || '';
    const subtitle = target.dataset.artSubtitle || '';
    const token = ++renderToken;

    titleEl.textContent = title;
    subtitleEl.textContent = subtitle;
    subtitleEl.hidden = !subtitle;
    meta.hidden = !title && !subtitle;
    image.hidden = true;
    fallback.hidden = false;
    overlay.hidden = false;
    activeTarget = target;
    moveTo(event);

    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      const resolved = await resolveHoverArtSource(src, fallbackSrc);
      if (token !== renderToken || activeTarget !== target) return;
      if (resolved) {
        image.src = resolved;
        image.hidden = false;
        fallback.hidden = true;
      } else {
        image.removeAttribute('src');
        image.hidden = true;
        fallback.hidden = false;
      }
    }, 16);
  };

  const findArtTarget = (event) => event.target?.closest?.('[data-art-hover="1"]');

  const onMouseOver = (event) => {
    const target = findArtTarget(event);
    if (!target || !root.contains(target)) return;
    show(target, event);
  };

  const onMouseMove = (event) => {
    if (overlay.hidden) return;
    const target = findArtTarget(event);
    if (!target || !root.contains(target)) {
      hide();
      return;
    }
    if (activeTarget !== target) show(target, event);
    else moveTo(event);
  };

  const onMouseOut = (event) => {
    if (!activeTarget) return;
    const nextTarget = event.relatedTarget?.closest?.(ART_SELECTOR);
    if (nextTarget && root.contains(nextTarget)) return;
    hide();
  };

  if (import.meta?.env?.DEV) {
    routeCheckTimer = window.setInterval(() => {
      const route = `${window.location.pathname}${window.location.search}`;
      if (route !== lastRoute) {
        lastRoute = route;
        runDevSafetyCheck(root);
      }
    }, 300);
  }

  root.addEventListener('mouseover', onMouseOver);
  root.addEventListener('mousemove', onMouseMove);
  root.addEventListener('mouseout', onMouseOut);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  return () => {
    window.clearTimeout(debounceTimer);
    if (routeCheckTimer) window.clearInterval(routeCheckTimer);
    if (rafId) window.cancelAnimationFrame(rafId);
    root.removeEventListener('mouseover', onMouseOver);
    root.removeEventListener('mousemove', onMouseMove);
    root.removeEventListener('mouseout', onMouseOut);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    hide();
  };
}
