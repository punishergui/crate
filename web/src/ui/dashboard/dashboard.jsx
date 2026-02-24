import React from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card';
import { concertsWidget } from './widgets/concerts';
import { discoverWidget } from './widgets/discover';
import { downloadsWidget } from './widgets/downloads';
import { missingAlbumsWidget } from './widgets/missingAlbums';
import { newReleasesWidget } from './widgets/newReleases';
import { recentActivityWidget } from './widgets/recentActivity';
import { upcomingReleasesWidget } from './widgets/upcomingReleases';
import { CoverStrip } from './widgets/helpers';
import './dashboard.css';

function useScanStatus() {
  const [scanStatus, setScanStatus] = React.useState(null);
  React.useEffect(() => {
    let timer;
    let closed = false;
    const tick = async () => {
      const payload = await fetch('/api/scan/status').then((r) => r.json()).catch(() => null);
      if (closed) return;
      setScanStatus(payload);
      timer = window.setTimeout(tick, payload?.status === 'running' ? 1200 : 10000);
    };
    tick();
    return () => { closed = true; clearTimeout(timer); };
  }, []);
  return [scanStatus, setScanStatus];
}

export default function DashboardPage() {
  const [data, setData] = React.useState(null);
  const [scanStatus, setScanStatus] = useScanStatus();

  React.useEffect(() => { fetch('/api/dashboard').then((r) => r.json()).then(setData).catch(() => setData(null)); }, []);

  const startScan = async () => {
    const payload = await fetch('/api/scan/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => null);
    if (payload?.status) setScanStatus(payload.status);
  };

  const recentlyAdded = (data?.recent || []).slice(0, 16);
  const progress = Math.max(0, Math.min(100, scanStatus?.progressPct || 0));

  return <section className="page-stack dashboard-shell">
    <div className="split-head">
      <h1>Dashboard</h1>
    </div>

    <div className="dashboard-grid dashboard-grid--fixed">
      <div className="widget-slot span-7">{(() => {
        const body = <CoverStrip items={recentlyAdded} empty="Scan your library to populate this wall." size="lg" showMetaOnHover className="cover-strip--hero" />;
        return <Card title="Recently Added" icon="🧱" footer={<Link to="/library" className="card-link">View all</Link>}>{body}</Card>;
      })()}</div>

      <div className="widget-slot span-5">
        <Card title="Scan Control" icon="⚡" footer={<Link to="/scan-report" className="card-link">View Scan Report</Link>}>
          <div className="scan-panel">
            <div className="status-pill"><span className={`status-dot ${scanStatus?.status === 'running' ? 'running' : ''}`} /><span>{scanStatus?.status || 'idle'}</span></div>
            <button className="btn btn-accent" onClick={startScan}>Start Scan</button>
            <p className="muted">Last Scan: {scanStatus?.finishedAt ? new Date(scanStatus.finishedAt).toLocaleString() : '—'}</p>
            {scanStatus?.status === 'running' ? <div className="progress"><span style={{ width: `${progress}%` }} /></div> : null}
            <p className="muted">Skipped: {scanStatus?.skippedTotal ?? 0} · Files: {scanStatus?.scannedFiles ?? 0}</p>
          </div>
        </Card>
      </div>

      <div className="widget-slot span-6"><Card title={newReleasesWidget.title} icon={newReleasesWidget.icon} footer={newReleasesWidget.render({ data }).footer}>{newReleasesWidget.render({ data }).body}</Card></div>
      <div className="widget-slot span-6"><Card title={discoverWidget.title} icon={discoverWidget.icon} footer={discoverWidget.render({ data }).footer}>{discoverWidget.render({ data }).body}</Card></div>

      <div className="widget-slot span-4"><Card title={concertsWidget.title} icon={concertsWidget.icon} footer={concertsWidget.render({ data }).footer}>{concertsWidget.render({ data }).body}</Card></div>
      <div className="widget-slot span-4"><Card title={downloadsWidget.title} icon={downloadsWidget.icon} footer={downloadsWidget.render({ data }).footer}>{downloadsWidget.render({ data }).body}</Card></div>
      <div className="widget-slot span-4"><Card title={missingAlbumsWidget.title} icon={missingAlbumsWidget.icon} footer={missingAlbumsWidget.render({ data }).footer}>{missingAlbumsWidget.render({ data }).body}</Card></div>

      <div className="widget-slot span-6"><Card title="Your Library" icon="📚" footer={<Link to="/library" className="card-link">View all</Link>}><CoverStrip items={(data?.recent || []).slice(0, 12)} empty="Library gallery appears after scans." size="md" showMetaOnHover /></Card></div>
      <div className="widget-slot span-6"><Card title={upcomingReleasesWidget.title} icon={upcomingReleasesWidget.icon} footer={upcomingReleasesWidget.render({ data }).footer}>{upcomingReleasesWidget.render({ data }).body}</Card></div>

      <div className="widget-slot span-12"><Card title={recentActivityWidget.title} icon={recentActivityWidget.icon} footer={recentActivityWidget.render({ data }).footer}>{recentActivityWidget.render({ data }).body}</Card></div>
    </div>
  </section>;
}
