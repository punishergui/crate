import React from 'react';
import { Link } from 'react-router-dom';
import { SkeletonRows } from './helpers';

export const recentActivityWidget = {
  id: 'recent-activity',
  title: 'Recent Activity',
  icon: '🕘',
  defaultSize: 'lg',
  render: (ctx) => {
    const items = ctx?.data?.recent || [];
    return {
      body: items.length ? <ul className="widget-list">{items.slice(0, 5).map((item, index) => <li key={`${item.title || 'recent'}-${index}`}>{item.title || item.albumTitle || 'Recently played item'}</li>)}</ul> : <SkeletonRows rows={4} />, 
      footer: <Link to="/activity" className="card-link">View All</Link>
    };
  }
};
