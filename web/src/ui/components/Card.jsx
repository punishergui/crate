import React from 'react';

export default function Card({ title, icon, right, footer, children, className = '', dragProps, menuLabel = 'Widget menu' }) {
  return <section className={`card app-card ${className}`.trim()}>
    <header className="card__head card-head">
      <div className="card-title-wrap">
        <span className="card-icon" aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
      </div>
      <div className="card-head-actions">
        {right || null}
        <button className="icon-btn" aria-label={menuLabel} type="button">⋯</button>
        {dragProps ? <button className="icon-btn drag-handle" aria-label="Drag widget" type="button" {...dragProps}>⠿</button> : null}
      </div>
    </header>
    <div className="card__body card-body">{children}</div>
    {footer ? <footer className="card__foot card-footer">{footer}</footer> : null}
  </section>;
}
