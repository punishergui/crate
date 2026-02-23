import React from 'react';
import { Link } from 'react-router-dom';

export const libraryWidget = {
  id: 'your-library',
  title: 'Your Library',
  icon: '📚',
  defaultSize: 'sm',
  render: (ctx) => ({
    body: <p>{ctx?.data?.stats?.artists ?? 0} artists · {ctx?.data?.stats?.albums ?? 0} albums · {ctx?.data?.stats?.tracks ?? 0} tracks</p>,
    footer: <Link to="/library" className="card-link">View All</Link>
  })
};
