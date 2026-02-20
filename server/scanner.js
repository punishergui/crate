const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

function collectAudioFiles(startPath, { recursive }) {
  const out = [];
  const stack = [startPath];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (isHiddenName(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          stack.push(fullPath);
        }
        continue;
      }
      if (!entry.isFile() || !isAudioFileName(entry.name)) continue;

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      out.push({
        path: fullPath,
        ext: path.extname(entry.name).toLowerCase().slice(1),
        mtime: stat.mtimeMs
      });
    }
  }

  return out;
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

async function readAlbumFromTags(track, artistName) {
  if (track.ext !== 'flac') return null;
  try {
    const comments = parseFlacVorbisComments(track.path);
    if (!comments) return null;

    const album = comments.get('ALBUM')?.[0];
    if (!album) return null;

    const taggedArtist = comments.get('ALBUMARTIST')?.[0] || comments.get('ARTIST')?.[0];
    if (taggedArtist) {
      const normalizedTagged = normalizeCompareValue(taggedArtist);
      const normalizedArtist = normalizeCompareValue(artistName);
      if (normalizedArtist && normalizedTagged && normalizedArtist !== normalizedTagged) {
        return null;
      }
    }

    return {
      album,
      year: comments.get('DATE')?.[0] || comments.get('YEAR')?.[0] || null
    };
  } catch {
    return null;
  }
}

async function groupLooseRootTracks({ artistName, artistPath, looseRootTracks }) {
  const groups = new Map();
  const catchAll = [];

  for (const track of looseRootTracks) {
    const tagInfo = await readAlbumFromTags(track, artistName);
    const albumTitle = tagInfo?.album || parseAlbumFromFilename(track.path, artistName);
    if (!albumTitle) {
      catchAll.push(track);
      continue;
    }

    const key = albumTitle;
    if (!groups.has(key)) {
      groups.set(key, {
        title: albumTitle,
        albumPath: createVirtualAlbumPath(artistPath, albumTitle),
        tracks: []
      });
    }
    groups.get(key).tracks.push(track);
  }

  const groupedAlbums = Array.from(groups.values()).sort((a, b) => a.title.localeCompare(b.title));
  const topNames = groupedAlbums.slice(0, 5).map((group) => group.title).join(', ');
  console.debug(
    `[scanner] artist="${artistName}" detectedAlbumGroups=${groupedAlbums.length} topAlbumNames="${topNames || 'none'}"`
  );

  if (catchAll.length > 0) {
    groupedAlbums.push({
      title: 'Loose Tracks',
      albumPath: createVirtualAlbumPath(artistPath, 'Loose Tracks'),
      tracks: catchAll
    });
  }

  return groupedAlbums;
}

class Scanner {
  constructor(db) {
    this.db = db;
    this.running = false;
    this.cancelRequested = false;
  }

  getStatus() {
    return this.db.prepare('SELECT * FROM scan_state WHERE id = 1').get();
  }

  requestCancel() {
    if (!this.running) return false;
    this.cancelRequested = true;
    return true;
  }

  startScan(libraryPath) {
    if (this.running) {
      return { started: false, status: this.getStatus() };
    }
    this.running = true;
    this.cancelRequested = false;
    setImmediate(() => this.runScan(libraryPath).catch((error) => {
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

  upsertArtist(name, seenAt) {
    const existing = this.db.prepare('SELECT id FROM artists WHERE name = ?').get(name);
    if (existing) {
      this.db.prepare('UPDATE artists SET lastSeen = ?, deleted = 0 WHERE id = ?').run(seenAt, existing.id);
      return existing.id;
    }
    const res = this.db.prepare('INSERT INTO artists(name, firstSeen, lastSeen, deleted) VALUES (?, ?, ?, 0)').run(name, seenAt, seenAt);
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

  async runScan(libraryPath) {
    const seenAt = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE scan_state
        SET status = 'running', startedAt = ?, finishedAt = NULL, currentPath = NULL,
            scannedFiles = 0, scannedAlbums = 0, scannedArtists = 0, error = NULL
        WHERE id = 1
      `).run(seenAt);
    });
    tx();

    let scannedFiles = 0;
    let scannedAlbums = 0;
    const artistsSeen = new Set();

    try {
      if (!fs.existsSync(libraryPath)) {
        throw new Error(`Library path does not exist: ${libraryPath}`);
      }

      let rootEntries = [];
      try {
        rootEntries = fs.readdirSync(libraryPath, { withFileTypes: true });
      } catch {
        rootEntries = [];
      }

      const artistDirs = rootEntries
        .filter((entry) => entry.isDirectory() && !isHiddenName(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const artistEntry of artistDirs) {
        if (this.cancelRequested) break;

        const artistName = artistEntry.name;
        const artistPath = path.join(libraryPath, artistName);
        this.db.prepare('UPDATE scan_state SET currentPath = ? WHERE id = 1').run(artistPath);

        const artistId = this.upsertArtist(artistName, seenAt);
        artistsSeen.add(artistId);

        let artistEntries = [];
        try {
          artistEntries = fs.readdirSync(artistPath, { withFileTypes: true });
        } catch {
          artistEntries = [];
        }

        const albumFolders = artistEntries
          .filter((entry) => entry.isDirectory() && !isHiddenName(entry.name))
          .sort((a, b) => a.name.localeCompare(b.name));

        const albumCandidates = [];
        for (const albumEntry of albumFolders) {
          if (this.cancelRequested) break;
          const albumPath = path.join(artistPath, albumEntry.name);
          const albumTracks = collectAudioFiles(albumPath, { recursive: true });
          if (albumTracks.length === 0) continue;
          albumCandidates.push({
            title: albumEntry.name,
            albumPath,
            tracks: albumTracks
          });
        }

        if (this.cancelRequested) break;

        const looseRootTracks = artistEntries
          .filter((entry) => entry.isFile() && !isHiddenName(entry.name) && isAudioFileName(entry.name))
          .map((entry) => {
            const fullPath = path.join(artistPath, entry.name);
            let stat;
            try {
              stat = fs.statSync(fullPath);
            } catch {
              return null;
            }
            return {
              path: fullPath,
              ext: path.extname(entry.name).toLowerCase().slice(1),
              mtime: stat.mtimeMs
            };
          })
          .filter(Boolean);

        console.debug(
          `[scanner] artist="${artistName}" subfolderAlbumCount=${albumCandidates.length} looseRootTrackCount=${looseRootTracks.length}`
        );

        for (const albumCandidate of albumCandidates) {
          if (this.cancelRequested) break;
          this.db.prepare('UPDATE scan_state SET currentPath = ? WHERE id = 1').run(albumCandidate.albumPath);
          const trackCount = this.syncAlbum({
            artistId,
            title: albumCandidate.title,
            albumPath: albumCandidate.albumPath,
            tracks: albumCandidate.tracks,
            seenAt
          });
          if (!trackCount) continue;

          scannedAlbums += 1;
          scannedFiles += trackCount;
          this.db.prepare('UPDATE scan_state SET scannedFiles = ?, scannedAlbums = ?, scannedArtists = ? WHERE id = 1').run(
            scannedFiles,
            scannedAlbums,
            artistsSeen.size
          );
        }

        if (this.cancelRequested) break;

        if (looseRootTracks.length > 0) {
          this.db.prepare('UPDATE scan_state SET currentPath = ? WHERE id = 1').run(artistPath);
          const groupedLooseAlbums = await groupLooseRootTracks({ artistName, artistPath, looseRootTracks });
          for (const looseAlbum of groupedLooseAlbums) {
            const trackCount = this.syncAlbum({
              artistId,
              title: looseAlbum.title,
              albumPath: looseAlbum.albumPath,
              seenAt,
              tracks: looseAlbum.tracks
            });
            if (!trackCount) continue;
            scannedAlbums += 1;
            scannedFiles += trackCount;
            this.db.prepare('UPDATE scan_state SET scannedFiles = ?, scannedAlbums = ?, scannedArtists = ? WHERE id = 1').run(
              scannedFiles,
              scannedAlbums,
              artistsSeen.size
            );
          }
        } else if (albumCandidates.length === 0) {
          const rootTracks = collectAudioFiles(artistPath, { recursive: true });
          if (rootTracks.length > 0) {
            this.db.prepare('UPDATE scan_state SET currentPath = ? WHERE id = 1').run(artistPath);
            const rootTrackCount = this.syncAlbum({
              artistId,
              title: 'Loose Tracks',
              albumPath: createVirtualAlbumPath(artistPath, 'Loose Tracks'),
              seenAt,
              tracks: rootTracks
            });
            scannedAlbums += 1;
            scannedFiles += rootTrackCount;
            this.db.prepare('UPDATE scan_state SET scannedFiles = ?, scannedAlbums = ?, scannedArtists = ? WHERE id = 1').run(
              scannedFiles,
              scannedAlbums,
              artistsSeen.size
            );
          }
        }
      }

      const finishedAt = nowIso();
      this.db.transaction(() => {
        this.db.prepare('UPDATE tracks SET deleted = 1 WHERE lastSeen < ?').run(seenAt);
        this.db.prepare('UPDATE albums SET deleted = 1 WHERE lastSeen < ?').run(seenAt);
        this.db.prepare('UPDATE artists SET deleted = 1 WHERE lastSeen < ?').run(seenAt);
        this.db.prepare('UPDATE settings SET lastScanAt = ? WHERE id = 1').run(finishedAt);
        this.db.prepare(`
          UPDATE scan_state
          SET status = ?, finishedAt = ?, currentPath = NULL,
              scannedFiles = ?, scannedAlbums = ?, scannedArtists = ?, error = NULL
          WHERE id = 1
        `).run(this.cancelRequested ? 'cancelled' : 'idle', finishedAt, scannedFiles, scannedAlbums, artistsSeen.size);
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

module.exports = { Scanner };
