import React from 'react';
import { Link } from 'react-router-dom';
import Artwork from '../../components/Artwork';
import { getAlbumArtUrl } from '../../lib/artwork';

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
      body: <ul className="activity-list">{(items.length ? items : [{ title: 'No recent activity yet.' }]).map((item, index) => <li key={`${item.title || item.albumTitle || 'recent'}-${index}`}><span className="activity-icon">●</span>{item.id ? <Artwork src={getAlbumArtUrl(item)} alt={item.title || item.albumTitle || 'Album'} fallbackSeed={`${item.artistName || ''} ${item.title || ''}`} size="xs" /> : null}<span>{item.title || item.albumTitle || 'Recently played item'} {item.artistName ? `· ${item.artistName}` : ''}</span></li>)}</ul>,
      footer: <Link to="/activity" className="card-link">View All</Link>
    };
  }
};
