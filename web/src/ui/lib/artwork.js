const AVAILABLE_SIZES = [256, 512, 1024];
const hasArtworkCache = new Map();

function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function getBestArtworkSize(targetPx = 256) {
  const numeric = Number(targetPx) || 256;
  return AVAILABLE_SIZES.find((size) => size >= numeric) || 1024;
}

export function rememberArtworkAvailability(id, ok) {
  if (!id) return;
  hasArtworkCache.set(String(id), Boolean(ok));
  if (hasArtworkCache.size > 4000) {
    const first = hasArtworkCache.keys().next();
    if (!first.done) hasArtworkCache.delete(first.value);
  }
}

export function getKnownArtworkAvailability(id) {
  if (!id) return null;
  return hasArtworkCache.has(String(id)) ? hasArtworkCache.get(String(id)) : null;
}

export function buildArtHoverAttrs({ src = '', label = '', enabled = true } = {}) {
  if (!enabled) return {};
  return {
    'data-art-hover': '1',
    'data-art-src': src || '',
    'data-art-label': label || ''
  };
}


export function resolveArtworkUrl(type, id, size = 256) {
  const numericId = firstNumber(id);
  if (!numericId) return null;
  const safeType = type === 'artist' ? 'artist' : 'album';
  return `/api/artwork/${safeType}/${numericId}?size=${getBestArtworkSize(size)}`;
}
export function getAlbumArtUrl(albumOrId, size = 256) {
  const albumId = typeof albumOrId === 'object' ? firstNumber(albumOrId?.albumId, albumOrId?.id) : firstNumber(albumOrId);
  if (!albumId) return null;
  return resolveArtworkUrl('album', albumId, size);
}

export function getArtistArtUrl(artistOrId, size = 256) {
  const artistId = typeof artistOrId === 'object' ? firstNumber(artistOrId?.artistId, artistOrId?.id) : firstNumber(artistOrId);
  if (!artistId) return null;
  return resolveArtworkUrl('artist', artistId, size);
}

export function getAlbumArtDiagnoseUrl(albumId) {
  const id = firstNumber(albumId);
  return id ? `/api/artwork/album/${id}/diagnose` : null;
}

export function getArtistArtDiagnoseUrl(artistId) {
  const id = firstNumber(artistId);
  return id ? `/api/artwork/artist/${id}/diagnose` : null;
}

export function getAlbumArtRescanUrl(albumId) {
  const id = firstNumber(albumId);
  return id ? `/api/artwork/album/${id}/rescan` : null;
}

export function getArtistArtRescanUrl(artistId) {
  const id = firstNumber(artistId);
  return id ? `/api/artwork/artist/${id}/rescan` : null;
}
