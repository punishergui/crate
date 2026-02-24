import React from 'react';
import Card from '../components/Card';
import { widgetMap, widgetRegistry } from './widgets';
import './dashboard.css';

const LAYOUT_KEY = 'crate.dashboard.layout.v1';
const sizeToSpan = { sm: 3, md: 6, lg: 12 };

function defaultLayout() {
  return widgetRegistry.map((widget, index) => ({ id: widget.id, size: widget.defaultSize || 'md', visible: widget.defaultVisible !== false, order: Number.isInteger(widget.defaultOrder) ? widget.defaultOrder : index }));
}

function sanitizeLayout(raw) {
  if (!Array.isArray(raw)) return defaultLayout();
  const valid = raw
    .filter((item) => item && widgetMap[item.id])
    .map((item, index) => ({
      id: item.id,
      size: ['sm', 'md', 'lg'].includes(item.size) ? item.size : widgetMap[item.id].defaultSize,
      visible: item.visible !== false,
      order: Number.isFinite(item.order) ? item.order : index
    }));
  const missing = widgetRegistry.filter((widget) => !valid.find((item) => item.id === widget.id))
    .map((widget) => ({ id: widget.id, size: widget.defaultSize, visible: true, order: widget.defaultOrder }));
  return [...valid, ...missing].sort((a, b) => a.order - b.order).map((item, order) => ({ ...item, order }));
}

export default function DashboardPage() {
  const [data, setData] = React.useState(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [dragId, setDragId] = React.useState('');
  const [layout, setLayout] = React.useState(() => {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (!stored) return defaultLayout();
    try {
      return sanitizeLayout(JSON.parse(stored));
    } catch {
      return defaultLayout();
    }
  });

  React.useEffect(() => { fetch('/api/dashboard').then((r) => r.json()).then(setData).catch(() => setData(null)); }, []);

  React.useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  const ordered = [...layout].sort((a, b) => a.order - b.order);
  const visibleItems = ordered.filter((item) => item.visible);
  const hiddenItems = ordered.filter((item) => !item.visible);

  const updateItem = (id, updater) => setLayout((prev) => prev.map((item) => item.id === id ? updater(item) : item));

  const moveItem = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setLayout((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const fromIndex = sorted.findIndex((item) => item.id === fromId);
      const toIndex = sorted.findIndex((item) => item.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = sorted.splice(fromIndex, 1);
      sorted.splice(toIndex, 0, moved);
      return sorted.map((item, order) => ({ ...item, order }));
    });
  };

  const resetLayout = () => setLayout(defaultLayout());

  return <section className="page-stack">
    <div className="split-head">
      <h1>Dashboard</h1>
      <div className="inline-actions">
        <button className="btn" onClick={() => setIsEditing((v) => !v)}>{isEditing ? 'Done' : 'Customize'}</button>
        {isEditing ? <button className="btn" onClick={resetLayout}>Reset Layout</button> : null}
      </div>
    </div>

    {isEditing && hiddenItems.length ? <Card title="Hidden Widgets" icon="🙈" className="hidden-card">
      <div className="chip-row">
        {hiddenItems.map((item) => <button key={item.id} className="chip" onClick={() => updateItem(item.id, (current) => ({ ...current, visible: true }))}>Show {widgetMap[item.id].title}</button>)}
      </div>
    </Card> : null}

    <div className={`dashboard-grid ${isEditing ? 'editing' : ''}`}>
      {visibleItems.map((layoutItem) => {
        const widget = widgetMap[layoutItem.id];
        const rendered = widget.render({ data, layout: layoutItem });
        return <div
          key={widget.id}
          className={`widget-slot span-${sizeToSpan[layoutItem.size]}`}
          draggable={isEditing}
          onDragStart={() => setDragId(widget.id)}
          onDragOver={(event) => { if (isEditing) event.preventDefault(); }}
          onDrop={() => { if (isEditing) moveItem(dragId, widget.id); setDragId(''); }}
        >
          <Card
            title={widget.title}
            icon={widget.icon}
            footer={rendered.footer}
            dragProps={isEditing ? { onMouseDown: () => {}, tabIndex: -1 } : null}
            right={isEditing ? <div className="edit-controls">
              <select value={layoutItem.size} onChange={(event) => updateItem(widget.id, (current) => ({ ...current, size: event.target.value }))}>
                <option value="sm">Small</option>
                <option value="md">Medium</option>
                <option value="lg">Large</option>
              </select>
              <button className="icon-btn" onClick={() => updateItem(widget.id, (current) => ({ ...current, visible: false }))} aria-label={`Hide ${widget.title}`}>✕</button>
            </div> : null}
          >
            {rendered.body}
          </Card>
        </div>;
      })}
    </div>
  </section>;
}
