const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const APP_NAME = 'crate';
const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = '/app/data';
const STORE_FILE = path.join(DATA_DIR, 'items.json');

function isoNow() {
  return new Date().toISOString();
}

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ nextId: 1, items: [] }, null, 2));
  }
}

function readStore() {
  const raw = fs.readFileSync(STORE_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const nextId = Number(parsed.nextId) > 0 ? Number(parsed.nextId) : 1;
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return { nextId, items };
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html)
  });
  res.end(html);
}

function renderHome() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Crate</title>
  </head>
  <body>
    <main>
      <h1>Crate running</h1>
      <p>Timestamp: ${isoNow()}</p>
    </main>
  </body>
</html>`;
}

ensureStorage();

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      sendJson(res, 200, { ok: true, name: APP_NAME, ts: isoNow() });
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/') {
      sendHtml(res, 200, renderHome());
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/items') {
      const store = readStore();
      sendJson(res, 200, store.items);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/items') {
      const body = await readJsonBody(req);
      const title = typeof body.title === 'string' ? body.title.trim() : '';

      if (!title) {
        sendJson(res, 400, { error: 'title is required' });
        return;
      }

      const store = readStore();
      const item = {
        id: store.nextId,
        title,
        createdAt: isoNow()
      };
      store.nextId += 1;
      store.items.push(item);
      writeStore(store);
      sendJson(res, 201, item);
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  } catch (error) {
    if (error && error.message === 'Invalid JSON body') {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (error && error.message === 'Payload too large') {
      sendJson(res, 413, { error: 'Payload too large' });
      return;
    }
    console.error('request_error', error);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`${APP_NAME} listening on 0.0.0.0:${PORT}`);
});
