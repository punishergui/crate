import React from 'react';
import { createPortal } from 'react-dom';
import { useHoverPreview } from './HoverPreviewContext';

const OFFSET = 24;
const EDGE_GUTTER = 12;
const HOVER_SIZE = 320;
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

export default function HoverPreviewLayer({ enabled = true }) {
  const { hoverItem, cursorPos, clearHover } = useHoverPreview();
  const [state, setState] = React.useState({ src: '', placeholder: true });
  const tokenRef = React.useRef(0);

  React.useEffect(() => {
    if (!enabled || !hoverItem) {
      tokenRef.current += 1;
      setState({ src: '', placeholder: true });
      return;
    }

    const token = tokenRef.current + 1;
    tokenRef.current = token;

    setState({ src: '', placeholder: true });

    resolvePreviewSrc(hoverItem.src, hoverItem.fallbackSrc).then((resolvedSrc) => {
      if (tokenRef.current !== token) return;
      setState({ src: resolvedSrc, placeholder: !resolvedSrc });
    });
  }, [enabled, hoverItem]);

  React.useEffect(() => {
    if (!enabled) clearHover();
  }, [enabled, clearHover]);

  if (!enabled || !hoverItem) return null;

  const next = clampPosition(cursorPos.x, cursorPos.y, HOVER_SIZE);

  return createPortal(
    <div
      id="artHoverPreview"
      className="hover-preview-root"
      style={{ transform: `translate3d(${next.left}px, ${next.top}px, 0)` }}
      aria-hidden="true"
    >
      <div className="hoverArtBox" role="presentation">
        {state.placeholder ? (
          <div className="hoverArtPlaceholder"><span>♪</span></div>
        ) : (
          <img
            src={state.src}
            alt=""
            className="hoverArtImage"
            onError={() => setState({ src: '', placeholder: true })}
          />
        )}
        {(hoverItem.title || hoverItem.subtitle) ? (
          <div className="hoverArtMeta">
            <strong>{hoverItem.title}</strong>
            {hoverItem.subtitle ? <span>{hoverItem.subtitle}</span> : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
