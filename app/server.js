const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { URL } = require('url');

const APP_NAME = 'crate';
const APP_VERSION = process.env.APP_VERSION || require('./package.json').version;
const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = '/app/data';
const DB_FILE = path.join(DATA_DIR, 'crate.db');
const BOOT_LOG = path.join(DATA_DIR, 'boot.log');

function isoNow() {
  return new Date().toISOString();
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSql(sql, { expectRows = true } = {}) {
  const args = expectRows
    ? ['-header', '-tabs', DB_FILE, sql]
    : [DB_FILE, sql];
  const out = execFileSync('sqlite3', args, { encoding: 'utf8' });

  if (!expectRows) return [];
  const text = out.trim();
  if (!text) return [];

  const lines = text.split('\n');
  const headers = lines[0].split('\t');
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split('\t');
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? '';
    });
    return row;
  });
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function writeText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function ensureStorageAndDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const line = `[${isoNow()}] ${APP_NAME} booted (pid=${process.pid}, version=${APP_VERSION})\n`;
  fs.appendFileSync(BOOT_LOG, line, 'utf8');

  runSql('PRAGMA journal_mode=WAL;', { expectRows: false });
  runSql('PRAGMA foreign_keys=ON;', { expectRows: false });
  runSql(`
    CREATE TABLE IF NOT EXISTS crates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `, { expectRows: false });

  runSql(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crate_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('link', 'note')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(crate_id) REFERENCES crates(id) ON DELETE CASCADE
    );
  `, { expectRows: false });
}

ensureStorageAndDb();

function renderIndexHtml() { return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Crate MVP</title>
<style>
body{margin:0;font-family:Arial;background:#111827;color:#e5e7eb}.layout{display:grid;grid-template-columns:300px 1fr;height:100vh}
.sidebar{padding:16px;border-right:1px solid #374151;background:#0b1220;overflow:auto}.main{padding:16px;overflow:auto}
input,textarea,select,button{font:inherit;padding:8px;border-radius:6px;border:1px solid #4b5563}input,textarea,select{background:#1f2937;color:#fff}
button{background:#2563eb;color:#fff;border:none;cursor:pointer}.secondary{background:#374151}.crate-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1f2937}
.name{cursor:pointer;font-weight:600}.active{color:#60a5fa}.item{border:1px solid #374151;border-radius:8px;padding:12px;margin-bottom:10px}.pill{display:inline-block;border:1px solid #4b5563;border-radius:20px;padding:2px 8px;font-size:.75rem;margin-right:4px}
.muted{color:#9ca3af;font-size:.85rem}.error{color:#fca5a5}
</style></head>
<body><div class="layout"><aside class="sidebar"><h2>Crates</h2><form id="create-crate-form"><input id="crate-name" placeholder="New crate name" required/><button type="submit">Create crate</button></form><div id="crates"></div></aside>
<main class="main"><h1>Crate Items</h1><p class="muted" id="selected-crate-label">No crate selected.</p><section id="item-section" style="display:none;"><h3>Add item</h3><form id="create-item-form"><select id="item-type"><option value="note">note</option><option value="link">link</option></select><input id="item-title" placeholder="Title" required/><textarea id="item-content" placeholder="Content or URL" required rows="4"></textarea><input id="item-tags" placeholder="Tags (comma-separated)"/><button type="submit">Add item</button></form></section><p id="status" class="error"></p><section id="items"></section></main></div>
<script>
let selectedCrateId=null;const cratesEl=document.getElementById('crates'),itemsEl=document.getElementById('items'),statusEl=document.getElementById('status'),labelEl=document.getElementById('selected-crate-label'),itemSection=document.getElementById('item-section');
async function api(path,options={}){const res=await fetch(path,{headers:{'Content-Type':'application/json'},...options});if(!res.ok){let msg='Request failed';try{msg=(await res.json()).error||msg}catch(e){}throw new Error(msg)}return res.json()}
function showError(m=''){statusEl.textContent=m}
function renderSelectedCrate(c){if(!c){labelEl.textContent='No crate selected.';itemSection.style.display='none';return}labelEl.textContent='Selected crate: '+c.name;itemSection.style.display='block'}
async function loadCrates(){const crates=await api('/api/crates');cratesEl.innerHTML='';crates.forEach((crate)=>{const row=document.createElement('div');row.className='crate-row';const name=document.createElement('span');name.className='name'+(crate.id===selectedCrateId?' active':'');name.textContent=crate.name;name.onclick=()=>{selectedCrateId=crate.id;renderSelectedCrate(crate);loadCrates();loadItems()};const del=document.createElement('button');del.className='secondary';del.textContent='Delete';del.onclick=async()=>{if(!confirm('Delete crate and all items?'))return;await api('/api/crates/'+crate.id,{method:'DELETE'});if(selectedCrateId===crate.id){selectedCrateId=null;renderSelectedCrate(null)}await loadCrates();await loadItems()};row.append(name,del);cratesEl.appendChild(row)});if(!selectedCrateId&&crates[0]){selectedCrateId=crates[0].id;renderSelectedCrate(crates[0]);await loadItems()}else if(!crates.length){renderSelectedCrate(null);itemsEl.innerHTML='<p class="muted">No crates yet.</p>'}}
async function loadItems(){if(!selectedCrateId){itemsEl.innerHTML='';return}const items=await api('/api/crates/'+selectedCrateId+'/items');itemsEl.innerHTML='';if(!items.length){itemsEl.innerHTML='<p class="muted">No items in this crate yet.</p>';return}items.forEach((item)=>{const w=document.createElement('article');w.className='item';w.innerHTML='<div><span class="pill">'+item.type+'</span> <strong class="title"></strong> <button class="secondary" style="float:right">Delete</button></div><p class="muted"></p><p class="content"></p><div class="tags"></div>';w.querySelector('.title').textContent=item.title;w.querySelector('.muted').textContent=new Date(item.created_at+'Z').toLocaleString();w.querySelector('.content').textContent=item.content;const t=w.querySelector('.tags');(item.tags||'').split(',').map(x=>x.trim()).filter(Boolean).forEach((tag)=>{const p=document.createElement('span');p.className='pill';p.textContent=tag;t.appendChild(p)});w.querySelector('button').onclick=async()=>{await api('/api/items/'+item.id,{method:'DELETE'});await loadItems()};itemsEl.appendChild(w)})}

document.getElementById('create-crate-form').addEventListener('submit',async(e)=>{e.preventDefault();showError();const name=document.getElementById('crate-name').value.trim();if(!name)return;try{await api('/api/crates',{method:'POST',body:JSON.stringify({name})});document.getElementById('crate-name').value='';await loadCrates()}catch(err){showError(err.message)}});
document.getElementById('create-item-form').addEventListener('submit',async(e)=>{e.preventDefault();showError();if(!selectedCrateId)return;const payload={type:document.getElementById('item-type').value,title:document.getElementById('item-title').value.trim(),content:document.getElementById('item-content').value.trim(),tags:document.getElementById('item-tags').value.trim()};try{await api('/api/crates/'+selectedCrateId+'/items',{method:'POST',body:JSON.stringify(payload)});document.getElementById('item-title').value='';document.getElementById('item-content').value='';document.getElementById('item-tags').value='';await loadItems()}catch(err){showError(err.message)}});
loadCrates().catch((e)=>showError(e.message));
</script></body></html>`; }

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      const row = runSql('SELECT 1 AS ok;')[0];
      return writeJson(res, 200, { ok: true, app: APP_NAME, db: row?.ok === '1', dbFile: DB_FILE, time: isoNow() });
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/crates') {
      const rows = runSql('SELECT id, name, created_at, updated_at FROM crates ORDER BY name COLLATE NOCASE ASC;')
        .map((r) => ({ ...r, id: Number(r.id) }));
      return writeJson(res, 200, rows);
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/crates') {
      const body = await readJsonBody(req);
      const name = (body.name || '').trim();
      if (!name) return writeJson(res, 400, { error: 'name is required' });
      const exists = runSql(`SELECT id FROM crates WHERE name = ${q(name)} LIMIT 1;`)[0];
      if (exists) return writeJson(res, 409, { error: 'crate name already exists' });
      runSql(`INSERT INTO crates (name, created_at, updated_at) VALUES (${q(name)}, datetime('now'), datetime('now'));`, { expectRows: false });
      const crate = runSql(`SELECT id, name, created_at, updated_at FROM crates WHERE name = ${q(name)} ORDER BY id DESC LIMIT 1;`)[0];
      crate.id = Number(crate.id);
      return writeJson(res, 201, crate);
    }

    if (req.method === 'DELETE' && /^\/api\/crates\/\d+$/.test(reqUrl.pathname)) {
      const crateId = Number(reqUrl.pathname.split('/').pop());
      const crateExists = runSql(`SELECT id FROM crates WHERE id = ${crateId} LIMIT 1;`)[0];
      if (!crateExists) return writeJson(res, 404, { error: 'crate not found' });
      runSql('PRAGMA foreign_keys=ON;', { expectRows: false });
      runSql(`DELETE FROM crates WHERE id = ${crateId};`, { expectRows: false });
      return writeJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && /^\/api\/crates\/\d+\/items$/.test(reqUrl.pathname)) {
      const crateId = Number(reqUrl.pathname.split('/')[3]);
      const rows = runSql(`SELECT id, crate_id, type, title, content, tags, created_at, updated_at FROM items WHERE crate_id = ${crateId} ORDER BY datetime(created_at) DESC, id DESC;`)
        .map((r) => ({ ...r, id: Number(r.id), crate_id: Number(r.crate_id) }));
      return writeJson(res, 200, rows);
    }

    if (req.method === 'POST' && /^\/api\/crates\/\d+\/items$/.test(reqUrl.pathname)) {
      const crateId = Number(reqUrl.pathname.split('/')[3]);
      const crate = runSql(`SELECT id FROM crates WHERE id = ${crateId} LIMIT 1;`)[0];
      if (!crate) return writeJson(res, 404, { error: 'crate not found' });

      const body = await readJsonBody(req);
      const type = (body.type || '').trim();
      const title = (body.title || '').trim();
      const content = (body.content || '').trim();
      const tags = String(body.tags || '').trim();
      if (!['link', 'note'].includes(type)) return writeJson(res, 400, { error: 'type must be link or note' });
      if (!title) return writeJson(res, 400, { error: 'title is required' });
      if (!content) return writeJson(res, 400, { error: 'content is required' });

      runSql(`INSERT INTO items (crate_id, type, title, content, tags, created_at, updated_at) VALUES (${crateId}, ${q(type)}, ${q(title)}, ${q(content)}, ${q(tags)}, datetime('now'), datetime('now'));`, { expectRows: false });
      const item = runSql(`SELECT id, crate_id, type, title, content, tags, created_at, updated_at FROM items WHERE crate_id = ${crateId} ORDER BY id DESC LIMIT 1;`)[0];
      item.id = Number(item.id);
      item.crate_id = Number(item.crate_id);
      return writeJson(res, 201, item);
    }

    if (req.method === 'DELETE' && /^\/api\/items\/\d+$/.test(reqUrl.pathname)) {
      const itemId = Number(reqUrl.pathname.split('/').pop());
      const itemExists = runSql(`SELECT id FROM items WHERE id = ${itemId} LIMIT 1;`)[0];
      if (!itemExists) return writeJson(res, 404, { error: 'item not found' });
      runSql(`DELETE FROM items WHERE id = ${itemId};`, { expectRows: false });
      return writeJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/info') {
      return writeJson(res, 200, { name: APP_NAME, version: APP_VERSION, env: process.env.NODE_ENV || 'development', port: PORT, host: '10.0.10.10:4010', dataDir: DATA_DIR, dbFile: DB_FILE, time: isoNow() });
    }

    if (req.method === 'GET' && reqUrl.pathname === '/') {
      return writeText(res, 200, renderIndexHtml(), 'text/html; charset=utf-8');
    }

    return writeJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    console.error('request_error', err);
    return writeJson(res, 500, { error: 'Internal Server Error' });
  }
});

console.log(`Data dir path: ${DATA_DIR}`);
console.log(`DB file path: ${DB_FILE}`);
console.log(`Listening port: ${PORT}`);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`${APP_NAME} listening on 0.0.0.0:${PORT}`);
});
