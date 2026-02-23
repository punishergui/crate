import React from 'react';
import { Link } from 'react-router-dom';
import { SkeletonRows } from './helpers';

export const downloadsWidget = {
  id: 'soulseek-downloads',
  title: 'Soulseek Downloads',
  icon: '⬇️',
  defaultSize: 'sm',
  render: () => ({
    body: <><p className="muted">Syncing from Soulseek queue.</p><SkeletonRows rows={2} /></>,
    footer: <Link to="/downloads" className="card-link">View All</Link>
  })
};
