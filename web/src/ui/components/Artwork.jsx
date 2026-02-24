import React from 'react';
import { getBestArtworkSize, getKnownArtworkAvailability, rememberArtworkAvailability } from '../lib/artwork';

const SIZE_MAP = { xs: 28, sm: 48, md: 88, lg: 140, xl: 220, tile: 'var(--artTile)', 'tile-lg': 'var(--artTileLg)' };

function initialsFromSeed(seed = '') {
  const words = String(seed).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '♪';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
}

function colorShift(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return Math.abs(hash % 40);
}

export default function Artwork({ src, alt = 'Artwork', size = 'md', shape = 'square', fallbackSeed = '', overlay = null, popout = false, popoutTitle = '', popoutSubtitle = '', badge = '', widthPx = null }) {
  const [failed, setFailed] = React.useState(false);
  const ref = React.useRef(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  React.useEffect(() => {
    const known = getKnownArtworkAvailability(src);
    if (known === false) setFailed(true);
  }, [src]);

  React.useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '180px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const px = widthPx || SIZE_MAP[size] || SIZE_MAP.md;
  const numericPx = typeof px === 'number' ? px : 256;
  const imgSize = getBestArtworkSize(numericPx);
  const resolvedSrc = src ? src.replace(/size=\d+/, `size=${imgSize}`) : src;
  const showImage = Boolean(resolvedSrc && !failed && visible);
  const shouldPopout = popout && ['xs', 'sm'].includes(size);

  return (
    <div
      ref={ref}
      className={`artwork artwork-${shape}`}
      style={{ width: px, height: px, '--shift': `${colorShift(fallbackSeed)}deg` }}
      data-art-popout-src={shouldPopout ? resolvedSrc : undefined}
      data-art-popout-title={shouldPopout ? (popoutTitle || alt) : undefined}
      data-art-popout-subtitle={shouldPopout ? popoutSubtitle : undefined}
      tabIndex={shouldPopout ? 0 : undefined}
    >
      {showImage ? (
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={numericPx}
          height={numericPx}
          onLoad={() => rememberArtworkAvailability(src, true)}
          onError={() => {
            setFailed(true);
            rememberArtworkAvailability(src, false);
          }}
        />
      ) : (
        <div className="artwork-fallback" aria-label={alt}>{initialsFromSeed(fallbackSeed || alt)}</div>
      )}
      {badge ? <span className="artwork-badge">{badge}</span> : null}
      {overlay ? <div className="artwork-overlay">{overlay}</div> : null}
    </div>
  );
}
