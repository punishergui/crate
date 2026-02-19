const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const APP_NAME = 'crate';
const APP_VERSION = process.env.APP_VERSION || require('./package.json').version;
const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = '/app/data';
const BOOT_LOG = path.join(DATA_DIR, 'boot.log');

function isoNow() {
  return new Date().toISOString();
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function writeText(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function ensureDataDirAndLogBoot() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const line = `[${isoNow()}] ${APP_NAME} booted (pid=${process.pid}, version=${APP_VERSION})\n`;
  fs.appendFileSync(BOOT_LOG, line, 'utf8');
}

ensureDataDirAndLogBoot();

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && reqUrl.pathname === '/health') {
    return writeJson(res, 200, {
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      time: isoNow()
    });
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/info') {
    return writeJson(res, 200, {
      name: APP_NAME,
      version: APP_VERSION,
      env: process.env.NODE_ENV || 'development',
      port: PORT,
      host: '10.0.10.10:4010',
      dataDir: DATA_DIR,
      time: isoNow()
    });
  }

  if (req.method === 'GET' && reqUrl.pathname === '/') {
    return writeText(res, 200, `Crate is running - ${isoNow()}`);
  }

  return writeJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`${APP_NAME} listening on 0.0.0.0:${PORT}`);
});
