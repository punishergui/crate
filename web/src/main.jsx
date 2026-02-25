import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from './lib/api';
import { registerSW } from 'virtual:pwa-register';
import DashboardPage from './ui/dashboard/dashboard';
import Artwork from './ui/components/Artwork';
import CoverTile from './ui/components/CoverTile';
import {
  getAlbumArtDiagnoseUrl,
  getAlbumArtRescanUrl,
  getAlbumArtUrl,
  getArtistArtDiagnoseUrl,
  getArtistArtRescanUrl
} from './ui/lib/artwork';
import './ui/theme/themes.css';
import './styles.css';

registerSW({ immediate: true });

const THEME_KEY = 'crate.theme.v1';
const THEMES = [
  { id: 'neon-djent', name: 'Neon Djent', vibe: 'Dark charcoal shell with neon orange accents and subtle teal glow.', swatches: ['#090a0d', '#13161b', '#ff9f1a', '#47d1c8'] },
  { id: 'steel-smoke', name: 'Steel & Smoke', vibe: 'Neutral metal palette with restrained contrast and low glow.', swatches: ['#0f1218', '#1b212b', '#8fa1b8', '#c5ced9'] },
  { id: 'warm-tube-glow', name: 'Warm Tube Glow', vibe: 'Warm amber highlights with soft vintage tube color.', swatches: ['#14100d', '#221915', '#ffb15a', '#ffd48a'] }
];

function getTheme() {
  return document.documentElement.getAttribute('data-theme') || localStorage.getItem(THEME_KEY) || 'neon-djent';
}

function applyTheme(themeId) {
  const next = themeId || 'neon-djent';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/library', label: 'Library' },
  { to: '/scan-report', label: 'Scan Report' },
  { to: '/repair', label: 'Repair Center' },
  { to: '/settings/themes', label: 'Themes' },
  { to: '/settings/appearance', label: 'Appearance' },
  { to: '/settings/artwork', label: 'Artwork' },
  { to: '/settings/scan', label: 'Library Scan' }
];

const REASONS = ['ignored_non_audio', 'missing_tags', 'tag_mismatch', 'hidden_path', 'permission_denied', 'unreadable'];

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

function useArtHover(enabled) {
  React.useEffect(() => {
    let cleanup = () => {};
    if (!enabled) return cleanup;
    import('./client/js/artHover').then((mod) => {
      mod.initArtHover();
      cleanup = mod.attachArtHover(document);
    }).catch(() => {});
    return () => cleanup();
  }, [enabled]);
}

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
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [results, setResults] = React.useState({ artists: [], albums: [], tracks: [] });
  const [error, setError] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const reqRef = React.useRef(0);
  const rootRef = React.useRef(null);

  const rows = React.useMemo(() => ([
    ...results.artists.map((artist) => ({ key: `artist-${artist.id}`, type: 'artist', item: artist })),
    ...results.albums.map((album) => ({ key: `album-${album.id}`, type: 'album', item: album }))
  ]), [results]);

  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults({ artists: [], albums: [], tracks: [] });
      setIsOpen(false);
      setIsLoading(false);
      setError('');
      setActiveIndex(-1);
      return undefined;
    }

    const requestId = reqRef.current + 1;
    reqRef.current = requestId;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError('');
      try {
        const payload = await api.get(`/api/search?q=${encodeURIComponent(trimmed)}&limit=8`);
        if (requestId !== reqRef.current) return;
        setResults({ artists: payload.artists || [], albums: payload.albums || [], tracks: payload.tracks || [] });
        setIsOpen(true);
        setActiveIndex(-1);
      } catch (e) {
        if (requestId !== reqRef.current) return;
        setResults({ artists: [], albums: [], tracks: [] });
        setError(e.message || 'Search failed');
        setIsOpen(true);
      } finally {
        if (requestId === reqRef.current) setIsLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    const onDocClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const goToSearch = () => {
    const trimmed = query.trim();
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    setIsOpen(false);
  };

  const goToRow = (row) => {
    if (!row) return;
    if (row.type === 'artist') navigate(`/artists/${row.item.id}`);
    if (row.type === 'album') navigate(`/albums/${row.item.id}`);
    setIsOpen(false);
  };

  return <header className="top-bar">
    <div className="top-search-wrap" ref={rootRef}><label htmlFor="global-search"><span className="sr-only">Search</span></label><input id="global-search" className="top-search" placeholder="Search artists, albums, tracks" value={query} onFocus={() => { if (rows.length || error) setIsOpen(true); }} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
      if (event.key === 'Escape') { setIsOpen(false); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); setIsOpen(true); setActiveIndex((idx) => Math.min(rows.length - 1, idx + 1)); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIsOpen(true); setActiveIndex((idx) => Math.max(0, idx - 1)); return; }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIndex >= 0 && rows[activeIndex]) goToRow(rows[activeIndex]);
        else goToSearch();
      }
    }} />
      {isOpen ? <div className="top-search-dropdown">{isLoading ? <div className="top-search-row muted">Searching…</div> : null}
        {error ? <div className="top-search-row muted">{error}</div> : null}
        {!isLoading && !error && !rows.length ? <div className="top-search-row muted">No results</div> : null}
        {!isLoading && !error ? rows.map((row, index) => {
          const item = row.item;
          const title = row.type === 'artist' ? item.name : item.title;
          const subtitle = row.type === 'artist' ? 'Artist' : `${item.artistName || 'Unknown artist'}`;
          return <button key={row.key} className={`top-search-row ${activeIndex === index ? 'active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => goToRow(row)}>
            <Artwork src={row.type === 'artist' ? `/api/artwork/artist/${item.id}?size=256` : `/api/artwork/album/${item.id}?size=256`} alt={title} fallbackSeed={`${subtitle} ${title}`} size="sm" popout popoutTitle={title} popoutSubtitle={subtitle} />
            <span><strong>{title}</strong><small className="muted">{subtitle}</small></span>
          </button>;
        }) : null}
      </div> : null}
    </div>
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
      ? <article key={item.id} className="album-grid-tile"><CoverTile size="md" albumId={item} title={item.title} subtitle={item.artistName} /><strong>{item.title}</strong><span className="muted">{item.artistName}</span><ArtworkInspector title={item.title} diagnoseUrl={getAlbumArtDiagnoseUrl(item.id)} rescanUrl={getAlbumArtRescanUrl(item.id)} />{item.artistId ? <ArtworkInspector title={item.artistName || 'Artist'} diagnoseUrl={getArtistArtDiagnoseUrl(item.artistId)} rescanUrl={getArtistArtRescanUrl(item.artistId)} /> : null}</article>
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
  const [settings, setSettings] = React.useState({ artworkPreferEmbedded: true, artworkPreferFolder: true, artworkAllowRemote: false, artworkCacheEnabled: true, artworkDefaultSize: 512, artworkFolderFilenames: ['cover', 'folder', 'front', 'album'] });
  const [status, setStatus] = React.useState('');
  React.useEffect(() => { api.get('/api/settings/artwork').then(setSettings).catch(() => null); }, []);
  const patch = async (next) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    const saved = await request('/api/settings/artwork', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged) }).catch((error) => ({ error: error.message }));
    if (saved?.error) setStatus(saved.error);
  };
  const clearCache = async () => {
    await api.post('/api/artwork/cache/clear').catch(() => null);
    setStatus('Artwork cache cleared.');
  };
  const rescanAll = async () => {
    const payload = await api.post('/api/artwork/refresh-all').catch((error) => ({ error: error.message }));
    setStatus(payload.error ? payload.error : `Queued ${payload.queued || 0} albums for artwork refresh.`);
  };
  return <section className="page-stack"><h1>Artwork</h1><div className="app-card"><div className="filters-row">
    <label>Prefer embedded art<select value={settings.artworkPreferEmbedded ? 'on' : 'off'} onChange={(e) => patch({ artworkPreferEmbedded: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Prefer folder art<select value={settings.artworkPreferFolder ? 'on' : 'off'} onChange={(e) => patch({ artworkPreferFolder: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Allow remote fallback<select value={settings.artworkAllowRemote ? 'on' : 'off'} onChange={(e) => patch({ artworkAllowRemote: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Cache artwork thumbnails<select value={settings.artworkCacheEnabled ? 'on' : 'off'} onChange={(e) => patch({ artworkCacheEnabled: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Artwork quality<select value={settings.artworkDefaultSize} onChange={(e) => patch({ artworkDefaultSize: Number(e.target.value) })}><option value={256}>256</option><option value={512}>512</option><option value={1024}>1024</option></select></label>
    <label>Folder names<input className="input" value={(settings.artworkFolderFilenames || []).join(', ')} onChange={(e) => patch({ artworkFolderFilenames: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></label>
  </div><div className="inline-actions"><button className="btn" onClick={clearCache}>Clear artwork cache</button><button className="btn btn-accent" onClick={rescanAll}>Rescan artwork now</button></div>
  <div className="theme-live-preview"><strong>Preview</strong><CoverTile size="sm" title="Album preview" subtitle="Artist preview" albumId={1} /></div>{status ? <p className="muted">{status}</p> : null}</div></section>;
}

function ThemesSettingsPage() {
  const [activeTheme, setActiveTheme] = React.useState(getTheme());
  const onApply = (id) => { applyTheme(id); setActiveTheme(id); };
  return <section className="page-stack"><h1>Themes</h1><div className="themes-grid">{THEMES.map((theme) => {
    const active = activeTheme === theme.id;
    return <article key={theme.id} className={`themeCard theme--${theme.id} ${active ? 'isActive' : ''}`}>
      <div className="themePreview" aria-hidden>
        <div className="themePreview-topbar" />
        <div className="themePreview-body">
          <div className="themePreview-nav"><span /><span /><span /></div>
          <div className="themePreview-tiles"><span /><span /><span /></div>
        </div>
        <div className="themePreview-accent" />
      </div>
      <div className="themeMeta">
        <strong>{theme.name} {active ? <span className="badge">Active</span> : null}</strong><p>{theme.vibe}</p>
        <button className="btn" onClick={() => onApply(theme.id)}>{active ? 'Active' : 'Set Theme'}</button>
      </div>
    </article>;
  })}</div></section>;
}


function AppearanceSettingsPage({ uiSettings, setUiSettings }) {
  const patch = (next) => setUiSettings((prev) => ({ ...prev, ...next }));
  return <section className="page-stack"><h1>Appearance</h1><div className="app-card"><div className="filters-row">
    <label>Artwork density<select value={uiSettings.artSize} onChange={(e) => patch({ artSize: e.target.value })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
    <label>Enable hover popout<select value={uiSettings.hoverPopout ? 'on' : 'off'} onChange={(e) => patch({ hoverPopout: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Popout size<select value={uiSettings.popoutSize} onChange={(e) => patch({ popoutSize: Number(e.target.value) })}><option value={200}>200</option><option value={280}>280</option><option value={360}>360</option></select></label>
    <label>Square corners<select value={uiSettings.squareCorners ? 'on' : 'off'} onChange={(e) => patch({ squareCorners: e.target.value === 'on' })}><option value="on">On</option><option value="off">Rounded</option></select></label>
  </div></div></section>;
}



function ScanSettingsPage({ scanSettings, setScanSettings }) {
  const [status, setStatus] = React.useState('');
  const patch = (next) => setScanSettings((prev) => ({ ...prev, ...next }));
  const save = async () => {
    const payload = await api.put('/api/settings/scan', scanSettings).catch((error) => ({ error: error.message }));
    if (payload?.error) {
      setStatus(payload.error);
      return;
    }
    setScanSettings(payload);
    setStatus('Saved');
  };
  return <section className="page-stack"><h1>Library Scan</h1><div className="app-card"><div className="filters-row">
    <label>Scan subfolders<select value={scanSettings.scanGroupByFolder ? 'on' : 'off'} onChange={(e) => patch({ scanGroupByFolder: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Scan depth<select value={scanSettings.scanMaxDepth} onChange={(e) => patch({ scanMaxDepth: Number(e.target.value) })}>{[2,3,4,5,6,7,8].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
    <label>Ignore hidden folders<select value={scanSettings.scanIgnoreHiddenPaths ? 'on' : 'off'} onChange={(e) => patch({ scanIgnoreHiddenPaths: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Include disc subfolders<select value={scanSettings.scanIncludeDiscSubfolders ? 'on' : 'off'} onChange={(e) => patch({ scanIncludeDiscSubfolders: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Include Singles folders<select value={scanSettings.scanIncludeSingles ? 'on' : 'off'} onChange={(e) => patch({ scanIncludeSingles: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
  </div><div className="filters-row">
    <label>Root loose tracks as singles<select value={scanSettings.scanTreatArtistRootLooseTracksAsSingles ? 'on' : 'off'} onChange={(e) => patch({ scanTreatArtistRootLooseTracksAsSingles: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Treat compilations separately<select value={scanSettings.scanTreatCompilationAsSeparate ? 'on' : 'off'} onChange={(e) => patch({ scanTreatCompilationAsSeparate: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Ignored folder names<input className="input" value={(scanSettings.scanIgnoreFolderNames || []).join(', ')} onChange={(e) => patch({ scanIgnoreFolderNames: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></label>
    <button className="btn btn-accent" onClick={save}>Save Scan Settings</button>
  </div>{status ? <p className="muted">{status}</p> : null}</div></section>;
}

function PlaceholderPage({ title, text }) { return <section className="page-stack"><h1>{title}</h1><AppCard title={title}><p>{text}</p></AppCard></section>; }

function ScanReportPage({ scanStatus, setScanStatus, onStartScan }) {
  const [selectedReason, setSelectedReason] = React.useState(''); const [selectedExt, setSelectedExt] = React.useState(''); const [searchText, setSearchText] = React.useState('');
  const [offset, setOffset] = React.useState(0); const [rows, setRows] = React.useState([]); const [total, setTotal] = React.useState(0); const [extensions, setExtensions] = React.useState([]); const [selectedItem, setSelectedItem] = React.useState(null); const limit = 50;
  React.useEffect(() => { if (selectedReason !== 'ignored_non_audio') { setExtensions([]); setSelectedExt(''); return; }
    api.get('/api/scan/skipped/extensions?reason=ignored_non_audio&limit=20').then((payload) => setExtensions(payload.items || [])).catch(() => setExtensions([]));
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
      <select value={selectedExt} onChange={(event) => setSelectedExt(event.target.value)} disabled={selectedReason !== 'ignored_non_audio'}><option value="">All extensions</option>{extensions.map((item) => <option key={item.ext || '(none)'} value={item.ext || ''}>{item.ext || '(none)'} ({item.count})</option>)}</select>
      <input className="input" placeholder="Search path or message" value={searchText} onChange={(event) => setSearchText(event.target.value)} /></div>
      <div className="table-wrap"><table className="scan-table"><thead><tr><th>When</th><th>Reason</th><th>Ext</th><th>Path</th><th>Message</th><th>Actions</th></tr></thead><tbody>{visibleRows.map((item, idx) => <tr key={`${item.path}-${idx}`}><td>{formatDate(item.at)}</td><td>{item.reason}</td><td>{item.ext || '—'}</td><td className="path-cell">{item.path}</td><td>{item.message || '—'}</td><td><button className="btn btn-small" onClick={() => setSelectedItem(item)}>Details</button></td></tr>)}</tbody></table></div>
      {!visibleRows.length ? <p className="muted">No skipped rows matched the current filter.</p> : null}
      <div className="pager"><button className="btn" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>Previous</button><button className="btn" disabled={offset + limit >= total} onClick={() => setOffset((value) => value + limit)}>Next</button></div>
    </AppCard>
    {selectedItem ? <div className="modal-backdrop" role="presentation" onClick={() => setSelectedItem(null)}><div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}><div className="card-head"><h2>Skipped Item Details</h2><button className="btn" onClick={() => setSelectedItem(null)}>Close</button></div><dl className="details-grid"><dt>Path</dt><dd>{selectedItem.path}</dd><dt>Reason</dt><dd>{selectedItem.reason}</dd><dt>Extension</dt><dd>{selectedItem.ext || '—'}</dd></dl><pre>{JSON.stringify(safeParseDetails(selectedItem.detailsJson), null, 2)}</pre></div></div> : null}
  </section>;
}



function RepairCenterPage({ onStartScan }) {
  const TABS = ['Missing Albums', 'Tag Mismatch', 'Missing Tags', 'Permission Issues', 'Unsupported/Ignored Files', 'Tools'];
  const [tab, setTab] = React.useState(TABS[0]);
  const [rows, setRows] = React.useState([]);
  const [status, setStatus] = React.useState('');
  const [testPath, setTestPath] = React.useState('');

  React.useEffect(() => {
    const load = async () => {
      if (tab === 'Missing Albums') {
        const payload = await api.get('/api/expected/missing?limit=100&page=1').catch(() => ({ items: [] }));
        setRows(payload.items || []);
      } else if (tab === 'Tag Mismatch') {
        const payload = await api.get('/api/scan/skipped?reason=tag_mismatch&limit=100').catch(() => ({ items: [] }));
        setRows(payload.items || []);
      } else if (tab === 'Missing Tags') {
        const payload = await api.get('/api/scan/skipped?reason=missing_tags&limit=100').catch(() => ({ items: [] }));
        setRows(payload.items || []);
      } else if (tab === 'Permission Issues') {
        const payload = await api.get('/api/scan/skipped?reason=permission_denied&limit=100').catch(() => ({ items: [] }));
        setRows(payload.items || []);
      } else if (tab === 'Unsupported/Ignored Files') {
        const payload = await api.get('/api/scan/skipped?reason=ignored_non_audio&limit=100').catch(() => ({ items: [] }));
        setRows(payload.items || []);
      } else {
        setRows([]);
      }
    };
    load();
  }, [tab]);

  const testAccess = async () => {
    const payload = await api.post('/api/debug/test-path-access', { path: testPath }).catch((error) => ({ error: error.message }));
    setStatus(payload.error ? payload.error : JSON.stringify(payload));
  };

  return <section className="page-stack repair-layout"><h1>Repair Center</h1><div className="repair-grid">
    <aside className="repair-tabs">{TABS.map((item) => <button key={item} className={`chip ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{item}</button>)}</aside>
    <div className="app-card">
      {tab === 'Tools' ? <div className="filters-row"><button className="btn btn-accent" onClick={() => onStartScan()}>Rescan Library</button><button className="btn" onClick={() => api.post('/api/artwork/refresh-all').then(() => setStatus('Artwork rebuild queued')).catch((e) => setStatus(e.message))}>Rebuild Artwork</button><button className="btn" onClick={() => api.post('/api/library/adopt-folder', { artistId: 1, folderPath: '/music' }).then(() => setStatus('Folder adopted')).catch((e) => setStatus(e.message))}>Adopt Folder</button></div> : null}
      {tab === 'Permission Issues' ? <div className="filters-row"><input className="input" placeholder="/music/Artist/Album" value={testPath} onChange={(e) => setTestPath(e.target.value)} /><button className="btn" onClick={testAccess}>Test access</button></div> : null}
      <div className="table-wrap"><table className="scan-table"><thead><tr><th>Path / Item</th><th>Reason</th><th>Message</th><th>Action</th></tr></thead><tbody>{rows.map((item, idx) => <tr key={idx}><td className="path-cell">{item.path || `${item.artistName} — ${item.title}`}</td><td>{item.reason || 'missing_album'}</td><td>{item.message || (tab === 'Permission Issues' ? 'Grant r-x to the container group/user for this path.' : '—')}</td><td><button className="btn btn-small" onClick={() => navigator.clipboard?.writeText(item.path || '')}>Copy</button></td></tr>)}</tbody></table></div>
      {!rows.length ? <p className="muted">No rows found for this section yet.</p> : null}
      {status ? <p className="muted">{status}</p> : null}
    </div></div></section>;
}

function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const [state, setState] = React.useState({ loading: false, error: '', artists: [], albums: [], tracks: [] });

  React.useEffect(() => {
    if (q.length < 2) {
      setState({ loading: false, error: '', artists: [], albums: [], tracks: [] });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    api.get(`/api/search?q=${encodeURIComponent(q)}&limit=50`).then((payload) => {
      if (cancelled) return;
      setState({ loading: false, error: '', artists: payload.artists || [], albums: payload.albums || [], tracks: payload.tracks || [] });
    }).catch((error) => {
      if (cancelled) return;
      setState({ loading: false, error: error.message || 'Search failed', artists: [], albums: [], tracks: [] });
    });
    return () => { cancelled = true; };
  }, [q]);

  return <section className="page-stack"><h1>Search</h1><p className="muted">Query: {q || '—'}</p>
    {state.loading ? <p className="muted">Loading results…</p> : null}
    {state.error ? <p className="muted">{state.error}</p> : null}
    <AppCard title="Artists"><div className="simple-list">{state.artists.map((artist) => <Link key={artist.id} to={`/artists/${artist.id}`} className="top-search-row"><Artwork src={`/api/artwork/artist/${artist.id}?size=256`} alt={artist.name} fallbackSeed={artist.name} size="sm" popout popoutTitle={artist.name} popoutSubtitle="Artist" /><span><strong>{artist.name}</strong><small className="muted">Artist</small></span></Link>)}{!state.artists.length ? <p className="muted">No artists.</p> : null}</div></AppCard>
    <AppCard title="Albums"><div className="simple-list">{state.albums.map((album) => <Link key={album.id} to={`/albums/${album.id}`} className="top-search-row"><Artwork src={getAlbumArtUrl(album.id, 256)} alt={album.title} fallbackSeed={`${album.artistName || ''} ${album.title || ''}`} size="sm" popout popoutTitle={album.title} popoutSubtitle={album.artistName || 'Unknown artist'} /><span><strong>{album.title}</strong><small className="muted">{album.artistName || 'Unknown artist'}</small></span></Link>)}{!state.albums.length ? <p className="muted">No albums.</p> : null}</div></AppCard>
  </section>;
}

function ArtistPage() {
  const location = useLocation();
  const artistId = Number(location.pathname.split('/').pop());
  const [payload, setPayload] = React.useState(null);
  React.useEffect(() => { api.get(`/api/library/artists/${artistId}`).then(setPayload).catch(() => setPayload(null)); }, [artistId]);
  return <section className="page-stack"><h1>{payload?.artist?.name || 'Artist'}</h1>
    <div className="album-grid">{(payload?.albums || []).map((item) => <article key={item.id} className="album-grid-tile"><CoverTile size="md" albumId={item.id} title={item.title} subtitle={payload?.artist?.name} /><strong>{item.title}</strong></article>)}</div>
  </section>;
}

function AlbumPage() {
  const location = useLocation();
  const albumId = Number(location.pathname.split('/').pop());
  const [payload, setPayload] = React.useState(null);
  React.useEffect(() => { api.get(`/api/library/albums/${albumId}`).then(setPayload).catch(() => setPayload(null)); }, [albumId]);
  return <section className="page-stack"><h1>{payload?.title || 'Album'}</h1>
    <div className="media-row"><Artwork src={getAlbumArtUrl(albumId, 512)} alt={payload?.title || 'Album cover'} fallbackSeed={`${payload?.artistName || ''} ${payload?.title || ''}`} size="lg" popout popoutTitle={payload?.title || 'Album'} popoutSubtitle={payload?.artistName || 'Unknown artist'} />
      <div><p className="muted">{payload?.artistName || 'Unknown artist'}</p><p className="muted">Tracks: {payload?.trackCount ?? 0}</p></div></div>
  </section>;
}

function App() {
  const [scanStatus, setScanStatus] = useScanStatusPolling();
  const [uiSettings, setUiSettings] = React.useState(getUiArtSettings);
  const [scanSettings, setScanSettings] = React.useState({ scanMaxDepth: 3, scanIgnoreHiddenPaths: true, scanGroupByFolder: true, scanTreatArtistRootLooseTracksAsSingles: true, scanIncludeDiscSubfolders: true, scanIncludeSingles: true, scanTreatCompilationAsSeparate: false, scanIgnoreFolderNames: ['.crate','_tmp','@eaDir'] });
  useArtHover(uiSettings.hoverPopout);
  React.useEffect(() => { applyUiArtSettings(uiSettings); localStorage.setItem(UI_ART_KEY, JSON.stringify(uiSettings)); }, [uiSettings]);
  React.useEffect(() => { api.get('/api/settings/scan').then((payload) => setScanSettings(payload)).catch(() => null); }, []);
  const startScan = React.useCallback(async () => { const payload = await api.post('/api/scan/start', { maxDepth: scanSettings.scanMaxDepth }); if (payload?.status) setScanStatus(payload.status); return payload; }, [setScanStatus, scanSettings.scanMaxDepth]);

  return <div className="app-shell"><aside className="sidebar"><div className="brand">CRATE</div><nav className="nav-list">{NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'}>{item.label}</NavLink>)}</nav></aside>
    <main className="content"><TopBar scanStatus={scanStatus} onScan={startScan} /><Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/library" element={<Library />} />
      <Route path="/scan-report" element={<ScanReportPage scanStatus={scanStatus} setScanStatus={setScanStatus} onStartScan={startScan} />} />
      <Route path="/repair" element={<RepairCenterPage onStartScan={startScan} />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/artists/:id" element={<ArtistPage />} />
      <Route path="/albums/:id" element={<AlbumPage />} />
      <Route path="/settings/themes" element={<ThemesSettingsPage />} />
      <Route path="/settings/appearance" element={<AppearanceSettingsPage uiSettings={uiSettings} setUiSettings={setUiSettings} />} />
      <Route path="/settings/artwork" element={<ArtworkSettingsPage />} />
      <Route path="/settings/scan" element={<ScanSettingsPage scanSettings={scanSettings} setScanSettings={setScanSettings} />} />
      <Route path="/concerts" element={<PlaceholderPage title="Concerts" text="Concert events and locations will appear here." />} />
      <Route path="/releases" element={<PlaceholderPage title="Releases" text="New and upcoming releases feed." />} />
      <Route path="/downloads" element={<PlaceholderPage title="Downloads" text="Soulseek download queue and history." />} />
      <Route path="/discover" element={<PlaceholderPage title="Discover" text="Spotify discover recommendations." />} />
      <Route path="/missing" element={<PlaceholderPage title="Missing Albums" text="Albums still missing from your library." />} />
      <Route path="/activity" element={<PlaceholderPage title="Recent Activity" text="Recent listening and scan activity." />} />
      <Route path="/settings" element={<AppearanceSettingsPage uiSettings={uiSettings} setUiSettings={setUiSettings} />} />
    </Routes></main>
    <nav className="mobile-nav">{NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'}>{item.label}</NavLink>)}</nav>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
