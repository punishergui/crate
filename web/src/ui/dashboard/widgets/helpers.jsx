import React from 'react';
import Artwork from '../../components/Artwork';
import { getAlbumArtUrl, getArtistArtUrl } from '../../lib/artwork';

export function SkeletonRows({ rows = 3 }) {
  return <div className="skeleton-stack">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton-row" />)}</div>;
}

export function AlbumTile({ album, subtext, size = 'tile' }) {
  return <article className="media-tile media-tile-art">
    <Artwork src={getAlbumArtUrl(album, 512)} alt={`${album.title || 'Album'} cover`} fallbackSeed={`${album.artistName || ''} ${album.title || ''}`} size={size} badge={album.artworkSource || ''} />
    <div><strong>{album.title || 'Unknown release'}</strong><span className="muted">{subtext || album.artistName || 'Unknown artist'}</span></div>
  </article>;
}

export function ArtistTile({ artist, subtext }) {
  return <article className="media-tile media-tile-art">
    <Artwork src={getArtistArtUrl(artist, 512)} alt={`${artist.name || 'Artist'} artwork`} fallbackSeed={artist.name || 'Artist'} size="tile" />
    <div><strong>{artist.name || 'Unknown artist'}</strong><span className="muted">{subtext || 'Discover mix'}</span></div>
  </article>;
}

export function CoverStrip({ items = [], empty = 'No artwork yet.' }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <div className="cover-strip">{items.map((item, index) => <Artwork key={`${item.id || item.title || 'cover'}-${index}`} src={getAlbumArtUrl(item, 512)} alt={item.title || 'Album cover'} fallbackSeed={`${item.artistName || ''} ${item.title || ''}`} size="lg" />)}</div>;
}
