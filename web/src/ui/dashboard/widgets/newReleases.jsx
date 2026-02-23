import React from 'react';
import { Link } from 'react-router-dom';
import { SimpleList } from './helpers';

export const newReleasesWidget = {
  id: 'new-releases',
  title: 'New Releases',
  icon: '🆕',
  defaultSize: 'md',
  render: () => ({
    body: <SimpleList items={['Sleep Token — Take Me Back', 'VOLA — Friend of a Phantom', 'Spiritbox — Eternal Blue']} />,
    footer: <Link to="/releases" className="card-link">View All</Link>
  })
};
