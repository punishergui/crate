import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';

registerSW({ immediate: true });

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

const api = {
  get: (url) => request(url),
  put: (url, body) => request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  post: (url, body = {}) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
};

function AppCard({ title, actions, children, className = '' }) {
  return <section className={`app-card ${className}`}>
    <header className="card-top"><h2>{title}</h2><div>{actions}</div></header>
    <div>{children}</div>
  </section>;
}

function TopBar({ scanStatus, onScan }) {
  return <header className="top-bar">
    <button onClick={onScan}>Scan</button>
    <input className="search" placeholder="Search artists, albums, tracks" />
    <div className="status-pill">{scanStatus?.status || 'idle'} · {scanStatus?.currentPath ? 'scanning' : 'ready'}</div>
    <button title="Notifications">🔔</button>
    <Link to="/settings">⚙️</Link>
  </header>;
}

function Dashboard() {
  const [data, setData] = React.useState();
  React.useEffect(() => { api.get('/api/dashboard').then(setData).catch(() => setData(null)); }, []);

  return <div className="dashboard-grid">
    <div className="col-left">
      <AppCard title="Concerts Near You"><ul><li>Connect your event provider to populate shows.</li></ul></AppCard>
      <AppCard title="Recent Activity"><ul>{(data?.recent || []).slice(0, 8).map((a) => <li key={a.id}>{a.artistName} — {a.title}</li>)}</ul></AppCard>
    </div>
    <div className="col-right">
      <AppCard title="New Releases" className="feature-card"><div className="album-grid">{(data?.recent || []).slice(0, 8).map((a) => <AlbumTile key={a.id} album={a} />)}</div></AppCard>
      <div className="mini-grid">
        <AppCard title="Library Overview"><p>{data?.stats?.artists ?? '-'} artists · {data?.stats?.albums ?? '-'} albums · {data?.stats?.tracks ?? '-'} tracks</p></AppCard>
        <AppCard title="Missing Albums"><p>{data?.missingTotal ?? 0}</p></AppCard>
        <AppCard title="Downloads"><p>No active downloads</p></AppCard>
      </div>
    </div>
  </div>;
}

function AlbumTile({ album, onToggleOwned }) {
  return <article className="album-tile">
    <div className="artwork" />
    <div className="tile-meta"><strong>{album.title}</strong><span>{album.artistName}</span></div>
    <div className="tile-hover">
      <button>Play</button>
      <Link to={`/artist/${album.artistSlug || album.artistId}`}>Open</Link>
      {onToggleOwned ? <button onClick={() => onToggleOwned(album.id, !album.owned)}>{album.owned ? 'Mark Missing' : 'Mark Owned'}</button> : null}
    </div>
  </article>;
}

function Collection() {
  const [q, setQ] = React.useState('');
  const [ownedFilter, setOwnedFilter] = React.useState('all');
  const [list, setList] = React.useState({ items: [] });
  const load = React.useCallback(() => {
    const ownedQuery = ownedFilter === 'all' ? '' : `&owned=${ownedFilter}`;
    api.get(`/api/library/albums?search=${encodeURIComponent(q)}&page=1&pageSize=60${ownedQuery}`).then(setList);
  }, [ownedFilter, q]);
  React.useEffect(() => { load(); }, [load]);

  const toggleOwned = async (id, owned) => {
    await api.put(`/api/library/albums/${id}/owned`, { owned });
    load();
  };

  return <section>
    <h1>Collection</h1>
    <div className="filters">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist or album" />
      <select><option>Artist</option></select><select><option>Format</option></select><select><option>Year</option></select>
      <button onClick={() => setOwnedFilter('1')}>Owned</button><button onClick={() => setOwnedFilter('0')}>Missing</button><button onClick={() => setOwnedFilter('all')}>All</button>
    </div>
    <div className="album-grid">{list.items.map((a) => <AlbumTile key={a.id} album={a} onToggleOwned={toggleOwned} />)}</div>
  </section>;
}

function ArtistPage() {
  const { artistKey } = useParams();
  const navigate = useNavigate();
  const [data, setData] = React.useState();
  const [summary, setSummary] = React.useState();
  const [status, setStatus] = React.useState('');

  React.useEffect(() => {
    (async () => {
      let artist;
      if (/^\d+$/.test(String(artistKey))) {
        const legacy = await api.get(`/api/library/artists/${artistKey}`);
        navigate(`/artist/${legacy.artist.slug || legacy.artist.id}`, { replace: true });
        artist = legacy.artist;
      } else {
        artist = await api.get(`/api/artist/by-slug/${encodeURIComponent(artistKey)}`);
      }
      setData(await api.get(`/api/artist/${artist.id}/overview`));
      setSummary(await api.get(`/api/expected/artist/${artist.id}/summary`).catch(() => null));
    })().catch((e) => setStatus(e.message));
  }, [artistKey, navigate]);

  const deepRescan = async () => {
    if (!data?.artist?.id) return;
    const response = await api.post(`/api/artist/${data.artist.id}/scan/deep`, { recursive: true, maxDepth: 6 });
    setStatus(response.started ? 'Deep rescan started.' : 'Scan already running.');
  };

  if (!data) return <section>{status || 'Loading...'}</section>;
  return <section>
    <div className="artist-hero"><h1>{data.artist.name}</h1><p>Owned {summary?.ownedCount ?? data.owned.length} · Missing {summary?.missingCount ?? 0}</p><button onClick={deepRescan}>Deep Rescan</button></div>
    {status ? <p>{status}</p> : null}
    <AppCard title="Albums"><div className="album-grid">{data.owned.map((a) => <AlbumTile key={a.id} album={{ ...a, artistName: data.artist.name, artistSlug: data.artist.slug }} />)}</div></AppCard>
    <div className="mini-grid">
      <AppCard title="Missing Albums"><ul>{(summary?.missingAlbums || []).slice(0, 20).map((a) => <li key={a.id}>{a.title}</li>)}</ul></AppCard>
      <AppCard title="Upcoming Shows"><p>No shows connected yet.</p></AppCard>
    </div>
  </section>;
}

function ScanSettings({ settings, setSettings }) {
  const [scan, setScan] = React.useState();
  const [skipped, setSkipped] = React.useState([]);
  const [maxDepth, setMaxDepth] = React.useState(4);
  const [deep, setDeep] = React.useState(true);

  React.useEffect(() => {
    const tick = async () => {
      setScan(await api.get('/api/scan/status'));
      setSkipped(await api.get('/api/scan/skipped?limit=200').catch(() => []));
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  const startScan = () => api.post('/api/scan/start', { recursive: deep, maxDepth }).then((v) => setScan(v.status));
  const save = async () => setSettings(await api.put('/api/settings', settings));

  return <section>
    <h1>Library Settings</h1>
    <div className="mini-grid">
      <AppCard title="Scanner">
        <label><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Deep Scan</label>
        <label>Max depth <input type="number" min="1" max="20" value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} /></label>
        <button onClick={startScan}>Normal Scan</button>
        <button onClick={() => api.post('/api/scan/cancel').then((v) => setScan(v.status))}>Cancel</button>
      </AppCard>
      <AppCard title="Appearance">
        <label>Accent <input value={settings?.accentColor || ''} onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })} /></label>
        <label><input type="checkbox" checked={Boolean(settings?.noiseOverlay)} onChange={(e) => setSettings({ ...settings, noiseOverlay: e.target.checked })} /> Grain overlay</label>
        <button onClick={save}>Save</button>
      </AppCard>
    </div>
    <AppCard title="Live Scan Progress"><pre>{JSON.stringify(scan, null, 2)}</pre></AppCard>
    <AppCard title="Skipped Files"><ul>{skipped.map((s) => <li key={s.id}>{s.reason}: {s.path}</li>)}</ul></AppCard>
  </section>;
}

function Placeholder({ title }) { return <section><h1>{title}</h1><p>Coming soon.</p></section>; }

function App() {
  const [settings, setSettings] = React.useState();
  const [scanStatus, setScanStatus] = React.useState();
  React.useEffect(() => { api.get('/api/settings').then(setSettings); }, []);
  React.useEffect(() => {
    const tick = () => api.get('/api/scan/status').then(setScanStatus).catch(() => null);
    tick();
    const id = setInterval(tick, 2500);
    return () => clearInterval(id);
  }, []);

  const startQuickScan = () => api.post('/api/scan/start', { recursive: true, maxDepth: 3 }).then((v) => setScanStatus(v.status));

  return <div className={settings?.noiseOverlay ? 'app-shell noise' : 'app-shell'} style={{ '--accent': settings?.accentColor || '#FF6A00' }}>
    <aside className="sidebar">
      <NavLink to="/">Dashboard</NavLink>
      <NavLink to="/collection">Collection</NavLink>
      <NavLink to="/discover">Discover</NavLink>
      <NavLink to="/releases">Releases</NavLink>
      <NavLink to="/concerts">Concerts</NavLink>
      <NavLink to="/wishlist">Wishlist</NavLink>
      <NavLink to="/settings">Settings</NavLink>
    </aside>
    <main className="content">
      <TopBar scanStatus={scanStatus} onScan={startQuickScan} />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/discover" element={<Placeholder title="Discover" />} />
        <Route path="/releases" element={<Placeholder title="Releases" />} />
        <Route path="/concerts" element={<Placeholder title="Concerts" />} />
        <Route path="/wishlist" element={<Placeholder title="Wishlist" />} />
        <Route path="/artist/:artistKey" element={<ArtistPage />} />
        <Route path="/settings" element={<ScanSettings settings={settings} setSettings={setSettings} />} />
      </Routes>
    </main>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>
);
