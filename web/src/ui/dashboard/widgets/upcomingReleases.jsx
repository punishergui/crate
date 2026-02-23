import React from 'react';
import { Link } from 'react-router-dom';
import { SimpleList } from './helpers';

export const upcomingReleasesWidget = {
  id: 'upcoming-releases',
  title: 'Upcoming Releases',
  icon: '📅',
  defaultSize: 'md',
  render: () => ({
    body: <SimpleList items={['Monuments — Apr 19', 'ERRA — May 02', 'Northlane — May 18']} />,
    footer: <Link to="/releases" className="card-link">View All</Link>
  })
};
