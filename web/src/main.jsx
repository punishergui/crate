import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';

registerSW({ immediate: true });

const api = {
  get: (url) => fetch(url).then((r) => r.json()),
  put: (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  post: (url, body = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
};

function Dashboard() {
  const [stats, setStats] = React.useState();
  const [recent, setRecent] = React.useState([]);
  React.useEffect(() => {
    api.get('/api/stats').then(setStats);
    api.get('/api/library/recent?limit=12').then(setRecent);
  }, []);
  return <section><h1>Dashboard</h1><p>Artists {stats?.artists ?? '-'} Albums {stats?.albums ?? '-'} Tracks {stats?.tracks ?? '-'}</p><div className="grid">{recent.map((a) => <AlbumCard key={a.id} album={a} />)}</div></section>;
}

function Collection() {
  const [q, setQ] = React.useState('');
  const [list, setList] = React.useState({ items: [], total: 0 });
  React.useEffect(() => { api.get(`/api/library/albums?search=${encodeURIComponent(q)}&page=1&pageSize=60`).then(setList); }, [q]);
  return <section><h1>Collection</h1><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search albums or artists" /><div className="grid">{list.items.map((a) => <AlbumCard key={a.id} album={a} />)}</div></section>;
}

function ArtistPage() {
  const { id } = useParams();
  const [data, setData] = React.useState();
  React.useEffect(() => { api.get(`/api/library/artists/${id}`).then(setData); }, [id]);
  if (!data) return <p>Loading</p>;
  return <section><h1>{data.artist.name}</h1><div className="grid">{data.albums.map((a) => <AlbumCard key={a.id} album={{ ...a, artistName: data.artist.name }} />)}</div></section>;
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
  return <article className="card"><h3>{album.title}</h3><p>{album.artistName}</p><small>{(album.formats || []).join(', ')}</small></article>;
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
