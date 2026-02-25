const OFFSET = 20;
const EDGE_GUTTER = 10;
const TOUCH_MEDIA = '(hover: none), (pointer: coarse)';
const ART_SELECTOR = '[data-art-hover="1"]';

function isTouchOnly() {
  return window.matchMedia(TOUCH_MEDIA).matches;
}

function clampPosition(cx, cy, size) {
  const maxX = window.innerWidth - size - EDGE_GUTTER;
  const maxY = window.innerHeight - size - EDGE_GUTTER;
  return {
    x: Math.max(EDGE_GUTTER, Math.min(maxX, cx + OFFSET)),
    y: Math.max(EDGE_GUTTER, Math.min(maxY, cy + OFFSET))
  };
}

export function initArtHover() {
  if (isTouchOnly()) return null;
  let overlay = document.getElementById('artHoverPreview');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'artHoverPreview';
  overlay.hidden = true;
  overlay.innerHTML = '<img id="artHoverImg" alt="" /><div id="artHoverLabel"></div>';
  document.body.appendChild(overlay);
  return overlay;
}

export function attachArtHover(root = document) {
  const overlay = initArtHover();
  if (!overlay) return () => {};

  const image = overlay.querySelector('#artHoverImg');
  const label = overlay.querySelector('#artHoverLabel');
  let activeTarget = null;
  let pendingSrc = '';
  let rafId = 0;
  let debounceTimer = 0;
  let targetPoint = { x: -9999, y: -9999 };
  let renderedPoint = { x: -9999, y: -9999 };

  const hide = () => {
    activeTarget = null;
    pendingSrc = '';
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
    const size = Number(getComputedStyle(document.documentElement).getPropertyValue('--artPopoutSize').replace('px', '')) || 280;
    targetPoint = clampPosition(event.clientX, event.clientY, size);
    if (!rafId && !overlay.hidden) {
      renderedPoint = { ...targetPoint };
      overlay.style.transform = `translate3d(${renderedPoint.x}px, ${renderedPoint.y}px, 0)`;
      rafId = window.requestAnimationFrame(renderPosition);
    }
  };

  const show = (target, event) => {
    if (!target || isTouchOnly()) return;
    const src = target.dataset.artSrc || '';
    if (!src) {
      hide();
      return;
    }
    if (src !== pendingSrc) {
      pendingSrc = src;
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        image.src = src;
      }, 24);
    }
    label.textContent = target.dataset.artLabel || '';
    label.hidden = !label.textContent;
    activeTarget = target;
    moveTo(event);
    overlay.hidden = false;
  };

  const onMouseOver = (event) => {
    const target = event.target?.closest?.(ART_SELECTOR);
    if (!target || !root.contains(target)) return;
    show(target, event);
  };

  const onMouseMove = (event) => {
    if (overlay.hidden) return;
    const target = event.target?.closest?.(ART_SELECTOR);
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

  const onImageError = () => {
    hide();
  };

  image.addEventListener('error', onImageError);
  root.addEventListener('mouseover', onMouseOver);
  root.addEventListener('mousemove', onMouseMove);
  root.addEventListener('mouseout', onMouseOut);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  return () => {
    window.clearTimeout(debounceTimer);
    if (rafId) window.cancelAnimationFrame(rafId);
    image.removeEventListener('error', onImageError);
    root.removeEventListener('mouseover', onMouseOver);
    root.removeEventListener('mousemove', onMouseMove);
    root.removeEventListener('mouseout', onMouseOut);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    hide();
  };
}
