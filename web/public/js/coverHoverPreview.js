const OFFSET = 18;

export function attachCoverHoverPreview(containerSelector = 'body') {
  if (window.matchMedia('(pointer: coarse)').matches) return () => {};
  const container = document.querySelector(containerSelector) || document.body;

  let el = document.getElementById('cover-hover-preview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cover-hover-preview';
    el.className = 'art-hover';
    el.hidden = true;
    el.innerHTML = '<div class="art-hover__media"></div><div class="art-hover__meta"><strong></strong><span></span></div>';
    document.body.appendChild(el);
  }

  const media = el.querySelector('.art-hover__media');
  const titleEl = el.querySelector('strong');
  const subtitleEl = el.querySelector('span');
  let rafId = 0;
  let tx = 0; let ty = 0; let x = 0; let y = 0;

  const clampPos = (cx, cy) => {
    const size = Number(getComputedStyle(document.documentElement).getPropertyValue('--artPopoutSize').replace('px', '')) || 320;
    const maxX = window.innerWidth - size - 8;
    const maxY = window.innerHeight - size - 44;
    return [Math.max(8, Math.min(maxX, cx + OFFSET)), Math.max(8, Math.min(maxY, cy + OFFSET))];
  };

  const tick = () => {
    x += (tx - x) * 0.22;
    y += (ty - y) * 0.22;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    rafId = requestAnimationFrame(tick);
  };

  const draw = (target, e) => {
    [tx, ty] = clampPos(e.clientX, e.clientY);
    const src = target.dataset.artPopoutSrc;
    const hiRes = src ? src.replace(/size=\d+/, 'size=512') : '';
    const initials = target.dataset.artPopoutInitials || '♪';
    const shift = target.dataset.artPopoutShift || '0deg';
    media.innerHTML = hiRes
      ? `<img src="${hiRes}" alt="">`
      : `<div class="artwork-fallback" style="--shift:${shift}">${initials}</div>`;
    titleEl.textContent = target.dataset.artPopoutTitle || '';
    subtitleEl.textContent = target.dataset.artPopoutSubtitle || '';
    el.hidden = false;
    if (!rafId) {
      x = tx;
      y = ty;
      rafId = requestAnimationFrame(tick);
    }
  };

  const onMove = (e) => {
    const target = e.target.closest('[data-art-popout-title]');
    if (!target || !container.contains(target)) return;
    draw(target, e);
  };

  const hide = () => {
    el.hidden = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', hide, true);
  document.addEventListener('scroll', hide, true);

  return () => {
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerleave', hide, true);
    document.removeEventListener('scroll', hide, true);
    hide();
  };
}
