const OFFSET = 18;

export function initArtHover() {
  if (window.matchMedia('(pointer: coarse)').matches) return () => {};

  let el = document.getElementById('art-hover');
  if (!el) {
    el = document.createElement('div');
    el.id = 'art-hover';
    el.className = 'art-hover';
    el.innerHTML = '<div class="art-hover__media"></div><div class="art-hover__meta"><strong></strong><span></span></div>';
    document.body.appendChild(el);
  }

  const media = el.querySelector('.art-hover__media');
  const titleEl = el.querySelector('strong');
  const subtitleEl = el.querySelector('span');

  const clampPos = (x, y) => {
    const size = Number(getComputedStyle(document.documentElement).getPropertyValue('--artPopoutSize').replace('px', '')) || 260;
    const maxX = window.innerWidth - size - 8;
    const maxY = window.innerHeight - size - 44;
    return [Math.max(8, Math.min(maxX, x + OFFSET)), Math.max(8, Math.min(maxY, y + OFFSET))];
  };

  const draw = (target, e) => {
    const [x, y] = clampPos(e.clientX, e.clientY);
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const src = target.dataset.artPopoutSrc;
    const initials = target.dataset.artPopoutInitials || '♪';
    const shift = target.dataset.artPopoutShift || '0deg';
    media.innerHTML = src
      ? `<img src="${src}" alt="">`
      : `<div class="artwork-fallback" style="--shift:${shift}">${initials}</div>`;
    titleEl.textContent = target.dataset.artPopoutTitle || '';
    subtitleEl.textContent = target.dataset.artPopoutSubtitle || '';
    el.hidden = false;
  };

  const onMove = (e) => {
    const target = e.target.closest('[data-art-popout-title]');
    if (!target) return;
    draw(target, e);
  };
  const hide = () => { el.hidden = true; };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerleave', hide, true);
  document.addEventListener('scroll', hide, true);

  return () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', hide, true);
    document.removeEventListener('scroll', hide, true);
    el.hidden = true;
  };
}
