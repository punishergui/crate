import React from 'react';
import { Link } from 'react-router-dom';
import { AlbumTile, ArtistTile } from './helpers';

const defaults = {
  newForYou: [{ title: 'Caligula\'s Horse Essentials', artistName: 'Caligula\'s Horse' }, { title: 'Periphery V', artistName: 'Periphery' }],
  weeklyPicks: [{ title: 'Abyss', artistName: 'Unprocessed' }, { title: 'Voidkind', artistName: 'Dvne' }],
  similarArtists: [{ name: 'Monuments' }, { name: 'Northlane' }, { name: 'Loathe' }]
};

function DiscoverTabs({ payload }) {
  const tabs = [
    { id: 'newForYou', label: 'New For You' },
    { id: 'weeklyPicks', label: 'Weekly Picks' },
    { id: 'similarArtists', label: 'Similar Artists' }
  ];
  const [tab, setTab] = React.useState('newForYou');
  const activeItems = (payload[tab] || defaults[tab] || []).slice(0, 12);

  return <div className="discover-tabs">
    <div className="tab-row">{tabs.map((item) => <button key={item.id} type="button" className={`btn tab-btn ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div className="tile-grid">{activeItems.map((item, i) => tab === 'similarArtists'
      ? <ArtistTile key={`artist-${i}`} artist={item} subtext="Based on your library" />
      : <AlbumTile key={`album-${i}`} album={item} subtext={item.artistName} size="tile" />)}</div>
  </div>;
}

export const discoverWidget = {
  id: 'spotify-discover',
  title: 'Spotify Discover',
  icon: '🧭',
  defaultSize: 'lg',
  route: '/discover',
  defaultVisible: true,
  render: (ctx) => {
    const payload = ctx?.data?.discover || defaults;
    return {
      body: <DiscoverTabs payload={payload} />,
      footer: <Link to="/discover" className="card-link">View All</Link>
    };
  }
};
