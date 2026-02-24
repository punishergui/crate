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

export function getAlbumArtUrl(album, size = 256) {
  if (!album || typeof album !== 'object') return null;
  const direct = cleanUrl(album.artworkUrl || album.coverUrl || album.imageUrl);
  if (direct) return direct;

  const artworkSource = cleanUrl(album.artworkSource);
  if (artworkSource) return artworkSource;

  const albumId = firstNumber(album.albumId, album.id);
  if (!albumId) return null;
  return `/api/artwork/album/${albumId}?size=${size}`;
}

export function getArtistArtUrl(artist, size = 256) {
  if (!artist || typeof artist !== 'object') return null;
  const direct = cleanUrl(artist.artworkUrl || artist.imageUrl || artist.coverUrl);
  if (direct) return direct;

  const artistId = firstNumber(artist.artistId, artist.id);
  if (artistId && artist.albumId) {
    return `/api/artwork/album/${artist.albumId}?size=${size}`;
  }

  return null;
}
