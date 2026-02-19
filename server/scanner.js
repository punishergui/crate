const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a']);

function nowIso() {
  return new Date().toISOString();
}

function parseAlbumFromPath(libraryPath, dirPath) {
  const rel = path.relative(libraryPath, dirPath);
  if (!rel || rel.startsWith('..')) {
    return { artistName: 'Unknown', albumTitle: 'Unknown' };
  }
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length >= 2) {
    return { artistName: parts[0], albumTitle: parts[1] };
  }
  return { artistName: 'Unknown', albumTitle: 'Unknown' };
}

function walkFiles(startPath, onDirectory, shouldCancel) {
  const stack = [startPath];
  while (stack.length > 0) {
    if (shouldCancel()) return;
    const current = stack.pop();
    onDirectory(current);
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
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
    setImmediate(() => this.runScan(libraryPath));
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
    const existing = this.db.prepare('SELECT id, firstSeen FROM albums WHERE path = ?').get(albumPath);
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
    const markSeen = this.db.prepare('UPDATE tracks SET lastSeen = ?, mtime = ?, ext = ?, deleted = 0 WHERE path = ?');
    const insert = this.db.prepare('INSERT INTO tracks(albumId, path, ext, mtime, lastSeen, deleted) VALUES (?, ?, ?, ?, ?, 0)');
    const find = this.db.prepare('SELECT id FROM tracks WHERE path = ?');

    for (const track of tracks) {
      const existing = find.get(track.path);
      if (existing) {
        markSeen.run(seenAt, track.mtime, track.ext, track.path);
      } else {
        insert.run(albumId, track.path, track.ext, track.mtime, seenAt);
      }
    }

    this.db.prepare('UPDATE tracks SET deleted = 1 WHERE albumId = ? AND lastSeen < ?').run(albumId, seenAt);
  }

  runScan(libraryPath) {
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

      walkFiles(
        libraryPath,
        (dirPath) => {
          if (this.cancelRequested) return;
          this.db.prepare('UPDATE scan_state SET currentPath = ? WHERE id = 1').run(dirPath);
          let entries = [];
          try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
          } catch {
            return;
          }
          const files = entries.filter((entry) => entry.isFile());
          const audioTracks = [];
          const formats = new Set();
          let latestMtime = 0;

          for (const file of files) {
            const ext = path.extname(file.name).toLowerCase();
            if (!AUDIO_EXTS.has(ext)) continue;
            const fullPath = path.join(dirPath, file.name);
            let stat;
            try {
              stat = fs.statSync(fullPath);
            } catch {
              continue;
            }
            audioTracks.push({ path: fullPath, ext: ext.slice(1), mtime: stat.mtimeMs });
            formats.add(ext.slice(1));
            latestMtime = Math.max(latestMtime, stat.mtimeMs);
          }

          if (audioTracks.length === 0) return;

          const { artistName, albumTitle } = parseAlbumFromPath(libraryPath, dirPath);
          const artistId = this.upsertArtist(artistName || 'Unknown', seenAt);
          artistsSeen.add(artistId);
          const albumId = this.upsertAlbum({
            artistId,
            title: albumTitle || 'Unknown',
            albumPath: dirPath,
            seenAt,
            formats,
            trackCount: audioTracks.length,
            lastFileMtime: latestMtime || null
          });
          this.syncTracks(albumId, audioTracks, seenAt);

          scannedFiles += audioTracks.length;
          scannedAlbums += 1;
          this.db.prepare(`
            UPDATE scan_state
            SET scannedFiles = ?, scannedAlbums = ?, scannedArtists = ?
            WHERE id = 1
          `).run(scannedFiles, scannedAlbums, artistsSeen.size);
        },
        () => this.cancelRequested
      );

      const finishedAt = nowIso();
      this.db.transaction(() => {
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
