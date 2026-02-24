import React from 'react';
import { Link } from 'react-router-dom';
import Artwork from '../../components/Artwork';
import { getArtistArtUrl } from '../../lib/artwork';

const fallback = [
  { artistName: 'Invent Animate', date: 'Mar 20', venue: 'The Fillmore' },
  { artistName: 'Periphery', date: 'Apr 03', venue: 'House of Blues' },
  { artistName: 'TesseracT', date: 'Apr 15', venue: 'The Observatory' }
];

export const concertsWidget = {
  id: 'concerts-near-you',
  title: 'Concerts Near You',
  icon: '🎫',
  defaultSize: 'md',
  route: '/concerts',
  defaultVisible: true,
  render: (ctx) => {
    const items = (ctx?.data?.concerts || fallback).slice(0, 4);
    return {
      body: <ul className="activity-list">{items.map((item, i) => <li key={`${item.artistName}-${item.date}-${i}`}><Artwork src={item.imageUrl || getArtistArtUrl(item)} alt={`${item.artistName} event`} fallbackSeed={item.artistName} size="sm" /><span><strong>{item.artistName}</strong> · {item.date} <span className="muted">{item.venue || 'Venue TBA'}</span></span></li>)}</ul>,
      footer: <Link to="/concerts" className="card-link">View All</Link>
    };
  }
};
