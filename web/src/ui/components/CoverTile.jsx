import React from 'react';
import Artwork from './Artwork';

const SIZE_MAP = { sm: '96px', md: '140px', lg: '220px' };

export default function CoverTile({ size = 'md', albumId, title = 'Unknown release', subtitle = 'Unknown artist', className = '' }) {
  const px = SIZE_MAP[size] || SIZE_MAP.md;
  return <article className={`cover-tile-v2 ${className}`.trim()} style={{ '--coverSize': px }}>
    <Artwork
      kind="album"
      id={albumId?.id || albumId?.albumId || albumId}
      title={title}
      subtitle={subtitle}
      alt={`${title} cover`}
      fallbackSeed={`${subtitle} ${title}`}
      size="tile"
      popout
      popoutTitle={title}
      popoutSubtitle={subtitle}
      overlay={<div className="cover-tile-v2__overlay"><strong>{title}</strong><span>{subtitle}</span></div>}
    />
  </article>;
}
