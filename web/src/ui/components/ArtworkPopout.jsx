import React from 'react';
import { createPortal } from 'react-dom';

const OFFSET = 24;

export default function ArtworkPopout({ enabled = true }) {
  const popoutRef = React.useRef(null);
  const targetRef = React.useRef({ x: 0, y: 0, visible: false, src: '', title: '', subtitle: '' });
  const [state, setState] = React.useState(targetRef.current);

  React.useEffect(() => {
    if (!enabled || window.matchMedia('(pointer: coarse)').matches) return undefined;

    let raf = 0;
    let x = 0;
    let y = 0;

    const animate = () => {
      const next = targetRef.current;
      x += (next.x - x) * 0.2;
      y += (next.y - y) * 0.2;
      if (popoutRef.current) {
        popoutRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      raf = requestAnimationFrame(animate);
    };

    const hide = () => {
      targetRef.current = { ...targetRef.current, visible: false };
      setState(targetRef.current);
    };

    const place = (cx, cy) => {
      const size = Number(getComputedStyle(document.documentElement).getPropertyValue('--artPopoutSize').replace('px', '')) || 280;
      const maxX = window.innerWidth - size - 8;
      const maxY = window.innerHeight - size - 8;
      targetRef.current = {
        ...targetRef.current,
        x: Math.max(8, Math.min(maxX, cx + OFFSET)),
        y: Math.max(8, Math.min(maxY, cy + OFFSET))
      };
    };

    const showFromEl = (el, event) => {
      const src = el.dataset.artPopoutSrc;
      if (!src) return;
      const rect = el.getBoundingClientRect();
      const cx = event?.clientX ?? (rect.left + rect.right) / 2;
      const cy = event?.clientY ?? (rect.top + rect.bottom) / 2;
      place(cx, cy);
      targetRef.current = {
        ...targetRef.current,
        visible: true,
        src,
        title: el.dataset.artPopoutTitle || '',
        subtitle: el.dataset.artPopoutSubtitle || ''
      };
      setState(targetRef.current);
    };

    const onPointerMove = (event) => {
      const el = event.target?.closest?.('[data-art-popout-src]');
      if (!el) return;
      showFromEl(el, event);
    };

    const onPointerLeave = (event) => {
      if (!event.target?.closest?.('[data-art-popout-src]')) return;
      hide();
    };

    const onFocusIn = (event) => {
      const el = event.target?.closest?.('[data-art-popout-src]');
      if (!el) return;
      showFromEl(el);
    };

    const onFocusOut = (event) => {
      if (!event.target?.closest?.('[data-art-popout-src]')) return;
      hide();
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerleave', onPointerLeave, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);

  if (!enabled) return null;

  return createPortal(
    <div ref={popoutRef} className={`art-popout ${state.visible ? 'visible' : ''}`} aria-hidden>
      {state.src ? <img src={state.src} alt={state.title || 'Artwork popout'} /> : null}
      {state.title || state.subtitle ? <div className="art-popout-meta"><strong>{state.title}</strong><span>{state.subtitle}</span></div> : null}
    </div>,
    document.body
  );
}
