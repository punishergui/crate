import React from 'react';
import { Link } from 'react-router-dom';
import { AlbumTile, CoverStrip } from './helpers';

const FALLBACK = [
  { id: 'nr1', title: 'Take Me Back to Eden', artistName: 'Sleep Token' },
  { id: 'nr2', title: 'Friend of a Phantom', artistName: 'VOLA' },
  { id: 'nr3', title: 'Heavener', artistName: 'Invent Animate' },
  { id: 'nr4', title: 'War of Being', artistName: 'TesseracT' }
];

export const newReleasesWidget = {
  id: 'new-releases',
  title: 'New Releases',
  icon: '🆕',
  defaultSize: 'md',
  route: '/releases',
  defaultVisible: true,
  render: (ctx) => {
    const items = (ctx?.data?.newReleases || FALLBACK).slice(0, 6);
    const upcoming = (ctx?.data?.upcoming || []).slice(0, 10);
    return {
      body: <div className="widget-stack"><div className="tile-grid tile-grid--large">{items.map((album, i) => <AlbumTile key={`${album.id || album.title}-${i}`} album={album} subtext={`${album.artistName || 'Unknown'} · Out now`} />)}</div><div><small className="muted">Upcoming Releases</small><CoverStrip items={upcoming} empty="No upcoming releases loaded." size="md" showMetaOnHover /></div></div>,
      footer: <Link to="/releases" className="card-link">Explore more</Link>
    };
  }
};
