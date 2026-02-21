const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { USER_AGENT } = require('./musicbrainz');

const ARTWORK_DIR = process.env.ARTWORK_DIR || '/data/artwork';
const ORIGINAL_DIR = path.join(ARTWORK_DIR, 'original');
const THUMBS_DIR = path.join(ARTWORK_DIR, 'thumbs');

function nowTs() {
  return Date.now();
}

function normalizeBool(value, defaultValue) {
  if (value === null || value === undefined) return defaultValue;
  return Boolean(value);
}

class ArtworkService {
  constructor(db, logger = console) {
    this.db = db;
    this.log = logger;
    fs.mkdirSync(ORIGINAL_DIR, { recursive: true });
    fs.mkdirSync(THUMBS_DIR, { recursive: true });
    this.timer = setInterval(() => this.processNextJob().catch((error) => {
      this.log.error?.(error, 'artwork job failed');
    }), 1500);
    this.timer.unref?.();
  }

  getPaths(albumId) {
    return {
      original: path.join(ORIGINAL_DIR, `${albumId}.jpg`),
      thumb256: path.join(THUMBS_DIR, `${albumId}_256.jpg`),
      thumb512: path.join(THUMBS_DIR, `${albumId}_512.jpg`)
    };
  }

  queue(type, payload) {
    this.db.prepare(`INSERT INTO jobs (type, payloadJson, status, createdAt) VALUES (?, ?, 'queued', ?)`).run(type, JSON.stringify(payload), nowTs());
  }

  getSettings() {
    const row = this.db.prepare('SELECT artworkPreferLocal, artworkAllowRemote FROM settings WHERE id = 1').get() || {};
    return {
      artworkPreferLocal: normalizeBool(row.artworkPreferLocal, true),
      artworkAllowRemote: normalizeBool(row.artworkAllowRemote, false)
    };
  }

  async processNextJob() {
    const job = this.db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1`).get();
    if (!job) return;
    this.db.prepare(`UPDATE jobs SET status = 'running', startedAt = ?, error = NULL WHERE id = ?`).run(nowTs(), job.id);
    try {
      const payload = JSON.parse(job.payloadJson || '{}');
      if (job.type === 'art_fetch_album') {
        await this.refreshAlbum(payload.albumId, { force: Boolean(payload.force) });
      }
      this.db.prepare(`UPDATE jobs SET status = 'done', finishedAt = ? WHERE id = ?`).run(nowTs(), job.id);
    } catch (error) {
      this.db.prepare(`UPDATE jobs SET status = 'error', finishedAt = ?, error = ? WHERE id = ?`).run(nowTs(), String(error.message || error), job.id);
    }
  }

  resolveAlbumFolder(albumId, albumPath) {
    if (albumPath && fs.existsSync(albumPath) && fs.statSync(albumPath).isDirectory()) return albumPath;
    const tracks = this.db.prepare('SELECT path FROM tracks WHERE albumId = ? AND deleted = 0').all(albumId);
    if (!tracks.length) return null;
    const counts = new Map();
    for (const track of tracks) {
      const dir = path.dirname(track.path);
      counts.set(dir, (counts.get(dir) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  pickLocalImage(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) return null;
    const entries = fs.readdirSync(folderPath, { withFileTypes: true }).filter((entry) => entry.isFile());
    const files = entries
      .filter((entry) => /\.(jpe?g|png)$/i.test(entry.name))
      .map((entry) => {
        const fullPath = path.join(folderPath, entry.name);
        const stat = fs.statSync(fullPath);
        return { fullPath, name: entry.name.toLowerCase(), size: stat.size };
      });
    if (!files.length) return null;

    const exact = files.find((file) => ['cover.jpg', 'folder.jpg', 'front.jpg', 'album.jpg'].includes(file.name));
    if (exact) return exact.fullPath;

    const named = files.filter((file) => /cover|folder|front/.test(file.name)).sort((a, b) => b.size - a.size)[0];
    if (named) return named.fullPath;

    return files.sort((a, b) => b.size - a.size)[0].fullPath;
  }

  async cacheFromPath(albumId, sourcePath, sourceMeta) {
    const paths = this.getPaths(albumId);
    await fsp.copyFile(sourcePath, paths.original);
    await fsp.copyFile(sourcePath, paths.thumb256);
    await fsp.copyFile(sourcePath, paths.thumb512);
    const data = await fsp.readFile(sourcePath);
    this.db.prepare(`
      INSERT INTO album_art(albumId, source, originalPath, remoteUrl, etag, lastFetchedAt, hash)
      VALUES (@albumId, @source, @originalPath, @remoteUrl, @etag, @lastFetchedAt, @hash)
      ON CONFLICT(albumId) DO UPDATE SET
        source = excluded.source,
        originalPath = excluded.originalPath,
        remoteUrl = excluded.remoteUrl,
        etag = excluded.etag,
        lastFetchedAt = excluded.lastFetchedAt,
        hash = excluded.hash
    `).run({
      albumId,
      source: sourceMeta.source,
      originalPath: sourceMeta.originalPath || null,
      remoteUrl: sourceMeta.remoteUrl || null,
      etag: sourceMeta.etag || null,
      lastFetchedAt: nowTs(),
      hash: crypto.createHash('sha1').update(data).digest('hex')
    });
  }

  async tryRemote(album) {
    const artistQ = encodeURIComponent(`artist:"${album.artistName}"`);
    const releaseQ = encodeURIComponent(`release:"${album.title}"`);
    const mbUrl = `https://musicbrainz.org/ws/2/release/?query=${artistQ}%20AND%20${releaseQ}&limit=1&fmt=json`;
    const mbRes = await fetch(mbUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!mbRes.ok) return false;
    const payload = await mbRes.json();
    const releaseId = payload?.releases?.[0]?.id;
    if (!releaseId) return false;

    const coverUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
    const coverRes = await fetch(coverUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!coverRes.ok) return false;
    const arr = await coverRes.arrayBuffer();
    const tmpPath = path.join(ARTWORK_DIR, `tmp-${album.id}.jpg`);
    await fsp.writeFile(tmpPath, Buffer.from(arr));
    await this.cacheFromPath(album.id, tmpPath, { source: 'remote', remoteUrl: coverUrl, etag: coverRes.headers.get('etag') });
    await fsp.rm(tmpPath, { force: true });
    return true;
  }

  markNone(albumId) {
    this.db.prepare(`INSERT INTO album_art(albumId, source, lastFetchedAt) VALUES (?, 'none', ?) ON CONFLICT(albumId) DO UPDATE SET source = 'none', lastFetchedAt = excluded.lastFetchedAt`).run(albumId, nowTs());
  }

  async refreshAlbum(albumId, { force = false } = {}) {
    const album = this.db.prepare(`SELECT al.id, al.title, al.path, ar.name AS artistName FROM albums al JOIN artists ar ON ar.id = al.artistId WHERE al.id = ? AND al.deleted = 0`).get(albumId);
    if (!album) return false;

    const existing = this.db.prepare('SELECT source FROM album_art WHERE albumId = ?').get(albumId);
    if (existing?.source === 'none' && !force) return false;

    const settings = this.getSettings();
    const folderPath = this.resolveAlbumFolder(album.id, album.path);
    const localPath = this.pickLocalImage(folderPath);

    if (localPath && settings.artworkPreferLocal) {
      await this.cacheFromPath(album.id, localPath, { source: 'local', originalPath: localPath });
      return true;
    }

    if (!localPath && settings.artworkAllowRemote) {
      const ok = await this.tryRemote(album);
      if (ok) return true;
    }

    if (localPath) {
      await this.cacheFromPath(album.id, localPath, { source: 'local', originalPath: localPath });
      return true;
    }

    this.markNone(album.id);
    return false;
  }

  getJobCounts() {
    const rows = this.db.prepare(`SELECT status, COUNT(*) AS count FROM jobs GROUP BY status`).all();
    return {
      queued: rows.find((r) => r.status === 'queued')?.count || 0,
      running: rows.find((r) => r.status === 'running')?.count || 0,
      done: rows.find((r) => r.status === 'done')?.count || 0,
      error: rows.find((r) => r.status === 'error')?.count || 0
    };
  }
}

module.exports = { ArtworkService, ARTWORK_DIR };
