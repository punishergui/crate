const BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'crate/1.0 (https://github.com/punishergui/crate)';
const MIN_INTERVAL_MS = 1000;

let queue = Promise.resolve();
let lastRequestAt = 0;

async function scheduleRequest(url) {
  queue = queue.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MusicBrainz request failed (${response.status}): ${text || response.statusText}`);
    }
    return response.json();
  });
  return queue;
}

function isAlbumReleaseGroup(releaseGroup) {
  const primaryType = String(releaseGroup['primary-type'] || '').toLowerCase();
  return primaryType === 'album';
}

async function findArtistByName(name) {
  const query = encodeURIComponent(`artist:"${name}"`);
  const url = `${BASE_URL}/artist?query=${query}&fmt=json&limit=5`;
  const payload = await scheduleRequest(url);
  const artists = payload.artists || [];
  if (!artists.length) return null;

  const normalizedTarget = String(name || '').toLowerCase().trim();
  const ranked = artists
    .map((artist, index) => {
      const normalizedName = String(artist.name || '').toLowerCase().trim();
      const score = Number(artist.score || 0) + (normalizedName === normalizedTarget ? 20 : 0) - index;
      return { ...artist, _score: score };
    })
    .sort((a, b) => b._score - a._score);

  const best = ranked[0];
  return best ? { mbid: best.id, name: best.name, score: best._score } : null;
}

async function fetchArtistAlbums(mbid) {
  const releaseGroups = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${BASE_URL}/release-group?artist=${encodeURIComponent(mbid)}&fmt=json&limit=${limit}&offset=${offset}`;
    const payload = await scheduleRequest(url);
    const page = payload['release-groups'] || [];

    for (const item of page) {
      if (!isAlbumReleaseGroup(item)) continue;
      const firstDate = String(item['first-release-date'] || '');
      const year = /^\d{4}/.test(firstDate) ? Number(firstDate.slice(0, 4)) : null;
      releaseGroups.push({
        mbReleaseGroupId: item.id,
        title: item.title,
        year,
        type: item['primary-type'] || 'Album'
      });
    }

    offset += page.length;
    if (!page.length || offset >= Number(payload['release-group-count'] || 0)) {
      break;
    }
  }

  return releaseGroups;
}

module.exports = { findArtistByName, fetchArtistAlbums };
