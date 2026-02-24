const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { USER_AGENT } = require('./musicbrainz');

const ARTWORK_DIR = process.env.ARTWORK_DIR || '/data/artwork';
const SIZES = [256, 512, 1024];
const EXACT_NAMES = ['cover.jpg', 'folder.jpg', 'front.jpg', 'album.jpg', 'cover.png', 'folder.png', 'front.png'];

function nowTs() { return Date.now(); }
function normalizeBool(value, defaultValue) { return value === null || value === undefined ? defaultValue : Boolean(value); }


function getSharp() {
  try { return require('sharp'); } catch { return null; }
}

function detectType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png' : 'image/jpeg';
}


function rankFolderImages(files) {
  for (const name of EXACT_NAMES) {
    const found = files.find((file) => file.lower === name);
    if (found) return found;
  }
  const named = files.filter((file) => /cover|front/.test(file.lower)).sort((a, b) => b.size - a.size)[0];
  if (named) return named;
  return null;
}

class ArtworkService {
  constructor(db, logger = console) {
    this.db = db;
    this.log = logger;
    fs.mkdirSync(ARTWORK_DIR, { recursive: true });
    this.timer = setInterval(() => this.processNextJob().catch((error) => this.log.error?.(error, 'artwork job failed')), 1500);
    this.timer.unref?.();
  }

  queue(type, payload) {
    this.db.prepare(`INSERT INTO jobs (type, payloadJson, status, createdAt) VALUES (?, ?, 'queued', ?)`).run(type, JSON.stringify(payload), nowTs());
  }

  getSettings() {
    const row = this.db.prepare('SELECT artworkPreferLocal, artworkAllowRemote FROM settings WHERE id = 1').get() || {};
    return { artworkPreferLocal: normalizeBool(row.artworkPreferLocal, true), artworkAllowRemote: normalizeBool(row.artworkAllowRemote, false) };
  }

  getAlbum(albumId) {
    return this.db.prepare(`
      SELECT al.id, al.title, al.path, al.artistId, al.lastFileMtime, ar.name AS artistName
      FROM albums al JOIN artists ar ON ar.id = al.artistId
      WHERE al.id = ? AND al.deleted = 0
    `).get(albumId) || null;
  }

  resolveAlbumFolder(albumId, albumPath) {
    if (albumPath && fs.existsSync(albumPath) && fs.statSync(albumPath).isDirectory()) return albumPath;
    const tracks = this.db.prepare('SELECT path FROM tracks WHERE albumId = ? AND deleted = 0').all(albumId);
    const counts = new Map();
    for (const track of tracks) {
      const dir = path.dirname(track.path);
      counts.set(dir, (counts.get(dir) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  resolveCrateRoot(albumPath, folderPath) {
    const marker = `${path.sep}.crate${path.sep}`;
    if (albumPath && albumPath.includes(marker)) return albumPath.slice(0, albumPath.indexOf(marker) + '.crate'.length + 1);
    if (folderPath) return path.join(path.dirname(folderPath), '.crate');
    return path.join(ARTWORK_DIR, 'global');
  }

  getAlbumCacheDir(album) {
    const folder = this.resolveAlbumFolder(album.id, album.path);
    const crateRoot = this.resolveCrateRoot(album.path, folder);
    return path.join(crateRoot, 'artwork', 'albums', String(album.id));
  }

  getArtistCacheDirs(artistId) {
    const albums = this.db.prepare('SELECT id, path FROM albums WHERE artistId = ? AND deleted = 0 ORDER BY id').all(artistId);
    const dirs = new Set();
    for (const album of albums) {
      const folder = this.resolveAlbumFolder(album.id, album.path);
      const crateRoot = this.resolveCrateRoot(album.path, folder);
      dirs.add(path.join(crateRoot, 'artwork', 'artists', String(artistId)));
    }
    dirs.add(path.join(ARTWORK_DIR, 'artists', String(artistId)));
    return [...dirs];
  }

  async processNextJob() {
    const job = this.db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1`).get();
    if (!job) return;
    this.db.prepare(`UPDATE jobs SET status = 'running', startedAt = ?, error = NULL WHERE id = ?`).run(nowTs(), job.id);
    try {
      const payload = JSON.parse(job.payloadJson || '{}');
      if (job.type === 'art_fetch_album') await this.refreshAlbum(payload.albumId, { force: Boolean(payload.force) });
      this.db.prepare(`UPDATE jobs SET status = 'done', finishedAt = ? WHERE id = ?`).run(nowTs(), job.id);
    } catch (error) {
      this.db.prepare(`UPDATE jobs SET status = 'error', finishedAt = ?, error = ? WHERE id = ?`).run(nowTs(), String(error.message || error), job.id);
    }
  }

  discoverFolderImage(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) return { best: null, tried: [{ source: 'folder', ok: false, message: 'Album folder missing', path: folderPath || null }] };
    const entries = fs.readdirSync(folderPath, { withFileTypes: true }).filter((entry) => entry.isFile());
    const files = entries.filter((entry) => /\.(jpe?g|png)$/i.test(entry.name)).map((entry) => {
      const fullPath = path.join(folderPath, entry.name);
      const stat = fs.statSync(fullPath);
      return { fullPath, name: entry.name, lower: entry.name.toLowerCase(), size: stat.size };
    });
    if (!files.length) return { best: null, tried: [{ source: 'folder', ok: false, message: 'No image files in album folder', path: folderPath }] };

    const ranked = rankFolderImages(files);
    if (ranked) return { best: ranked.fullPath, tried: [{ source: 'folder', ok: true, message: `Found ranked filename ${ranked.name}`, path: ranked.fullPath }] };

    return { best: null, tried: [{ source: 'folder', ok: false, message: 'Only unrelated image files found', path: folderPath }] };
  }

  async generateVariants(sourcePath, cacheDir) {
    await fsp.mkdir(cacheDir, { recursive: true });
    const sharp = getSharp();
    let metadata = { width: null, height: null };
    for (const size of SIZES) {
      const targetPath = path.join(cacheDir, `${size}.jpg`);
      if (fs.existsSync(targetPath)) continue;
      if (sharp) {
        const pipeline = sharp(sourcePath);
        if (!metadata.width) metadata = await pipeline.metadata();
        await sharp(sourcePath).resize(size, size, { fit: 'cover' }).jpeg({ quality: 88 }).toFile(targetPath);
      } else {
        await fsp.copyFile(sourcePath, targetPath);
      }
    }
    if (sharp && !metadata.width) metadata = await sharp(sourcePath).metadata();
    const original = path.join(cacheDir, 'original.jpg');
    if (!fs.existsSync(original)) await fsp.copyFile(sourcePath, original);
    return { width: metadata.width || null, height: metadata.height || null };
  }

  async writeAlbumArtRow(albumId, source, meta = {}) {
    const data = meta.hashBuffer ? meta.hashBuffer : (meta.sourcePath ? await fsp.readFile(meta.sourcePath) : Buffer.from(String(nowTs())));
    this.db.prepare(`
      INSERT INTO album_art(albumId, source, originalPath, remoteUrl, etag, lastFetchedAt, hash, width, height)
      VALUES (@albumId, @source, @originalPath, @remoteUrl, @etag, @lastFetchedAt, @hash, @width, @height)
      ON CONFLICT(albumId) DO UPDATE SET
      source = excluded.source, originalPath = excluded.originalPath, remoteUrl = excluded.remoteUrl,
      etag = excluded.etag, lastFetchedAt = excluded.lastFetchedAt, hash = excluded.hash, width = excluded.width, height = excluded.height
    `).run({
      albumId,
      source,
      originalPath: meta.originalPath || null,
      remoteUrl: meta.remoteUrl || null,
      etag: meta.etag || null,
      lastFetchedAt: nowTs(),
      hash: crypto.createHash('sha1').update(data).digest('hex'),
      width: meta.width || null,
      height: meta.height || null
    });
  }

  async tryRemote(album, cacheDir) {
    const artistQ = encodeURIComponent(`artist:"${album.artistName}"`);
    const releaseQ = encodeURIComponent(`release:"${album.title}"`);
    const mbRes = await fetch(`https://musicbrainz.org/ws/2/release/?query=${artistQ}%20AND%20${releaseQ}&limit=1&fmt=json`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!mbRes.ok) return { ok: false, message: `MusicBrainz lookup failed (${mbRes.status})` };
    const payload = await mbRes.json();
    const releaseId = payload?.releases?.[0]?.id;
    if (!releaseId) return { ok: false, message: 'No MusicBrainz release id found' };
    const coverUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
    const coverRes = await fetch(coverUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!coverRes.ok) return { ok: false, message: `CoverArtArchive failed (${coverRes.status})` };
    const tmpPath = path.join(ARTWORK_DIR, `tmp-${album.id}.jpg`);
    await fsp.writeFile(tmpPath, Buffer.from(await coverRes.arrayBuffer()));
    const dimensions = await this.generateVariants(tmpPath, cacheDir);
    await this.writeAlbumArtRow(album.id, 'remote', { sourcePath: tmpPath, remoteUrl: coverUrl, etag: coverRes.headers.get('etag'), ...dimensions });
    await fsp.rm(tmpPath, { force: true });
    return { ok: true, message: 'Fetched remote artwork', path: coverUrl };
  }

  async diagnoseAlbum(albumId, { size = 512, forceRescan = false } = {}) {
    const album = this.getAlbum(albumId);
    if (!album) return null;
    const tried = [];
    const folderPath = this.resolveAlbumFolder(album.id, album.path);
    const cacheDir = this.getAlbumCacheDir(album);
    if (forceRescan) await fsp.rm(cacheDir, { recursive: true, force: true });
    const cachePath = path.join(cacheDir, `${size}.jpg`);
    if (fs.existsSync(cachePath)) {
      tried.push({ source: 'cache', ok: true, message: 'Found cached size variant', path: cachePath });
      return { albumId, albumTitle: album.title, albumPath: folderPath || album.path, resolved: true, bestSource: 'cache', tried, suggestedFixes: [], filePath: cachePath, contentType: detectType(cachePath) };
    }
    tried.push({ source: 'cache', ok: false, message: 'Cache miss', path: cachePath });

    const folder = this.discoverFolderImage(folderPath);
    tried.push(...folder.tried);
    if (folder.best) {
      const dimensions = await this.generateVariants(folder.best, cacheDir);
      await this.writeAlbumArtRow(album.id, 'folder', { sourcePath: folder.best, originalPath: folder.best, ...dimensions });
      return { albumId, albumTitle: album.title, albumPath: folderPath || album.path, resolved: true, bestSource: 'folder', tried, suggestedFixes: [], filePath: path.join(cacheDir, `${size}.jpg`), contentType: 'image/jpeg' };
    }

    tried.push({ source: 'embedded', ok: false, message: 'Embedded extraction not implemented yet (TODO hook)' });

    const settings = this.getSettings();
    if (settings.artworkAllowRemote) {
      const remote = await this.tryRemote(album, cacheDir).catch((error) => ({ ok: false, message: error.message }));
      tried.push({ source: 'remote', ok: remote.ok, message: remote.message, path: remote.path || null });
      if (remote.ok) return { albumId, albumTitle: album.title, albumPath: folderPath || album.path, resolved: true, bestSource: 'remote', tried, suggestedFixes: [], filePath: path.join(cacheDir, `${size}.jpg`), contentType: 'image/jpeg' };
    } else {
      tried.push({ source: 'remote', ok: false, message: 'Remote artwork disabled in settings' });
    }

    await this.writeAlbumArtRow(album.id, 'none', { hashBuffer: Buffer.from('none') });
    return {
      albumId,
      albumTitle: album.title,
      albumPath: folderPath || album.path,
      resolved: false,
      bestSource: null,
      tried,
      suggestedFixes: ['Add cover.jpg or folder.jpg to the album folder.', 'Enable remote artwork in Settings → Artwork.', 'Use "Rescan Artwork" for this album after adding assets.']
    };
  }

  async refreshAlbum(albumId, { force = false } = {}) {
    const result = await this.diagnoseAlbum(albumId, { forceRescan: force, size: 512 });
    return Boolean(result?.resolved);
  }

  async diagnoseArtist(artistId, { size = 512, forceRescan = false } = {}) {
    const artist = this.db.prepare('SELECT id, name FROM artists WHERE id = ?').get(artistId);
    if (!artist) return null;
    const tried = [];
    for (const dir of this.getArtistCacheDirs(artistId)) {
      const candidate = path.join(dir, `${size}.jpg`);
      if (forceRescan) await fsp.rm(dir, { recursive: true, force: true });
      if (fs.existsSync(candidate)) {
        tried.push({ source: 'artist-cache', ok: true, message: 'Found cached artist artwork', path: candidate });
        return { artistId, artistName: artist.name, resolved: true, bestSource: 'cache', tried, suggestedFixes: [], filePath: candidate, contentType: 'image/jpeg' };
      }
    }
    tried.push({ source: 'artist-cache', ok: false, message: 'No cached artist artwork variants found' });

    const album = this.db.prepare(`
      SELECT al.id, al.lastFileMtime, aa.source
      FROM albums al
      LEFT JOIN album_art aa ON aa.albumId = al.id
      WHERE al.artistId = ? AND al.deleted = 0 AND aa.source IS NOT NULL AND aa.source != 'none'
      ORDER BY CASE aa.source WHEN 'folder' THEN 1 WHEN 'cache' THEN 1 WHEN 'embedded' THEN 2 WHEN 'remote' THEN 3 ELSE 9 END,
               al.lastFileMtime DESC, al.id DESC
      LIMIT 1
    `).get(artistId);
    if (album) {
      tried.push({ source: 'representative-album', ok: true, message: `Selected album ${album.id} deterministically` });
      return { artistId, artistName: artist.name, resolved: true, bestSource: 'album', tried, suggestedFixes: [], redirectAlbumId: album.id };
    }
    tried.push({ source: 'representative-album', ok: false, message: 'No artist albums currently have artwork metadata' });

    return { artistId, artistName: artist.name, resolved: false, bestSource: null, tried, suggestedFixes: ['Add album artwork files and rescan albums for this artist.', 'Rescan artwork for this artist from the app.'] };
  }

  async rescanArtist(artistId) {
    const albums = this.db.prepare('SELECT id FROM albums WHERE artistId = ? AND deleted = 0').all(artistId);
    for (const album of albums) await this.refreshAlbum(album.id, { force: true });
    return albums.length;
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

module.exports = { ArtworkService, ARTWORK_DIR, SIZES, EXACT_NAMES, rankFolderImages };
