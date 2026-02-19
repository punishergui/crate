const fs = require('node:fs');
const path = require('node:path');

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

  scanAlbum({ artistId, title, albumPath, seenAt }) {
    const tracks = collectAudioFiles(albumPath, { recursive: true });
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

        for (const albumEntry of albumFolders) {
          if (this.cancelRequested) break;
          const albumPath = path.join(artistPath, albumEntry.name);
          this.db.prepare('UPDATE scan_state SET currentPath = ? WHERE id = 1').run(albumPath);
          const trackCount = this.scanAlbum({ artistId, title: albumEntry.name, albumPath, seenAt });
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

        const looseTracks = artistEntries
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

        if (looseTracks.length > 0) {
          const formats = new Set();
          let latestMtime = 0;
          for (const track of looseTracks) {
            formats.add(track.ext);
            latestMtime = Math.max(latestMtime, track.mtime || 0);
          }
          const singlesAlbumId = this.upsertAlbum({
            artistId,
            title: 'Singles',
            albumPath: artistPath,
            seenAt,
            formats,
            trackCount: looseTracks.length,
            lastFileMtime: latestMtime || null
          });
          this.syncTracks(singlesAlbumId, looseTracks, seenAt);

          scannedAlbums += 1;
          scannedFiles += looseTracks.length;
          this.db.prepare('UPDATE scan_state SET scannedFiles = ?, scannedAlbums = ?, scannedArtists = ? WHERE id = 1').run(
            scannedFiles,
            scannedAlbums,
            artistsSeen.size
          );
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
