import React from 'react';
import { Link } from 'react-router-dom';
import Artwork from '../../components/Artwork';

export const recentActivityWidget = {
  id: 'recent-activity',
  title: 'Recent Activity',
  icon: '🕘',
  defaultSize: 'lg',
  route: '/activity',
  defaultVisible: true,
  render: (ctx) => {
    const items = (ctx?.data?.recent || []).slice(0, 6);
    return {
      body: <ul className="activity-list scroll-list">{(items.length ? items : [{ title: 'No recent activity yet.' }]).map((item, index) => <li key={`${item.title || item.albumTitle || 'recent'}-${index}`}><span className="activity-icon">●</span>{item.id ? <Artwork kind="album" id={item?.id || item?.albumId} title={item.title || item.albumTitle || 'Album'} subtitle={item.artistName || ''} alt={item.title || item.albumTitle || 'Album'} fallbackSeed={`${item.artistName || ''} ${item.title || ''}`} size="xs" popout popoutTitle={item.title || item.albumTitle || 'Album'} popoutSubtitle={item.artistName || ''} /> : null}<span>{item.title || item.albumTitle || 'Recently played item'} {item.artistName ? `· ${item.artistName}` : ''}</span></li>)}</ul>,
      footer: <Link to="/activity" className="card-link">View All</Link>
    };
  }
};
