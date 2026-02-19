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
  return db.prepare(`
    SELECT al.id, al.title, al.path, al.lastFileMtime, al.firstSeen, al.formatsJson, al.trackCount, ar.name AS artistName
    FROM albums al
    JOIN artists ar ON ar.id = al.artistId
    WHERE al.deleted = 0
    ORDER BY COALESCE(al.lastFileMtime, strftime('%s', al.firstSeen) * 1000) DESC
    LIMIT ?
  `).all(limit).map((row) => ({ ...row, formats: JSON.parse(row.formatsJson || '[]') }));
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
