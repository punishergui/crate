import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import DashboardPage from './ui/dashboard/dashboard';
import Artwork from './ui/components/Artwork';
import {
  getAlbumArtDiagnoseUrl,
  getAlbumArtRescanUrl,
  getAlbumArtUrl,
  getArtistArtDiagnoseUrl,
  getArtistArtRescanUrl
} from './ui/lib/artwork';
import ArtworkPopout from './ui/components/ArtworkPopout.jsx';
import './ui/theme/themes.css';
import './styles.css';

registerSW({ immediate: true });

const THEME_KEY = 'crate.theme.v1';
const THEMES = [
  { id: 'neon-djent', name: 'Neon Djent', vibe: 'Gritty dark shell with restrained neon amber accents.', swatches: ['#090a0d', '#13161b', '#ff9f1a'] },
  { id: 'classic-dark', name: 'Classic Dark', vibe: 'Muted dark mode with cool blue highlights.', swatches: ['#101319', '#1a1f29', '#5b8dff'] }
];

function getTheme() {
  return document.documentElement.getAttribute('data-theme') || localStorage.getItem(THEME_KEY) || 'neon-djent';
}

function applyTheme(themeId) {
  const next = themeId || 'neon-djent';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

const api = {
  get: (url) => request(url),
  post: (url, body = {}) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
};

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/library', label: 'Library' },
  { to: '/scan-report', label: 'Scan Report' },
  { to: '/settings/themes', label: 'Themes' },
  { to: '/settings/appearance', label: 'Appearance' },
  { to: '/settings/artwork', label: 'Artwork' }
];

const REASONS = ['missing_tags', 'tag_mismatch', 'unsupported_extension', 'hidden_path', 'permission_denied', 'unreadable'];

const UI_ART_KEY = 'crate.ui.art.v1';
const VIEW_MODE_KEY = 'crate.ui.viewModes.v1';

function getUiArtSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_ART_KEY) || '{}');
    return {
      artSize: saved.artSize || 'medium',
      hoverPopout: saved.hoverPopout !== false,
      popoutSize: saved.popoutSize || 280,
      squareCorners: saved.squareCorners !== false
    };
  } catch {
    return { artSize: 'medium', hoverPopout: true, popoutSize: 280, squareCorners: true };
  }
}

function applyUiArtSettings(settings) {
  const tileMap = { small: ['120px', '160px'], medium: ['180px', '220px'], large: ['190px', '230px'], massive: ['230px', '280px'] };
  const [tile, tileLg] = tileMap[settings.artSize] || ['180px', '220px'];
  document.documentElement.style.setProperty('--artTile', tile);
  document.documentElement.style.setProperty('--artTileLg', tileLg);
  document.documentElement.style.setProperty('--artPopoutSize', `${settings.popoutSize}px`);
  document.documentElement.style.setProperty('--artRadius', settings.squareCorners ? '0px' : '12px');
}


function safeParseDetails(raw) { if (!raw) return {}; try { return JSON.parse(raw); } catch { return { raw }; } }
function formatDate(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(); }

function useScanStatusPolling() {
  const [scanStatus, setScanStatus] = React.useState(null);
  React.useEffect(() => {
    let timerId;
    let closed = false;
    const tick = async () => {
      const payload = await api.get('/api/scan/status').catch(() => null);
      if (closed) return;
      setScanStatus(payload);
      timerId = window.setTimeout(tick, payload?.status === 'running' ? 1000 : 10000);
    };
    tick();
    return () => { closed = true; clearTimeout(timerId); };
  }, []);
  return [scanStatus, setScanStatus];
}

function AppCard({ title, children, right }) {
  return <section className="app-card"><header className="card-head"><h2>{title}</h2>{right || null}</header>{children}</section>;
}

function TopBar({ scanStatus, onScan }) {
  return <header className="top-bar">
    <label className="top-search-wrap" htmlFor="global-search"><span className="sr-only">Search</span><input id="global-search" className="top-search" placeholder="Search artists, albums, tracks" /></label>
    <div className="top-actions"><div className="status-pill" aria-live="polite"><span className={`status-dot ${scanStatus?.status === 'running' ? 'running' : ''}`} /><span>{scanStatus?.status || 'idle'}</span></div><button className="btn btn-accent" onClick={onScan}>Start Scan</button></div>
  </header>;
}

function Library() {
  const location = useLocation();
  const [q, setQ] = React.useState('');
  const [list, setList] = React.useState({ items: [] });
  const [mode, setMode] = React.useState(() => {
    const saved = JSON.parse(localStorage.getItem(VIEW_MODE_KEY) || '{}');
    return saved[location.pathname] || 'art-grid';
  });
  React.useEffect(() => { api.get(`/api/library/albums?search=${encodeURIComponent(q)}&page=1&pageSize=60`).then(setList).catch(() => setList({ items: [] })); }, [q]);
  React.useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(VIEW_MODE_KEY) || '{}');
    saved[location.pathname] = mode;
    localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(saved));
  }, [mode, location.pathname]);

  return <section className="page-stack"><div className="split-head"><h1>Library</h1><div className="inline-actions"><button className={`btn ${mode === 'art-grid' ? 'btn-accent' : ''}`} onClick={() => setMode('art-grid')}>Art Grid</button><button className={`btn ${mode === 'compact-list' ? 'btn-accent' : ''}`} onClick={() => setMode('compact-list')}>Compact List</button></div></div><input value={q} onChange={(e) => setQ(e.target.value)} className="input" placeholder="Filter by artist or album" />
    <div className={mode === 'art-grid' ? 'album-grid' : 'simple-list'}>{list.items.map((item) => mode === 'art-grid'
      ? <article key={item.id} className="album-grid-tile"><Artwork src={getAlbumArtUrl(item, 512)} alt={`${item.title} cover`} fallbackSeed={`${item.artistName} ${item.title}`} size="tile-lg" badge={item.artworkSource || ''} /><strong>{item.title}</strong><span className="muted">{item.artistName}</span><ArtworkInspector title={item.title} diagnoseUrl={getAlbumArtDiagnoseUrl(item.id)} rescanUrl={getAlbumArtRescanUrl(item.id)} />{item.artistId ? <ArtworkInspector title={item.artistName || 'Artist'} diagnoseUrl={getArtistArtDiagnoseUrl(item.artistId)} rescanUrl={getArtistArtRescanUrl(item.artistId)} /> : null}</article>
      : <article key={item.id} className="list-item"><div className="media-row"><Artwork src={getAlbumArtUrl(item, 256)} alt={`${item.title} cover`} fallbackSeed={`${item.artistName} ${item.title}`} size="sm" popout popoutTitle={item.title} popoutSubtitle={item.artistName} /><div><strong>{item.title}</strong><span>{item.artistName}</span></div></div></article>)}{!list.items.length ? <p className="muted">No albums found.</p> : null}</div></section>;
}


function ArtworkInspector({ title, diagnoseUrl, rescanUrl, onDone }) {
  const [open, setOpen] = React.useState(false);
  const [diag, setDiag] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const runDiagnose = async () => {
    if (!diagnoseUrl) return;
    setBusy(true);
    const payload = await api.get(diagnoseUrl).catch((error) => ({ error: error.message }));
    setDiag(payload);
    setBusy(false);
    setOpen(true);
  };

  const runRescan = async () => {
    if (!rescanUrl) return;
    setBusy(true);
    const payload = await api.post(rescanUrl).catch((error) => ({ error: error.message }));
    setDiag(payload);
    setBusy(false);
    setOpen(true);
    onDone?.();
  };

  return <div className="inline-actions">
    <button className="btn" onClick={runDiagnose} disabled={busy}>Diagnose</button>
    <button className="btn btn-accent" onClick={runRescan} disabled={busy}>Rescan Artwork</button>
    {open ? <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}><div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
      <div className="card-head"><h2>{title} Diagnostics</h2><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
      <pre>{JSON.stringify(diag, null, 2)}</pre>
    </div></div> : null}
  </div>;
}

function ArtworkSettingsPage() {
  const [settings, setSettings] = React.useState({ artworkPreferLocal: true, artworkAllowRemote: false });
  const [status, setStatus] = React.useState('');
  React.useEffect(() => { api.get('/api/settings').then((payload) => setSettings({ artworkPreferLocal: !!payload.artworkPreferLocal, artworkAllowRemote: !!payload.artworkAllowRemote })); }, []);
  const patch = async (next) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    await request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged) }).catch(() => null);
  };
  const rescanAll = async () => {
    const payload = await api.post('/api/artwork/refresh-all').catch((error) => ({ error: error.message }));
    setStatus(payload.error ? payload.error : `Queued ${payload.queued || 0} albums for artwork refresh.`);
  };
  return <section className="page-stack"><h1>Artwork</h1><div className="app-card"><div className="filters-row">
    <label>Prefer folder artwork<select value={settings.artworkPreferLocal ? 'on' : 'off'} onChange={(e) => patch({ artworkPreferLocal: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Cache artwork locally<select value="on" disabled><option value="on">On</option></select></label>
    <label>Allow remote artwork<select value={settings.artworkAllowRemote ? 'on' : 'off'} onChange={(e) => patch({ artworkAllowRemote: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <button className="btn btn-accent" onClick={rescanAll}>Rescan artwork now</button>
  </div>{status ? <p className="muted">{status}</p> : null}</div></section>;
}

function ThemesSettingsPage() {
  const [activeTheme, setActiveTheme] = React.useState(getTheme());
  const onApply = (id) => { applyTheme(id); setActiveTheme(id); };
  return <section className="page-stack"><h1>Themes</h1><div className="themes-grid">{THEMES.map((theme) => <article key={theme.id} className={`theme-card ${activeTheme === theme.id ? 'active' : ''}`}>
    <div className="theme-swatch-row">{theme.swatches.map((color) => <span key={color} className="swatch-dot" style={{ background: color }} />)}</div>
    <strong>{theme.name} {activeTheme === theme.id ? <span className="badge">Active</span> : null}</strong><p>{theme.vibe}</p>
    <div className="theme-live-preview"><div className="app-card"><div className="card-head"><h2>Preview</h2></div><div className="media-row"><Artwork size="sm" fallbackSeed={theme.name} overlay={<span>View</span>} /><button className="btn btn-small">Button</button></div><div className="preview-progress"><span style={{ width: '62%' }} /></div></div></div>
    <button className="btn" onClick={() => onApply(theme.id)}>{activeTheme === theme.id ? 'Active' : 'Apply'}</button>
  </article>)}</div></section>;
}


function AppearanceSettingsPage({ uiSettings, setUiSettings }) {
  const patch = (next) => setUiSettings((prev) => ({ ...prev, ...next }));
  return <section className="page-stack"><h1>Appearance</h1><div className="app-card"><div className="filters-row">
    <label>Album art size<select value={uiSettings.artSize} onChange={(e) => patch({ artSize: e.target.value })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="massive">Massive</option></select></label>
    <label>Enable hover popout<select value={uiSettings.hoverPopout ? 'on' : 'off'} onChange={(e) => patch({ hoverPopout: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Popout size<select value={uiSettings.popoutSize} onChange={(e) => patch({ popoutSize: Number(e.target.value) })}><option value={200}>200</option><option value={280}>280</option><option value={360}>360</option></select></label>
    <label>Square corners<select value={uiSettings.squareCorners ? 'on' : 'off'} onChange={(e) => patch({ squareCorners: e.target.value === 'on' })}><option value="on">On</option><option value="off">Rounded</option></select></label>
  </div></div></section>;
}

function PlaceholderPage({ title, text }) { return <section className="page-stack"><h1>{title}</h1><AppCard title={title}><p>{text}</p></AppCard></section>; }

function ScanReportPage({ scanStatus, setScanStatus, onStartScan }) {
  const [selectedReason, setSelectedReason] = React.useState(''); const [selectedExt, setSelectedExt] = React.useState(''); const [searchText, setSearchText] = React.useState('');
  const [offset, setOffset] = React.useState(0); const [rows, setRows] = React.useState([]); const [total, setTotal] = React.useState(0); const [extensions, setExtensions] = React.useState([]); const [selectedItem, setSelectedItem] = React.useState(null); const limit = 50;
  React.useEffect(() => { if (selectedReason !== 'unsupported_extension') { setExtensions([]); setSelectedExt(''); return; }
    api.get('/api/scan/skipped/extensions?reason=unsupported_extension&limit=20').then((payload) => setExtensions(payload.items || [])).catch(() => setExtensions([]));
  }, [selectedReason]);
  React.useEffect(() => {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) }); if (selectedReason) query.set('reason', selectedReason);
    api.get(`/api/scan/skipped?${query.toString()}`).then((payload) => { setRows(payload.items || []); setTotal(payload.total || 0); }).catch(() => { setRows([]); setTotal(0); });
  }, [selectedReason, offset]);
  const visibleRows = rows.filter((row) => (selectedExt ? row.ext === selectedExt : true) && ((`${row.path || ''} ${row.message || ''}`).toLowerCase().includes(searchText.toLowerCase())));
  const reasonEntries = Object.entries(scanStatus?.skippedReasonsBreakdown || {});
  const refreshStatus = async () => setScanStatus(await api.get('/api/scan/status').catch(() => null));
  return <section className="page-stack"><div className="split-head"><h1>Scan Report</h1><button className="btn btn-accent" onClick={() => onStartScan().then(refreshStatus)}>Start Scan</button></div>
    <div className="stat-grid"><AppCard title="Last Scan"><p>{formatDate(scanStatus?.finishedAt || scanStatus?.startedAt)}</p></AppCard><AppCard title="Status"><p>{scanStatus?.status || 'idle'}</p></AppCard><AppCard title="Scanned"><p>{scanStatus?.scannedFiles ?? 0} files · {scanStatus?.scannedAlbums ?? 0} albums · {scanStatus?.scannedArtists ?? 0} artists</p></AppCard></div>
    <AppCard title="Skipped Reasons"><div className="chip-row">{reasonEntries.map(([reason, count]) => <button key={reason} className={`chip ${selectedReason === reason ? 'active' : ''}`} onClick={() => { setSelectedReason(reason === selectedReason ? '' : reason); setOffset(0); }}>{reason} ({count})</button>)}</div></AppCard>
    <AppCard title="Skipped Files" right={<span className="muted">{offset + 1}-{Math.min(offset + limit, total)} of {total}</span>}>
      <div className="filters-row"><select value={selectedReason} onChange={(event) => { setSelectedReason(event.target.value); setOffset(0); }}><option value="">All reasons</option>{REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
      <select value={selectedExt} onChange={(event) => setSelectedExt(event.target.value)} disabled={selectedReason !== 'unsupported_extension'}><option value="">All extensions</option>{extensions.map((item) => <option key={item.ext || '(none)'} value={item.ext || ''}>{item.ext || '(none)'} ({item.count})</option>)}</select>
      <input className="input" placeholder="Search path or message" value={searchText} onChange={(event) => setSearchText(event.target.value)} /></div>
      <div className="table-wrap"><table className="scan-table"><thead><tr><th>When</th><th>Reason</th><th>Ext</th><th>Path</th><th>Message</th><th>Actions</th></tr></thead><tbody>{visibleRows.map((item, idx) => <tr key={`${item.path}-${idx}`}><td>{formatDate(item.at)}</td><td>{item.reason}</td><td>{item.ext || '—'}</td><td className="path-cell">{item.path}</td><td>{item.message || '—'}</td><td><button className="btn btn-small" onClick={() => setSelectedItem(item)}>Details</button></td></tr>)}</tbody></table></div>
      {!visibleRows.length ? <p className="muted">No skipped rows matched the current filter.</p> : null}
      <div className="pager"><button className="btn" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>Previous</button><button className="btn" disabled={offset + limit >= total} onClick={() => setOffset((value) => value + limit)}>Next</button></div>
    </AppCard>
    {selectedItem ? <div className="modal-backdrop" role="presentation" onClick={() => setSelectedItem(null)}><div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}><div className="card-head"><h2>Skipped Item Details</h2><button className="btn" onClick={() => setSelectedItem(null)}>Close</button></div><dl className="details-grid"><dt>Path</dt><dd>{selectedItem.path}</dd><dt>Reason</dt><dd>{selectedItem.reason}</dd><dt>Extension</dt><dd>{selectedItem.ext || '—'}</dd></dl><pre>{JSON.stringify(safeParseDetails(selectedItem.detailsJson), null, 2)}</pre></div></div> : null}
  </section>;
}

function App() {
  const [scanStatus, setScanStatus] = useScanStatusPolling();
  const [uiSettings, setUiSettings] = React.useState(getUiArtSettings);
  React.useEffect(() => { applyUiArtSettings(uiSettings); localStorage.setItem(UI_ART_KEY, JSON.stringify(uiSettings)); }, [uiSettings]);
  const startScan = React.useCallback(async () => { const payload = await api.post('/api/scan/start'); if (payload?.status) setScanStatus(payload.status); return payload; }, [setScanStatus]);

  return <div className="app-shell"><aside className="sidebar"><div className="brand">CRATE</div><nav className="nav-list">{NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'}>{item.label}</NavLink>)}</nav></aside>
    <main className="content"><TopBar scanStatus={scanStatus} onScan={startScan} /><Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/library" element={<Library />} />
      <Route path="/scan-report" element={<ScanReportPage scanStatus={scanStatus} setScanStatus={setScanStatus} onStartScan={startScan} />} />
      <Route path="/settings/themes" element={<ThemesSettingsPage />} />
      <Route path="/settings/appearance" element={<AppearanceSettingsPage uiSettings={uiSettings} setUiSettings={setUiSettings} />} />
      <Route path="/settings/artwork" element={<ArtworkSettingsPage />} />
      <Route path="/concerts" element={<PlaceholderPage title="Concerts" text="Concert events and locations will appear here." />} />
      <Route path="/releases" element={<PlaceholderPage title="Releases" text="New and upcoming releases feed." />} />
      <Route path="/downloads" element={<PlaceholderPage title="Downloads" text="Soulseek download queue and history." />} />
      <Route path="/discover" element={<PlaceholderPage title="Discover" text="Spotify discover recommendations." />} />
      <Route path="/missing" element={<PlaceholderPage title="Missing Albums" text="Albums still missing from your library." />} />
      <Route path="/activity" element={<PlaceholderPage title="Recent Activity" text="Recent listening and scan activity." />} />
      <Route path="/settings" element={<AppearanceSettingsPage uiSettings={uiSettings} setUiSettings={setUiSettings} />} />
    </Routes></main>
    <nav className="mobile-nav">{NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'}>{item.label}</NavLink>)}</nav>
    <ArtworkPopout enabled={uiSettings.hoverPopout} />
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
