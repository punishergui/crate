import React from 'react';
import { Link } from 'react-router-dom';
import { SimpleList } from './helpers';

export const discoverWidget = {
  id: 'spotify-discover',
  title: 'Spotify Discover',
  icon: '🧭',
  defaultSize: 'md',
  render: () => ({
    body: <SimpleList items={['Loathe Radio', 'Progressive Metal Mix', 'Mathcore Essentials']} />,
    footer: <Link to="/discover" className="card-link">View All</Link>
  })
};
