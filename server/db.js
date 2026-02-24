const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { slugifyArtistName, shortHash } = require('./slug');

const DATA_DIR = '/data';
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const DB_PATH = path.join(DATA_DIR, 'crate.sqlite');
const LATEST_SCHEMA_VERSION = 2;

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
  ensureColumn(db, 'artists', 'slug', 'ALTER TABLE artists ADD COLUMN slug TEXT');
  ensureIndex(db, 'idx_artists_slug_unique', 'CREATE UNIQUE INDEX idx_artists_slug_unique ON artists(slug)');

  const withoutSlug = db.prepare("SELECT id, name FROM artists WHERE slug IS NULL OR slug = ''").all();
  const updateSlug = db.prepare('UPDATE artists SET slug = ? WHERE id = ?');
  for (const artist of withoutSlug) {
    updateSlug.run(buildArtistSlug(db, artist.name, artist.id), artist.id);
  }
}

function hasColumn(db, table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((entry) => entry.name === column);
}

function ensureColumn(db, table, column, ddl) {
  if (!hasColumn(db, table, column)) {
    db.exec(ddl);
    return true;
  }
  return false;
}

function hasIndex(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name);
  return Boolean(row);
}

function ensureIndex(db, name, ddl) {
  if (!hasIndex(db, name)) {
    db.exec(ddl);
    return true;
  }
  return false;
}

function readSchemaVersion(db) {
  const row = db.pragma('user_version', { simple: true });
  return Number.isInteger(row) ? row : 0;
}

function setSchemaVersion(db, version) {
  db.pragma(`user_version = ${version}`);
}

function migrationV1(db) {
  ensureArtistSlugs(db);
  ensureColumn(db, 'albums', 'owned', 'ALTER TABLE albums ADD COLUMN owned INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'albums', 'pathDir', 'ALTER TABLE albums ADD COLUMN pathDir TEXT');
  ensureColumn(db, 'albums', 'albumKey', 'ALTER TABLE albums ADD COLUMN albumKey TEXT');
  ensureIndex(db, 'idx_albums_artist_deleted', 'CREATE INDEX idx_albums_artist_deleted ON albums(artistId, deleted)');
  ensureIndex(db, 'idx_albums_album_key_unique', 'CREATE UNIQUE INDEX idx_albums_album_key_unique ON albums(albumKey)');

  ensureColumn(db, 'expected_albums', 'primaryType', 'ALTER TABLE expected_albums ADD COLUMN primaryType TEXT');
  ensureColumn(db, 'expected_albums', 'secondaryTypesJson', "ALTER TABLE expected_albums ADD COLUMN secondaryTypesJson TEXT NOT NULL DEFAULT '[]'");

  const hasExpectedIgnoredLegacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get('expected_ignored');
  if (hasExpectedIgnoredLegacy) {
    db.exec(`
      INSERT OR IGNORE INTO expected_ignored_albums (artistId, expectedAlbumId, createdAt)
      SELECT artistId, expectedAlbumId, createdAt
      FROM expected_ignored
    `);
    db.exec('DROP TABLE expected_ignored');
  }

  ensureColumn(db, 'settings', 'lidarrEnabled', 'ALTER TABLE settings ADD COLUMN lidarrEnabled INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'settings', 'lidarrBaseUrl', "ALTER TABLE settings ADD COLUMN lidarrBaseUrl TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'settings', 'lidarrApiKey', "ALTER TABLE settings ADD COLUMN lidarrApiKey TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'settings', 'lidarrQualityProfileId', 'ALTER TABLE settings ADD COLUMN lidarrQualityProfileId INTEGER');
  ensureColumn(db, 'settings', 'lidarrRootFolderPath', 'ALTER TABLE settings ADD COLUMN lidarrRootFolderPath TEXT');
  ensureColumn(db, 'settings', 'artworkPreferLocal', 'ALTER TABLE settings ADD COLUMN artworkPreferLocal INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'settings', 'artworkAllowRemote', 'ALTER TABLE settings ADD COLUMN artworkAllowRemote INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'settings', 'artworkPreferEmbedded', 'ALTER TABLE settings ADD COLUMN artworkPreferEmbedded INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'settings', 'artworkPreferFolder', 'ALTER TABLE settings ADD COLUMN artworkPreferFolder INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'settings', 'artworkCacheEnabled', 'ALTER TABLE settings ADD COLUMN artworkCacheEnabled INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'settings', 'artworkDefaultSize', 'ALTER TABLE settings ADD COLUMN artworkDefaultSize INTEGER NOT NULL DEFAULT 512');
  ensureColumn(db, 'settings', 'artworkFolderFilenames', "ALTER TABLE settings ADD COLUMN artworkFolderFilenames TEXT NOT NULL DEFAULT 'cover,folder,front,album'");
  ensureColumn(db, 'settings', 'scanMaxDepth', 'ALTER TABLE settings ADD COLUMN scanMaxDepth INTEGER NOT NULL DEFAULT 4');
  ensureColumn(db, 'settings', 'scanIgnoreHiddenPaths', 'ALTER TABLE settings ADD COLUMN scanIgnoreHiddenPaths INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'settings', 'scanGroupByFolder', 'ALTER TABLE settings ADD COLUMN scanGroupByFolder INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'settings', 'scanTreatArtistRootLooseTracksAsSingles', 'ALTER TABLE settings ADD COLUMN scanTreatArtistRootLooseTracksAsSingles INTEGER NOT NULL DEFAULT 1');

  ensureColumn(db, 'scan_state', 'skippedFiles', 'ALTER TABLE scan_state ADD COLUMN skippedFiles INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'scan_state', 'skippedReasonsJson', "ALTER TABLE scan_state ADD COLUMN skippedReasonsJson TEXT NOT NULL DEFAULT '{}'");

  ensureColumn(db, 'scan_skipped', 'ext', 'ALTER TABLE scan_skipped ADD COLUMN ext TEXT');
  ensureColumn(db, 'scan_skipped', 'message', 'ALTER TABLE scan_skipped ADD COLUMN message TEXT');
  ensureColumn(db, 'scan_skipped', 'detailsJson', 'ALTER TABLE scan_skipped ADD COLUMN detailsJson TEXT');
  ensureIndex(db, 'idx_scan_skipped_reason_created', 'CREATE INDEX idx_scan_skipped_reason_created ON scan_skipped(reason, createdAt DESC)');
  ensureIndex(db, 'idx_scan_skipped_ext', 'CREATE INDEX idx_scan_skipped_ext ON scan_skipped(ext)');

  ensureColumn(db, 'file_index', 'lastSeenAt', 'ALTER TABLE file_index ADD COLUMN lastSeenAt TEXT');
  ensureColumn(db, 'file_index', 'inode', 'ALTER TABLE file_index ADD COLUMN inode INTEGER');
  ensureColumn(db, 'file_index', 'device', 'ALTER TABLE file_index ADD COLUMN device INTEGER');
}

function migrationV2(db) {
  ensureIndex(db, 'idx_expected_artists_artist_id', 'CREATE INDEX idx_expected_artists_artist_id ON expected_artists(artistId)');
  ensureIndex(db, 'idx_file_index_inode', 'CREATE INDEX idx_file_index_inode ON file_index(inodeKey)');
  ensureIndex(db, 'idx_file_index_hash', 'CREATE INDEX idx_file_index_hash ON file_index(fileHash)');
  ensureIndex(db, 'idx_expected_artists_artist_unique', 'CREATE UNIQUE INDEX idx_expected_artists_artist_unique ON expected_artists(artistId)');
  ensureIndex(db, 'idx_expected_albums_expected_artist_id', 'CREATE INDEX idx_expected_albums_expected_artist_id ON expected_albums(expectedArtistId)');
  ensureIndex(db, 'idx_expected_albums_release_group_unique', 'CREATE UNIQUE INDEX idx_expected_albums_release_group_unique ON expected_albums(expectedArtistId, mb_release_group_id)');
  ensureIndex(db, 'idx_expected_albums_normalized_title', 'CREATE INDEX idx_expected_albums_normalized_title ON expected_albums(expectedArtistId, normalizedTitle)');
  ensureIndex(db, 'idx_wishlist_status', 'CREATE INDEX idx_wishlist_status ON wishlist_albums(status)');
}

const MIGRATIONS = [migrationV1, migrationV2];

function runMigrations(db) {
  const startingVersion = readSchemaVersion(db);
  for (let index = startingVersion; index < MIGRATIONS.length; index += 1) {
    const migration = MIGRATIONS[index];
    const nextVersion = index + 1;
    db.transaction(() => {
      migration(db);
      setSchemaVersion(db, nextVersion);
    })();
  }
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
      scanMaxDepth INTEGER NOT NULL DEFAULT 4,
      scanIgnoreHiddenPaths INTEGER NOT NULL DEFAULT 1,
      scanGroupByFolder INTEGER NOT NULL DEFAULT 1,
      scanTreatArtistRootLooseTracksAsSingles INTEGER NOT NULL DEFAULT 1
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
      pathDir TEXT,
      albumKey TEXT,
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
  `);
  try {
    runMigrations(db);
  } catch (error) {
    throw wrapMigrationErrors(error);
  }

  db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
  db.prepare('INSERT OR IGNORE INTO scan_state (id) VALUES (1)').run();
  return db;
}

module.exports = {
  initDb,
  DB_PATH,
  ensureDataDirs,
  hasColumn,
  ensureColumn,
  ensureIndex,
  LATEST_SCHEMA_VERSION
};
