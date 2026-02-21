const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { initDb } = require('./db');
const { Scanner } = require('./scanner');
const { normalizeTitle } = require('./normalize');
const { createDiscographyService } = require('./discography');
const { createLidarrClient } = require('./lidarr');

const APP_NAME = 'crate';
const PORT = Number(process.env.PORT || 4000);
const HOST = '0.0.0.0';

const app = Fastify({ logger: true });
const db = initDb();
const scanner = new Scanner(db);
const discography = createDiscographyService(db);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = process.env.GIT_SHA || pkg.version;

function normalizeSettings(row) {
  return {
    accentColor: row.accentColor,
    noiseOverlay: Boolean(row.noiseOverlay),
    libraryPath: row.libraryPath,
    lastScanAt: row.lastScanAt || null,
    lidarrEnabled: Boolean(row.lidarrEnabled),
    lidarrBaseUrl: row.lidarrBaseUrl || '',
    lidarrApiKey: row.lidarrApiKey || '',
    lidarrQualityProfileId: Number.isInteger(row.lidarrQualityProfileId) ? row.lidarrQualityProfileId : null,
    lidarrRootFolderPath: row.lidarrRootFolderPath || ''
  };
}

function getSettings() {
  const row = db.prepare('SELECT accentColor, noiseOverlay, libraryPath, lastScanAt, lidarrEnabled, lidarrBaseUrl, lidarrApiKey, lidarrQualityProfileId, lidarrRootFolderPath FROM settings WHERE id = 1').get();
  return normalizeSettings(row);
}

function validateSettings(payload) {
  const out = getSettings();
  if ('accentColor' in payload) {
    if (typeof payload.accentColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(payload.accentColor)) {
      throw new Error('accentColor must be a hex color like #FF6A00');
    }
    out.accentColor = payload.accentColor;
  }
  if ('noiseOverlay' in payload) {
    if (typeof payload.noiseOverlay !== 'boolean') {
      throw new Error('noiseOverlay must be boolean');
    }
    out.noiseOverlay = payload.noiseOverlay;
  }
  if ('libraryPath' in payload) {
    if (typeof payload.libraryPath !== 'string' || !payload.libraryPath.startsWith('/')) {
      throw new Error('libraryPath must be an absolute path');
    }
    out.libraryPath = payload.libraryPath;
  }
  if ('lidarrEnabled' in payload) {
    if (typeof payload.lidarrEnabled !== 'boolean') {
      throw new Error('lidarrEnabled must be boolean');
    }
    out.lidarrEnabled = payload.lidarrEnabled;
  }
  if ('lidarrBaseUrl' in payload) {
    if (typeof payload.lidarrBaseUrl !== 'string') {
      throw new Error('lidarrBaseUrl must be a string');
    }
    out.lidarrBaseUrl = payload.lidarrBaseUrl.trim();
  }
  if ('lidarrApiKey' in payload) {
    if (typeof payload.lidarrApiKey !== 'string') {
      throw new Error('lidarrApiKey must be a string');
    }
    out.lidarrApiKey = payload.lidarrApiKey.trim();
  }
  if ('lidarrQualityProfileId' in payload) {
    if (payload.lidarrQualityProfileId === null || payload.lidarrQualityProfileId === '') {
      out.lidarrQualityProfileId = null;
    } else if (!Number.isInteger(payload.lidarrQualityProfileId) || payload.lidarrQualityProfileId < 1) {
      throw new Error('lidarrQualityProfileId must be a positive integer when provided');
    } else {
      out.lidarrQualityProfileId = payload.lidarrQualityProfileId;
    }
  }
  if ('lidarrRootFolderPath' in payload) {
    if (payload.lidarrRootFolderPath === null) {
      out.lidarrRootFolderPath = '';
    } else if (typeof payload.lidarrRootFolderPath !== 'string') {
      throw new Error('lidarrRootFolderPath must be a string when provided');
    } else {
      out.lidarrRootFolderPath = payload.lidarrRootFolderPath.trim();
    }
  }
  return out;
}

function getArtistOverview(artistId) {
  const owned = db.prepare(`
    SELECT id, title, path, lastFileMtime, formatsJson, trackCount
    FROM albums
    WHERE artistId = ? AND deleted = 0
    ORDER BY title
  `).all(artistId).map((row) => ({ ...row, formats: JSON.parse(row.formatsJson || '[]') }));

  const wanted = db.prepare(`
    SELECT id, title, year, notes, createdAt
    FROM wanted_albums
    WHERE artistId = ?
    ORDER BY createdAt DESC, id DESC
  `).all(artistId);

  const aliases = db.prepare(`
    SELECT alias, mapsToTitle
    FROM album_aliases
    WHERE artistId = ?
  `).all(artistId);

  const aliasMap = new Map();
  for (const item of aliases) {
    aliasMap.set(normalizeTitle(item.alias), normalizeTitle(item.mapsToTitle));
  }

  const ownedMatchSet = new Set();
  for (const album of owned) {
    const normalizedOwned = normalizeTitle(album.title);
    ownedMatchSet.add(normalizedOwned);
    const mappedTitle = aliasMap.get(normalizedOwned);
    if (mappedTitle) ownedMatchSet.add(mappedTitle);
  }

  let ownedMatched = 0;
  const missing = [];
  for (const wantedAlbum of wanted) {
    const wantedNormalized = normalizeTitle(wantedAlbum.title);
    if (ownedMatchSet.has(wantedNormalized)) {
      ownedMatched += 1;
    } else {
      missing.push({
        id: wantedAlbum.id,
        title: wantedAlbum.title,
        year: wantedAlbum.year,
        notes: wantedAlbum.notes
      });
    }
  }

  const completionPct = wanted.length === 0 ? null : Math.round((ownedMatched / wanted.length) * 100);

  return {
    owned,
    wanted,
    missing,
    completionPct
  };
}

function getAllMissing(limit) {
  const artists = db.prepare('SELECT id, name, slug FROM artists WHERE deleted = 0').all();
  const out = [];
  for (const artist of artists) {
    const overview = getArtistOverview(artist.id);
    for (const item of overview.missing) {
      out.push({
        artistId: artist.id,
        artistName: artist.name,
        artistSlug: artist.slug,
        title: item.title,
        year: item.year
      });
    }
  }
  return out
    .sort((a, b) => a.artistName.localeCompare(b.artistName) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function getRecent(limit) {
  return db.prepare(`
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.firstSeen, al.formatsJson, al.trackCount, ar.name AS artistName, ar.slug AS artistSlug
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.deleted = 0
    ORDER BY COALESCE(al.lastFileMtime, strftime('%s', al.firstSeen) * 1000) DESC
    LIMIT ?
  `).all(limit).map((row) => ({ ...row, formats: JSON.parse(row.formatsJson || '[]') }));
}


function clearLibraryState() {
  db.transaction(() => {
    db.prepare('DELETE FROM album_match_overrides').run();
    db.prepare('DELETE FROM wishlist_albums').run();
    db.prepare('DELETE FROM expected_albums').run();
    db.prepare('DELETE FROM expected_artists').run();
    db.prepare('DELETE FROM tracks').run();
    db.prepare('DELETE FROM albums').run();
    db.prepare('DELETE FROM wanted_albums').run();
    db.prepare('DELETE FROM album_aliases').run();
    db.prepare('UPDATE artists SET deleted = 1').run();
    db.prepare(`
      UPDATE scan_state
      SET status = 'idle', startedAt = NULL, finishedAt = NULL, currentPath = NULL,
          scannedFiles = 0, scannedAlbums = 0, scannedArtists = 0, skippedFiles = 0, skippedReasonsJson = '{}', error = NULL
      WHERE id = 1
    `).run();
  })();
}

function getStats() {
  const artists = db.prepare('SELECT COUNT(*) AS c FROM artists WHERE deleted = 0').get().c;
  const albums = db.prepare('SELECT COUNT(*) AS c FROM albums WHERE deleted = 0').get().c;
  const tracks = db.prepare('SELECT COUNT(*) AS c FROM tracks WHERE deleted = 0').get().c;
  const lastScanAt = db.prepare('SELECT lastScanAt FROM settings WHERE id = 1').get().lastScanAt;
  return { artists, albums, tracks, lastScanAt: lastScanAt || null };
}

app.get('/health', async () => {
  const settings = getSettings();
  let dbOk = true;
  try {
    db.prepare('SELECT 1').get();
  } catch {
    dbOk = false;
  }
  return {
    ok: true,
    name: APP_NAME,
    version: VERSION,
    db: dbOk,
    musicMounted: fs.existsSync(settings.libraryPath),
    lastScanAt: settings.lastScanAt
  };
});

app.get('/api/settings', async () => getSettings());

app.put('/api/settings', async (req, reply) => {
  try {
    const next = validateSettings(req.body || {});
    db.prepare(`
      UPDATE settings
      SET accentColor = ?,
          noiseOverlay = ?,
          libraryPath = ?,
          lidarrEnabled = ?,
          lidarrBaseUrl = ?,
          lidarrApiKey = ?,
          lidarrQualityProfileId = ?,
          lidarrRootFolderPath = ?
      WHERE id = 1
    `).run(
      next.accentColor,
      next.noiseOverlay ? 1 : 0,
      next.libraryPath,
      next.lidarrEnabled ? 1 : 0,
      next.lidarrBaseUrl,
      next.lidarrApiKey,
      next.lidarrQualityProfileId,
      next.lidarrRootFolderPath || null
    );
    return getSettings();
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
});

app.get('/api/stats', async () => getStats());

app.post('/api/scan/start', async (req, reply) => {
  const payload = req.body || {};
  if ('maxDepth' in payload && (!Number.isInteger(payload.maxDepth) || payload.maxDepth < 1 || payload.maxDepth > 20)) {
    return reply.code(400).send({ error: 'maxDepth must be an integer between 1 and 20' });
  }

  const settings = getSettings();
  return scanner.startScan(settings.libraryPath, {
    recursive: payload.recursive !== undefined ? Boolean(payload.recursive) : true,
    maxDepth: payload.maxDepth,
    artistId: Number.isInteger(payload.artistId) ? payload.artistId : null
  });
});

app.post('/api/scan', async (req, reply) => {
  const payload = req.body || {};
  if ('maxDepth' in payload && (!Number.isInteger(payload.maxDepth) || payload.maxDepth < 1 || payload.maxDepth > 20)) {
    return reply.code(400).send({ error: 'maxDepth must be an integer between 1 and 20' });
  }

  const settings = getSettings();
  return scanner.startScan(settings.libraryPath, {
    recursive: payload.recursive !== undefined ? Boolean(payload.recursive) : true,
    maxDepth: payload.maxDepth,
    artistId: Number.isInteger(payload.artistId) ? payload.artistId : null
  });
});

app.get('/api/scan/status', async () => scanner.getStatus());


app.get('/api/scan/skipped', async (req, reply) => {
  const limit = Number(req.query.limit ?? 200);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return reply.code(400).send({ error: 'limit must be an integer between 1 and 1000' });
  }
  const startedAt = db.prepare('SELECT startedAt FROM scan_state WHERE id = 1').get()?.startedAt;
  if (!startedAt) return [];
  return db.prepare(`
    SELECT id, filePath AS path, reason, createdAt
    FROM scan_skipped
    WHERE scanStartedAt = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(startedAt, limit);
});

app.post('/api/artist/:id/scan/deep', async (req, reply) => {
  const artistId = Number(req.params.id);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }

  const artist = db.prepare('SELECT id FROM artists WHERE id = ? AND deleted = 0').get(artistId);
  if (!artist) {
    return reply.code(404).send({ error: 'Artist not found' });
  }

  const payload = req.body || {};
  if ('maxDepth' in payload && (!Number.isInteger(payload.maxDepth) || payload.maxDepth < 1 || payload.maxDepth > 20)) {
    return reply.code(400).send({ error: 'maxDepth must be an integer between 1 and 20' });
  }

  const settings = getSettings();
  return scanner.startScan(settings.libraryPath, {
    recursive: payload.recursive !== undefined ? Boolean(payload.recursive) : true,
    maxDepth: payload.maxDepth,
    artistId
  });
});

app.post('/api/scan/cancel', async () => ({ cancelled: scanner.requestCancel(), status: scanner.getStatus() }));


app.post('/api/library/rebuild', async (req, reply) => {
  if (scanner.running) {
    return reply.code(409).send({ error: 'scan already running' });
  }

  clearLibraryState();
  const settings = getSettings();
  scanner.startScan(settings.libraryPath);
  return { ok: true };
});

app.get('/api/library/albums', async (req, reply) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 24)));
  const search = String(req.query.search || '').trim();
  const ownedParam = req.query.owned;
  const offset = (page - 1) * pageSize;

  let ownedFilter = '';
  if (ownedParam === '1') {
    ownedFilter = 'AND al.owned = 1';
  } else if (ownedParam === '0') {
    ownedFilter = 'AND al.owned = 0';
  } else if (ownedParam !== undefined) {
    return reply.code(400).send({ error: 'owned must be 0 or 1 when provided' });
  }

  const where = `${ownedFilter} ${search ? 'AND (al.title LIKE @q OR ar.name LIKE @q)' : ''}`;
  const params = search ? { q: `%${search}%`, limit: pageSize, offset } : { limit: pageSize, offset };

  const items = db.prepare(`
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.formatsJson, al.trackCount, al.owned, ar.id AS artistId, ar.name AS artistName, ar.slug AS artistSlug
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.deleted = 0 ${where}
    ORDER BY al.lastFileMtime DESC, al.id DESC
    LIMIT @limit OFFSET @offset
  `).all(params).map((row) => ({ ...row, owned: Boolean(row.owned), formats: JSON.parse(row.formatsJson || '[]') }));

  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.deleted = 0 ${where}
  `).get(search ? { q: `%${search}%` } : {}).c;

  return { items, total };
});

app.put('/api/library/albums/:id/owned', async (req, reply) => {
  const albumId = Number(req.params.id);
  if (!Number.isInteger(albumId) || albumId < 1) {
    return reply.code(400).send({ error: 'invalid album id' });
  }

  const { owned } = req.body || {};
  if (typeof owned !== 'boolean') {
    return reply.code(400).send({ error: 'owned must be boolean' });
  }

  const result = db.prepare('UPDATE albums SET owned = ? WHERE id = ? AND deleted = 0').run(owned ? 1 : 0, albumId);
  if (result.changes === 0) {
    return reply.code(404).send({ error: 'Album not found' });
  }

  const row = db.prepare(`
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.formatsJson, al.trackCount, al.owned, ar.id AS artistId, ar.name AS artistName, ar.slug AS artistSlug
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.id = ?
  `).get(albumId);
  return { ...row, owned: Boolean(row.owned), formats: JSON.parse(row.formatsJson || '[]') };
});

app.get('/api/library/artists', async () => {
  return db.prepare('SELECT id, name, slug FROM artists WHERE deleted = 0 ORDER BY name').all();
});

app.get('/api/artist/by-slug/:slug', async (req, reply) => {
  const artist = db.prepare('SELECT id, name, slug FROM artists WHERE slug = ? AND deleted = 0').get(req.params.slug);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });
  return artist;
});

app.get('/api/library/artists/:id', async (req, reply) => {
  const artist = db.prepare('SELECT id, name, slug FROM artists WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });
  const albums = db.prepare(`
    SELECT id, title, path, lastFileMtime, formatsJson, trackCount
    FROM albums WHERE artistId = ? AND deleted = 0 ORDER BY title
  `).all(req.params.id).map((row) => ({ ...row, formats: JSON.parse(row.formatsJson || '[]') }));
  return { artist, albums };
});

app.get('/api/library/recent', async (req) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  return getRecent(limit);
});

app.get('/api/artist/:id/overview', async (req, reply) => {
  const artistId = Number(req.params.id);
  const artist = db.prepare('SELECT id, name, slug FROM artists WHERE id = ? AND deleted = 0').get(artistId);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });
  return { artist, ...getArtistOverview(artistId) };
});

app.post('/api/artist/:id/wanted', async (req, reply) => {
  const artistId = Number(req.params.id);
  const artist = db.prepare('SELECT id FROM artists WHERE id = ? AND deleted = 0').get(artistId);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });

  const { title, year, notes } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    return reply.code(400).send({ error: 'title is required' });
  }
  if (year !== undefined && year !== null && (!Number.isInteger(year))) {
    return reply.code(400).send({ error: 'year must be an integer' });
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return reply.code(400).send({ error: 'notes must be a string' });
  }

  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO wanted_albums (artistId, title, year, notes, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(artistId, title.trim(), year ?? null, notes ?? null, createdAt);

  return db.prepare('SELECT id, artistId, title, year, notes, createdAt FROM wanted_albums WHERE id = ?').get(result.lastInsertRowid);
});

app.delete('/api/wanted/:wantedId', async (req) => {
  db.prepare('DELETE FROM wanted_albums WHERE id = ?').run(req.params.wantedId);
  return { ok: true };
});

app.post('/api/artist/:id/alias', async (req, reply) => {
  const artistId = Number(req.params.id);
  const artist = db.prepare('SELECT id FROM artists WHERE id = ? AND deleted = 0').get(artistId);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });

  const { alias, mapsToTitle } = req.body || {};
  if (typeof alias !== 'string' || !alias.trim()) {
    return reply.code(400).send({ error: 'alias is required' });
  }
  if (typeof mapsToTitle !== 'string' || !mapsToTitle.trim()) {
    return reply.code(400).send({ error: 'mapsToTitle is required' });
  }

  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO album_aliases (artistId, alias, mapsToTitle, createdAt)
    VALUES (?, ?, ?, ?)
  `).run(artistId, alias.trim(), mapsToTitle.trim(), createdAt);

  return db.prepare('SELECT id, artistId, alias, mapsToTitle, createdAt FROM album_aliases WHERE id = ?').get(result.lastInsertRowid);
});

app.delete('/api/alias/:aliasId', async (req) => {
  db.prepare('DELETE FROM album_aliases WHERE id = ?').run(req.params.aliasId);
  return { ok: true };
});

app.get('/api/missing/top', async (req, reply) => {
  const limit = Number(req.query.limit ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return reply.code(400).send({ error: 'limit must be an integer between 1 and 1000' });
  }
  return getAllMissing(limit);
});

app.post('/api/expected/artist/:artistId/sync', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  try {
    return await discography.syncExpectedForArtist(artistId);
  } catch (error) {
    const status = error.statusCode || 500;
    req.log.error({
      err: error,
      artistId,
      statusCode: status,
      details: error.details || null
    }, 'expected artist sync failed');
    return reply.code(status).send({
      error: error.message || 'Failed to sync expected albums',
      statusCode: status
    });
  }
});

app.get('/api/expected/artist/:artistId/settings', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  try {
    return discography.getArtistSettings(artistId);
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to fetch expected settings' });
  }
});

app.post('/api/expected/artist/:artistId/settings', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  try {
    return discography.updateArtistSettings(artistId, req.body || {});
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to save expected settings' });
  }
});

app.put('/api/expected/artist/:artistId/settings', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  try {
    return discography.updateArtistSettings(artistId, req.body || {});
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to save expected settings' });
  }
});

app.post('/api/expected/artist/:artistId/ignore', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  const expectedAlbumId = Number(req.body?.expectedAlbumId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  if (!Number.isInteger(expectedAlbumId) || expectedAlbumId < 1) {
    return reply.code(400).send({ error: 'expectedAlbumId must be a positive integer' });
  }
  try {
    return discography.ignoreExpectedAlbum(artistId, expectedAlbumId);
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to ignore expected album' });
  }
});

app.post('/api/expected/artist/:artistId/unignore', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  const expectedAlbumId = Number(req.body?.expectedAlbumId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  if (!Number.isInteger(expectedAlbumId) || expectedAlbumId < 1) {
    return reply.code(400).send({ error: 'expectedAlbumId must be a positive integer' });
  }
  try {
    return discography.unignoreExpectedAlbum(artistId, expectedAlbumId);
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to unignore expected album' });
  }
});

app.get('/api/expected/artist/:artistId/summary', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  try {
    return discography.computeSummary(artistId);
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to compute summary' });
  }
});

app.get('/api/expected/artist/:artistId/missing', async (req, reply) => {
  const artistId = Number(req.params.artistId);
  if (!Number.isInteger(artistId) || artistId < 1) {
    return reply.code(400).send({ error: 'invalid artist id' });
  }
  try {
    return discography.getMissingAlbums(artistId);
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to fetch missing albums' });
  }
});

app.post('/api/wishlist', async (req, reply) => {
  let expectedAlbumId = Number(req.body?.expectedAlbumId);

  if ((!Number.isInteger(expectedAlbumId) || expectedAlbumId < 1) && req.body) {
    const artistId = Number(req.body.artistId);
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const year = Number.isInteger(req.body.year) ? req.body.year : null;
    const source = typeof req.body.source === 'string' ? req.body.source.trim().toLowerCase() : '';

    if (!Number.isInteger(artistId) || artistId < 1 || !title || source !== 'musicbrainz') {
      return reply.code(400).send({ error: 'expectedAlbumId or artistId + title + source="musicbrainz" is required' });
    }

    const found = db.prepare(`
      SELECT ea.id
      FROM expected_albums ea
      JOIN expected_artists er ON er.id = ea.expectedArtistId
      WHERE er.artistId = ?
        AND lower(ea.title) = lower(?)
        AND (? IS NULL OR ea.year = ?)
      ORDER BY ea.id DESC
      LIMIT 1
    `).get(artistId, title, year, year);

    if (!found) {
      return reply.code(404).send({ error: 'Expected album not found for provided artist/title/year' });
    }

    expectedAlbumId = found.id;
  }

  if (!Number.isInteger(expectedAlbumId) || expectedAlbumId < 1) {
    return reply.code(400).send({ error: 'expectedAlbumId must be a positive integer' });
  }

  const album = db.prepare('SELECT id FROM expected_albums WHERE id = ?').get(expectedAlbumId);
  if (!album) {
    return reply.code(404).send({ error: 'Expected album not found' });
  }

  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO wishlist_albums (expectedAlbumId, status, createdAt)
    VALUES (?, 'wanted', ?)
    ON CONFLICT(expectedAlbumId) DO NOTHING
  `).run(expectedAlbumId, createdAt);

  return db.prepare('SELECT id, expectedAlbumId, status, createdAt FROM wishlist_albums WHERE expectedAlbumId = ?').get(expectedAlbumId);
});

app.get('/api/wishlist', async () => {
  return db.prepare(`
    SELECT w.id, w.status, w.createdAt, ea.id AS expectedAlbumId, ea.title, ea.year, ar.id AS artistId, ar.name AS artistName, ar.slug AS artistSlug
    FROM wishlist_albums w
    JOIN expected_albums ea ON ea.id = w.expectedAlbumId
    JOIN expected_artists er ON er.id = ea.expectedArtistId
    JOIN artists ar ON ar.id = er.artistId
    ORDER BY w.createdAt DESC, w.id DESC
  `).all();
});


app.post('/api/integrations/lidarr/search', async (req, reply) => {
  const artistName = typeof req.body?.artistName === 'string' ? req.body.artistName.trim() : '';
  const albumTitle = typeof req.body?.albumTitle === 'string' ? req.body.albumTitle.trim() : '';
  const year = Number.isInteger(req.body?.year) ? req.body.year : null;
  const expectedAlbumId = Number(req.body?.expectedAlbumId);

  if (!artistName || !albumTitle) {
    return reply.code(400).send({ error: 'artistName and albumTitle are required' });
  }
  if (!Number.isInteger(expectedAlbumId) || expectedAlbumId < 1) {
    return reply.code(400).send({ error: 'expectedAlbumId must be a positive integer' });
  }

  const expected = db.prepare(`
    SELECT ea.id, ea.title, ea.year, er.artistId, ar.name AS artistName
    FROM expected_albums ea
    JOIN expected_artists er ON er.id = ea.expectedArtistId
    JOIN artists ar ON ar.id = er.artistId
    WHERE ea.id = ?
  `).get(expectedAlbumId);

  if (!expected) {
    return reply.code(404).send({ error: 'Expected album not found' });
  }

  const titleMatches = expected.title.toLowerCase() === albumTitle.toLowerCase();
  const artistMatches = expected.artistName.toLowerCase() === artistName.toLowerCase();
  if (!titleMatches || !artistMatches) {
    return reply.code(409).send({ error: 'artistName/albumTitle do not match expectedAlbumId' });
  }

  let summary;
  try {
    summary = discography.computeSummary(expected.artistId);
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ error: error.message || 'Failed to validate expected album' });
  }

  const allowed = summary.missingAlbums.some((album) => album.id === expectedAlbumId);
  if (!allowed) {
    return reply.code(409).send({ error: 'Album is not currently eligible for search with active include filters' });
  }

  const settings = getSettings();
  try {
    const lidarr = createLidarrClient(settings);
    const result = await lidarr.searchMissingAlbum({ artistName, albumTitle, year: year || expected.year || null });
    return { ok: true, lidarr: result };
  } catch (error) {
    const status = error.statusCode || 502;
    req.log.error({ err: error, artistName, albumTitle, expectedAlbumId }, 'lidarr search failed');
    return reply.code(status).send({ error: error.message || 'Lidarr request failed' });
  }
});

app.get('/api/dashboard', async () => {
  const stats = getStats();
  const recent = getRecent(12);

  const syncedArtists = db.prepare('SELECT artistId FROM expected_artists').all();
  let missingTotal = 0;
  for (const row of syncedArtists) {
    try {
      const summary = discography.computeSummary(row.artistId);
      missingTotal += summary.missingCount;
    } catch {
      // Ignore missing artists that may have been deleted.
    }
  }

  const wishlistCount = db.prepare('SELECT COUNT(*) AS c FROM wishlist_albums').get().c;

  return { stats, recent, missingTotal, wishlistCount };
});

app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'dist'),
  prefix: '/'
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.url === '/health') {
    return reply.code(404).send({ error: 'Not Found' });
  }
  return reply.sendFile('index.html');
});

app.listen({ port: PORT, host: HOST }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
