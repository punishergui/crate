const DEFAULT_TIMEOUT_MS = 15000;

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

async function withTimeout(promise, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]);
}

function createLidarrClient(settings) {
  const baseUrl = normalizeBaseUrl(settings.lidarrBaseUrl);
  const apiKey = String(settings.lidarrApiKey || '').trim();

  if (!settings.lidarrEnabled) {
    const error = new Error('Lidarr integration is disabled');
    error.statusCode = 400;
    throw error;
  }
  if (!baseUrl || !apiKey) {
    const error = new Error('Lidarr base URL and API key are required');
    error.statusCode = 400;
    throw error;
  }

  async function request(path, { method = 'GET', body } = {}) {
    const response = await withTimeout(fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    }), `Lidarr ${method} ${path}`);

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.message || payload.error || `Lidarr request failed (${response.status})`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  }

  async function findManagedArtist(artistName) {
    const items = await request(`/api/v1/artist?term=${encodeURIComponent(artistName)}`);
    return (items || []).find((item) => String(item.artistName || '').toLowerCase() === artistName.toLowerCase()) || null;
  }

  async function getAddDefaults() {
    const [profiles, folders] = await Promise.all([
      request('/api/v1/qualityprofile'),
      request('/api/v1/rootfolder')
    ]);

    const qualityProfileId = Number.isInteger(settings.lidarrQualityProfileId)
      ? settings.lidarrQualityProfileId
      : Number(profiles?.[0]?.id) || null;

    const rootFolderPath = (typeof settings.lidarrRootFolderPath === 'string' && settings.lidarrRootFolderPath.trim())
      ? settings.lidarrRootFolderPath.trim()
      : (folders?.[0]?.path || null);

    if (!qualityProfileId || !rootFolderPath) {
      const error = new Error('Unable to resolve Lidarr quality profile or root folder. Configure them in settings.');
      error.statusCode = 400;
      throw error;
    }

    return { qualityProfileId, rootFolderPath };
  }

  async function ensureArtistExists({ artistName }) {
    const existing = await findManagedArtist(artistName);
    if (existing) return { artist: existing, created: false };

    const lookup = await request(`/api/v1/artist/lookup?term=${encodeURIComponent(artistName)}`);
    const candidate = (lookup || []).find((item) => String(item.artistName || '').toLowerCase() === artistName.toLowerCase()) || lookup?.[0];
    if (!candidate) {
      const error = new Error(`Artist not found in Lidarr lookup: ${artistName}`);
      error.statusCode = 404;
      throw error;
    }

    const defaults = await getAddDefaults();
    const created = await request('/api/v1/artist', {
      method: 'POST',
      body: {
        ...candidate,
        qualityProfileId: defaults.qualityProfileId,
        rootFolderPath: defaults.rootFolderPath,
        monitored: true,
        addOptions: {
          searchForMissingAlbums: false,
          monitor: 'all'
        }
      }
    });

    return { artist: created, created: true };
  }

  async function findArtistAlbum(artistId, albumTitle, year) {
    const albums = await request(`/api/v1/album?artistId=${artistId}`);
    return (albums || []).find((album) => {
      if (String(album.title || '').toLowerCase() !== albumTitle.toLowerCase()) return false;
      if (!year) return true;
      return Number(album.releaseDate?.slice(0, 4)) === year;
    }) || null;
  }

  async function addAlbumFromLookup(artistName, albumTitle, year) {
    const lookupTerm = year ? `${artistName} ${albumTitle} ${year}` : `${artistName} ${albumTitle}`;
    const options = await request(`/api/v1/album/lookup?term=${encodeURIComponent(lookupTerm)}`);
    const match = (options || []).find((item) => {
      if (String(item.title || '').toLowerCase() !== albumTitle.toLowerCase()) return false;
      const lookupYear = Number(item.releaseDate?.slice(0, 4));
      return !year || lookupYear === year;
    });
    if (!match) return null;

    const monitored = await request('/api/v1/album', {
      method: 'POST',
      body: {
        ...match,
        monitored: true
      }
    });
    return monitored;
  }

  async function triggerAlbumSearch(albumId, artistId) {
    try {
      return await request('/api/v1/command', {
        method: 'POST',
        body: {
          name: 'AlbumSearch',
          albumIds: [albumId]
        }
      });
    } catch {
      return request('/api/v1/command', {
        method: 'POST',
        body: {
          name: 'MissingAlbumSearch',
          artistId
        }
      });
    }
  }

  async function searchMissingAlbum({ artistName, albumTitle, year }) {
    const ensured = await ensureArtistExists({ artistName });
    let album = await findArtistAlbum(ensured.artist.id, albumTitle, year);

    let albumAdded = false;
    if (!album) {
      album = await addAlbumFromLookup(artistName, albumTitle, year);
      albumAdded = Boolean(album);
    }

    if (!album) {
      const error = new Error(`Album not found in Lidarr lookup: ${albumTitle}`);
      error.statusCode = 404;
      throw error;
    }

    const command = await triggerAlbumSearch(album.id, ensured.artist.id);
    return {
      artistId: ensured.artist.id,
      artistName: ensured.artist.artistName,
      artistAdded: ensured.created,
      albumId: album.id,
      albumTitle: album.title,
      albumAdded,
      commandId: command.id,
      commandName: command.name,
      artistUrl: `${baseUrl}/artist/${ensured.artist.id}`,
      albumUrl: `${baseUrl}/album/${album.id}`
    };
  }

  return {
    searchMissingAlbum
  };
}

module.exports = { createLidarrClient };
