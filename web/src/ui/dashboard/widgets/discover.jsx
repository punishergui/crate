import React from 'react';
import { Link } from 'react-router-dom';
import { AlbumTile, ArtistTile } from './helpers';

const defaults = {
  newForYou: [{ title: 'Caligula\'s Horse Essentials', artistName: 'Caligula\'s Horse' }, { title: 'Periphery V', artistName: 'Periphery' }],
  weeklyPicks: [{ title: 'Abyss', artistName: 'Unprocessed' }, { title: 'Voidkind', artistName: 'Dvne' }],
  similarArtists: [{ name: 'Monuments' }, { name: 'Northlane' }, { name: 'Loathe' }]
};

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
      body: <div className="discover-columns">
        <div><h4>New for You</h4>{(payload.newForYou || defaults.newForYou).slice(0, 3).map((item, i) => <AlbumTile key={`new-${i}`} album={item} subtext={item.artistName} size="tile" />)}</div>
        <div><h4>Weekly Picks</h4>{(payload.weeklyPicks || defaults.weeklyPicks).slice(0, 3).map((item, i) => <AlbumTile key={`weekly-${i}`} album={item} subtext={item.artistName} size="tile" />)}</div>
        <div><h4>Similar Artists</h4>{(payload.similarArtists || defaults.similarArtists).slice(0, 3).map((item, i) => <ArtistTile key={`artist-${i}`} artist={item} subtext="Based on your library" />)}</div>
      </div>,
      footer: <Link to="/discover" className="card-link">View All</Link>
    };
  }
};
