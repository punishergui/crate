const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { initDb } = require('./db');
const { Scanner } = require('./scanner');
const { normalizeTitle } = require('./normalize');
const { createDiscographyService } = require('./discography');

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
    lastScanAt: row.lastScanAt || null
  };
}

function getSettings() {
  const row = db.prepare('SELECT accentColor, noiseOverlay, libraryPath, lastScanAt FROM settings WHERE id = 1').get();
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
  const artists = db.prepare('SELECT id, name FROM artists WHERE deleted = 0').all();
  const out = [];
  for (const artist of artists) {
    const overview = getArtistOverview(artist.id);
    for (const item of overview.missing) {
      out.push({
        artistId: artist.id,
        artistName: artist.name,
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
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.firstSeen, al.formatsJson, al.trackCount, ar.name AS artistName
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
    db.prepare('DELETE FROM artists').run();
    db.prepare(`
      UPDATE scan_state
      SET status = 'idle', startedAt = NULL, finishedAt = NULL, currentPath = NULL,
          scannedFiles = 0, scannedAlbums = 0, scannedArtists = 0, error = NULL
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
    db.prepare('UPDATE settings SET accentColor = ?, noiseOverlay = ?, libraryPath = ? WHERE id = 1').run(
      next.accentColor,
      next.noiseOverlay ? 1 : 0,
      next.libraryPath
    );
    return getSettings();
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
});

app.get('/api/stats', async () => getStats());

app.post('/api/scan/start', async () => {
  const settings = getSettings();
  return scanner.startScan(settings.libraryPath);
});

app.post('/api/scan', async () => {
  const settings = getSettings();
  return scanner.startScan(settings.libraryPath);
});

app.get('/api/scan/status', async () => scanner.getStatus());

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
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.formatsJson, al.trackCount, al.owned, ar.id AS artistId, ar.name AS artistName
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
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.formatsJson, al.trackCount, al.owned, ar.id AS artistId, ar.name AS artistName
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.id = ?
  `).get(albumId);
  return { ...row, owned: Boolean(row.owned), formats: JSON.parse(row.formatsJson || '[]') };
});

app.get('/api/library/artists', async () => {
  return db.prepare('SELECT id, name FROM artists WHERE deleted = 0 ORDER BY name').all();
});

app.get('/api/library/artists/:id', async (req, reply) => {
  const artist = db.prepare('SELECT id, name FROM artists WHERE id = ? AND deleted = 0').get(req.params.id);
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
  const artist = db.prepare('SELECT id, name FROM artists WHERE id = ? AND deleted = 0').get(artistId);
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

app.post('/api/expected/artist/:id/sync', async (req, reply) => {
  const artistId = Number(req.params.id);
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

app.get('/api/expected/artist/:id/summary', async (req, reply) => {
  const artistId = Number(req.params.id);
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

app.get('/api/expected/artist/:id/missing', async (req, reply) => {
  const artistId = Number(req.params.id);
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
  const expectedAlbumId = Number(req.body?.expectedAlbumId);
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
    SELECT w.id, w.status, w.createdAt, ea.id AS expectedAlbumId, ea.title, ea.year, ar.id AS artistId, ar.name AS artistName
    FROM wishlist_albums w
    JOIN expected_albums ea ON ea.id = w.expectedAlbumId
    JOIN expected_artists er ON er.id = ea.expectedArtistId
    JOIN artists ar ON ar.id = er.artistId
    ORDER BY w.createdAt DESC, w.id DESC
  `).all();
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
