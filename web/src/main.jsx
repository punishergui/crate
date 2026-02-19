import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';

registerSW({ immediate: true });

const api = {
  get: (url) => fetch(url).then((r) => r.json()),
  put: (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  post: (url, body = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  del: (url) => fetch(url, { method: 'DELETE' }).then((r) => r.json())
};

function Dashboard() {
  const [stats, setStats] = React.useState();
  const [recent, setRecent] = React.useState([]);
  const [missingTop, setMissingTop] = React.useState([]);
  React.useEffect(() => {
    api.get('/api/stats').then(setStats);
    api.get('/api/library/recent?limit=12').then(setRecent);
    api.get('/api/missing/top?limit=200').then(setMissingTop);
  }, []);
  return <section>
    <h1>Dashboard</h1>
    <p>Artists {stats?.artists ?? '-'} Albums {stats?.albums ?? '-'} Tracks {stats?.tracks ?? '-'}</p>
    <div className="panel">
      <h2>Missing albums</h2>
      <p>Total missing items: {missingTop.length}</p>
      <ul>
        {missingTop.slice(0, 10).map((item, index) => <li key={`${item.artistId}-${item.title}-${index}`}><Link to={`/artist/${item.artistId}`}>{item.artistName}</Link> — {item.title}{item.year ? ` (${item.year})` : ''}</li>)}
      </ul>
    </div>
    <div className="grid">{recent.map((a) => <AlbumCard key={a.id} album={a} />)}</div>
  </section>;
}

function Collection() {
  const [q, setQ] = React.useState('');
  const [ownedFilter, setOwnedFilter] = React.useState('1');
  const [list, setList] = React.useState({ items: [], total: 0 });

  const load = React.useCallback(() => {
    const ownedQuery = ownedFilter === 'all' ? '' : `&owned=${ownedFilter}`;
    api.get(`/api/library/albums?search=${encodeURIComponent(q)}&page=1&pageSize=60${ownedQuery}`).then(setList);
  }, [ownedFilter, q]);

  React.useEffect(() => { load(); }, [load]);

  const toggleOwned = async (albumId, nextOwned) => {
    const previous = list.items;
    setList((prev) => ({
      ...prev,
      items: prev.items.map((album) => (album.id === albumId ? { ...album, owned: nextOwned } : album))
    }));

    try {
      const updated = await api.put(`/api/library/albums/${albumId}/owned`, { owned: nextOwned });
      setList((prev) => ({
        ...prev,
        items: prev.items.map((album) => (album.id === albumId ? { ...album, ...updated } : album))
      }));

      if (ownedFilter !== 'all' && String(nextOwned ? 1 : 0) !== ownedFilter) {
        setList((prev) => ({ ...prev, items: prev.items.filter((album) => album.id !== albumId) }));
      }
    } catch (error) {
      setList((prev) => ({ ...prev, items: previous }));
    }
  };

  return <section>
    <h1>Collection</h1>
    <div className="toolbar">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search albums or artists" />
      <div className="toggle-group" role="group" aria-label="Owned filter">
        <button className={ownedFilter === '1' ? 'active' : ''} onClick={() => setOwnedFilter('1')}>Owned</button>
        <button className={ownedFilter === '0' ? 'active' : ''} onClick={() => setOwnedFilter('0')}>Missing</button>
        <button className={ownedFilter === 'all' ? 'active' : ''} onClick={() => setOwnedFilter('all')}>All</button>
      </div>
    </div>
    <div className="grid">{list.items.map((a) => <AlbumCard key={a.id} album={a} onToggleOwned={toggleOwned} />)}</div>
  </section>;
}

function ArtistPage() {
  const { id } = useParams();
  const [data, setData] = React.useState();
  const [aliasForm, setAliasForm] = React.useState({ alias: '', mapsToTitle: '' });
  const [wantedForm, setWantedForm] = React.useState({ title: '', year: '', notes: '' });

  const load = React.useCallback(() => {
    api.get(`/api/artist/${id}/overview`).then(setData);
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  if (!data) return <p>Loading</p>;

  const addWanted = async (e) => {
    e.preventDefault();
    const payload = {
      title: wantedForm.title,
      year: wantedForm.year ? Number(wantedForm.year) : null,
      notes: wantedForm.notes || null
    };
    await api.post(`/api/artist/${id}/wanted`, payload);
    setWantedForm({ title: '', year: '', notes: '' });
    load();
  };

  const addAlias = async (e) => {
    e.preventDefault();
    await api.post(`/api/artist/${id}/alias`, aliasForm);
    setAliasForm({ alias: '', mapsToTitle: '' });
    load();
  };

  return <section>
    <h1>{data.artist.name}</h1>
    <div className="stats-row">
      <span>Owned {data.owned.length}</span>
      <span>Wanted {data.wanted.length}</span>
      <span>Missing {data.missing.length}</span>
      <span>Completion {data.completionPct === null ? 'n/a' : `${data.completionPct}%`}</span>
    </div>

    <div className="panel">
      <h2>Add wanted album</h2>
      <form onSubmit={addWanted}>
        <input value={wantedForm.title} onChange={(e) => setWantedForm({ ...wantedForm, title: e.target.value })} placeholder="Album title" required />
        <input value={wantedForm.year} onChange={(e) => setWantedForm({ ...wantedForm, year: e.target.value })} placeholder="Year" />
        <input value={wantedForm.notes} onChange={(e) => setWantedForm({ ...wantedForm, notes: e.target.value })} placeholder="Notes" />
        <button type="submit">Add Wanted</button>
      </form>
    </div>

    <div className="panel">
      <h2>Add alias mapping</h2>
      <form onSubmit={addAlias}>
        <input value={aliasForm.alias} onChange={(e) => setAliasForm({ ...aliasForm, alias: e.target.value })} placeholder="Owned title variant" required />
        <input value={aliasForm.mapsToTitle} onChange={(e) => setAliasForm({ ...aliasForm, mapsToTitle: e.target.value })} placeholder="Maps to wanted title" required />
        <button type="submit">Add Alias</button>
      </form>
    </div>

    <div className="three-col">
      <div>
        <h2>Owned</h2>
        <ul>{data.owned.map((a) => <li key={a.id}>{a.title} <small>({a.trackCount} tracks)</small></li>)}</ul>
      </div>
      <div>
        <h2>Wanted</h2>
        <ul>{data.wanted.map((a) => <li key={a.id}>{a.title}{a.year ? ` (${a.year})` : ''} {a.notes ? `— ${a.notes}` : ''} <button onClick={() => api.del(`/api/wanted/${a.id}`).then(load)}>Delete</button></li>)}</ul>
      </div>
      <div>
        <h2>Missing</h2>
        <ul>{data.missing.map((a) => <li key={a.id}>{a.title}{a.year ? ` (${a.year})` : ''} {a.notes ? `— ${a.notes}` : ''}</li>)}</ul>
      </div>
    </div>
  </section>;
}

function Settings({ settings, setSettings }) {
  const [scan, setScan] = React.useState();
  const [form, setForm] = React.useState(settings);
  React.useEffect(() => setForm(settings), [settings]);
  React.useEffect(() => {
    api.get('/api/scan/status').then(setScan);
    const id = setInterval(() => api.get('/api/scan/status').then(setScan), 2000);
    return () => clearInterval(id);
  }, []);

  if (!form) return null;

  const save = async () => {
    const next = await api.put('/api/settings', form);
    setSettings(next);
  };

  return <section><h1>Settings</h1>
    <label>Accent <input value={form.accentColor || ''} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} /></label>
    <label>Noise <input type="checkbox" checked={Boolean(form.noiseOverlay)} onChange={(e) => setForm({ ...form, noiseOverlay: e.target.checked })} /></label>
    <button onClick={save}>Save</button>
    <button onClick={() => api.post('/api/scan/start').then((v) => setScan(v.status))}>Scan Now</button>
    <button onClick={() => api.post('/api/scan/cancel').then((v) => setScan(v.status))}>Cancel Scan</button>
    <pre>{JSON.stringify(scan, null, 2)}</pre>
  </section>;
}

function AlbumCard({ album, onToggleOwned }) {
  return <article className="card">
    <div className="card-header">
      <h3>{album.title}</h3>
      <span className={`badge ${album.owned ? 'owned' : 'missing'}`}>{album.owned ? 'Owned' : 'Missing'}</span>
    </div>
    <p>{album.artistName}</p>
    <small>{(album.formats || []).join(', ')}</small>
    {onToggleOwned ? <div className="card-actions"><button onClick={() => onToggleOwned(album.id, !album.owned)}>{album.owned ? 'Mark Missing' : 'Mark Owned'}</button></div> : null}
  </article>;
}

function App() {
  const [settings, setSettings] = React.useState();
  React.useEffect(() => { api.get('/api/settings').then(setSettings); }, []);

  return (
    <div className={settings?.noiseOverlay ? 'app noise' : 'app'} style={{ '--accent': settings?.accentColor || '#FF6A00' }}>
      <nav>
        <Link to="/">Dashboard</Link>
        <Link to="/collection">Collection</Link>
        <Link to="/settings">Settings</Link>
        <Link to="/artist/1">Artist</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/artist/:id" element={<ArtistPage />} />
          <Route path="/settings" element={<Settings settings={settings} setSettings={setSettings} />} />
        </Routes>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
