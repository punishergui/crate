import React from 'react';

const SIZE_MAP = { xs: 24, sm: 40, md: 64, lg: 96 };

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

export default function Artwork({ src, alt = 'Artwork', size = 'md', shape = 'rounded', fallbackSeed = '', overlay = null }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  const px = SIZE_MAP[size] || SIZE_MAP.md;
  const showImage = Boolean(src && !failed);

  return (
    <div className={`artwork artwork-${shape}`} style={{ width: px, height: px, '--shift': `${colorShift(fallbackSeed)}deg` }}>
      {showImage ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <div className="artwork-fallback" aria-label={alt}>{initialsFromSeed(fallbackSeed || alt)}</div>
      )}
      {overlay ? <div className="artwork-overlay">{overlay}</div> : null}
    </div>
  );
}
