const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DATA_DIR = '/data';
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const DB_PATH = path.join(DATA_DIR, 'crate.sqlite');

function ensureDataDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function initDb() {
  ensureDataDirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      accentColor TEXT NOT NULL DEFAULT '#FF6A00',
      noiseOverlay INTEGER NOT NULL DEFAULT 1,
      libraryPath TEXT NOT NULL DEFAULT '/music',
      lastScanAt TEXT
    );

    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      deleted INTEGER NOT NULL DEFAULT 0,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL,
      lastFileMtime INTEGER,
      formatsJson TEXT NOT NULL DEFAULT '[]',
      trackCount INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      albumId INTEGER NOT NULL,
      path TEXT NOT NULL UNIQUE,
      ext TEXT NOT NULL,
      mtime INTEGER,
      lastSeen TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(albumId) REFERENCES albums(id)
    );


    CREATE TABLE IF NOT EXISTS wanted_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      notes TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE IF NOT EXISTS album_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      alias TEXT NOT NULL,
      mapsToTitle TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );


    CREATE TABLE IF NOT EXISTS scan_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      startedAt TEXT,
      finishedAt TEXT,
      currentPath TEXT,
      scannedFiles INTEGER NOT NULL DEFAULT 0,
      scannedAlbums INTEGER NOT NULL DEFAULT 0,
      scannedArtists INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS expected_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      notes TEXT,
      linkedAlbumId INTEGER,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id),
      FOREIGN KEY(linkedAlbumId) REFERENCES albums(id)
    );

    CREATE TABLE IF NOT EXISTS artist_tracking (
      artistId INTEGER PRIMARY KEY,
      isTracked INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE INDEX IF NOT EXISTS idx_expected_albums_artist_id ON expected_albums(artistId);
  `);

  db.prepare(`INSERT OR IGNORE INTO settings (id) VALUES (1)`).run();
  db.prepare(`INSERT OR IGNORE INTO scan_state (id) VALUES (1)`).run();

  db.exec(`
    INSERT INTO expected_albums (artistId, title, year, notes, linkedAlbumId, createdAt)
    SELECT wa.artistId, wa.title, wa.year, wa.notes, NULL, wa.createdAt
    FROM wanted_albums wa
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected_albums ea
      WHERE ea.artistId = wa.artistId
        AND ea.title = wa.title
        AND COALESCE(ea.year, -1) = COALESCE(wa.year, -1)
        AND COALESCE(ea.notes, '') = COALESCE(wa.notes, '')
        AND ea.createdAt = wa.createdAt
    );
  `);

  return db;
}

module.exports = { initDb, DB_PATH, ensureDataDirs };
