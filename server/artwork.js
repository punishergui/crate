const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { USER_AGENT } = require('./musicbrainz');

const ARTWORK_DIR = process.env.ARTWORK_DIR || '/data/artwork-cache';
const SIZES = [256, 512, 1024];
const EXACT_NAMES = ['cover.jpg', 'cover.jpeg', 'folder.jpg', 'front.jpg', 'album.jpg', 'artwork.jpg', 'cover.png', 'folder.png', 'front.png', 'album.png'];

function nowTs() { return Date.now(); }
function normalizeBool(value, defaultValue) { return value === null || value === undefined ? defaultValue : Boolean(value); }
function detectType(filePath) { return filePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg'; }
function clampSize(size) { return SIZES.includes(Number(size)) ? Number(size) : 512; }
function safeName(value = '') { return String(value || '').replace(/[<>&"']/g, '').slice(0, 80); }

function getSharp() {
  try { return require('sharp'); } catch { return null; }
}
function getMusicMetadata() {
  try { return require('music-metadata'); } catch { return null; }
}

function rankFolderImages(files) {
  for (const name of EXACT_NAMES) {
    const found = files.find((file) => file.lower === name);
    if (found) return found;
  }
  const coverish = files.filter((file) => /cover|front|folder|album|artwork/.test(file.lower)).sort((a, b) => b.size - a.size)[0];
  if (coverish) return coverish;
  const pngAny = files.filter((file) => file.lower.endsWith('.png')).sort((a, b) => b.size - a.size)[0];
  if (pngAny) return pngAny;
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
    const row = this.db.prepare('SELECT artworkPreferEmbedded, artworkPreferFolder, artworkAllowRemote, artworkCacheEnabled, artworkDefaultSize, artworkFolderFilenames FROM settings WHERE id = 1').get() || {};
    return {
      artworkPreferEmbedded: normalizeBool(row.artworkPreferEmbedded, true),
      artworkPreferFolder: normalizeBool(row.artworkPreferFolder, true),
      artworkAllowRemote: normalizeBool(row.artworkAllowRemote, false),
      artworkCacheEnabled: normalizeBool(row.artworkCacheEnabled, true),
      artworkDefaultSize: clampSize(row.artworkDefaultSize || 512),
      artworkFolderFilenames: String(row.artworkFolderFilenames || 'cover,folder,front,album').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
    };
  }

  getAlbum(albumId) {
    return this.db.prepare(`SELECT al.id, al.title, al.path, al.artistId, ar.name AS artistName FROM albums al JOIN artists ar ON ar.id = al.artistId WHERE al.id = ? AND al.deleted = 0`).get(albumId) || null;
  }

  resolveAlbumFolder(albumId, albumPath) {
    if (albumPath && fs.existsSync(albumPath) && fs.statSync(albumPath).isDirectory()) return albumPath;
    const track = this.db.prepare('SELECT path FROM tracks WHERE albumId = ? AND deleted = 0 ORDER BY id LIMIT 1').get(albumId);
    return track?.path ? path.dirname(track.path) : null;
  }

  getAlbumCacheDir(albumId) {
    return path.join(ARTWORK_DIR, 'albums', String(albumId));
  }

  getArtistCacheDir(artistId) {
    return path.join(ARTWORK_DIR, 'artists', String(artistId));
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

  discoverFolderImage(folderPath, preferredNames = []) {
    if (!folderPath || !fs.existsSync(folderPath)) return { best: null, tried: [{ source: 'folder', ok: false, message: 'Album folder missing', path: folderPath || null }] };
    const entries = fs.readdirSync(folderPath, { withFileTypes: true }).filter((entry) => entry.isFile());
    const files = entries.filter((entry) => /\.(jpe?g|png)$/i.test(entry.name)).map((entry) => {
      const fullPath = path.join(folderPath, entry.name);
      const stat = fs.statSync(fullPath);
      return { fullPath, name: entry.name, lower: entry.name.toLowerCase(), size: stat.size };
    });
    if (!files.length) return { best: null, tried: [{ source: 'folder', ok: false, message: 'No image files in album folder', path: folderPath }] };

    for (const baseName of preferredNames) {
      const preferred = files.find((file) => file.lower === `${baseName}.jpg` || file.lower === `${baseName}.jpeg` || file.lower === `${baseName}.png`);
      if (preferred) return { best: preferred.fullPath, tried: [{ source: 'folder', ok: true, message: `Found preferred filename ${preferred.name}`, path: preferred.fullPath }] };
    }

    const ranked = rankFolderImages(files);
    return ranked
      ? { best: ranked.fullPath, tried: [{ source: 'folder', ok: true, message: `Found ranked filename ${ranked.name}`, path: ranked.fullPath }] }
      : { best: null, tried: [{ source: 'folder', ok: false, message: 'Only unrelated image files found', path: folderPath }] };
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
        return { buffer: front.data, ext: front.format === 'image/png' ? '.png' : '.jpg', sourcePath: track.path };
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
    }
  }

  async generatePlaceholder(album, size) {
    const placeholderPath = path.join(this.getAlbumCacheDir(album.id), `${size}-placeholder.jpg`);
    if (fs.existsSync(placeholderPath)) return placeholderPath;
    await fsp.mkdir(path.dirname(placeholderPath), { recursive: true });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#252a35"/><stop offset="100%" stop-color="#11141b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="46%" fill="#f6f7fb" text-anchor="middle" font-size="24" font-family="Arial" font-weight="700">NO ART</text><text x="50%" y="58%" fill="#c3c8d4" text-anchor="middle" font-size="14" font-family="Arial">${safeName(album.title)}</text><text x="50%" y="66%" fill="#8f97a8" text-anchor="middle" font-size="12" font-family="Arial">${safeName(album.artistName)}</text></svg>`;
    const sharp = getSharp();
    if (sharp) {
      await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toFile(placeholderPath);
    } else {
      await fsp.writeFile(placeholderPath, Buffer.from(svg));
    }
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
    await this.writeAlbumArtRow(album.id, 'remote', { remoteUrl: coverUrl, etag: coverRes.headers.get('etag'), hash: sourceHash });
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
    const sources = settings.artworkPreferEmbedded ? ['embedded', 'folder'] : ['folder', 'embedded'];
    if (!settings.artworkPreferFolder) sources.splice(sources.indexOf('folder'), 1);

    for (const source of sources) {
      if (source === 'folder') {
        const folder = this.discoverFolderImage(folderPath, settings.artworkFolderFilenames);
        if (folder.best) {
          const sourceData = await fsp.readFile(folder.best);
          const sourceHash = crypto.createHash('sha1').update(sourceData).digest('hex').slice(0, 12);
          await this.generateVariants(folder.best, cacheDir, sourceHash);
          await this.writeAlbumArtRow(album.id, 'folder', { originalPath: folder.best, hash: sourceHash });
          return { resolved: true, source: 'folder', filePath: path.join(cacheDir, `${artworkSize}-${sourceHash}.jpg`), contentType: 'image/jpeg', album };
        }
      }
      if (source === 'embedded') {
        const embedded = await this.extractEmbeddedImage(album.id);
        if (embedded?.buffer) {
          const sourceHash = crypto.createHash('sha1').update(embedded.buffer).digest('hex').slice(0, 12);
          await this.generateVariants(embedded.buffer, cacheDir, sourceHash);
          await this.writeAlbumArtRow(album.id, 'embedded', { originalPath: embedded.sourcePath, hash: sourceHash });
          return { resolved: true, source: 'embedded', filePath: path.join(cacheDir, `${artworkSize}-${sourceHash}.jpg`), contentType: 'image/jpeg', album };
        }
      }
    }

    if (settings.artworkAllowRemote) {
      const remote = await this.tryRemote(album, cacheDir, artworkSize).catch(() => null);
      if (remote?.path && fs.existsSync(remote.path)) return { resolved: true, source: 'remote', filePath: remote.path, contentType: 'image/jpeg', album };
    }

    const placeholder = await this.generatePlaceholder(album, artworkSize);
    await this.writeAlbumArtRow(album.id, 'placeholder', { hash: 'placeholder' });
    return { resolved: true, source: 'placeholder', placeholder: true, filePath: placeholder, contentType: 'image/jpeg', album };
  }

  async diagnoseAlbum(albumId, { size = 512, forceRescan = false } = {}) {
    const result = await this.resolveAlbumArtwork(albumId, { size, forceRescan });
    if (!result) return null;
    return { albumId, albumTitle: result.album.title, resolved: true, bestSource: result.source, filePath: result.filePath, contentType: result.contentType, placeholder: Boolean(result.placeholder) };
  }

  async diagnoseArtist(artistId, { size = 512 } = {}) {
    const artist = this.db.prepare('SELECT id, name FROM artists WHERE id = ? AND deleted = 0').get(artistId);
    if (!artist) return null;
    const album = this.db.prepare('SELECT id FROM albums WHERE artistId = ? AND deleted = 0 ORDER BY lastFileMtime DESC, id DESC LIMIT 1').get(artistId);
    if (!album) {
      const fake = { id: `artist-${artistId}`, title: artist.name, artistName: artist.name };
      const placeholder = await this.generatePlaceholder(fake, clampSize(size));
      return { artistId, artistName: artist.name, resolved: true, bestSource: 'placeholder', filePath: placeholder, contentType: 'image/jpeg' };
    }
    return { artistId, artistName: artist.name, ...(await this.resolveAlbumArtwork(album.id, { size })), redirectAlbumId: album.id };
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
