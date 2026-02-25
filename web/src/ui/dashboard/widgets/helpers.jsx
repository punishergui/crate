import React from 'react';
import Artwork from '../../components/Artwork';
import CoverTile from '../../components/CoverTile';

export function SkeletonRows({ rows = 3 }) {
  return <div className="skeleton-stack">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton-row" />)}</div>;
}

export function AlbumTile({ album, subtext, size = 'tile-lg' }) {
  return <article className="media-tile media-tile-art">
    <Artwork kind="album" id={album?.id || album?.albumId} title={album.title || 'Unknown release'} subtitle={album.artistName || 'Unknown artist'} alt={`${album.title || 'Album'} cover`} fallbackSeed={`${album.artistName || ''} ${album.title || ''}`} size={size} popout popoutTitle={album.title || 'Unknown release'} popoutSubtitle={album.artistName || 'Unknown artist'} badge={album.artworkSource || ''} />
    <div><strong>{album.title || 'Unknown release'}</strong><span className="muted">{subtext || album.artistName || 'Unknown artist'}</span></div>
  </article>;
}

export function ArtistTile({ artist, subtext }) {
  return <article className="media-tile media-tile-art">
    <Artwork kind="artist" id={artist?.id || artist?.artistId} title={artist.name || 'Unknown artist'} subtitle={subtext || 'Discover mix'} alt={`${artist.name || 'Artist'} artwork`} fallbackSeed={artist.name || 'Artist'} size="tile-lg" popout popoutTitle={artist.name || 'Unknown artist'} popoutSubtitle={subtext || 'Discover mix'} />
    <div><strong>{artist.name || 'Unknown artist'}</strong><span className="muted">{subtext || 'Discover mix'}</span></div>
  </article>;
}

function CoverStripTile({ item, size, showMetaOnHover }) {
  return <article className="cover-tile" style={{ '--cover-size': size === 'lg' ? '132px' : size === 'md' ? '124px' : '96px' }}>
    <CoverTile size={size === 'lg' ? 'md' : 'sm'} albumId={item} title={item.title || 'Untitled'} subtitle={item.artistName || 'Unknown artist'} />
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
  return <div className={`cover-strip-wrap ${className}`.trim()}><div className="cover-strip" ref={stripRef} onWheel={onWheel}>{items.map((item, index) => <CoverStripTile key={`${item.id || item.title || 'cover'}-${index}`} item={item} size={size} showMetaOnHover={showMetaOnHover} />)}</div></div>;
}
