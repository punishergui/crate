const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { ArtworkService } = require('../server/artwork');

function dbForArtwork(tmpDir) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY,
      artworkPreferEmbedded INTEGER,
      artworkPreferFolder INTEGER,
      artworkAllowRemote INTEGER,
      artworkCacheEnabled INTEGER,
      artworkDefaultSize INTEGER,
      artworkFolderFilenames TEXT
    );
    INSERT INTO settings(id, artworkPreferEmbedded, artworkPreferFolder, artworkAllowRemote, artworkCacheEnabled, artworkDefaultSize, artworkFolderFilenames)
    VALUES(1, 1, 1, 0, 1, 512, 'cover,folder,front,album');
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT, deleted INTEGER DEFAULT 0);
    CREATE TABLE albums (id INTEGER PRIMARY KEY, artistId INTEGER, title TEXT, path TEXT, deleted INTEGER DEFAULT 0, lastFileMtime INTEGER);
    CREATE TABLE tracks (id INTEGER PRIMARY KEY, albumId INTEGER, path TEXT, deleted INTEGER DEFAULT 0);
    CREATE TABLE album_art (albumId INTEGER PRIMARY KEY, source TEXT, originalPath TEXT, remoteUrl TEXT, etag TEXT, lastFetchedAt INTEGER, hash TEXT, width INTEGER, height INTEGER);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, payloadJson TEXT, status TEXT, createdAt INTEGER, startedAt INTEGER, finishedAt INTEGER, error TEXT);
  `);
  db.prepare('INSERT INTO artists(id, name, deleted) VALUES(1, ?, 0)').run('Test Artist');
  db.prepare('INSERT INTO albums(id, artistId, title, path, deleted) VALUES(1, 1, ?, ?, 0)').run('Test Album', tmpDir);
  return db;
}

test('diagnoseAlbum returns placeholder when no local art exists', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-artwork-'));
  const db = dbForArtwork(tmp);
  const service = new ArtworkService(db, { error() {} });
  clearInterval(service.timer);

  const diag = await service.diagnoseAlbum(1, { size: 512 });
  assert.equal(diag.resolved, true);
  assert.equal(diag.bestSource, 'placeholder');
  assert.equal(fs.existsSync(diag.filePath), true);
});
