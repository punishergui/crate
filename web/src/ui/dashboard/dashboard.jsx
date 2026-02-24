import React from 'react';
import Card from '../components/Card';
import { concertsWidget } from './widgets/concerts';
import { discoverWidget } from './widgets/discover';
import { downloadsWidget } from './widgets/downloads';
import { libraryWidget } from './widgets/library';
import { missingAlbumsWidget } from './widgets/missingAlbums';
import { newReleasesWidget } from './widgets/newReleases';
import { recentActivityWidget } from './widgets/recentActivity';
import { upcomingReleasesWidget } from './widgets/upcomingReleases';
import './dashboard.css';

export default function DashboardPage() {
  const [data, setData] = React.useState(null);

  React.useEffect(() => { fetch('/api/dashboard').then((r) => r.json()).then(setData).catch(() => setData(null)); }, []);


  return <section className="page-stack dashboard-shell">
    <div className="split-head">
      <h1>Dashboard</h1>
    </div>

    <div className="dashboard-grid">
      <div className="dashboard-card-slot dashboard-card-slot--concerts"><Card title={concertsWidget.title} icon={concertsWidget.icon} footer={concertsWidget.render({ data }).footer}>{concertsWidget.render({ data }).body}</Card></div>
      <div className="dashboard-card-slot dashboard-card-slot--new-releases"><Card title={newReleasesWidget.title} icon={newReleasesWidget.icon} footer={newReleasesWidget.render({ data }).footer}>{newReleasesWidget.render({ data }).body}</Card></div>

      <div className="dashboard-card-slot dashboard-card-slot--library"><Card title={libraryWidget.title} icon={libraryWidget.icon} footer={libraryWidget.render({ data }).footer}>{libraryWidget.render({ data }).body}</Card></div>
      <div className="dashboard-card-slot dashboard-card-slot--soulseek"><Card title={downloadsWidget.title} icon={downloadsWidget.icon} footer={downloadsWidget.render({ data }).footer}>{downloadsWidget.render({ data }).body}</Card></div>
      <div className="dashboard-card-slot dashboard-card-slot--discover"><Card title={discoverWidget.title} icon={discoverWidget.icon} footer={discoverWidget.render({ data }).footer}>{discoverWidget.render({ data }).body}</Card></div>

      <div className="dashboard-card-slot dashboard-card-slot--missing"><Card title={missingAlbumsWidget.title} icon={missingAlbumsWidget.icon} footer={missingAlbumsWidget.render({ data }).footer}>{missingAlbumsWidget.render({ data }).body}</Card></div>
      <div className="dashboard-card-slot dashboard-card-slot--upcoming"><Card title={upcomingReleasesWidget.title} icon={upcomingReleasesWidget.icon} footer={upcomingReleasesWidget.render({ data }).footer}>{upcomingReleasesWidget.render({ data }).body}</Card></div>

      <div className="dashboard-card-slot dashboard-card-slot--activity"><Card title={recentActivityWidget.title} icon={recentActivityWidget.icon} footer={recentActivityWidget.render({ data }).footer}>{recentActivityWidget.render({ data }).body}</Card></div>
    </div>
  </section>;
}
