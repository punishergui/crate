const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { slugifyArtistName, shortHash } = require('./slug');

const AUDIO_EXTS = new Set(['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aiff', '.alac']);

function nowIso() {
  return new Date().toISOString();
}

function isHiddenName(name) {
  return name.startsWith('.');
}

function isAudioFileName(name) {
  return AUDIO_EXTS.has(path.extname(name).toLowerCase());
}

function normalizeCompareValue(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeAlbumKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function deriveAlbumTitleFromFolderName(folderName) {
  const original = String(folderName || '').trim();
  if (!original) return original;

  const withoutWrappedYear = original
    .replace(/\s*\((19\d{2}|20\d{2})\)\s*$/, '')
    .replace(/\s*\[(19\d{2}|20\d{2})\]\s*$/, '')
    .replace(/\s+[-–—]\s+(19\d{2}|20\d{2})\s*$/, '')
    .trim();

  if (withoutWrappedYear !== original) {
    return withoutWrappedYear;
  }

  const leadingYearMatch = original.match(/^(19\d{2}|20\d{2})\s+[-–—:]\s+(.+)$/);
  if (leadingYearMatch?.[2]) {
    return leadingYearMatch[2].trim();
  }

  return original;
}

function createVirtualAlbumPath(artistPath, albumTitle) {
  const slug = normalizeAlbumKey(albumTitle) || 'unknown-album';
  const hash = crypto.createHash('sha1').update(albumTitle).digest('hex').slice(0, 8);
  return path.join(artistPath, '.crate', `${slug}-${hash}`);
}

function parseAlbumFromFilename(filePath, artistName) {
  const basename = path.basename(filePath, path.extname(filePath));
  const parts = basename.split(/\s[-–—]\s/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const normalizedArtist = normalizeCompareValue(artistName);
  const maybeArtist = normalizeCompareValue(parts[0]);
  if (maybeArtist && normalizedArtist && maybeArtist !== normalizedArtist) return null;

  const album = parts[1];
  return album || null;
}

function readUInt24BE(buffer, offset) {
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
}

function parseFlacVorbisComments(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    if (fs.readSync(fd, header, 0, 4, 0) !== 4 || header.toString('ascii') !== 'fLaC') {
      return null;
    }

    let position = 4;
    while (true) {
      const blockHeader = Buffer.alloc(4);
      if (fs.readSync(fd, blockHeader, 0, 4, position) !== 4) return null;
      const isLast = (blockHeader[0] & 0x80) !== 0;
      const blockType = blockHeader[0] & 0x7f;
      const blockLength = readUInt24BE(blockHeader, 1);
      position += 4;

      if (blockType === 4) {
        const block = Buffer.alloc(blockLength);
        if (fs.readSync(fd, block, 0, blockLength, position) !== blockLength) return null;

        let cursor = 0;
        if (cursor + 4 > block.length) return null;
        const vendorLength = block.readUInt32LE(cursor);
        cursor += 4 + vendorLength;
        if (cursor + 4 > block.length) return null;

        const commentCount = block.readUInt32LE(cursor);
        cursor += 4;

        const comments = new Map();
        for (let i = 0; i < commentCount; i += 1) {
          if (cursor + 4 > block.length) break;
          const commentLength = block.readUInt32LE(cursor);
          cursor += 4;
          if (cursor + commentLength > block.length) break;

          const comment = block.toString('utf8', cursor, cursor + commentLength);
          cursor += commentLength;

          const sep = comment.indexOf('=');
          if (sep < 1) continue;
          const key = comment.slice(0, sep).toUpperCase();
          const value = comment.slice(sep + 1).trim();
          if (!value) continue;
          if (!comments.has(key)) comments.set(key, []);
          comments.get(key).push(value);
        }

        return comments;
      }

      position += blockLength;
      if (isLast) return null;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function decodeId3v1Text(buffer, start, length) {
  return buffer
    .toString('latin1', start, start + length)
    .replace(/\0+$/g, '')
    .trim();
}

function parseMp3Id3v1(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 128) return null;

  const fd = fs.openSync(filePath, 'r');
  try {
    const tag = Buffer.alloc(128);
    if (fs.readSync(fd, tag, 0, 128, stat.size - 128) !== 128) return null;
    if (tag.toString('ascii', 0, 3) !== 'TAG') return null;

    const title = decodeId3v1Text(tag, 3, 30);
    const artist = decodeId3v1Text(tag, 33, 30);
    const album = decodeId3v1Text(tag, 63, 30);
    const year = decodeId3v1Text(tag, 93, 4);
    if (!album) return null;

    return {
      album,
      albumArtist: artist || null,
      artist: artist || null,
      year: year || null,
      title: title || null
    };
  } finally {
    fs.closeSync(fd);
  }
}

function readTags(track) {
  if (track.ext === 'flac') {
    const comments = parseFlacVorbisComments(track.path);
    if (!comments) return null;
    return {
      album: comments.get('ALBUM')?.[0] || null,
      albumArtist: comments.get('ALBUMARTIST')?.[0] || null,
      artist: comments.get('ARTIST')?.[0] || null,
      year: comments.get('DATE')?.[0] || comments.get('YEAR')?.[0] || null
    };
  }
  if (track.ext === 'mp3') {
    return parseMp3Id3v1(track.path);
  }
  return null;
}

function resolveArtistNameFromTags(tagInfo, fallbackArtistName) {
  return tagInfo?.albumArtist || tagInfo?.artist || fallbackArtistName;
}

function buildAlbumGroupKey(albumName, albumArtistName) {
  return `${normalizeCompareValue(albumArtistName)}::${normalizeCompareValue(albumName)}`;
}

function getStatInodeKey(stat) {
  if (!stat || !Number.isInteger(stat.dev) || !Number.isInteger(stat.ino)) return null;
  if (stat.ino <= 0) return null;
  return `${stat.dev}:${stat.ino}`;
}

function normalizePathForHash(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function hashFileFirstChunk(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, 0);
    return crypto.createHash('sha1').update(chunk.subarray(0, bytesRead)).digest('hex').slice(0, 16);
  } finally {
    fs.closeSync(fd);
  }
}

function collectArtistTracks(artistPath, { recursive = true, maxDepth = 3 }, onSkip) {
  const out = [];
  const stack = [{ currentPath: artistPath, depth: 0 }];

  while (stack.length > 0) {
    const { currentPath, depth } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      onSkip?.(currentPath, `unreadable-directory: ${error.message}`);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (isHiddenName(entry.name)) {
        onSkip?.(fullPath, 'hidden-path');
        continue;
      }

      let lst;
      try {
        lst = fs.lstatSync(fullPath);
      } catch (error) {
        onSkip?.(fullPath, `unreadable-path: ${error.message}`);
        continue;
      }

      const isSymlink = lst.isSymbolicLink();
      let stat = lst;
      if (isSymlink) {
        try {
          stat = fs.statSync(fullPath);
        } catch (error) {
          onSkip?.(fullPath, `broken-symlink: ${error.message}`);
          continue;
        }
      }

      const isDir = stat.isDirectory();
      const isFile = stat.isFile();
      if (isDir) {
        if (!recursive && depth >= 0) continue;
        if (depth + 1 > maxDepth) {
          onSkip?.(fullPath, `depth-exceeded:${maxDepth}`);
          continue;
        }
        stack.push({ currentPath: fullPath, depth: depth + 1 });
        continue;
      }

      if (!isFile) {
        onSkip?.(fullPath, 'unsupported-file-type');
        continue;
      }

      if (!isAudioFileName(entry.name)) {
        onSkip?.(fullPath, `unsupported-extension:${path.extname(entry.name).toLowerCase() || 'none'}`);
        continue;
      }

      out.push({
        path: fullPath,
        ext: path.extname(entry.name).toLowerCase().slice(1),
        mtime: stat.mtimeMs,
        size: stat.size,
        inode: Number.isInteger(stat.ino) ? stat.ino : null,
        device: Number.isInteger(stat.dev) ? stat.dev : null,
        inodeKey: getStatInodeKey(stat)
      });
    }
  }

  return out;
}

class Scanner {
  constructor(db) {
    this.db = db;
    this.running = false;
    this.cancelRequested = false;
  }

  requestCancel() {
    if (!this.running) return false;
    this.cancelRequested = true;
    return true;
  }

  startScan(libraryPath, options = {}) {
    if (this.running) {
      return { started: false, status: this.getStatus() };
    }
    this.running = true;
    this.cancelRequested = false;
    const scanOptions = {
      recursive: options.recursive !== undefined ? Boolean(options.recursive) : true,
      maxDepth: Number.isInteger(options.maxDepth) && options.maxDepth > 0 ? options.maxDepth : 3,
      artistId: Number.isInteger(options.artistId) ? options.artistId : null
    };

    setImmediate(() => this.runScan(libraryPath, scanOptions).catch((error) => {
      this.db.prepare(`
        UPDATE scan_state
        SET status = 'error', finishedAt = ?, error = ?, currentPath = NULL
        WHERE id = 1
      `).run(nowIso(), String(error.message || error));
      this.running = false;
      this.cancelRequested = false;
    }));
    return { started: true, status: this.getStatus() };
  }

  generateUniqueArtistSlug(name, artistId = null) {
    const base = slugifyArtistName(name);
    const existing = this.db.prepare('SELECT id FROM artists WHERE slug = ?').all(base);
    if (existing.length === 0 || existing.some((row) => row.id === artistId)) {
      return base;
    }
    return `${base}-${shortHash(name).slice(0, 6)}`;
  }

  upsertArtist(name, seenAt) {
    const existing = this.db.prepare('SELECT id, slug FROM artists WHERE name = ?').get(name);
    if (existing) {
      const nextSlug = existing.slug || this.generateUniqueArtistSlug(name, existing.id);
      this.db.prepare('UPDATE artists SET slug = ?, lastSeen = ?, deleted = 0 WHERE id = ?').run(nextSlug, seenAt, existing.id);
      return existing.id;
    }

    const slug = this.generateUniqueArtistSlug(name);
    const res = this.db.prepare('INSERT INTO artists(name, slug, firstSeen, lastSeen, deleted) VALUES (?, ?, ?, ?, 0)').run(name, slug, seenAt, seenAt);
    return res.lastInsertRowid;
  }

  upsertAlbum({ artistId, title, albumPath, seenAt, formats, trackCount, lastFileMtime }) {
    const formatsJson = JSON.stringify(Array.from(formats).sort());
    const existing = this.db.prepare('SELECT id FROM albums WHERE path = ?').get(albumPath);
    if (existing) {
      this.db.prepare(`
        UPDATE albums
        SET artistId = ?, title = ?, lastSeen = ?, lastFileMtime = ?, formatsJson = ?, trackCount = ?, deleted = 0
        WHERE id = ?
      `).run(artistId, title, seenAt, lastFileMtime, formatsJson, trackCount, existing.id);
      return existing.id;
    }
    const res = this.db.prepare(`
      INSERT INTO albums(artistId, title, path, firstSeen, lastSeen, lastFileMtime, formatsJson, trackCount, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(artistId, title, albumPath, seenAt, seenAt, lastFileMtime, formatsJson, trackCount);
    return res.lastInsertRowid;
  }

  syncTracks(albumId, tracks, seenAt) {
    const markSeen = this.db.prepare('UPDATE tracks SET albumId = ?, lastSeen = ?, mtime = ?, ext = ?, deleted = 0 WHERE path = ?');
    const insert = this.db.prepare('INSERT INTO tracks(albumId, path, ext, mtime, lastSeen, deleted) VALUES (?, ?, ?, ?, ?, 0)');
    const find = this.db.prepare('SELECT id FROM tracks WHERE path = ?');

    for (const track of tracks) {
      const existing = find.get(track.path);
      if (existing) {
        markSeen.run(albumId, seenAt, track.mtime, track.ext, track.path);
      } else {
        insert.run(albumId, track.path, track.ext, track.mtime, seenAt);
      }
    }

    this.db.prepare('UPDATE tracks SET deleted = 1 WHERE albumId = ? AND lastSeen < ?').run(albumId, seenAt);
  }

  syncAlbum({ artistId, title, albumPath, tracks, seenAt }) {
    if (tracks.length === 0) return null;

    const formats = new Set();
    let latestMtime = 0;
    for (const track of tracks) {
      formats.add(track.ext);
      latestMtime = Math.max(latestMtime, track.mtime || 0);
    }

    const albumId = this.upsertAlbum({
      artistId,
      title,
      albumPath,
      seenAt,
      formats,
      trackCount: tracks.length,
      lastFileMtime: latestMtime || null
    });
    this.syncTracks(albumId, tracks, seenAt);
    return tracks.length;
  }

  buildTrackMetadata(track, artistName, seenAt) {
    const findCache = this.db.prepare('SELECT * FROM file_index WHERE path = ?');
    const upsertCache = this.db.prepare(`
      INSERT INTO file_index(path, mtime, size, inode, device, inodeKey, fileHash, ext, albumTag, albumArtistTag, artistTag, yearTag, lastScanAt, lastSeenAt)
      VALUES(@path, @mtime, @size, @inode, @device, @inodeKey, @fileHash, @ext, @albumTag, @albumArtistTag, @artistTag, @yearTag, @lastScanAt, @lastSeenAt)
      ON CONFLICT(path) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size,
        inode = excluded.inode,
        device = excluded.device,
        inodeKey = excluded.inodeKey,
        fileHash = excluded.fileHash,
        ext = excluded.ext,
        albumTag = excluded.albumTag,
        albumArtistTag = excluded.albumArtistTag,
        artistTag = excluded.artistTag,
        yearTag = excluded.yearTag,
        lastScanAt = excluded.lastScanAt,
        lastSeenAt = excluded.lastSeenAt
    `);

    const cached = findCache.get(track.path);
    if (cached && cached.mtime === track.mtime && cached.size === track.size) {
      upsertCache.run({ ...cached, lastScanAt: seenAt, lastSeenAt: seenAt });
      return {
        ...track,
        tagInfo: {
          album: cached.albumTag,
          albumArtist: cached.albumArtistTag,
          artist: cached.artistTag,
          year: cached.yearTag
        },
        inodeKey: cached.inodeKey,
        inode: cached.inode,
        device: cached.device,
        fileHash: cached.fileHash,
        albumTitle: cached.albumTag,
        albumArtistName: resolveArtistNameFromTags({ albumArtist: cached.albumArtistTag, artist: cached.artistTag }, artistName)
      };
    }

    let tagInfo = null;
    try {
      tagInfo = readTags(track);
    } catch {
      tagInfo = null;
    }

    const albumTitle = tagInfo?.album || parseAlbumFromFilename(track.path, artistName) || null;
    const albumArtistName = resolveArtistNameFromTags(tagInfo, artistName);
    const fileHash = !track.inodeKey ? hashFileFirstChunk(track.path) : null;

    upsertCache.run({
      path: track.path,
      mtime: track.mtime,
      size: track.size,
      inode: track.inode,
      device: track.device,
      inodeKey: track.inodeKey,
      fileHash,
      ext: track.ext,
      albumTag: tagInfo?.album || null,
      albumArtistTag: tagInfo?.albumArtist || null,
      artistTag: tagInfo?.artist || null,
      yearTag: tagInfo?.year || null,
      lastScanAt: seenAt,
      lastSeenAt: seenAt
    });

    return { ...track, tagInfo, albumTitle, albumArtistName, fileHash };
  }

  normalizeSkipReason(reason) {
    const value = String(reason || 'unknown').toLowerCase();
    if (value.startsWith('unsupported-extension')) return 'unsupported extension';
    if (value.startsWith('unreadable') || value.startsWith('unreadable-directory') || value.startsWith('unreadable-path')) return 'unreadable';
    if (value.startsWith('missing-album-tag')) return 'missing album tag';
    if (value.startsWith('missing-artist-tag')) return 'missing artist tag';
    if (value.startsWith('deduped')) return 'duplicate';
    if (value.startsWith('parse-error')) return 'parse error';
    return reason || 'other';
  }

  pushSkip(skipped, filePath, reason) {
    skipped.push({ filePath, reason: this.normalizeSkipReason(reason) });
  }

  updateScanProgress({ scannedFiles, scannedAlbums, scannedArtists, skippedFiles, skippedReasons, currentPath }) {
    this.db.prepare(`
      UPDATE scan_state
      SET scannedFiles = ?, scannedAlbums = ?, scannedArtists = ?, skippedFiles = ?, skippedReasonsJson = ?, currentPath = ?
      WHERE id = 1
    `).run(scannedFiles, scannedAlbums, scannedArtists, skippedFiles, JSON.stringify(skippedReasons), currentPath || null);
  }

  recordSkipped(scanStartedAt, skipped) {
    if (!skipped.length) return;
    const insert = this.db.prepare('INSERT INTO scan_skipped(scanStartedAt, filePath, reason, createdAt) VALUES (?, ?, ?, ?)');
    const createdAt = nowIso();
    const runInsert = this.db.transaction((items) => {
      for (const item of items) insert.run(scanStartedAt, item.filePath, item.reason, createdAt);
    });
    runInsert(skipped);
  }

  computeDedupeKey(metadata) {
    if (metadata.inodeKey) return `inode:${metadata.inodeKey}`;
    return `fallback:${metadata.size}:${Math.round(metadata.mtime || 0)}:${shortHash(normalizePathForHash(metadata.path))}`;
  }

  getStatus() {
    const row = this.db.prepare('SELECT * FROM scan_state WHERE id = 1').get();
    const parsed = row?.skippedReasonsJson ? JSON.parse(row.skippedReasonsJson) : {};
    return {
      ...row,
      skippedReasonsBreakdown: parsed
    };
  }

  async runScan(libraryPath, scanOptions = {}) {
    const seenAt = nowIso();
    const scanArtistId = Number.isInteger(scanOptions.artistId) ? scanOptions.artistId : null;
    this.db.prepare('DELETE FROM scan_skipped WHERE scanStartedAt < ?').run(seenAt);
    this.db.prepare(`
      UPDATE scan_state
      SET status = 'running', startedAt = ?, finishedAt = NULL, currentPath = NULL,
          scannedFiles = 0, scannedAlbums = 0, scannedArtists = 0, skippedFiles = 0, skippedReasonsJson = '{}', error = NULL
      WHERE id = 1
    `).run(seenAt);

    let scannedFiles = 0;
    let scannedAlbums = 0;
    let skippedFiles = 0;
    const skippedReasons = {};
    const artistsSeen = new Set();

    try {
      if (!fs.existsSync(libraryPath)) throw new Error(`Library path does not exist: ${libraryPath}`);

      let artistDirs = [];
      if (scanArtistId) {
        const artist = this.db.prepare('SELECT id, name FROM artists WHERE id = ?').get(scanArtistId);
        if (!artist) throw new Error(`Artist not found: ${scanArtistId}`);
        artistDirs = [{ name: artist.name }];
      } else {
        let rootEntries = [];
        try {
          rootEntries = fs.readdirSync(libraryPath, { withFileTypes: true });
        } catch {
          rootEntries = [];
        }
        artistDirs = rootEntries.filter((entry) => entry.isDirectory() && !isHiddenName(entry.name)).sort((a,b)=>a.name.localeCompare(b.name));
      }

      const seenDedupKeys = new Set();
      for (const artistEntry of artistDirs) {
        if (this.cancelRequested) break;
        const artistName = artistEntry.name;
        const artistPath = path.join(libraryPath, artistName);
        this.updateScanProgress({ scannedFiles, scannedAlbums, scannedArtists: artistsSeen.size, skippedFiles, skippedReasons, currentPath: artistPath });

        const artistId = this.upsertArtist(artistName, seenAt);
        artistsSeen.add(artistId);

        const skipped = [];
        const artistTracks = collectArtistTracks(artistPath, { recursive: scanOptions.recursive !== false, maxDepth: scanOptions.maxDepth || 3 }, (filePath, reason) => {
          this.pushSkip(skipped, filePath, reason);
        });

        const tracksByAlbum = new Map();
        for (const track of artistTracks) {
          if (this.cancelRequested) break;

          let metadata;
          try {
            metadata = await this.buildTrackMetadata(track, artistName, seenAt);
          } catch (error) {
            this.pushSkip(skipped, track.path, `parse-error:${error.message || error}`);
            continue;
          }

          if (!metadata.tagInfo?.album) {
            this.pushSkip(skipped, track.path, 'missing-album-tag');
            continue;
          }

          if (!metadata.tagInfo?.albumArtist && !metadata.tagInfo?.artist) {
            this.pushSkip(skipped, track.path, 'missing-artist-tag');
            continue;
          }

          const normalizedTaggedArtist = normalizeCompareValue(metadata.albumArtistName);
          const normalizedArtist = normalizeCompareValue(artistName);
          if (normalizedArtist && normalizedTaggedArtist && normalizedArtist !== normalizedTaggedArtist) {
            this.pushSkip(skipped, track.path, `missing-artist-tag:mismatch:${metadata.albumArtistName}`);
            continue;
          }

          const dedupeKey = this.computeDedupeKey(metadata);
          if (seenDedupKeys.has(dedupeKey)) {
            this.pushSkip(skipped, track.path, `deduped:${dedupeKey}`);
            continue;
          }
          seenDedupKeys.add(dedupeKey);

          const albumGroupKey = buildAlbumGroupKey(metadata.albumTitle, metadata.albumArtistName);
          if (!tracksByAlbum.has(albumGroupKey)) {
            tracksByAlbum.set(albumGroupKey, {
              title: metadata.albumTitle,
              albumPath: createVirtualAlbumPath(artistPath, `${metadata.albumArtistName}-${metadata.albumTitle}`),
              tracks: []
            });
          }
          tracksByAlbum.get(albumGroupKey).tracks.push(track);
        }

        if (this.cancelRequested) break;

        for (const albumCandidate of tracksByAlbum.values()) {
          this.updateScanProgress({ scannedFiles, scannedAlbums, scannedArtists: artistsSeen.size, skippedFiles, skippedReasons, currentPath: albumCandidate.albumPath });
          const trackCount = this.syncAlbum({ artistId, title: albumCandidate.title, albumPath: albumCandidate.albumPath, tracks: albumCandidate.tracks, seenAt });
          if (!trackCount) continue;
          scannedAlbums += 1;
          scannedFiles += trackCount;
        }

        for (const item of skipped) {
          skippedFiles += 1;
          skippedReasons[item.reason] = (skippedReasons[item.reason] || 0) + 1;
        }
        this.recordSkipped(seenAt, skipped);
        this.updateScanProgress({ scannedFiles, scannedAlbums, scannedArtists: artistsSeen.size, skippedFiles, skippedReasons, currentPath: artistPath });
      }

      const finishedAt = nowIso();
      this.db.transaction(() => {
        if (!scanArtistId) {
          this.db.prepare('UPDATE tracks SET deleted = 1 WHERE lastSeen < ?').run(seenAt);
          this.db.prepare('UPDATE albums SET deleted = 1 WHERE lastSeen < ?').run(seenAt);
          this.db.prepare('UPDATE artists SET deleted = 1 WHERE lastSeen < ?').run(seenAt);
        }
        if (!scanArtistId) {
          this.db.prepare('DELETE FROM file_index WHERE lastScanAt < ?').run(seenAt);
        }
        this.db.prepare('UPDATE settings SET lastScanAt = ? WHERE id = 1').run(finishedAt);
        this.db.prepare(`
          UPDATE scan_state
          SET status = ?, finishedAt = ?, currentPath = NULL,
              scannedFiles = ?, scannedAlbums = ?, scannedArtists = ?, skippedFiles = ?, skippedReasonsJson = ?, error = NULL
          WHERE id = 1
        `).run(this.cancelRequested ? 'cancelled' : 'idle', finishedAt, scannedFiles, scannedAlbums, artistsSeen.size, skippedFiles, JSON.stringify(skippedReasons));
      })();
    } catch (error) {
      this.db.prepare(`
        UPDATE scan_state
        SET status = 'error', finishedAt = ?, error = ?, currentPath = NULL
        WHERE id = 1
      `).run(nowIso(), String(error.message || error));
    } finally {
      this.running = false;
      this.cancelRequested = false;
    }
  }
}

module.exports = { Scanner, deriveAlbumTitleFromFolderName, collectArtistTracks, parseMp3Id3v1 };
