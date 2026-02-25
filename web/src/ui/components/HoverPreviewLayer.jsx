import React from 'react';
import { createPortal } from 'react-dom';

const OFFSET = 24;
const EDGE_GUTTER = 12;
const HOVER_SIZE = 320;
const HOVER_SELECTOR = '[data-art-hover="1"]';
const preloadCache = new Map();

function clampPosition(clientX, clientY, size = HOVER_SIZE) {
  const maxX = Math.max(EDGE_GUTTER, window.innerWidth - size - EDGE_GUTTER);
  const maxY = Math.max(EDGE_GUTTER, window.innerHeight - size - EDGE_GUTTER);
  return {
    left: Math.max(EDGE_GUTTER, Math.min(maxX, clientX + OFFSET)),
    top: Math.max(EDGE_GUTTER, Math.min(maxY, clientY + OFFSET))
  };
}

function preloadImage(src) {
  if (!src) return Promise.resolve(false);
  if (preloadCache.has(src)) return preloadCache.get(src);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
  preloadCache.set(src, job);
  if (preloadCache.size > 1000) {
    const first = preloadCache.keys().next();
    if (!first.done) preloadCache.delete(first.value);
  }
  return job;
}

async function resolvePreviewSrc(primary = '', fallback = '') {
  if (primary && await preloadImage(primary)) return primary;
  if (fallback && await preloadImage(fallback)) return fallback;
  return '';
}

function readHoverPayload(target) {
  if (!target?.dataset) return null;
  return {
    src: target.dataset.artSrc || '',
    fallbackSrc: target.dataset.artFallbackSrc || '',
    title: target.dataset.artTitle || '',
    subtitle: target.dataset.artSubtitle || ''
  };
}

export default function HoverPreviewLayer({ enabled = true }) {
  const [state, setState] = React.useState({
    visible: false,
    left: 0,
    top: 0,
    src: '',
    title: '',
    subtitle: '',
    placeholder: true
  });

  const tokenRef = React.useRef(0);
  const activeElRef = React.useRef(null);
  const visibleRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) {
      visibleRef.current = false;
      setState((prev) => ({ ...prev, visible: false }));
      return undefined;
    }

    const hide = () => {
      tokenRef.current += 1;
      activeElRef.current = null;
      visibleRef.current = false;
      setState((prev) => ({ ...prev, visible: false }));
    };

    const updatePosition = (event) => {
      const next = clampPosition(event.clientX, event.clientY, HOVER_SIZE);
      setState((prev) => (prev.left === next.left && prev.top === next.top ? prev : { ...prev, ...next }));
    };

    const showForTarget = async (target, event) => {
      const payload = readHoverPayload(target);
      if (!payload) return;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      activeElRef.current = target;
      const next = clampPosition(event.clientX, event.clientY, HOVER_SIZE);
      visibleRef.current = true;
      setState({
        visible: true,
        left: next.left,
        top: next.top,
        src: '',
        title: payload.title,
        subtitle: payload.subtitle,
        placeholder: true
      });
      const resolvedSrc = await resolvePreviewSrc(payload.src, payload.fallbackSrc);
      if (tokenRef.current !== token || activeElRef.current !== target) return;
      setState((prev) => ({
        ...prev,
        src: resolvedSrc,
        title: payload.title,
        subtitle: payload.subtitle,
        placeholder: !resolvedSrc
      }));
    };

    const getTarget = (event) => event.target?.closest?.(HOVER_SELECTOR);

    const onMouseOver = (event) => {
      const target = getTarget(event);
      if (!target) return;
      showForTarget(target, event);
    };

    const onMouseMove = (event) => {
      if (!visibleRef.current && !activeElRef.current) return;
      const target = getTarget(event);
      if (!target) {
        hide();
        return;
      }
      if (target !== activeElRef.current) {
        showForTarget(target, event);
        return;
      }
      updatePosition(event);
    };

    const onMouseOut = (event) => {
      if (!activeElRef.current) return;
      const nextTarget = event.relatedTarget?.closest?.(HOVER_SELECTOR);
      if (nextTarget) return;
      hide();
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseout', onMouseOut);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);

    return () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      hide();
    };
  }, [enabled]);

  if (!enabled || !state.visible) return null;

  return createPortal(
    <div
      id="artHoverPreview"
      className="hover-preview-root"
      style={{ transform: `translate3d(${state.left}px, ${state.top}px, 0)` }}
      aria-hidden="true"
    >
      <div className="hoverArtBox" role="presentation">
        {state.placeholder ? (
          <div className="hoverArtPlaceholder"><span>♪</span></div>
        ) : (
          <img src={state.src} alt="" className="hoverArtImage" />
        )}
        {(state.title || state.subtitle) ? (
          <div className="hoverArtMeta">
            <strong>{state.title}</strong>
            {state.subtitle ? <span>{state.subtitle}</span> : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
