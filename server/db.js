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

    CREATE TABLE IF NOT EXISTS expected_artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      mbid TEXT UNIQUE,
      name TEXT,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE IF NOT EXISTS expected_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expectedArtistId INTEGER NOT NULL,
      mb_release_group_id TEXT,
      title TEXT NOT NULL,
      year INTEGER,
      type TEXT,
      normalizedTitle TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(expectedArtistId) REFERENCES expected_artists(id)
    );

    CREATE TABLE IF NOT EXISTS wishlist_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expectedAlbumId INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'wanted',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(expectedAlbumId) REFERENCES expected_albums(id)
    );

    CREATE TABLE IF NOT EXISTS album_match_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expectedAlbumId INTEGER UNIQUE,
      ownedAlbumId INTEGER UNIQUE,
      FOREIGN KEY(expectedAlbumId) REFERENCES expected_albums(id),
      FOREIGN KEY(ownedAlbumId) REFERENCES albums(id)
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

    CREATE INDEX IF NOT EXISTS idx_albums_artist_deleted ON albums(artistId, deleted);
    CREATE INDEX IF NOT EXISTS idx_expected_artists_artist_id ON expected_artists(artistId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expected_artists_artist_unique ON expected_artists(artistId);
    CREATE INDEX IF NOT EXISTS idx_expected_albums_expected_artist_id ON expected_albums(expectedArtistId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expected_albums_release_group_unique ON expected_albums(expectedArtistId, mb_release_group_id);
    CREATE INDEX IF NOT EXISTS idx_expected_albums_normalized_title ON expected_albums(expectedArtistId, normalizedTitle);
    CREATE INDEX IF NOT EXISTS idx_wishlist_status ON wishlist_albums(status);
  `);

  const albumColumns = db.prepare('PRAGMA table_info(albums)').all();
  const hasOwnedColumn = albumColumns.some((column) => column.name === 'owned');
  if (!hasOwnedColumn) {
    db.exec('ALTER TABLE albums ADD COLUMN owned INTEGER NOT NULL DEFAULT 1');
  }

  db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
  db.prepare('INSERT OR IGNORE INTO scan_state (id) VALUES (1)').run();
  return db;
}

module.exports = { initDb, DB_PATH, ensureDataDirs };
