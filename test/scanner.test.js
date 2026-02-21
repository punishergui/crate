const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { Scanner, collectArtistTracks, parseMp3Id3v1 } = require('../server/scanner');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY, lastScanAt TEXT);
    INSERT INTO settings(id, lastScanAt) VALUES(1, NULL);
    CREATE TABLE scan_state (
      id INTEGER PRIMARY KEY,
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
    INSERT INTO scan_state(id) VALUES(1);
    CREATE TABLE artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
      deleted INTEGER NOT NULL DEFAULT 0,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL
    );
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
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      albumId INTEGER NOT NULL,
      path TEXT NOT NULL UNIQUE,
      ext TEXT NOT NULL,
      mtime INTEGER,
      lastSeen TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE file_index (
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
    CREATE TABLE scan_skipped (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanStartedAt TEXT NOT NULL,
      filePath TEXT NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL
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
  return db;
}

function writeMp3WithId3v1(filePath, { title, artist, album, year }) {
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
  const tag = Buffer.alloc(128, 0);
  tag.write('TAG', 0, 'ascii');
  Buffer.from(String(title || '').slice(0, 30), 'latin1').copy(tag, 3);
  Buffer.from(String(artist || '').slice(0, 30), 'latin1').copy(tag, 33);
  Buffer.from(String(album || '').slice(0, 30), 'latin1').copy(tag, 63);
  Buffer.from(String(year || '').slice(0, 4), 'latin1').copy(tag, 93);
  fs.writeFileSync(filePath, Buffer.concat([audio, tag]));
}

test('collectArtistTracks recursively finds files in artist/album folders', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-scanner-'));
  const artistDir = path.join(tmp, 'New Found Glory');
  const albumDir = path.join(artistDir, 'Waiting (1998)');
  fs.mkdirSync(albumDir, { recursive: true });
  writeMp3WithId3v1(path.join(albumDir, '01-intro.mp3'), { title: 'Intro', artist: 'New Found Glory', album: 'Waiting', year: '1998' });

  const tracks = collectArtistTracks(artistDir, { recursive: true, maxDepth: 3 });
  assert.equal(tracks.length, 1);
  assert.match(tracks[0].path, /Waiting \(1998\).*01-intro\.mp3$/);
});

test('parseMp3Id3v1 reads album/artist tags for grouping', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-id3-'));
  const file = path.join(tmp, 'track.mp3');
  writeMp3WithId3v1(file, { title: 'Head on Collision', artist: 'New Found Glory', album: 'Sticks and Stones', year: '2002' });

  const tags = parseMp3Id3v1(file);
  assert.equal(tags.album, 'Sticks and Stones');
  assert.equal(tags.artist, 'New Found Glory');
  assert.equal(tags.year, '2002');
});

test('scanner imports nested artist/album mp3 using tags', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-scan-'));
  const artistDir = path.join(tmp, 'New Found Glory');
  const albumDir = path.join(artistDir, 'Waiting (1998)');
  fs.mkdirSync(albumDir, { recursive: true });
  writeMp3WithId3v1(path.join(albumDir, '01-something-i-call-personality.mp3'), {
    title: 'Something I Call Personality',
    artist: 'New Found Glory',
    album: 'Waiting',
    year: '1998'
  });

  const db = createTestDb();
  const scanner = new Scanner(db);
  await scanner.runScan(tmp, { recursive: true, maxDepth: 4 });

  const album = db.prepare('SELECT title, trackCount FROM albums WHERE deleted = 0').get();
  assert.ok(album);
  assert.equal(album.title, 'Waiting');
  assert.equal(album.trackCount, 1);
});


test('scanner dedupes duplicate hardlinks and records skipped reason breakdown', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-scan-dupe-'));
  const artistDir = path.join(tmp, 'New Found Glory');
  const albumDir = path.join(artistDir, 'Waiting (1998)');
  fs.mkdirSync(albumDir, { recursive: true });

  const source = path.join(albumDir, '01-track.mp3');
  writeMp3WithId3v1(source, { title: 'Track', artist: 'New Found Glory', album: 'Waiting', year: '1998' });
  const dupe = path.join(artistDir, '01-track-hardlink.mp3');
  fs.linkSync(source, dupe);

  const db = createTestDb();
  const scanner = new Scanner(db);
  await scanner.runScan(tmp, { recursive: true, maxDepth: 4 });

  const trackCount = db.prepare('SELECT COUNT(*) AS c FROM tracks WHERE deleted = 0').get().c;
  assert.equal(trackCount, 1);

  const status = scanner.getStatus();
  assert.equal(status.skippedFiles, 1);
  assert.equal(status.skippedReasonsBreakdown.duplicate, 1);
});
