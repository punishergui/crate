const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { slugifyArtistName, shortHash } = require('./slug');

const DATA_DIR = '/data';
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const DB_PATH = path.join(DATA_DIR, 'crate.sqlite');

function ensureDataDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}


function buildArtistSlug(db, name, rowId = null) {
  const base = slugifyArtistName(name);
  const rows = db.prepare('SELECT id, name, slug FROM artists WHERE slug = ?').all(base);
  if (rows.length === 0) return base;
  if (rows.some((row) => row.id === rowId)) return base;
  return `${base}-${shortHash(name).slice(0, 6)}`;
}

function ensureArtistSlugs(db) {
  const artistColumns = db.prepare('PRAGMA table_info(artists)').all();
  const hasSlugColumn = artistColumns.some((column) => column.name === 'slug');
  if (!hasSlugColumn) {
    db.exec('ALTER TABLE artists ADD COLUMN slug TEXT');
  }

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_slug_unique ON artists(slug)');

  const withoutSlug = db.prepare("SELECT id, name FROM artists WHERE slug IS NULL OR slug = ''").all();
  const updateSlug = db.prepare('UPDATE artists SET slug = ? WHERE id = ?');
  for (const artist of withoutSlug) {
    updateSlug.run(buildArtistSlug(db, artist.name, artist.id), artist.id);
  }
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
      lastScanAt TEXT,
      lidarrEnabled INTEGER NOT NULL DEFAULT 0,
      lidarrBaseUrl TEXT NOT NULL DEFAULT '',
      lidarrApiKey TEXT NOT NULL DEFAULT '',
      lidarrQualityProfileId INTEGER,
      lidarrRootFolderPath TEXT,
      artworkPreferLocal INTEGER NOT NULL DEFAULT 1,
      artworkAllowRemote INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
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

    CREATE TABLE IF NOT EXISTS file_index (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      inode INTEGER,
      device INTEGER,
      inodeKey TEXT,
      fileHash TEXT,
      ext TEXT NOT NULL,
      albumTag TEXT,
      albumArtistTag TEXT,
      artistTag TEXT,
      yearTag TEXT,
      lastScanAt TEXT NOT NULL,
      lastSeenAt TEXT
    );

    CREATE TABLE IF NOT EXISTS scan_skipped (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanStartedAt TEXT NOT NULL,
      filePath TEXT NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL
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
      primaryType TEXT,
      secondaryTypesJson TEXT NOT NULL DEFAULT '[]',
      normalizedTitle TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(expectedArtistId) REFERENCES expected_artists(id)
    );

    CREATE TABLE IF NOT EXISTS expected_ignored_albums (
      artistId INTEGER NOT NULL,
      expectedAlbumId INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (artistId, expectedAlbumId),
      FOREIGN KEY(artistId) REFERENCES artists(id)
    );

    CREATE TABLE IF NOT EXISTS expected_artist_settings (
      artistId INTEGER PRIMARY KEY,
      includeLive INTEGER NOT NULL DEFAULT 0,
      includeCompilations INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(artistId) REFERENCES artists(id)
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
      skippedFiles INTEGER NOT NULL DEFAULT 0,
      skippedReasonsJson TEXT NOT NULL DEFAULT '{}',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS album_art (
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

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      startedAt INTEGER,
      finishedAt INTEGER,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_albums_artist_deleted ON albums(artistId, deleted);
    CREATE INDEX IF NOT EXISTS idx_expected_artists_artist_id ON expected_artists(artistId);
    CREATE INDEX IF NOT EXISTS idx_file_index_inode ON file_index(inodeKey);
    CREATE INDEX IF NOT EXISTS idx_file_index_hash ON file_index(fileHash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expected_artists_artist_unique ON expected_artists(artistId);
    CREATE INDEX IF NOT EXISTS idx_expected_albums_expected_artist_id ON expected_albums(expectedArtistId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expected_albums_release_group_unique ON expected_albums(expectedArtistId, mb_release_group_id);
    CREATE INDEX IF NOT EXISTS idx_expected_albums_normalized_title ON expected_albums(expectedArtistId, normalizedTitle);
    CREATE INDEX IF NOT EXISTS idx_wishlist_status ON wishlist_albums(status);
  `);

  ensureArtistSlugs(db);

  const albumColumns = db.prepare('PRAGMA table_info(albums)').all();
  const hasOwnedColumn = albumColumns.some((column) => column.name === 'owned');
  if (!hasOwnedColumn) {
    db.exec('ALTER TABLE albums ADD COLUMN owned INTEGER NOT NULL DEFAULT 1');
  }


  const expectedAlbumColumns = db.prepare('PRAGMA table_info(expected_albums)').all();
  if (!expectedAlbumColumns.some((column) => column.name === 'primaryType')) {
    db.exec('ALTER TABLE expected_albums ADD COLUMN primaryType TEXT');
  }
  if (!expectedAlbumColumns.some((column) => column.name === 'secondaryTypesJson')) {
    db.exec("ALTER TABLE expected_albums ADD COLUMN secondaryTypesJson TEXT NOT NULL DEFAULT '[]'");
  }

  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
  const hasExpectedIgnoredLegacy = tableExists.get('expected_ignored');
  if (hasExpectedIgnoredLegacy) {
    db.exec(`
      INSERT OR IGNORE INTO expected_ignored_albums (artistId, expectedAlbumId, createdAt)
      SELECT artistId, expectedAlbumId, createdAt
      FROM expected_ignored
    `);
    db.exec('DROP TABLE expected_ignored');
  }


  const settingsColumns = db.prepare('PRAGMA table_info(settings)').all();
  if (!settingsColumns.some((column) => column.name === 'lidarrEnabled')) {
    db.exec('ALTER TABLE settings ADD COLUMN lidarrEnabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!settingsColumns.some((column) => column.name === 'lidarrBaseUrl')) {
    db.exec("ALTER TABLE settings ADD COLUMN lidarrBaseUrl TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColumns.some((column) => column.name === 'lidarrApiKey')) {
    db.exec("ALTER TABLE settings ADD COLUMN lidarrApiKey TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColumns.some((column) => column.name === 'lidarrQualityProfileId')) {
    db.exec('ALTER TABLE settings ADD COLUMN lidarrQualityProfileId INTEGER');
  }
  if (!settingsColumns.some((column) => column.name === 'lidarrRootFolderPath')) {
    db.exec('ALTER TABLE settings ADD COLUMN lidarrRootFolderPath TEXT');
  }
  if (!settingsColumns.some((column) => column.name === 'artworkPreferLocal')) {
    db.exec('ALTER TABLE settings ADD COLUMN artworkPreferLocal INTEGER NOT NULL DEFAULT 1');
  }
  if (!settingsColumns.some((column) => column.name === 'artworkAllowRemote')) {
    db.exec('ALTER TABLE settings ADD COLUMN artworkAllowRemote INTEGER NOT NULL DEFAULT 0');
  }

  const scanStateColumns = db.prepare('PRAGMA table_info(scan_state)').all();
  if (!scanStateColumns.some((column) => column.name === 'skippedFiles')) {
    db.exec('ALTER TABLE scan_state ADD COLUMN skippedFiles INTEGER NOT NULL DEFAULT 0');
  }
  if (!scanStateColumns.some((column) => column.name === 'skippedReasonsJson')) {
    db.exec("ALTER TABLE scan_state ADD COLUMN skippedReasonsJson TEXT NOT NULL DEFAULT '{}'");
  }

  const fileIndexColumns = db.prepare('PRAGMA table_info(file_index)').all();
  if (!fileIndexColumns.some((column) => column.name === 'lastSeenAt')) {
    db.exec('ALTER TABLE file_index ADD COLUMN lastSeenAt TEXT');
  }


  if (!fileIndexColumns.some((column) => column.name === 'inode')) {
    db.exec('ALTER TABLE file_index ADD COLUMN inode INTEGER');
  }
  if (!fileIndexColumns.some((column) => column.name === 'device')) {
    db.exec('ALTER TABLE file_index ADD COLUMN device INTEGER');
  }

  db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
  db.prepare('INSERT OR IGNORE INTO scan_state (id) VALUES (1)').run();
  return db;
}

module.exports = { initDb, DB_PATH, ensureDataDirs };
