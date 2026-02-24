import React from 'react';
import { Link } from 'react-router-dom';
import { CoverStrip } from './helpers';

export const missingAlbumsWidget = {
  id: 'missing-albums',
  title: 'Missing Albums',
  icon: '🧩',
  defaultSize: 'md',
  route: '/missing',
  defaultVisible: true,
  render: (ctx) => {
    const wishlist = ctx?.data?.wishlistCount ?? 0;
    const missingTotal = ctx?.data?.missingTotal ?? 0;
    const missing = (ctx?.data?.missing || []).slice(0, 8);
    return {
      body: <div className="widget-stack"><p><strong>Wanted:</strong> {wishlist} · <strong>Missing:</strong> {missingTotal}</p><CoverStrip items={missing} empty="No missing albums detected." /></div>,
      footer: <div className="inline-actions"><Link to="/missing" className="card-link">View Wishlist</Link><Link to="/downloads" className="card-link">Find on Soulseek</Link></div>
    };
  }
};
