const { slugifyArtistName, shortHash } = require('../slug');

const LATEST_SCHEMA_VERSION = 3;

const SETTINGS_COLUMN_DEFS = [
  { name: 'lidarrEnabled', clause: 'INTEGER NOT NULL DEFAULT 0', defaultExpr: '0' },
  { name: 'lidarrBaseUrl', clause: "TEXT NOT NULL DEFAULT ''", defaultExpr: "''" },
  { name: 'lidarrApiKey', clause: "TEXT NOT NULL DEFAULT ''", defaultExpr: "''" },
  { name: 'lidarrQualityProfileId', clause: 'INTEGER', defaultExpr: 'NULL' },
  { name: 'lidarrRootFolderPath', clause: 'TEXT', defaultExpr: 'NULL' },
  { name: 'artworkPreferLocal', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'artworkAllowRemote', clause: 'INTEGER NOT NULL DEFAULT 0', defaultExpr: '0' },
  { name: 'artworkPreferEmbedded', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'artworkPreferFolder', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'artworkCacheEnabled', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'artworkDefaultSize', clause: 'INTEGER NOT NULL DEFAULT 512', defaultExpr: '512' },
  { name: 'artworkFolderFilenames', clause: "TEXT NOT NULL DEFAULT 'cover,folder,front,album'", defaultExpr: "'cover,folder,front,album'" },
  { name: 'scanMaxDepth', clause: 'INTEGER NOT NULL DEFAULT 3', defaultExpr: '3' },
  { name: 'scanIgnoreHiddenPaths', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'scanGroupByFolder', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'scanTreatArtistRootLooseTracksAsSingles', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'scanIncludeDiscSubfolders', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'scanIncludeSingles', clause: 'INTEGER NOT NULL DEFAULT 1', defaultExpr: '1' },
  { name: 'scanTreatCompilationAsSeparate', clause: 'INTEGER NOT NULL DEFAULT 0', defaultExpr: '0' },
  { name: 'scanIgnoreFolderNames', clause: "TEXT NOT NULL DEFAULT '[]'", defaultExpr: "'[]'" },
];

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

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      appliedAt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ok', 'failed')),
      errorText TEXT
    )
  `);
}

function getMigrationRecords(db) {
  ensureMigrationsTable(db);
  return db.prepare('SELECT id, name, appliedAt, status, errorText FROM migrations ORDER BY id ASC').all();
}

function isMigrationOk(db, name) {
  const row = db.prepare('SELECT status FROM migrations WHERE name = ?').get(name);
  return row?.status === 'ok';
}

function recordMigration(db, name, status, errorText = null) {
  ensureMigrationsTable(db);
  db.prepare(`
    INSERT INTO migrations(name, appliedAt, status, errorText)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      appliedAt = excluded.appliedAt,
      status = excluded.status,
      errorText = excluded.errorText
  `).run(name, new Date().toISOString(), status, errorText);
}

function ensureSettingsColumns(db) {
  if (!tableExists(db, 'settings')) return { added: [], healed: [] };

  const added = [];
  for (const def of SETTINGS_COLUMN_DEFS) {
    if (addColumnIfMissing(db, 'settings', def.name, def.clause)) {
      added.push(def.name);
    }
  }

  const present = new Set(db.prepare('PRAGMA table_info(settings)').all().map((row) => row.name));
  const healingTargets = SETTINGS_COLUMN_DEFS.filter((def) => present.has(def.name));
  if (healingTargets.length === 0) return { added, healed: [] };

  const setClause = healingTargets.map((def) => `${def.name} = COALESCE(${def.name}, ${def.defaultExpr})`).join(',\n    ');
  db.prepare(`UPDATE settings SET ${setClause}`).run();

  return { added, healed: healingTargets.map((def) => def.name) };
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

function normalizeKey(value) {
  return normalizeCompareValue(value);
}

function computeAlbumKeyBase(artistName, title, year) {
  return `${normalizeKey(artistName)}::${normalizeKey(title)}::${String(year || '').trim()}`;
}

function logAlbumKeyDuplicates(db, label) {
  const duplicates = db.prepare(`
    SELECT albumKey, COUNT(*) AS count
    FROM albums
    WHERE albumKey IS NOT NULL AND albumKey != ''
    GROUP BY albumKey
    HAVING count > 1
    ORDER BY count DESC, albumKey ASC
    LIMIT 20
  `).all();
  if (duplicates.length > 0) {
    console.warn(`[migrations] ${label}: top ${duplicates.length} duplicate albumKey values: ${duplicates.map((row) => `${row.albumKey}(${row.count})`).join(', ')}`);
  }
  return duplicates;
}

function ensureUniqueAlbumKeys(db) {
  const hasYear = columnExists(db, 'albums', 'year');
  const selectSql = `
    SELECT albums.id, artists.name AS artistName, albums.title, albums.albumKey, ${hasYear ? 'albums.year AS year' : "'' AS year"}
    FROM albums
    LEFT JOIN artists ON artists.id = albums.artistId
    ORDER BY albums.id ASC
  `;
  const rows = db.prepare(selectSql).all();
  const used = new Map();
  const updates = [];

  for (const row of rows) {
    const existingKey = String(row.albumKey || '').trim();
    const baseKey = computeAlbumKeyBase(row.artistName, row.title, row.year);
    const preferredKey = existingKey || baseKey;
    const suffixBase = preferredKey || baseKey || 'album';
    let candidate = preferredKey || `${suffixBase}::${row.id}`;

    if (used.has(candidate) && used.get(candidate) !== row.id) {
      candidate = `${suffixBase}::${row.id}`;
      let bump = 1;
      while (used.has(candidate) && used.get(candidate) !== row.id) {
        bump += 1;
        candidate = `${suffixBase}::${row.id}::${bump}`;
      }
    }

    used.set(candidate, row.id);
    if (candidate !== existingKey) {
      updates.push({ id: row.id, albumKey: candidate });
    }
  }

  const updateKey = db.prepare('UPDATE albums SET albumKey = ? WHERE id = ?');
  for (const entry of updates) {
    updateKey.run(entry.albumKey, entry.id);
  }

  return updates.length;
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

  ensureSettingsColumns(db);

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
  try {
    addColumnIfMissing(db, 'albums', 'albumKey', 'TEXT');

    const beforeDuplicates = logAlbumKeyDuplicates(db, 'before albumKey repair');
    if (beforeDuplicates.length > 0 && indexExists(db, 'idx_albums_album_key_unique')) {
      db.exec('DROP INDEX IF EXISTS idx_albums_album_key_unique');
      console.warn('[migrations] dropped idx_albums_album_key_unique before repairing duplicate albumKey values');
    }

    const repairedCount = ensureUniqueAlbumKeys(db);
    const afterDuplicates = logAlbumKeyDuplicates(db, 'after albumKey repair');
    console.info(`[migrations] repaired ${repairedCount} albumKey collisions/backfills`);

    if (afterDuplicates.length === 0) {
      ensureIndex(db, 'idx_albums_album_key_unique', 'CREATE UNIQUE INDEX idx_albums_album_key_unique ON albums(albumKey)');
    } else {
      console.error('[migrations] albumKey duplicates still present after repair; leaving unique index uncreated (safe mode)');
    }
  } catch (error) {
    console.error(`[migrations] migrationV2 safe mode: failed to fully repair albumKey values; continuing without enforcing unique index. ${error.message || error}`);
  }

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

const MIGRATIONS = [
  { name: 'migration_v1', run: migrationV1 },
  { name: 'migration_v2', run: migrationV2 },
  { name: 'migration_v3', run: migrationV3 },
];

function applyMigrations(db, options = {}) {
  ensureMetaTable(db);
  ensureMigrationsTable(db);

  const migrationList = options.migrations || MIGRATIONS;
  const migrationErrors = [];

  for (let index = 0; index < migrationList.length; index += 1) {
    const migration = migrationList[index];
    const nextVersion = index + 1;
    if (isMigrationOk(db, migration.name)) {
      setSchemaVersion(db, Math.max(getSchemaVersion(db), nextVersion));
      continue;
    }

    try {
      db.transaction(() => {
        migration.run(db);
        ensureSettingsColumns(db);
        setSchemaVersion(db, nextVersion);
        recordMigration(db, migration.name, 'ok', null);
      })();
    } catch (error) {
      const errorText = error?.stack || error?.message || String(error);
      console.error(`[migrations] ${migration.name} failed`, error);
      recordMigration(db, migration.name, 'failed', errorText);
      migrationErrors.push({ name: migration.name, error: errorText });
    }
  }

  try {
    ensureSettingsColumns(db);
    setSchemaVersion(db, Math.max(getSchemaVersion(db), LATEST_SCHEMA_VERSION));
  } catch (error) {
    const errorText = error?.stack || error?.message || String(error);
    console.error('[migrations] post-migration schema repair failed', error);
    migrationErrors.push({ name: 'post_migration_schema_repair', error: errorText });
  }

  return {
    degraded: migrationErrors.length > 0,
    migrationErrors,
    schemaVersion: getSchemaVersion(db),
    migrations: getMigrationRecords(db),
  };
}

module.exports = {
  LATEST_SCHEMA_VERSION,
  SETTINGS_COLUMN_DEFS,
  applyMigrations,
  tableExists,
  columnExists,
  addColumnIfMissing,
  ensureIndex,
  normalizeKey,
  computeAlbumKeyBase,
  ensureUniqueAlbumKeys,
  migrationV2,
  getSchemaVersion,
  setSchemaVersion,
  ensureMigrationsTable,
  getMigrationRecords,
  ensureSettingsColumns,
  indexExists,
};
