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

const ARTWORK_PLACEHOLDER = '/artwork-placeholder.svg';

function artworkUrl(albumId, size = 512) {
  return `/api/artwork/album/${albumId}?size=${size}`;
}

const THEMES = [
  { id: 'neon-djent', name: 'Neon Djent', description: 'Industrial black with LED orange accents.' },
  { id: 'ice', name: 'Ice', description: 'Cold steel blue contrast for night sessions.' },
  { id: 'worship', name: 'Worship', description: 'Warm gold highlights with soft dark surfaces.' },
  { id: 'country', name: 'Country', description: 'Dark wood and brass-inspired tones.' }
];

function AppCard({ title, actions, children, className = 'card-solid' }) {
  return <section className={`app-card ${className}`}>
    <header className="card-top"><h2>{title}</h2><div>{actions}</div></header>
    <div>{children}</div>
  </section>;
}

function TopBar({ scanStatus, onScan }) {
  return <header className="top-bar">
    <div className="status-pill"><span className={`status-dot ${scanStatus?.status === 'running' ? 'live' : ''}`} />{scanStatus?.status || 'idle'}</div>
    <input className="search" placeholder="SEARCH ARTISTS, ALBUMS, TRACKS" />
    <button className="scan-led" onClick={onScan}>SCAN</button>
    <Link to="/settings" className="icon-link">⚙</Link>
  </header>;
}

function AlbumTile({ album, onToggleOwned, size = 512 }) {
  return <article className="album-tile">
    <img className="artwork" src={artworkUrl(album.id, size)} alt={`${album.title} cover`} loading="lazy" onError={(e) => {
      e.currentTarget.onerror = null;
      e.currentTarget.src = ARTWORK_PLACEHOLDER;
    }} />
    <div className="tile-meta"><strong>{album.title}</strong><span>{album.artistName}</span></div>
    <div className="tile-hover">
      <button>Play</button>
      <Link to={`/artist/${album.artistSlug || album.artistId}`}>Open</Link>
      {onToggleOwned ? <button onClick={() => onToggleOwned(album.id, !album.owned)}>{album.owned ? 'Missing' : 'Owned'}</button> : null}
    </div>
  </article>;
}

function Dashboard() {

  const [data, setData] = React.useState();
  React.useEffect(() => { api.get('/api/dashboard').then(setData).catch(() => setData(null)); }, []);

  return <div className="dashboard-grid">
    <div className="col-left">
      <AppCard title="Concerts" className="panel-metal"><ul><li>Connect event provider to populate shows.</li></ul></AppCard>
      <AppCard title="Recent Activity" className="card-soft"><div className="recent-cards">{(data?.recent || []).slice(0, 8).map((a) => <AlbumTile key={a.id} album={a} size={256} />)}</div></AppCard>
    </div>
    <div className="col-right">
      <AppCard title="New Releases" className="card-solid"><div className="album-grid">{(data?.recent || []).slice(0, 8).map((a) => <AlbumTile key={a.id} album={a} />)}</div></AppCard>
      <div className="mini-grid">
        <AppCard title="Library Overview" className="card-soft"><p>{data?.stats?.artists ?? '-'} artists · {data?.stats?.albums ?? '-'} albums · {data?.stats?.tracks ?? '-'} tracks</p></AppCard>
        <AppCard title="Missing Albums" className="card-soft"><ul className="missing-list">{(data?.missing || []).slice(0, 6).map((item, idx) => <li key={`${item.artistId}-${item.title}-${idx}`}><img src={ARTWORK_PLACEHOLDER} alt="missing album" /><span>{item.artistName} — {item.title}</span></li>)}</ul><p>{data?.missingTotal ?? 0} total</p></AppCard>
        <AppCard title="Downloads" className="card-soft"><p>No active downloads</p></AppCard>
      </div>
    </div>
  </div>;
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

  const toggleOwned = async (id, owned) => { await api.put(`/api/library/albums/${id}/owned`, { owned }); load(); };

  return <section>
    <h1>Collection</h1>
    <div className="filters inline-filters">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist or album" />
      <button onClick={() => setOwnedFilter('1')}>Owned</button><button onClick={() => setOwnedFilter('0')}>Missing</button><button onClick={() => setOwnedFilter('all')}>All</button>
    </div>
    <div className="album-grid collection-grid">{list.items.map((a) => <AlbumTile key={a.id} album={a} onToggleOwned={toggleOwned} />)}</div>
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
    const response = await api.post(`/api/scan/artist/${data.artist.id}/deep`, { recursive: true, maxDepth: 6 });
    setStatus(response.started ? 'Deep scan started.' : 'Scan already running.');
  };

  if (!data) return <section>{status || 'Loading...'}</section>;
  return <section>
    <div className="artist-hero panel-metal">
      <h1>{data.artist.name}</h1><p>Owned {summary?.ownedCount ?? data.owned.length} · Missing {summary?.missingCount ?? 0}</p>
      <button className="scan-led" onClick={deepRescan}>DEEP SCAN</button>
    </div>
    {status ? <p>{status}</p> : null}
    <AppCard title="Albums"><div className="album-grid collection-grid">{data.owned.map((a) => <AlbumTile key={a.id} album={{ ...a, artistName: data.artist.name, artistSlug: data.artist.slug }} />)}</div></AppCard>
  </section>;
}

function ThemesTab({ activeTheme, onThemeChange }) {
  return <div className="themes-grid">{THEMES.map((theme) => <button key={theme.id} className={`theme-card ${activeTheme === theme.id ? 'active' : ''}`} onClick={() => onThemeChange(theme.id)}>
    <div className="swatch" data-theme-preview={theme.id} />
    <strong>{theme.name}</strong>
    <p>{theme.description}</p>
  </button>)}</div>;
}


function LibraryArtworkSettings({ settings, setSettings, save }) {
  const [jobStatus, setJobStatus] = React.useState({ queued: 0, running: 0, done: 0, error: 0 });
  React.useEffect(() => {
    const tick = () => api.get('/api/artwork/status').then(setJobStatus).catch(() => null);
    tick();
    const id = setInterval(tick, 2500);
    return () => clearInterval(id);
  }, []);

  return <AppCard title="Library" className="card-soft">
    <p>Path: {settings?.libraryPath || '-'}</p>
    <label><input type="checkbox" checked={Boolean(settings?.artworkPreferLocal)} onChange={(e) => setSettings({ ...settings, artworkPreferLocal: e.target.checked })} /> Prefer local artwork</label>
    <label><input type="checkbox" checked={Boolean(settings?.artworkAllowRemote)} onChange={(e) => setSettings({ ...settings, artworkAllowRemote: e.target.checked })} /> Allow remote artwork</label>
    <div className="inline-filters">
      <button onClick={save}>Save artwork settings</button>
      <button onClick={() => api.post('/api/artwork/refresh-all')}>Refresh all artwork</button>
    </div>
    <p>Jobs — queued: {jobStatus.queued} · running: {jobStatus.running} · done: {jobStatus.done} · error: {jobStatus.error}</p>
  </AppCard>;
}

function ScanSettings({ settings, setSettings }) {
  const [tab, setTab] = React.useState('general');
  const [scan, setScan] = React.useState();
  const [skipped, setSkipped] = React.useState([]);
  const [maxDepth, setMaxDepth] = React.useState(4);
  const [deep, setDeep] = React.useState(true);
  const [activeTheme, setActiveTheme] = React.useState(window.CRATE_THEME?.get?.() || 'neon-djent');

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
  const applyTheme = (themeId) => { window.CRATE_THEME?.apply?.(themeId); setActiveTheme(themeId); };

  return <section>
    <h1>Settings</h1>
    <nav className="settings-tabs">
      {['general', 'library', 'scanner', 'themes', 'about'].map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t.toUpperCase()}</button>)}
    </nav>

    {tab === 'general' ? <AppCard title="General" className="card-soft"><p>General app preferences.</p></AppCard> : null}
    {tab === 'library' ? <LibraryArtworkSettings settings={settings} setSettings={setSettings} save={save} /> : null}
    {tab === 'about' ? <AppCard title="About" className="card-soft"><p>CRATE PWA</p></AppCard> : null}

    {tab === 'scanner' ? <>
      <div className="mini-grid">
        <AppCard title="Scanner" className="panel-metal">
          <label><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Deep Scan</label>
          <label>Max depth <input type="number" min="1" max="20" value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} /></label>
          <button className="scan-led" onClick={startScan}>Normal Scan</button>
          <button onClick={() => api.post('/api/scan/cancel').then((v) => setScan(v.status))}>Cancel</button>
        </AppCard>
        <AppCard title="Appearance" className="card-soft">
          <label>Accent <input value={settings?.accentColor || ''} onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })} /></label>
          <button onClick={save}>Save</button>
        </AppCard>
      </div>
      <AppCard title="Live Progress" className="card-solid"><pre>{JSON.stringify(scan, null, 2)}</pre></AppCard>
      <AppCard title="Skipped Files" className="card-soft"><ul>{skipped.map((s) => <li key={s.id}>{s.reason}: {s.path}</li>)}</ul></AppCard>
    </> : null}

    {tab === 'themes' ? <AppCard title="Themes" className="card-solid"><ThemesTab activeTheme={activeTheme} onThemeChange={applyTheme} /></AppCard> : null}
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

  return <div className="app-shell">
    <aside className="sidebar">
      <NavLink to="/">DASHBOARD</NavLink>
      <NavLink to="/collection">COLLECTION</NavLink>
      <NavLink to="/discover">DISCOVER</NavLink>
      <NavLink to="/releases">RELEASES</NavLink>
      <NavLink to="/concerts">CONCERTS</NavLink>
      <NavLink to="/wishlist">WISHLIST</NavLink>
      <NavLink to="/settings">SETTINGS</NavLink>
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
