import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';

registerSW({ immediate: true });

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

const api = {
  get: (url) => request(url),
  put: (url, body) => request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  post: (url, body = {}) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  del: (url) => request(url, { method: 'DELETE' })
};

function Dashboard() {
  const [data, setData] = React.useState();
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    api.get('/api/dashboard').then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <p>{error}</p>;

  return <section>
    <h1>Dashboard</h1>
    <p>Artists {data?.stats?.artists ?? '-'} Albums {data?.stats?.albums ?? '-'} Tracks {data?.stats?.tracks ?? '-'}</p>
    <div className="panel">
      <h2>Missing Albums</h2>
      <p>Missing total: {data?.missingTotal ?? 0}</p>
      <p>Wishlist items: {data?.wishlistCount ?? 0}</p>
      <Link to="/wishlist"><button>Open Wishlist</button></Link>
    </div>
    <div className="grid">{(data?.recent || []).map((a) => <AlbumCard key={a.id} album={a} />)}</div>
  </section>;
}

function WishlistPage() {
  const [items, setItems] = React.useState([]);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    api.get('/api/wishlist').then(setItems).catch((err) => setError(err.message));
  }, []);

  return <section>
    <h1>Wishlist</h1>
    {error ? <p>{error}</p> : null}
    <ul>
      {items.map((item) => <li key={item.id}>
        <Link to={`/artist/${item.artistSlug || item.artistId}`}>{item.artistName}</Link> — {item.title}{item.year ? ` (${item.year})` : ''} <small>[{item.status}]</small>
      </li>)}
    </ul>
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
    } catch {
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
  const { artistKey } = useParams();
  const navigate = useNavigate();
  const [data, setData] = React.useState();
  const [summary, setSummary] = React.useState();
  const [expectedSettings, setExpectedSettings] = React.useState({ includeLive: false, includeCompilations: false });
  const [lidarrEnabled, setLidarrEnabled] = React.useState(false);
  const [lidarrResults, setLidarrResults] = React.useState({});
  const [status, setStatus] = React.useState('');

  const artistId = data?.artist?.id;

  const load = React.useCallback(async () => {
    let artist;
    if (/^\d+$/.test(String(artistKey))) {
      const legacy = await api.get(`/api/library/artists/${artistKey}`);
      const canonicalSlug = legacy.artist.slug || legacy.artist.id;
      navigate(`/artist/${canonicalSlug}`, { replace: true });
      artist = legacy.artist;
    } else {
      artist = await api.get(`/api/artist/by-slug/${encodeURIComponent(artistKey)}`);
    }
    const overview = await api.get(`/api/artist/${artist.id}/overview`);
    setData(overview);
    try {
      const [nextSummary, nextSettings, appSettings] = await Promise.all([
        api.get(`/api/expected/artist/${artist.id}/summary`),
        api.get(`/api/expected/artist/${artist.id}/settings`),
        api.get('/api/settings')
      ]);
      setSummary(nextSummary);
      setExpectedSettings(nextSettings);
      setLidarrEnabled(Boolean(appSettings.lidarrEnabled));
    } catch {
      setSummary(null);
    }
  }, [artistKey, navigate]);

  React.useEffect(() => { load().catch((err) => setStatus(err.message)); }, [load]);

  if (!data) return <p>Loading</p>;

  const syncDiscography = async () => {
    if (!artistId) return;
    setStatus('Syncing discography...');
    try {
      const nextSummary = await api.post(`/api/expected/artist/${artistId}/sync`);
      setSummary(nextSummary);
      setStatus('Discography synced');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const addToWishlist = async (album) => {
    if (!artistId) return;
    try {
      await api.post('/api/wishlist', {
        artistId,
        artistName: data.artist.name,
        title: album.title,
        year: album.year,
        source: 'musicbrainz',
        expectedAlbumId: album.id
      });
      setStatus('Added to wishlist');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const ignoreExpected = async (expectedAlbumId) => {
    if (!artistId) return;
    try {
      await api.post(`/api/expected/artist/${artistId}/ignore`, { expectedAlbumId });
      const nextSummary = await api.get(`/api/expected/artist/${artistId}/summary`);
      setSummary(nextSummary);
      setStatus('Album ignored');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const unignoreExpected = async (expectedAlbumId) => {
    if (!artistId) return;
    try {
      await api.post(`/api/expected/artist/${artistId}/unignore`, { expectedAlbumId });
      const nextSummary = await api.get(`/api/expected/artist/${artistId}/summary`);
      setSummary(nextSummary);
      setStatus('Album unignored');
    } catch (error) {
      setStatus(error.message);
    }
  };


  const searchInLidarr = async (album) => {
    if (!artistId) return;
    setStatus(`Searching Lidarr for ${album.title}...`);
    try {
      const response = await api.post('/api/integrations/lidarr/search', {
        artistName: data.artist.name,
        albumTitle: album.title,
        year: album.year || null,
        expectedAlbumId: album.id
      });
      setLidarrResults((prev) => ({ ...prev, [album.id]: response.lidarr }));
      setStatus(`Lidarr search triggered for ${album.title}`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const updateExpectedFilter = async (key, value) => {
    if (!artistId) return;
    const next = { ...expectedSettings, [key]: value };
    setExpectedSettings(next);
    try {
      await api.post(`/api/expected/artist/${artistId}/settings`, next);
      const nextSummary = await api.get(`/api/expected/artist/${artistId}/summary`);
      setSummary(nextSummary);
    } catch (error) {
      setStatus(error.message);
    }
  };

  return <section>
    <h1>{data.artist.name}</h1>
    <button onClick={syncDiscography}>Sync Discography</button>
    {status ? <p>{status}</p> : null}

    <div className="stats-row">
      <span>Owned {summary?.ownedCount ?? data.owned.length}</span>
      <span>Expected {summary?.expectedCountFiltered ?? summary?.expectedCount ?? 0}</span>
      <span>Missing {summary?.missingCount ?? 0}</span>
      <span>Ignored {summary?.ignoredCount ?? 0}</span>
      <span>Completion {summary?.completionPct === null || summary?.completionPct === undefined ? 'n/a' : `${summary.completionPct}%`}</span>
    </div>

    <div className="three-col">
      <div>
        <h2>Owned</h2>
        <ul>{data.owned.map((a) => <li key={a.id}>{a.title} <small>({a.trackCount} tracks)</small></li>)}</ul>
      </div>
      <div>
        <h2>Expected Missing</h2>
        <label><input type="checkbox" checked={Boolean(expectedSettings.includeLive)} onChange={(e) => updateExpectedFilter('includeLive', e.target.checked)} /> Include live albums</label>
        <label><input type="checkbox" checked={Boolean(expectedSettings.includeCompilations)} onChange={(e) => updateExpectedFilter('includeCompilations', e.target.checked)} /> Include compilations</label>
        <ul>{(summary?.missingAlbums || []).map((album) => <li key={album.id}>
          {album.title}{album.year ? ` (${album.year})` : ''}
          <button onClick={() => addToWishlist(album)}>Add to Wishlist</button>
          {lidarrEnabled ? <button onClick={() => searchInLidarr(album)}>Search in Lidarr</button> : null}
          {lidarrResults[album.id]?.albumUrl ? <a href={lidarrResults[album.id].albumUrl} target="_blank" rel="noreferrer">Open Lidarr</a> : null}
          <button onClick={() => ignoreExpected(album.id)}>Ignore</button>
        </li>)}</ul>
        {(summary?.ignoredAlbums || []).length ? <details>
          <summary>Ignored ({summary?.ignoredCount || 0})</summary>
          <ul>{(summary?.ignoredAlbums || []).map((album) => <li key={album.id}>
            {album.title}{album.year ? ` (${album.year})` : ''}
            <button onClick={() => unignoreExpected(album.id)}>Unignore</button>
          </li>)}</ul>
        </details> : null}
      </div>
      <div>
        <h2>Manual Wanted</h2>
        <ul>{data.wanted.map((a) => <li key={a.id}>{a.title}{a.year ? ` (${a.year})` : ''}</li>)}</ul>
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
    <label>Lidarr Enabled <input type="checkbox" checked={Boolean(form.lidarrEnabled)} onChange={(e) => setForm({ ...form, lidarrEnabled: e.target.checked })} /></label>
    <label>Lidarr Base URL <input value={form.lidarrBaseUrl || ''} onChange={(e) => setForm({ ...form, lidarrBaseUrl: e.target.value })} placeholder="http://lidarr:8686" /></label>
    <label>Lidarr API Key <input value={form.lidarrApiKey || ''} onChange={(e) => setForm({ ...form, lidarrApiKey: e.target.value })} /></label>
    <label>Lidarr Quality Profile ID (optional) <input value={form.lidarrQualityProfileId || ''} onChange={(e) => setForm({ ...form, lidarrQualityProfileId: e.target.value ? Number(e.target.value) : null })} /></label>
    <label>Lidarr Root Folder Path (optional) <input value={form.lidarrRootFolderPath || ''} onChange={(e) => setForm({ ...form, lidarrRootFolderPath: e.target.value })} placeholder="/music" /></label>
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
  const [artists, setArtists] = React.useState([]);
  React.useEffect(() => { api.get('/api/settings').then(setSettings); }, []);
  React.useEffect(() => { api.get('/api/library/artists').then(setArtists).catch(() => setArtists([])); }, []);
  const firstArtistSlug = artists[0]?.slug || artists[0]?.id;

  return (
    <div className={settings?.noiseOverlay ? 'app noise' : 'app'} style={{ '--accent': settings?.accentColor || '#FF6A00' }}>
      <nav>
        <Link to="/">Dashboard</Link>
        <Link to="/collection">Collection</Link>
        <Link to="/wishlist">Wishlist</Link>
        <Link to="/settings">Settings</Link>
        {firstArtistSlug ? <Link to={`/artist/${firstArtistSlug}`}>Artist</Link> : null}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/artist/:artistKey" element={<ArtistPage />} />
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
