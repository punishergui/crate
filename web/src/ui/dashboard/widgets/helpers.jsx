import React from 'react';

export function SkeletonRows({ rows = 3 }) {
  return <div className="skeleton-stack">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton-row" />)}</div>;
}

export function SimpleList({ items }) {
  return <ul className="widget-list">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
