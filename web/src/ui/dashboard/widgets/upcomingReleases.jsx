import React from 'react';
import { Link } from 'react-router-dom';
import Artwork from '../../components/Artwork';
import { getAlbumArtUrl } from '../../lib/artwork';

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
    return {
      body: <div className="date-groups">{Object.entries(grouped).slice(0, 3).map(([date, items]) => <div key={date} className="date-row"><span className="muted">{date}</span><div className="cover-strip">{(items || []).slice(0, 5).map((album, i) => <Artwork key={`${date}-${i}`} src={getAlbumArtUrl(album)} alt={album.title || 'Upcoming album'} fallbackSeed={`${album.artistName || ''} ${album.title || ''}`} size="sm" />)}</div></div>)}</div>,
      footer: <Link to="/releases" className="card-link">View schedule</Link>
    };
  }
};
