import React from 'react';
import { Link } from 'react-router-dom';
import { CoverStrip } from './helpers';

export const libraryWidget = {
  id: 'your-library',
  title: 'Your Library',
  icon: '📚',
  defaultSize: 'md',
  route: '/library',
  defaultVisible: true,
  render: (ctx) => {
    const stats = ctx?.data?.stats || {};
    const recentlyAdded = (ctx?.data?.recent || []).slice(0, 6);
    return {
      body: <div className="widget-stack"><p>{stats.artists ?? 0} artists · {stats.albums ?? 0} albums · {stats.tracks ?? 0} tracks</p><div><small className="muted">Recently Added</small><CoverStrip items={recentlyAdded} empty="Scan your library to see recent additions." /></div></div>,
      footer: <Link to="/library" className="card-link">View All</Link>
    };
  }
};
