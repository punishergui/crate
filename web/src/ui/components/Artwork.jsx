import React from 'react';
import { buildArtHoverAttrs, getBestArtworkSize, getKnownArtworkAvailability, rememberArtworkAvailability, resolveArtworkUrl } from '../lib/artwork';

const SIZE_MAP = { xs: 28, sm: 48, md: 88, lg: 140, xl: 220, tile: 'var(--tile-size, 128px)', 'tile-lg': 'var(--tile-size-lg, 160px)' };

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

export default function Artwork({ kind = 'album', id = null, title = '', subtitle = '', src, alt = 'Artwork', size = 'md', fallbackSeed = '', overlay = null, popout = true, popoutTitle = '', popoutSubtitle = '', badge = '', widthPx = null, className = '' }) {
  const [failed, setFailed] = React.useState(false);
  const ref = React.useRef(null);
  const [visible, setVisible] = React.useState(false);

  const px = widthPx || SIZE_MAP[size] || SIZE_MAP.md;
  const numericPx = typeof px === 'number' ? px : 256;
  const imgSize = getBestArtworkSize(numericPx);
  const explicitSrc = src || (id ? resolveArtworkUrl(kind, id, imgSize) : '');
  const resolvedSrc = explicitSrc ? explicitSrc.replace(/size=\d+/, `size=${imgSize}`) : explicitSrc;

  React.useEffect(() => setFailed(false), [resolvedSrc]);

  React.useEffect(() => {
    const known = getKnownArtworkAvailability(resolvedSrc);
    if (known === false) setFailed(true);
  }, [resolvedSrc]);

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

  const showImage = Boolean(resolvedSrc && !failed && visible);
  const initials = initialsFromSeed(fallbackSeed || alt);
  const displayTitle = popoutTitle || title || alt;
  const displaySubtitle = popoutSubtitle || subtitle || '';
  const hoverAttrs = buildArtHoverAttrs({
    enabled: popout,
    src: resolvedSrc || '',
    title: displayTitle,
    subtitle: displaySubtitle
  });

  return (
    <div
      ref={ref}
      className={`artwork media-tile__image ${className}`.trim()}
      style={{ width: px, '--shift': `${colorShift(fallbackSeed)}deg` }}
      {...hoverAttrs}
    >
      {showImage ? (
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={numericPx}
          height={numericPx}
          onLoad={() => rememberArtworkAvailability(resolvedSrc, true)}
          onError={() => {
            setFailed(true);
            rememberArtworkAvailability(resolvedSrc, false);
          }}
        />
      ) : (
        <div className="artwork-fallback" aria-label={alt}>{initials}</div>
      )}
      {badge ? <span className="artwork-badge">{badge}</span> : null}
      {overlay ? <div className="artwork-overlay">{overlay}</div> : null}
    </div>
  );
}
