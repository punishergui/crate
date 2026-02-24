import React from 'react';
import { Link } from 'react-router-dom';
import { CoverStrip } from './helpers';

const fallback = {
  'Apr 19': [{ title: 'In Stasis', artistName: 'Monuments' }, { title: 'Gnosis', artistName: 'Monuments' }],
  'May 02': [{ title: 'Cure', artistName: 'ERRA' }, { title: 'Alien', artistName: 'Northlane' }]
};

export const upcomingReleasesWidget = {
  id: 'upcoming-releases',
  title: 'Upcoming Releases',
  icon: '📅',
  defaultSize: 'md',
  route: '/releases',
  defaultVisible: true,
  render: (ctx) => {
    const grouped = ctx?.data?.upcomingByDate || fallback;
    const flattened = Object.entries(grouped).flatMap(([date, items]) => (items || []).map((item) => ({ ...item, title: `${item.title || 'Untitled'} · ${date}` })));
    return {
      body: <CoverStrip items={flattened.slice(0, 12)} empty="No upcoming schedule." size="md" showMetaOnHover />,
      footer: <Link to="/releases" className="card-link">View schedule</Link>
    };
  }
};
