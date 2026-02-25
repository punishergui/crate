const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('server did not become ready in time'));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

test('health endpoint reports degraded mode when a migration fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-health-degraded-'));
  const dbPath = path.join(tmpDir, 'health.sqlite');

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted INTEGER NOT NULL DEFAULT 0,
      firstSeen TEXT NOT NULL,
      lastSeen TEXT NOT NULL
    );
  `);
  db.close();

  const port = 46100 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      CRATE_DB_PATH: dbPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}/health`);
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.degraded, true);
    assert.ok(Array.isArray(payload.migrationErrors));
    assert.ok(payload.migrationErrors.length >= 1);
  } finally {
    child.kill('SIGTERM');
  }
});
