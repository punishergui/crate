import React from 'react';

const DEFAULT_POS = { x: 0, y: 0 };

const HoverPreviewContext = React.createContext({
  hoverItem: null,
  cursorPos: DEFAULT_POS,
  setHoverActive: () => {},
  setHoverPos: () => {},
  clearHover: () => {}
});

export function HoverPreviewProvider({ children }) {
  const [hoverItem, setHoverItem] = React.useState(null);
  const [cursorPos, setCursorPos] = React.useState(DEFAULT_POS);

  const setHoverActive = React.useCallback((item) => {
    setHoverItem(item || null);
  }, []);

  const setHoverPos = React.useCallback((pos) => {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
    setCursorPos((prev) => (prev.x === pos.x && prev.y === pos.y ? prev : pos));
  }, []);

  const clearHover = React.useCallback(() => {
    setHoverItem(null);
  }, []);

  const value = React.useMemo(() => ({
    hoverItem,
    cursorPos,
    setHoverActive,
    setHoverPos,
    clearHover
  }), [hoverItem, cursorPos, setHoverActive, setHoverPos, clearHover]);

  return <HoverPreviewContext.Provider value={value}>{children}</HoverPreviewContext.Provider>;
}

export function useHoverPreview() {
  return React.useContext(HoverPreviewContext);
}
