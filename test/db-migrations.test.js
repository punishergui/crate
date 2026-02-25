const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { initDb, LATEST_SCHEMA_VERSION } = require('../server/db');

function createLegacyDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      accentColor TEXT NOT NULL DEFAULT '#FF6A00',
      noiseOverlay INTEGER NOT NULL DEFAULT 1,
      libraryPath TEXT NOT NULL DEFAULT '/music',
      lastScanAt TEXT
    );

    INSERT INTO settings(id, accentColor, noiseOverlay, libraryPath, lastScanAt)
    VALUES(1, '#FF6A00', 1, '/music', NULL);

    CREATE TABLE artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      deleted INTEGER NOT NULL DEFAULT 0,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL
    );

    INSERT INTO artists(name, deleted, firstSeen, lastSeen)
    VALUES ('Boards of Canada', 0, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');

    CREATE TABLE albums (
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

    INSERT INTO albums(artistId, title, path, firstSeen, lastSeen, lastFileMtime, formatsJson, trackCount, deleted)
    VALUES (1, 'Music Has the Right to Children', '/music/Boards of Canada/Music Has the Right to Children', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', NULL, '[]', 0, 0);

    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      albumId INTEGER NOT NULL,
      path TEXT NOT NULL UNIQUE,
      ext TEXT NOT NULL,
      mtime INTEGER,
      lastSeen TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(albumId) REFERENCES albums(id)
    );

    CREATE TABLE file_index (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      inodeKey TEXT,
      fileHash TEXT,
      ext TEXT NOT NULL,
      albumTag TEXT,
      albumArtistTag TEXT,
      artistTag TEXT,
      yearTag TEXT,
      lastScanAt TEXT NOT NULL
    );

    CREATE TABLE scan_skipped (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanStartedAt TEXT NOT NULL,
      filePath TEXT NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    INSERT INTO scan_skipped(scanStartedAt, filePath, reason, createdAt)
    VALUES ('2024-01-02T00:00:00.000Z', '/music/foo.mp3', 'missing tags', '2024-01-02T00:00:00.000Z');

    CREATE TABLE wanted_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      notes TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE album_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      alias TEXT NOT NULL,
      mapsToTitle TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE expected_artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      mbid TEXT UNIQUE,
      name TEXT,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE expected_albums (
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

    CREATE TABLE expected_ignored_albums (
      artistId INTEGER NOT NULL,
      expectedAlbumId INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (artistId, expectedAlbumId),
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE expected_artist_settings (
      artistId INTEGER PRIMARY KEY,
      includeLive INTEGER NOT NULL DEFAULT 0,
      includeCompilations INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE wishlist_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expectedAlbumId INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'wanted',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(expectedAlbumId) REFERENCES expected_albums(id)
    );

    CREATE TABLE album_match_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expectedAlbumId INTEGER UNIQUE,
      ownedAlbumId INTEGER UNIQUE,
      FOREIGN KEY(expectedAlbumId) REFERENCES expected_albums(id),
      FOREIGN KEY(ownedAlbumId) REFERENCES albums(id)
    );

    CREATE TABLE scan_state (
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

    CREATE TABLE album_art (
      albumId INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      originalPath TEXT,
      remoteUrl TEXT,
      etag TEXT,
      lastFetchedAt INTEGER,
      hash TEXT,
      width INTEGER,
      height INTEGER,
      FOREIGN KEY(albumId) REFERENCES albums(id)
    );

    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      startedAt INTEGER,
      finishedAt INTEGER,
      error TEXT
    );
  `);
  db.close();
}

test('initDb migrates legacy schema and writes schema version into meta', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-db-migration-'));
  const dbPath = path.join(tmpDir, 'legacy.sqlite');
  createLegacyDb(dbPath);

  const db = initDb({ dbPath });

  const schemaVersion = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  assert.equal(Number(schemaVersion.value), LATEST_SCHEMA_VERSION);

  const settingsColumns = db.prepare('PRAGMA table_info(settings)').all().map((column) => column.name);
  assert.ok(settingsColumns.includes('scanIgnoreFolderNames'));
  assert.ok(settingsColumns.includes('scanMaxDepth'));
  assert.ok(settingsColumns.includes('scanIncludeDiscSubfolders'));
  assert.ok(settingsColumns.includes('scanIncludeSingles'));

  const settingsRow = db.prepare('SELECT scanIgnoreFolderNames, scanMaxDepth, scanIncludeDiscSubfolders, scanIncludeSingles FROM settings WHERE id = 1').get();
  assert.equal(settingsRow.scanIgnoreFolderNames, '.crate,_tmp,@eaDir');
  assert.equal(settingsRow.scanMaxDepth, 3);
  assert.equal(settingsRow.scanIncludeDiscSubfolders, 1);
  assert.equal(settingsRow.scanIncludeSingles, 1);

  const albumColumns = db.prepare('PRAGMA table_info(albums)').all().map((column) => column.name);
  assert.ok(albumColumns.includes('albumKey'));

  const albumKeyRow = db.prepare('SELECT albumKey FROM albums WHERE id = 1').get();
  assert.ok(albumKeyRow.albumKey);

  const albumKeyIndex = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_albums_album_key_unique'").get();
  assert.ok(albumKeyIndex);

  const canonicalReason = db.prepare('SELECT reason FROM scan_skipped WHERE id = 1').get();
  assert.equal(canonicalReason.reason, 'missing_tags');

  db.close();
});
