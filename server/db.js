const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  LATEST_SCHEMA_VERSION,
  applyMigrations,
  columnExists,
  addColumnIfMissing,
  ensureIndex,
  ensureSettingsColumns,
  getMigrationRecords,
  getSchemaVersion,
} = require('./db/migrations');

const DATA_DIR = '/data';
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const DB_PATH = process.env.CRATE_DB_PATH || path.join(DATA_DIR, 'crate.sqlite');

function ensureDataDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function wrapMigrationErrors(error) {
  if (error && typeof error.message === 'string' && error.message.includes('readonly')) {
    const wrapped = new Error(`Database schema migration failed because the database is read-only: ${error.message}`);
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

function initDb(options = {}) {
  const dbPath = options.dbPath || DB_PATH;
  ensureDataDirs();
  const db = new Database(dbPath);
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
      artworkAllowRemote INTEGER NOT NULL DEFAULT 0,
      artworkPreferEmbedded INTEGER NOT NULL DEFAULT 1,
      artworkPreferFolder INTEGER NOT NULL DEFAULT 1,
      artworkCacheEnabled INTEGER NOT NULL DEFAULT 1,
      artworkDefaultSize INTEGER NOT NULL DEFAULT 512,
      artworkFolderFilenames TEXT NOT NULL DEFAULT 'cover,folder,front,album',
      scanMaxDepth INTEGER NOT NULL DEFAULT 3,
      scanIgnoreHiddenPaths INTEGER NOT NULL DEFAULT 1,
      scanGroupByFolder INTEGER NOT NULL DEFAULT 1,
      scanTreatArtistRootLooseTracksAsSingles INTEGER NOT NULL DEFAULT 1,
      scanIncludeDiscSubfolders INTEGER NOT NULL DEFAULT 1,
      scanIncludeSingles INTEGER NOT NULL DEFAULT 1,
      scanTreatCompilationAsSeparate INTEGER NOT NULL DEFAULT 0,
      scanIgnoreFolderNames TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
      artworkSource TEXT NOT NULL DEFAULT 'none',
      artworkPath TEXT,
      artworkMtime INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artistId INTEGER NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      pathDir TEXT,
      albumKey TEXT,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL,
      lastFileMtime INTEGER,
      formatsJson TEXT NOT NULL DEFAULT '[]',
      trackCount INTEGER NOT NULL DEFAULT 0,
      artworkSource TEXT NOT NULL DEFAULT 'none',
      artworkPath TEXT,
      artworkMtime INTEGER,
      artworkHash TEXT,
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
      ext TEXT,
      message TEXT,
      detailsJson TEXT,
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

    CREATE TABLE IF NOT EXISTS artwork_cache (
      key TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      mtime INTEGER,
      createdAt TEXT NOT NULL
    );
  `);

  try {
    const migrationState = applyMigrations(db, { migrations: options.migrations });
    db.crateRuntime = {
      degraded: Boolean(migrationState?.degraded),
      migrationErrors: migrationState?.migrationErrors || [],
    };
  } catch (error) {
    throw wrapMigrationErrors(error);
  }

  ensureSettingsColumns(db);
  db.prepare("INSERT OR IGNORE INTO settings (id, scanIgnoreFolderNames) VALUES (1, '[]')").run();
  db.prepare('INSERT OR IGNORE INTO scan_state (id) VALUES (1)').run();
  return db;
}


function getDbRuntimeStatus(db) {
  return {
    dbPath: db.name || DB_PATH,
    degraded: Boolean(db.crateRuntime?.degraded),
    migrationErrors: db.crateRuntime?.migrationErrors || [],
    schemaVersion: getSchemaVersion(db),
    migrations: getMigrationRecords(db),
  };
}

module.exports = {
  initDb,
  DB_PATH,
  ensureDataDirs,
  hasColumn: columnExists,
  ensureColumn: addColumnIfMissing,
  ensureIndex,
  LATEST_SCHEMA_VERSION,
  getDbRuntimeStatus
};
