import React from 'react';
import { Link } from 'react-router-dom';
import Artwork from '../../components/Artwork';

const fallbackActive = { title: 'Language', artistName: 'The Contortionist', progress: 61 };

export const downloadsWidget = {
  id: 'soulseek-downloads',
  title: 'Soulseek Downloads',
  icon: '⬇️',
  defaultSize: 'sm',
  route: '/downloads',
  defaultVisible: true,
  render: (ctx) => {
    const active = ctx?.data?.downloads?.active || fallbackActive;
    const queue = ctx?.data?.downloads?.queueCount ?? 4;
    const progress = Math.max(0, Math.min(100, active.progress ?? 0));
    return {
      body: <div className="download-widget scroll-list"><div className="media-row"><Artwork kind="album" id={active?.id || active?.albumId} hoverFallbackId={active?.artistId} title={active.title || 'Downloading album'} subtitle={active.artistName || 'Unknown artist'} alt={active.title || 'Downloading album'} fallbackSeed={`${active.artistName || ''} ${active.title || ''}`} size="sm" /><div><strong>{active.title || 'Waiting for metadata'}</strong><p className="muted">{active.artistName || 'Unknown artist'} · {progress}%</p></div></div><div className="progress"><span style={{ width: `${progress}%` }} /></div><p className="muted">Queue: {queue} item(s)</p></div>,
      footer: <Link to="/downloads" className="card-link">View queue</Link>
    };
  }
};
