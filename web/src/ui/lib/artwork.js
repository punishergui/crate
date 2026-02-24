const AVAILABLE_SIZES = [256, 512, 1024];
const hasArtworkCache = new Map();

function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
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

export function getAlbumArtUrl(album, size = 256) {
  if (!album || typeof album !== 'object') return null;
  const direct = cleanUrl(album.artworkUrl || album.coverUrl || album.imageUrl);
  if (direct) return direct;

  const artworkSource = cleanUrl(album.artworkSource);
  if (artworkSource) return artworkSource;

  const albumId = firstNumber(album.albumId, album.id);
  if (!albumId) return null;
  return `/api/artwork/album/${albumId}?size=${getBestArtworkSize(size)}`;
}

export function getArtistArtUrl(artist, size = 256) {
  if (!artist || typeof artist !== 'object') return null;
  const direct = cleanUrl(artist.artworkUrl || artist.imageUrl || artist.coverUrl);
  if (direct) return direct;

  const artistId = firstNumber(artist.artistId, artist.id);
  if (!artistId) return null;
  return `/api/artwork/artist/${artistId}?size=${getBestArtworkSize(size)}`;
}
