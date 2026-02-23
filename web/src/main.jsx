import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
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

const THEMES = [
  { id: 'neon-djent', name: 'Neon Djent', description: 'Dark high-contrast palette with cyan and violet accents.' },
  { id: 'classic-dark', name: 'Classic Dark', description: 'A calmer neutral dark theme with blue accents.' }
];

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/library', label: 'Library' },
  { to: '/scan-report', label: 'Scan Report' },
  { to: '/settings', label: 'Settings' }
];

const REASONS = ['missing_tags', 'tag_mismatch', 'unsupported_extension', 'hidden_path', 'permission_denied', 'unreadable'];

function safeParseDetails(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { raw }; }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function useScanStatusPolling() {
  const [scanStatus, setScanStatus] = React.useState(null);

  React.useEffect(() => {
    let timerId;
    let closed = false;

    const tick = async () => {
      const payload = await api.get('/api/scan/status').catch(() => null);
      if (closed) return;
      setScanStatus(payload);
      const nextDelay = payload?.status === 'running' ? 1000 : 10000;
      timerId = window.setTimeout(tick, nextDelay);
    };

    tick();
    return () => {
      closed = true;
      clearTimeout(timerId);
    };
  }, []);

  return [scanStatus, setScanStatus];
}

function AppCard({ title, children, right }) {
  return <section className="app-card">
    <header className="card-head">
      <h2>{title}</h2>
      {right || null}
    </header>
    {children}
  </section>;
}

function TopBar({ scanStatus, onScan }) {
  return <header className="top-bar">
    <label className="top-search-wrap" htmlFor="global-search">
      <span className="sr-only">Search</span>
      <input id="global-search" className="top-search" placeholder="Search artists, albums, tracks" />
    </label>
    <div className="top-actions">
      <div className="status-pill" aria-live="polite">
        <span className={`status-dot ${scanStatus?.status === 'running' ? 'running' : ''}`} />
        <span>{scanStatus?.status || 'idle'}</span>
      </div>
      <button className="btn btn-accent" onClick={onScan}>Start Scan</button>
    </div>
  </header>;
}

function Dashboard() {
  const [data, setData] = React.useState(null);

  React.useEffect(() => { api.get('/api/dashboard').then(setData).catch(() => setData(null)); }, []);

  return <section className="page-stack">
    <h1>Dashboard</h1>
    <div className="stat-grid">
      <AppCard title="Library">
        <p>{data?.stats?.artists ?? 0} artists · {data?.stats?.albums ?? 0} albums · {data?.stats?.tracks ?? 0} tracks</p>
      </AppCard>
      <AppCard title="Missing Albums">
        <p>{data?.missingTotal ?? 0} albums still marked missing.</p>
      </AppCard>
      <AppCard title="Recent">
        <p>{(data?.recent || []).length} recent items available.</p>
      </AppCard>
    </div>
  </section>;
}

function Library() {
  const [q, setQ] = React.useState('');
  const [list, setList] = React.useState({ items: [] });

  React.useEffect(() => {
    api.get(`/api/library/albums?search=${encodeURIComponent(q)}&page=1&pageSize=60`).then(setList).catch(() => setList({ items: [] }));
  }, [q]);

  return <section className="page-stack">
    <h1>Library</h1>
    <input value={q} onChange={(event) => setQ(event.target.value)} className="input" placeholder="Filter by artist or album" />
    <div className="simple-list">
      {list.items.map((item) => <article key={item.id} className="list-item">
        <strong>{item.title}</strong>
        <span>{item.artistName}</span>
      </article>)}
      {!list.items.length ? <p className="muted">No albums found.</p> : null}
    </div>
  </section>;
}

function ThemeSettings() {
  const [activeTheme, setActiveTheme] = React.useState(window.CRATE_THEME?.get?.() || 'neon-djent');

  const applyTheme = (themeId) => {
    window.CRATE_THEME?.apply?.(themeId);
    setActiveTheme(themeId);
  };

  return <section className="page-stack">
    <h1>Settings</h1>
    <AppCard title="Themes" right={<span className="muted">Active: {activeTheme}</span>}>
      <div className="themes-grid">
        {THEMES.map((theme) => <article key={theme.id} className={`theme-card ${activeTheme === theme.id ? 'active' : ''}`}>
          <div className="swatch" data-theme-preview={theme.id} />
          <strong>{theme.name}</strong>
          <p>{theme.description}</p>
          <button className="btn" onClick={() => applyTheme(theme.id)}>
            {activeTheme === theme.id ? 'Applied' : 'Apply'}
          </button>
        </article>)}
      </div>
    </AppCard>
  </section>;
}

function ScanReportPage({ scanStatus, setScanStatus, onStartScan }) {
  const [selectedReason, setSelectedReason] = React.useState('');
  const [selectedExt, setSelectedExt] = React.useState('');
  const [searchText, setSearchText] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [extensions, setExtensions] = React.useState([]);
  const [selectedItem, setSelectedItem] = React.useState(null);
  const limit = 50;

  React.useEffect(() => {
    if (selectedReason !== 'unsupported_extension') {
      setExtensions([]);
      setSelectedExt('');
      return;
    }
    api.get('/api/scan/skipped/extensions?reason=unsupported_extension&limit=20')
      .then((payload) => setExtensions(payload.items || []))
      .catch(() => setExtensions([]));
  }, [selectedReason]);

  React.useEffect(() => {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (selectedReason) query.set('reason', selectedReason);

    api.get(`/api/scan/skipped?${query.toString()}`)
      .then((payload) => {
        setRows(payload.items || []);
        setTotal(payload.total || 0);
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
      });
  }, [selectedReason, offset]);

  const visibleRows = rows.filter((row) => {
    const matchesExt = selectedExt ? row.ext === selectedExt : true;
    const haystack = `${row.path || ''} ${row.message || ''}`.toLowerCase();
    const matchesText = searchText ? haystack.includes(searchText.toLowerCase()) : true;
    return matchesExt && matchesText;
  });

  const reasonEntries = Object.entries(scanStatus?.skippedReasonsBreakdown || {});

  const copyText = async (value) => {
    if (!value) return;
    await navigator.clipboard.writeText(value).catch(() => null);
  };

  const refreshStatus = async () => {
    const payload = await api.get('/api/scan/status').catch(() => null);
    setScanStatus(payload);
  };

  return <section className="page-stack">
    <div className="split-head">
      <h1>Scan Report</h1>
      <button className="btn btn-accent" onClick={() => onStartScan().then(refreshStatus)}>Start Scan</button>
    </div>

    <div className="stat-grid">
      <AppCard title="Last Scan"><p>{formatDate(scanStatus?.finishedAt || scanStatus?.startedAt)}</p></AppCard>
      <AppCard title="Status"><p>{scanStatus?.status || 'idle'}</p></AppCard>
      <AppCard title="Scanned"><p>{scanStatus?.scannedFiles ?? 0} files · {scanStatus?.scannedAlbums ?? 0} albums · {scanStatus?.scannedArtists ?? 0} artists</p></AppCard>
    </div>

    <AppCard title="Skipped Reasons">
      <div className="chip-row">
        {reasonEntries.map(([reason, count]) => <button
          key={reason}
          className={`chip ${selectedReason === reason ? 'active' : ''}`}
          onClick={() => {
            setSelectedReason(reason === selectedReason ? '' : reason);
            setOffset(0);
          }}
        >
          {reason} ({count})
        </button>)}
      </div>
    </AppCard>

    <AppCard title="Skipped Files" right={<span className="muted">{offset + 1}-{Math.min(offset + limit, total)} of {total}</span>}>
      <div className="filters-row">
        <select value={selectedReason} onChange={(event) => { setSelectedReason(event.target.value); setOffset(0); }}>
          <option value="">All reasons</option>
          {REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
        </select>
        <select value={selectedExt} onChange={(event) => setSelectedExt(event.target.value)} disabled={selectedReason !== 'unsupported_extension'}>
          <option value="">All extensions</option>
          {extensions.map((item) => <option key={item.ext || '(none)'} value={item.ext || ''}>{item.ext || '(none)'} ({item.count})</option>)}
        </select>
        <input className="input" placeholder="Search path or message" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="scan-table">
          <thead><tr><th>When</th><th>Reason</th><th>Ext</th><th>Path</th><th>Message</th><th>Actions</th></tr></thead>
          <tbody>
            {visibleRows.map((item, index) => <tr key={`${item.path}-${item.at}-${index}`}>
              <td>{formatDate(item.at)}</td>
              <td>{item.reason}</td>
              <td>{item.ext || '—'}</td>
              <td className="path-cell">{item.path}</td>
              <td>{item.message || '—'}</td>
              <td><button className="btn btn-small" onClick={() => setSelectedItem(item)}>Details</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {!visibleRows.length ? <p className="muted">No skipped rows matched the current filter.</p> : null}
      <div className="pager">
        <button className="btn" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>Previous</button>
        <button className="btn" disabled={offset + limit >= total} onClick={() => setOffset((value) => value + limit)}>Next</button>
      </div>
    </AppCard>

    {selectedItem ? <div className="modal-backdrop" role="presentation" onClick={() => setSelectedItem(null)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Skipped file details" onClick={(event) => event.stopPropagation()}>
        <div className="card-head"><h2>Skipped Item Details</h2><button className="btn" onClick={() => setSelectedItem(null)}>Close</button></div>
        <dl className="details-grid">
          <dt>Path</dt><dd>{selectedItem.path}</dd>
          <dt>Reason</dt><dd>{selectedItem.reason}</dd>
          <dt>Extension</dt><dd>{selectedItem.ext || '—'}</dd>
          <dt>Message</dt><dd>{selectedItem.message || '—'}</dd>
          <dt>When</dt><dd>{formatDate(selectedItem.at)}</dd>
        </dl>
        <div className="copy-row">
          <button className="btn" onClick={() => copyText(selectedItem.path)}>Copy Path</button>
          <button className="btn" onClick={() => copyText(JSON.stringify(safeParseDetails(selectedItem.detailsJson), null, 2))}>Copy Tags JSON</button>
        </div>
        <pre>{JSON.stringify(safeParseDetails(selectedItem.detailsJson), null, 2)}</pre>
      </div>
    </div> : null}
  </section>;
}

function App() {
  const [scanStatus, setScanStatus] = useScanStatusPolling();

  const startScan = React.useCallback(async () => {
    const payload = await api.post('/api/scan/start');
    if (payload?.status) setScanStatus(payload.status);
    return payload;
  }, [setScanStatus]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">CRATE</div>
      <nav className="nav-list">
        {NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'}>{item.label}</NavLink>)}
      </nav>
    </aside>
    <main className="content">
      <TopBar scanStatus={scanStatus} onScan={startScan} />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/scan-report" element={<ScanReportPage scanStatus={scanStatus} setScanStatus={setScanStatus} onStartScan={startScan} />} />
        <Route path="/settings" element={<ThemeSettings />} />
      </Routes>
    </main>
    <nav className="mobile-nav">
      {NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'}>{item.label}</NavLink>)}
    </nav>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>
);
