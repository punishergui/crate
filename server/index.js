const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { initDb } = require('./db');
const { Scanner } = require('./scanner');

const APP_NAME = 'crate';
const PORT = Number(process.env.PORT || 4000);
const HOST = '0.0.0.0';

const app = Fastify({ logger: true });
const db = initDb();
const scanner = new Scanner(db);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = process.env.GIT_SHA || pkg.version;

function normalizeTitle(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[.,!?:;'"()\[\]{}\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function parseId(value, fieldName = 'id') {
  const out = Number(value);
  if (!Number.isInteger(out) || out < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return out;
}

function parseOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return value;
}

function getOwnedAlbums(artistId) {
  return db.prepare(`
    SELECT id, title, path, lastFileMtime, formatsJson, trackCount
    FROM albums
    WHERE artistId = ? AND deleted = 0
    ORDER BY title
  `).all(artistId).map((row) => ({ ...row, formats: JSON.parse(row.formatsJson || '[]') }));
}

function getExpectedAlbums(artistId) {
  return db.prepare(`
    SELECT id, artistId, title, year, notes, linkedAlbumId, createdAt
    FROM expected_albums
    WHERE artistId = ?
    ORDER BY createdAt DESC, id DESC
  `).all(artistId);
}

function computeOwnedMissing(artistId) {
  const ownedAlbums = getOwnedAlbums(artistId);
  const expected = getExpectedAlbums(artistId);
  const ownedById = new Map(ownedAlbums.map((album) => [album.id, album]));
  const ownedByNormalizedTitle = new Map();
  for (const album of ownedAlbums) {
    const normalized = normalizeTitle(album.title);
    if (!ownedByNormalizedTitle.has(normalized)) {
      ownedByNormalizedTitle.set(normalized, album);
    }
  }

  const matches = [];
  const matchedExpectedIds = new Set();
  for (const item of expected) {
    if (item.linkedAlbumId && ownedById.has(item.linkedAlbumId)) {
      matches.push({ expectedId: item.id, albumId: item.linkedAlbumId, method: 'linked' });
      matchedExpectedIds.add(item.id);
      continue;
    }
    const auto = ownedByNormalizedTitle.get(normalizeTitle(item.title));
    if (auto) {
      matches.push({ expectedId: item.id, albumId: auto.id, method: 'auto' });
      matchedExpectedIds.add(item.id);
    }
  }

  const missing = expected.filter((item) => !matchedExpectedIds.has(item.id));
  const ownedCount = matchedExpectedIds.size;
  const expectedCount = expected.length;
  const missingCount = missing.length;
  const percent = expectedCount === 0 ? null : Math.round((ownedCount / expectedCount) * 100);

  return {
    ownedAlbums,
    expected,
    missing,
    completion: {
      ownedCount,
      expectedCount,
      missingCount,
      percent
    },
    matches
  };
}

function getAllMissing(limit) {
  const artists = db.prepare('SELECT id, name FROM artists WHERE deleted = 0').all();
  const out = [];
  for (const artist of artists) {
    const overview = computeOwnedMissing(artist.id);
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

function ensureArtist(artistId) {
  return db.prepare('SELECT id, name FROM artists WHERE id = ? AND deleted = 0').get(artistId);
}

function ensureExpected(expectedId) {
  return db.prepare('SELECT id, artistId, linkedAlbumId FROM expected_albums WHERE id = ?').get(expectedId);
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

app.get('/api/stats', async () => {
  const artists = db.prepare('SELECT COUNT(*) AS c FROM artists WHERE deleted = 0').get().c;
  const albums = db.prepare('SELECT COUNT(*) AS c FROM albums WHERE deleted = 0').get().c;
  const tracks = db.prepare('SELECT COUNT(*) AS c FROM tracks WHERE deleted = 0').get().c;
  const lastScanAt = db.prepare('SELECT lastScanAt FROM settings WHERE id = 1').get().lastScanAt;
  return { artists, albums, tracks, lastScanAt: lastScanAt || null };
});

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

app.get('/api/library/albums', async (req) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 24)));
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * pageSize;

  const where = search ? 'AND (al.title LIKE @q OR ar.name LIKE @q)' : '';
  const params = search ? { q: `%${search}%`, limit: pageSize, offset } : { limit: pageSize, offset };

  const items = db.prepare(`
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.formatsJson, al.trackCount, ar.id AS artistId, ar.name AS artistName
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.deleted = 0 ${where}
    ORDER BY al.lastFileMtime DESC, al.id DESC
    LIMIT @limit OFFSET @offset
  `).all(params).map((row) => ({ ...row, formats: JSON.parse(row.formatsJson || '[]') }));

  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.deleted = 0 ${where}
  `).get(search ? { q: `%${search}%` } : {}).c;

  return { items, total };
});

app.get('/api/library/artists', async () => {
  return db.prepare('SELECT id, name FROM artists WHERE deleted = 0 ORDER BY name').all();
});

app.get('/api/library/artists/:id', async (req, reply) => {
  let artistId;
  try {
    artistId = parseId(req.params.id, 'artist id');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }

  const artist = ensureArtist(artistId);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });
  const albums = getOwnedAlbums(artistId);
  return { artist, albums };
});

app.get('/api/library/artists/:id/owned-missing', async (req, reply) => {
  let artistId;
  try {
    artistId = parseId(req.params.id, 'artist id');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  const artist = ensureArtist(artistId);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });

  const details = computeOwnedMissing(artistId);
  return { artist, ...details };
});

app.get('/api/library/recent', async (req) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  return db.prepare(`
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.firstSeen, al.formatsJson, al.trackCount, ar.name AS artistName, ar.id AS artistId
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.deleted = 0
    ORDER BY COALESCE(al.lastFileMtime, strftime('%s', al.firstSeen) * 1000) DESC
    LIMIT ?
  `).all(limit).map((row) => ({ ...row, formats: JSON.parse(row.formatsJson || '[]') }));
});

app.get('/api/artist/:id/overview', async (req, reply) => {
  let artistId;
  try {
    artistId = parseId(req.params.id, 'artist id');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  const artist = ensureArtist(artistId);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });
  const details = computeOwnedMissing(artistId);
  return {
    artist,
    owned: details.ownedAlbums,
    wanted: details.expected,
    missing: details.missing,
    completionPct: details.completion.percent
  };
});

app.get('/api/artists/:id/expected', async (req, reply) => {
  let artistId;
  try {
    artistId = parseId(req.params.id, 'artist id');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  const artist = ensureArtist(artistId);
  if (!artist) return reply.code(404).send({ error: 'Artist not found' });
  return getExpectedAlbums(artistId);
});

app.post('/api/artists/:id/expected', async (req, reply) => {
  let artistId;
  try {
    artistId = parseId(req.params.id, 'artist id');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  if (!ensureArtist(artistId)) return reply.code(404).send({ error: 'Artist not found' });

  const { title, year, notes } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    return reply.code(400).send({ error: 'title is required' });
  }
  let parsedYear;
  try {
    parsedYear = parseOptionalInteger(year, 'year');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return reply.code(400).send({ error: 'notes must be a string' });
  }

  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO expected_albums (artistId, title, year, notes, linkedAlbumId, createdAt)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(artistId, title.trim(), parsedYear, notes ?? null, createdAt);

  return db.prepare('SELECT id, artistId, title, year, notes, linkedAlbumId, createdAt FROM expected_albums WHERE id = ?').get(result.lastInsertRowid);
});

app.put('/api/expected/:expectedId', async (req, reply) => {
  let expectedId;
  try {
    expectedId = parseId(req.params.expectedId, 'expectedId');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }

  const existing = ensureExpected(expectedId);
  if (!existing) return reply.code(404).send({ error: 'Expected album not found' });

  const payload = req.body || {};
  const updates = [];
  const params = [];

  if ('title' in payload) {
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      return reply.code(400).send({ error: 'title must be a non-empty string' });
    }
    updates.push('title = ?');
    params.push(payload.title.trim());
  }

  if ('year' in payload) {
    try {
      updates.push('year = ?');
      params.push(parseOptionalInteger(payload.year, 'year'));
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  }

  if ('notes' in payload) {
    if (payload.notes !== null && payload.notes !== undefined && typeof payload.notes !== 'string') {
      return reply.code(400).send({ error: 'notes must be a string' });
    }
    updates.push('notes = ?');
    params.push(payload.notes ?? null);
  }

  if ('linkedAlbumId' in payload) {
    const linkedAlbumId = payload.linkedAlbumId;
    if (linkedAlbumId !== null) {
      let parsed;
      try {
        parsed = parseId(linkedAlbumId, 'linkedAlbumId');
      } catch (error) {
        return reply.code(400).send({ error: error.message });
      }
      const ownAlbum = db.prepare('SELECT id FROM albums WHERE id = ? AND artistId = ? AND deleted = 0').get(parsed, existing.artistId);
      if (!ownAlbum) {
        return reply.code(400).send({ error: 'linkedAlbumId must reference an owned album for the same artist' });
      }
      updates.push('linkedAlbumId = ?');
      params.push(parsed);
    } else {
      updates.push('linkedAlbumId = NULL');
    }
  }

  if (updates.length === 0) {
    return reply.code(400).send({ error: 'No valid fields provided' });
  }

  db.prepare(`UPDATE expected_albums SET ${updates.join(', ')} WHERE id = ?`).run(...params, expectedId);
  return db.prepare('SELECT id, artistId, title, year, notes, linkedAlbumId, createdAt FROM expected_albums WHERE id = ?').get(expectedId);
});

app.delete('/api/expected/:expectedId', async (req, reply) => {
  let expectedId;
  try {
    expectedId = parseId(req.params.expectedId, 'expectedId');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  db.prepare('DELETE FROM expected_albums WHERE id = ?').run(expectedId);
  return { ok: true };
});

app.post('/api/expected/:expectedId/link', async (req, reply) => {
  let expectedId;
  try {
    expectedId = parseId(req.params.expectedId, 'expectedId');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }

  const expected = ensureExpected(expectedId);
  if (!expected) return reply.code(404).send({ error: 'Expected album not found' });

  if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'albumId')) {
    return reply.code(400).send({ error: 'albumId is required (number or null)' });
  }

  const { albumId } = req.body;
  if (albumId === null) {
    db.prepare('UPDATE expected_albums SET linkedAlbumId = NULL WHERE id = ?').run(expectedId);
  } else {
    let parsedAlbumId;
    try {
      parsedAlbumId = parseId(albumId, 'albumId');
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }

    const ownAlbum = db.prepare('SELECT id FROM albums WHERE id = ? AND artistId = ? AND deleted = 0').get(parsedAlbumId, expected.artistId);
    if (!ownAlbum) {
      return reply.code(400).send({ error: 'albumId must reference an owned album for the same artist' });
    }
    db.prepare('UPDATE expected_albums SET linkedAlbumId = ? WHERE id = ?').run(parsedAlbumId, expectedId);
  }

  return db.prepare('SELECT id, artistId, title, year, notes, linkedAlbumId, createdAt FROM expected_albums WHERE id = ?').get(expectedId);
});

// backwards-compatible endpoints
app.post('/api/artist/:id/wanted', async (req, reply) => {
  let artistId;
  try {
    artistId = parseId(req.params.id, 'artist id');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  if (!ensureArtist(artistId)) return reply.code(404).send({ error: 'Artist not found' });

  const { title, year, notes } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    return reply.code(400).send({ error: 'title is required' });
  }
  let parsedYear;
  try {
    parsedYear = parseOptionalInteger(year, 'year');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return reply.code(400).send({ error: 'notes must be a string' });
  }

  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO expected_albums (artistId, title, year, notes, linkedAlbumId, createdAt)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(artistId, title.trim(), parsedYear, notes ?? null, createdAt);

  return db.prepare('SELECT id, artistId, title, year, notes, linkedAlbumId, createdAt FROM expected_albums WHERE id = ?').get(result.lastInsertRowid);
});

app.delete('/api/wanted/:wantedId', async (req, reply) => {
  let expectedId;
  try {
    expectedId = parseId(req.params.wantedId, 'wantedId');
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
  db.prepare('DELETE FROM expected_albums WHERE id = ?').run(expectedId);
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
