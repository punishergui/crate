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

export function getAlbumArtUrl(albumOrId, size = 256) {
  const albumId = typeof albumOrId === 'object' ? firstNumber(albumOrId?.albumId, albumOrId?.id) : firstNumber(albumOrId);
  if (!albumId) return null;
  return `/api/artwork/album/${albumId}?size=${getBestArtworkSize(size)}`;
}

export function getArtistArtUrl(artistOrId, size = 256) {
  const artistId = typeof artistOrId === 'object' ? firstNumber(artistOrId?.artistId, artistOrId?.id) : firstNumber(artistOrId);
  if (!artistId) return null;
  return `/api/artwork/artist/${artistId}?size=${getBestArtworkSize(size)}`;
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
