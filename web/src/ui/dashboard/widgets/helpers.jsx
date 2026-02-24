import React from 'react';
import Artwork from '../../components/Artwork';
import { getAlbumArtUrl, getArtistArtUrl } from '../../lib/artwork';

export function SkeletonRows({ rows = 3 }) {
  return <div className="skeleton-stack">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton-row" />)}</div>;
}

export function AlbumTile({ album, subtext, size = 'tile-lg' }) {
  return <article className="media-tile media-tile-art">
    <Artwork src={getAlbumArtUrl(album, 512)} alt={`${album.title || 'Album'} cover`} fallbackSeed={`${album.artistName || ''} ${album.title || ''}`} size={size} popout popoutTitle={album.title || 'Unknown release'} popoutSubtitle={album.artistName || 'Unknown artist'} badge={album.artworkSource || ''} />
    <div><strong>{album.title || 'Unknown release'}</strong><span className="muted">{subtext || album.artistName || 'Unknown artist'}</span></div>
  </article>;
}

export function ArtistTile({ artist, subtext }) {
  return <article className="media-tile media-tile-art">
    <Artwork src={getArtistArtUrl(artist, 512)} alt={`${artist.name || 'Artist'} artwork`} fallbackSeed={artist.name || 'Artist'} size="tile-lg" popout popoutTitle={artist.name || 'Unknown artist'} popoutSubtitle={subtext || 'Discover mix'} />
    <div><strong>{artist.name || 'Unknown artist'}</strong><span className="muted">{subtext || 'Discover mix'}</span></div>
  </article>;
}

function CoverTile({ item, size, showMetaOnHover }) {
  return <article className="cover-tile" style={{ '--cover-size': size === 'lg' ? '132px' : size === 'md' ? '124px' : '96px' }}>
    <div className="cover">
      <Artwork src={getAlbumArtUrl(item, 512)} alt={item.title || 'Album cover'} fallbackSeed={`${item.artistName || ''} ${item.title || ''}`} size="tile" popout popoutTitle={item.title || 'Unknown release'} popoutSubtitle={item.artistName || 'Unknown artist'} />
    </div>
    {showMetaOnHover ? <div className="cover-meta"><strong>{item.title || 'Untitled'}</strong> · <span className="muted">{item.artistName || 'Unknown artist'}</span></div> : null}
  </article>;
}

export function CoverStrip({ items = [], empty = 'No artwork yet.', size = 'md', showMetaOnHover = false, className = '' }) {
  const stripRef = React.useRef(null);

  const onWheel = (event) => {
    if (!stripRef.current || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    stripRef.current.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  if (!items.length) return <p className="muted">{empty}</p>;
  return <div className={`cover-strip-wrap ${className}`.trim()}><div className="cover-strip" ref={stripRef} onWheel={onWheel}>{items.map((item, index) => <CoverTile key={`${item.id || item.title || 'cover'}-${index}`} item={item} size={size} showMetaOnHover={showMetaOnHover} />)}</div></div>;
}
