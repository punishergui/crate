import React from 'react';
import { Link } from 'react-router-dom';

export const missingAlbumsWidget = {
  id: 'missing-albums',
  title: 'Missing Albums',
  icon: '🧩',
  defaultSize: 'sm',
  render: (ctx) => ({
    body: <p>{ctx?.data?.missingTotal ?? 0} albums still marked missing.</p>,
    footer: <Link to="/missing" className="card-link">View All</Link>
  })
};
