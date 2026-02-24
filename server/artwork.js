const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { USER_AGENT } = require('./musicbrainz');

const ARTWORK_DIR = process.env.ARTWORK_DIR || '/data/artwork-cache';
const SIZES = [256, 512, 1024];
const EXACT_NAMES = ['cover.jpg', 'cover.jpeg', 'folder.jpg', 'front.jpg', 'album.jpg', 'cover.png', 'folder.png', 'front.png', 'album.png'];

function nowTs() { return Date.now(); }
function detectType(filePath) { return filePath.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg'; }
function clampSize(size) { return SIZES.includes(Number(size)) ? Number(size) : 512; }
function safeName(value = '') { return String(value || '').replace(/[<>&"']/g, '').slice(0, 80); }
function initials(value = '') { return String(value).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'CR'; }

function getSharp() { try { return require('sharp'); } catch { return null; } }
function getMusicMetadata() { try { return require('music-metadata'); } catch { return null; } }

function rankFolderImages(files) {
  for (const name of EXACT_NAMES) {
    const found = files.find((file) => file.lower === name);
    if (found) return found;
  }
  const coverish = files.filter((file) => /cover|front|folder|album|artwork/.test(file.lower)).sort((a, b) => b.size - a.size)[0];
  if (coverish) return coverish;
  return files.sort((a, b) => b.size - a.size)[0] || null;
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
    const row = this.db.prepare('SELECT artworkPreferEmbedded, artworkPreferFolder, artworkAllowRemote, artworkDefaultSize, artworkFolderFilenames FROM settings WHERE id = 1').get() || {};
    return {
      artworkPreferEmbedded: row.artworkPreferEmbedded !== 0,
      artworkPreferFolder: row.artworkPreferFolder !== 0,
      artworkAllowRemote: row.artworkAllowRemote === 1,
      artworkDefaultSize: clampSize(row.artworkDefaultSize || 512),
      artworkFolderFilenames: String(row.artworkFolderFilenames || 'cover,folder,front,album').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
    };
  }

  getAlbum(albumId) {
    return this.db.prepare(`SELECT al.id, al.title, al.path, al.artistId, al.artworkPath, al.artworkMtime, ar.name AS artistName FROM albums al JOIN artists ar ON ar.id = al.artistId WHERE al.id = ? AND al.deleted = 0`).get(albumId) || null;
  }

  resolveAlbumFolder(albumId, albumPath) {
    if (albumPath && fs.existsSync(albumPath) && fs.statSync(albumPath).isDirectory()) return albumPath;
    const track = this.db.prepare('SELECT path FROM tracks WHERE albumId = ? AND deleted = 0 ORDER BY id LIMIT 1').get(albumId);
    return track?.path ? path.dirname(track.path) : null;
  }

  getAlbumCacheDir(albumId) { return path.join(ARTWORK_DIR, 'albums', String(albumId)); }

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

  discoverFolderImage(folderPath, preferredNames = []) {
    if (!folderPath || !fs.existsSync(folderPath)) return { best: null, stat: null };
    let entries;
    try {
      entries = fs.readdirSync(folderPath, { withFileTypes: true }).filter((entry) => entry.isFile());
    } catch {
      return { best: null, stat: null, permissionDenied: true };
    }
    const files = entries.filter((entry) => /\.(jpe?g|png)$/i.test(entry.name)).map((entry) => {
      const fullPath = path.join(folderPath, entry.name);
      const stat = fs.statSync(fullPath);
      return { fullPath, name: entry.name, lower: entry.name.toLowerCase(), size: stat.size, mtime: Math.floor(stat.mtimeMs) };
    });
    if (!files.length) return { best: null, stat: null };

    for (const baseName of preferredNames) {
      const preferred = files.find((file) => file.lower === `${baseName}.jpg` || file.lower === `${baseName}.jpeg` || file.lower === `${baseName}.png`);
      if (preferred) return { best: preferred.fullPath, stat: preferred };
    }

    const ranked = rankFolderImages(files);
    return ranked ? { best: ranked.fullPath, stat: ranked } : { best: null, stat: null };
  }

  discoverManagedImage(albumFolderPath, albumId) {
    if (!albumFolderPath) return null;
    const folderName = path.basename(albumFolderPath);
    const maybe = path.join(path.dirname(albumFolderPath), '.crate', String(albumId || folderName));
    return this.discoverFolderImage(maybe, ['cover', 'folder', 'front', 'album']);
  }

  async extractEmbeddedImage(albumId) {
    const mm = getMusicMetadata();
    if (!mm) return null;
    const tracks = this.db.prepare('SELECT path FROM tracks WHERE albumId = ? AND deleted = 0 ORDER BY id LIMIT 3').all(albumId);
    for (const track of tracks) {
      try {
        const metadata = await mm.parseFile(track.path, { skipCovers: false, duration: false });
        const pictures = metadata.common?.picture || [];
        if (!pictures.length) continue;
        const front = pictures.find((pic) => String(pic.type || '').toLowerCase().includes('front')) || pictures[0];
        if (!front?.data) continue;
        return { buffer: front.data, sourcePath: track.path };
      } catch {
        continue;
      }
    }
    return null;
  }

  async generateVariants(sourceInput, cacheDir, sourceHash) {
    await fsp.mkdir(cacheDir, { recursive: true });
    const sharp = getSharp();
    const outPath = (size) => path.join(cacheDir, `${size}-${sourceHash}.jpg`);
    for (const size of SIZES) {
      const targetPath = outPath(size);
      if (fs.existsSync(targetPath)) continue;
      if (sharp) {
        await sharp(sourceInput).resize(size, size, { fit: 'cover' }).jpeg({ quality: 88 }).toFile(targetPath);
      } else if (Buffer.isBuffer(sourceInput)) {
        await fsp.writeFile(targetPath, sourceInput);
      } else {
        await fsp.copyFile(sourceInput, targetPath);
      }
      this.db.prepare('INSERT OR REPLACE INTO artwork_cache(key, path, mtime, createdAt) VALUES (?, ?, ?, ?)').run(`album:${sourceHash}:${size}`, targetPath, nowTs(), new Date().toISOString());
    }
  }

  async generatePlaceholder(entity, size, kind = 'album') {
    const cacheDir = kind === 'artist' ? path.join(ARTWORK_DIR, 'artists', String(entity.id)) : this.getAlbumCacheDir(entity.id);
    const placeholderPath = path.join(cacheDir, `${size}-placeholder.svg`);
    if (fs.existsSync(placeholderPath)) return placeholderPath;
    await fsp.mkdir(path.dirname(placeholderPath), { recursive: true });
    const label = kind === 'artist' ? safeName(entity.name) : safeName(entity.title);
    const glyph = initials(label);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#26344a"/><stop offset="100%" stop-color="#151b28"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" fill="#f7f8fc" text-anchor="middle" font-size="${Math.floor(size * 0.28)}" font-family="Arial" font-weight="700">${glyph}</text><text x="50%" y="90%" fill="#aeb6c7" text-anchor="middle" font-size="${Math.floor(size * 0.06)}" font-family="Arial">CRATE</text></svg>`;
    await fsp.writeFile(placeholderPath, Buffer.from(svg));
    return placeholderPath;
  }

  async writeAlbumArtRow(albumId, source, meta = {}) {
    this.db.prepare(`INSERT INTO album_art(albumId, source, originalPath, remoteUrl, etag, lastFetchedAt, hash, width, height)
      VALUES (@albumId, @source, @originalPath, @remoteUrl, @etag, @lastFetchedAt, @hash, @width, @height)
      ON CONFLICT(albumId) DO UPDATE SET source = excluded.source, originalPath = excluded.originalPath, remoteUrl = excluded.remoteUrl,
      etag = excluded.etag, lastFetchedAt = excluded.lastFetchedAt, hash = excluded.hash, width = excluded.width, height = excluded.height`).run({
      albumId,
      source,
      originalPath: meta.originalPath || null,
      remoteUrl: meta.remoteUrl || null,
      etag: meta.etag || null,
      lastFetchedAt: nowTs(),
      hash: meta.hash || null,
      width: meta.width || null,
      height: meta.height || null
    });
    this.db.prepare('UPDATE albums SET artworkSource = ?, artworkPath = ?, artworkMtime = ?, artworkHash = ? WHERE id = ?').run(source, meta.originalPath || null, meta.mtime || null, meta.hash || null, albumId);
  }

  async tryRemote(album, cacheDir, size) {
    const artistQ = encodeURIComponent(`artist:"${album.artistName}"`);
    const releaseQ = encodeURIComponent(`release:"${album.title}"`);
    const mbRes = await fetch(`https://musicbrainz.org/ws/2/release/?query=${artistQ}%20AND%20${releaseQ}&limit=1&fmt=json`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!mbRes.ok) return null;
    const releaseId = (await mbRes.json())?.releases?.[0]?.id;
    if (!releaseId) return null;
    const coverUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
    const coverRes = await fetch(coverUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!coverRes.ok) return null;
    const buffer = Buffer.from(await coverRes.arrayBuffer());
    const sourceHash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
    await this.generateVariants(buffer, cacheDir, sourceHash);
    await this.writeAlbumArtRow(album.id, 'remote', { remoteUrl: coverUrl, hash: sourceHash });
    return { path: path.join(cacheDir, `${size}-${sourceHash}.jpg`), source: 'remote' };
  }

  async resolveAlbumArtwork(albumId, { size = 512, forceRescan = false } = {}) {
    const album = this.getAlbum(albumId);
    if (!album) return null;
    const settings = this.getSettings();
    const artworkSize = clampSize(size || settings.artworkDefaultSize);
    const cacheDir = this.getAlbumCacheDir(album.id);
    if (forceRescan) await fsp.rm(cacheDir, { recursive: true, force: true });

    const existing = this.db.prepare('SELECT hash FROM album_art WHERE albumId = ?').get(album.id);
    if (existing?.hash) {
      const cachedPath = path.join(cacheDir, `${artworkSize}-${existing.hash}.jpg`);
      if (fs.existsSync(cachedPath)) return { resolved: true, source: 'cache', filePath: cachedPath, contentType: detectType(cachedPath), album };
    }

    const folderPath = this.resolveAlbumFolder(album.id, album.path);
    let folder = this.discoverFolderImage(folderPath, settings.artworkFolderFilenames);
    if (!folder.best) {
      const managed = this.discoverManagedImage(folderPath, album.id);
      if (managed?.best) folder = managed;
    }

    if (folder.best && (!album.artworkPath || album.artworkPath !== folder.best || Number(album.artworkMtime || 0) !== Number(folder.stat?.mtime || 0))) {
      const sourceData = await fsp.readFile(folder.best);
      const sourceHash = crypto.createHash('sha1').update(sourceData).digest('hex').slice(0, 12);
      await this.generateVariants(folder.best, cacheDir, sourceHash);
      await this.writeAlbumArtRow(album.id, 'local', { originalPath: folder.best, hash: sourceHash, mtime: folder.stat?.mtime || null });
      return { resolved: true, source: 'local', filePath: path.join(cacheDir, `${artworkSize}-${sourceHash}.jpg`), contentType: 'image/jpeg', album };
    }

    if (settings.artworkPreferEmbedded) {
      const embedded = await this.extractEmbeddedImage(album.id);
      if (embedded?.buffer) {
        const sourceHash = crypto.createHash('sha1').update(embedded.buffer).digest('hex').slice(0, 12);
        await this.generateVariants(embedded.buffer, cacheDir, sourceHash);
        await this.writeAlbumArtRow(album.id, 'local', { originalPath: embedded.sourcePath, hash: sourceHash });
        return { resolved: true, source: 'embedded', filePath: path.join(cacheDir, `${artworkSize}-${sourceHash}.jpg`), contentType: 'image/jpeg', album };
      }
    }

    if (settings.artworkAllowRemote) {
      const remote = await this.tryRemote(album, cacheDir, artworkSize).catch(() => null);
      if (remote?.path && fs.existsSync(remote.path)) return { resolved: true, source: 'remote', filePath: remote.path, contentType: 'image/jpeg', album };
    }

    const placeholder = await this.generatePlaceholder(album, artworkSize, 'album');
    await this.writeAlbumArtRow(album.id, 'placeholder', { hash: 'placeholder' });
    return { resolved: true, source: 'placeholder', placeholder: true, filePath: placeholder, contentType: 'image/svg+xml', album };
  }

  async diagnoseAlbum(albumId, { size = 512, forceRescan = false } = {}) {
    const result = await this.resolveAlbumArtwork(albumId, { size, forceRescan });
    if (!result) return null;
    return { albumId, albumTitle: result.album.title, resolved: true, bestSource: result.source, filePath: result.filePath, contentType: result.contentType, placeholder: Boolean(result.placeholder) };
  }

  async diagnoseArtist(artistId, { size = 512 } = {}) {
    const artist = this.db.prepare('SELECT id, name FROM artists WHERE id = ? AND deleted = 0').get(artistId);
    if (!artist) return null;

    if (artist.artworkPath && fs.existsSync(artist.artworkPath)) {
      return { artistId, artistName: artist.name, resolved: true, bestSource: 'artist', filePath: artist.artworkPath, contentType: detectType(artist.artworkPath) };
    }

    const album = this.db.prepare(`
      SELECT id FROM albums
      WHERE artistId = ? AND deleted = 0
      ORDER BY CASE WHEN artworkSource = 'local' THEN 1 WHEN artworkSource = 'remote' THEN 2 ELSE 3 END, lastFileMtime DESC, id DESC
      LIMIT 1
    `).get(artistId);

    if (album) {
      const resolved = await this.resolveAlbumArtwork(album.id, { size });
      if (resolved?.filePath) return { artistId, artistName: artist.name, resolved: true, bestSource: 'album', filePath: resolved.filePath, contentType: resolved.contentType, redirectAlbumId: album.id };
    }

    const placeholder = await this.generatePlaceholder({ id: `artist-${artistId}`, name: artist.name }, clampSize(size), 'artist');
    return { artistId, artistName: artist.name, resolved: true, bestSource: 'placeholder', filePath: placeholder, contentType: 'image/svg+xml' };
  }

  async refreshAlbum(albumId, { force = false } = {}) {
    const result = await this.resolveAlbumArtwork(albumId, { forceRescan: force, size: 512 });
    return Boolean(result?.resolved);
  }

  async rescanArtist(artistId) {
    const albums = this.db.prepare('SELECT id FROM albums WHERE artistId = ? AND deleted = 0').all(artistId);
    for (const album of albums) await this.refreshAlbum(album.id, { force: true });
    return albums.length;
  }

  async rebuildArtwork({ scope = 'all', id = null } = {}) {
    if (scope === 'album') return { updated: (await this.refreshAlbum(Number(id), { force: true })) ? 1 : 0 };
    if (scope === 'artist') return { updated: await this.rescanArtist(Number(id)) };
    const albums = this.db.prepare('SELECT id FROM albums WHERE deleted = 0').all();
    for (const album of albums) await this.refreshAlbum(album.id, { force: true });
    return { updated: albums.length };
  }

  async clearCache() {
    await fsp.rm(ARTWORK_DIR, { recursive: true, force: true });
    await fsp.mkdir(ARTWORK_DIR, { recursive: true });
  }

  getJobCounts() {
    const rows = this.db.prepare(`SELECT status, COUNT(*) AS count FROM jobs GROUP BY status`).all();
    return { queued: rows.find((r) => r.status === 'queued')?.count || 0, running: rows.find((r) => r.status === 'running')?.count || 0, done: rows.find((r) => r.status === 'done')?.count || 0, error: rows.find((r) => r.status === 'error')?.count || 0 };
  }
}

module.exports = { ArtworkService, ARTWORK_DIR, SIZES, EXACT_NAMES, rankFolderImages };
