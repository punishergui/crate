const crypto = require('node:crypto');
const { slugifyArtistName, shortHash } = require('../slug');

const LATEST_SCHEMA_VERSION = 3;

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row);
}

function columnExists(db, table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((entry) => entry.name === column);
}

function addColumnIfMissing(db, table, column, sqlTypeAndDefaultClause) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlTypeAndDefaultClause}`);
    return true;
  }
  return false;
}

function indexExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name);
  return Boolean(row);
}

function ensureIndex(db, name, ddl) {
  if (!indexExists(db, name)) {
    db.exec(ddl);
    return true;
  }
  return false;
}

function buildArtistSlug(db, name, rowId = null) {
  const base = slugifyArtistName(name);
  const rows = db.prepare('SELECT id, name, slug FROM artists WHERE slug = ?').all(base);
  if (rows.length === 0) return base;
  if (rows.some((row) => row.id === rowId)) return base;
  return `${base}-${shortHash(name).slice(0, 6)}`;
}

function ensureArtistSlugs(db) {
  addColumnIfMissing(db, 'artists', 'slug', 'TEXT');
  ensureIndex(db, 'idx_artists_slug_unique', 'CREATE UNIQUE INDEX idx_artists_slug_unique ON artists(slug)');

  const withoutSlug = db.prepare("SELECT id, name FROM artists WHERE slug IS NULL OR slug = ''").all();
  const updateSlug = db.prepare('UPDATE artists SET slug = ? WHERE id = ?');
  for (const artist of withoutSlug) {
    updateSlug.run(buildArtistSlug(db, artist.name, artist.id), artist.id);
  }
}

function normalizeCompareValue(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function createAlbumKeyFromData(artistName, title, year) {
  const keySrc = `${normalizeCompareValue(artistName)}::${normalizeCompareValue(title)}::${String(year || '').trim()}`;
  return crypto.createHash('sha1').update(keySrc).digest('hex');
}

function ensureMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

function getSchemaVersion(db) {
  ensureMetaTable(db);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  const parsed = Number.parseInt(row?.value ?? '', 10);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;

  const userVersion = db.pragma('user_version', { simple: true });
  if (Number.isInteger(userVersion) && userVersion > 0) {
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)").run(String(userVersion));
    return userVersion;
  }

  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '0')").run();
  return 0;
}

function setSchemaVersion(db, version) {
  ensureMetaTable(db);
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)").run(String(version));
  db.pragma(`user_version = ${version}`);
}

function migrationV1(db) {
  ensureArtistSlugs(db);
  addColumnIfMissing(db, 'albums', 'owned', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'albums', 'pathDir', 'TEXT');
  addColumnIfMissing(db, 'albums', 'albumKey', 'TEXT');
  ensureIndex(db, 'idx_albums_artist_deleted', 'CREATE INDEX idx_albums_artist_deleted ON albums(artistId, deleted)');
  ensureIndex(db, 'idx_albums_album_key_unique', 'CREATE UNIQUE INDEX idx_albums_album_key_unique ON albums(albumKey)');

  addColumnIfMissing(db, 'expected_albums', 'primaryType', 'TEXT');
  addColumnIfMissing(db, 'expected_albums', 'secondaryTypesJson', "TEXT NOT NULL DEFAULT '[]'");

  if (tableExists(db, 'expected_ignored')) {
    db.exec(`
      INSERT OR IGNORE INTO expected_ignored_albums (artistId, expectedAlbumId, createdAt)
      SELECT artistId, expectedAlbumId, createdAt
      FROM expected_ignored
    `);
    db.exec('DROP TABLE expected_ignored');
  }

  addColumnIfMissing(db, 'settings', 'lidarrEnabled', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'settings', 'lidarrBaseUrl', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'settings', 'lidarrApiKey', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'settings', 'lidarrQualityProfileId', 'INTEGER');
  addColumnIfMissing(db, 'settings', 'lidarrRootFolderPath', 'TEXT');
  addColumnIfMissing(db, 'settings', 'artworkPreferLocal', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'artworkAllowRemote', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'settings', 'artworkPreferEmbedded', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'artworkPreferFolder', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'artworkCacheEnabled', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'artworkDefaultSize', 'INTEGER NOT NULL DEFAULT 512');
  addColumnIfMissing(db, 'settings', 'artworkFolderFilenames', "TEXT NOT NULL DEFAULT 'cover,folder,front,album'");
  addColumnIfMissing(db, 'settings', 'scanMaxDepth', 'INTEGER NOT NULL DEFAULT 3');
  addColumnIfMissing(db, 'settings', 'scanIgnoreHiddenPaths', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'scanGroupByFolder', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'scanTreatArtistRootLooseTracksAsSingles', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'scanIncludeDiscSubfolders', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'scanIncludeSingles', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'settings', 'scanTreatCompilationAsSeparate', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'settings', 'scanIgnoreFolderNames', "TEXT NOT NULL DEFAULT '.crate,_tmp,@eaDir'");

  db.prepare(`UPDATE settings SET
    scanMaxDepth = COALESCE(scanMaxDepth, 3),
    scanIncludeDiscSubfolders = COALESCE(scanIncludeDiscSubfolders, 1),
    scanIncludeSingles = COALESCE(scanIncludeSingles, 1),
    scanIgnoreFolderNames = COALESCE(scanIgnoreFolderNames, '.crate,_tmp,@eaDir')
  WHERE id = 1`).run();

  addColumnIfMissing(db, 'scan_state', 'skippedFiles', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'scan_state', 'skippedReasonsJson', "TEXT NOT NULL DEFAULT '{}'");

  addColumnIfMissing(db, 'scan_skipped', 'ext', 'TEXT');
  addColumnIfMissing(db, 'scan_skipped', 'message', 'TEXT');
  addColumnIfMissing(db, 'scan_skipped', 'detailsJson', 'TEXT');
  ensureIndex(db, 'idx_scan_skipped_reason_created', 'CREATE INDEX idx_scan_skipped_reason_created ON scan_skipped(reason, createdAt DESC)');
  ensureIndex(db, 'idx_scan_skipped_ext', 'CREATE INDEX idx_scan_skipped_ext ON scan_skipped(ext)');

  addColumnIfMissing(db, 'file_index', 'lastSeenAt', 'TEXT');
  addColumnIfMissing(db, 'file_index', 'inode', 'INTEGER');
  addColumnIfMissing(db, 'file_index', 'device', 'INTEGER');
}

function migrationV2(db) {
  addColumnIfMissing(db, 'albums', 'albumKey', 'TEXT');

  const rows = db.prepare(`
    SELECT albums.id, artists.name AS artistName, albums.title, albums.albumKey
    FROM albums
    INNER JOIN artists ON artists.id = albums.artistId
    WHERE albums.albumKey IS NULL OR albums.albumKey = ''
  `).all();
  const update = db.prepare('UPDATE albums SET albumKey = ? WHERE id = ?');
  for (const row of rows) {
    update.run(createAlbumKeyFromData(row.artistName, row.title, ''), row.id);
  }

  ensureIndex(db, 'idx_albums_album_key_unique', 'CREATE UNIQUE INDEX idx_albums_album_key_unique ON albums(albumKey)');
  ensureIndex(db, 'idx_expected_artists_artist_id', 'CREATE INDEX idx_expected_artists_artist_id ON expected_artists(artistId)');
  ensureIndex(db, 'idx_file_index_inode', 'CREATE INDEX idx_file_index_inode ON file_index(inodeKey)');
  ensureIndex(db, 'idx_file_index_hash', 'CREATE INDEX idx_file_index_hash ON file_index(fileHash)');
  ensureIndex(db, 'idx_expected_artists_artist_unique', 'CREATE UNIQUE INDEX idx_expected_artists_artist_unique ON expected_artists(artistId)');
  ensureIndex(db, 'idx_expected_albums_expected_artist_id', 'CREATE INDEX idx_expected_albums_expected_artist_id ON expected_albums(expectedArtistId)');
  ensureIndex(db, 'idx_expected_albums_release_group_unique', 'CREATE UNIQUE INDEX idx_expected_albums_release_group_unique ON expected_albums(expectedArtistId, mb_release_group_id)');
  ensureIndex(db, 'idx_expected_albums_normalized_title', 'CREATE INDEX idx_expected_albums_normalized_title ON expected_albums(expectedArtistId, normalizedTitle)');
  ensureIndex(db, 'idx_wishlist_status', 'CREATE INDEX idx_wishlist_status ON wishlist_albums(status)');
}

function migrationV3(db) {
  addColumnIfMissing(db, 'albums', 'artworkSource', "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing(db, 'albums', 'artworkPath', 'TEXT');
  addColumnIfMissing(db, 'albums', 'artworkMtime', 'INTEGER');
  addColumnIfMissing(db, 'albums', 'artworkHash', 'TEXT');

  addColumnIfMissing(db, 'artists', 'artworkSource', "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing(db, 'artists', 'artworkPath', 'TEXT');
  addColumnIfMissing(db, 'artists', 'artworkMtime', 'INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS artwork_cache (
      key TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      mtime INTEGER,
      createdAt TEXT NOT NULL
    )
  `);

  db.exec(`
    UPDATE scan_skipped
    SET reason = CASE
      WHEN reason = 'missing tags' THEN 'missing_tags'
      WHEN reason = 'unsupported extension' THEN 'unsupported_extension'
      ELSE reason
    END
    WHERE reason IN ('missing tags', 'unsupported extension')
  `);
}

const MIGRATIONS = [migrationV1, migrationV2, migrationV3];

function repairCriticalSchema(db) {
  migrationV1(db);
  migrationV2(db);
  migrationV3(db);
}

function applyMigrations(db) {
  ensureMetaTable(db);
  const hasSchemaVersion = Boolean(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get());
  const startingVersion = hasSchemaVersion ? getSchemaVersion(db) : 0;
  for (let index = startingVersion; index < MIGRATIONS.length; index += 1) {
    const migration = MIGRATIONS[index];
    const nextVersion = index + 1;
    db.transaction(() => {
      migration(db);
      setSchemaVersion(db, nextVersion);
    })();
  }

  db.transaction(() => {
    repairCriticalSchema(db);
    setSchemaVersion(db, Math.max(getSchemaVersion(db), LATEST_SCHEMA_VERSION));
  })();
}

module.exports = {
  LATEST_SCHEMA_VERSION,
  applyMigrations,
  tableExists,
  columnExists,
  addColumnIfMissing,
  ensureIndex,
  getSchemaVersion,
  setSchemaVersion,
};
