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
  const [list, setList] = React.useState({ items: [], total: 0 });
  React.useEffect(() => { api.get(`/api/library/albums?search=${encodeURIComponent(q)}&page=1&pageSize=60`).then(setList); }, [q]);
  return <section><h1>Collection</h1><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search albums or artists" /><div className="grid">{list.items.map((a) => <AlbumCard key={a.id} album={a} />)}</div></section>;
}

function ArtistsPage() {
  const [artists, setArtists] = React.useState([]);
  React.useEffect(() => { api.get('/api/library/artists').then(setArtists); }, []);

  return <section>
    <h1>Artists</h1>
    <div className="panel">
      <ul>
        {artists.map((artist) => <li key={artist.id}><Link to={`/artist/${artist.id}`}>{artist.name}</Link></li>)}
      </ul>
    </div>
  </section>;
}

function ArtistPage() {
  const { id } = useParams();
  const [data, setData] = React.useState();
  const [form, setForm] = React.useState({ title: '', year: '', notes: '' });
  const [linkDraft, setLinkDraft] = React.useState({});

  const load = React.useCallback(() => {
    api.get(`/api/library/artists/${id}/owned-missing`).then(setData);
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  if (!data) return <p>Loading</p>;

  const addExpected = async (e) => {
    e.preventDefault();
    await api.post(`/api/artists/${id}/expected`, {
      title: form.title,
      year: form.year ? Number(form.year) : null,
      notes: form.notes || null
    });
    setForm({ title: '', year: '', notes: '' });
    load();
  };

  const removeExpected = async (expectedId) => {
    await api.del(`/api/expected/${expectedId}`);
    load();
  };

  const setLink = async (expectedId) => {
    const selected = linkDraft[expectedId];
    const albumId = selected ? Number(selected) : null;
    await api.post(`/api/expected/${expectedId}/link`, { albumId });
    load();
  };

  return <section>
    <h1>{data.artist.name} <span className="badge">{data.completion.percent === null ? 'n/a' : `${data.completion.percent}% complete`}</span></h1>

    <div className="two-col">
      <div className="panel">
        <h2>Owned ({data.ownedAlbums.length})</h2>
        <div className="stack">
          {data.ownedAlbums.map((album) => (
            <article key={album.id} className="row-item">
              <strong>{album.title}</strong>
              <small>{(album.formats || []).join(', ') || 'unknown format'} • {album.trackCount} tracks</small>
            </article>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Missing ({data.missing.length})</h2>
        <div className="stack">
          {data.missing.map((item) => (
            <article key={item.id} className="row-item">
              <strong>{item.title}{item.year ? ` (${item.year})` : ''}</strong>
              <div>
                <select value={linkDraft[item.id] || ''} onChange={(e) => setLinkDraft({ ...linkDraft, [item.id]: e.target.value })}>
                  <option value="">Select owned album</option>
                  {data.ownedAlbums.map((owned) => <option key={owned.id} value={owned.id}>{owned.title}</option>)}
                </select>
                <button onClick={() => setLink(item.id)}>Link to owned album</button>
                <button onClick={() => removeExpected(item.id)}>Remove expected</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>

    <div className="panel">
      <h2>Add expected album</h2>
      <form onSubmit={addExpected}>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Album title" required />
        <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="Year (optional)" />
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes (optional)" />
        <button type="submit">Add expected</button>
      </form>
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

function AlbumCard({ album }) {
  return <article className="card"><h3>{album.title}</h3><p><Link to={`/artist/${album.artistId}`}>{album.artistName}</Link></p><small>{(album.formats || []).join(', ')}</small></article>;
}

function App() {
  const [settings, setSettings] = React.useState();
  React.useEffect(() => { api.get('/api/settings').then(setSettings); }, []);

  return (
    <div className={settings?.noiseOverlay ? 'app noise' : 'app'} style={{ '--accent': settings?.accentColor || '#FF6A00' }}>
      <nav>
        <Link to="/">Dashboard</Link>
        <Link to="/collection">Collection</Link>
        <Link to="/artists">Artists</Link>
        <Link to="/settings">Settings</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/artists" element={<ArtistsPage />} />
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
