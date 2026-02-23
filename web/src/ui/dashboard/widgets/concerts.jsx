import React from 'react';
import { Link } from 'react-router-dom';
import { SimpleList } from './helpers';

export const concertsWidget = {
  id: 'concerts-near-you',
  title: 'Concerts Near You',
  icon: '🎫',
  defaultSize: 'md',
  render: () => ({
    body: <SimpleList items={['Invent Animate · Mar 20', 'Periphery · Apr 03', 'TesseracT · Apr 15']} />,
    footer: <Link to="/concerts" className="card-link">View All</Link>
  })
};
