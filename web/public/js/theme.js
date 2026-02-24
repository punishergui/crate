const THEME_KEY = 'crate.theme.v1';
const DEFAULT_THEME = 'neon-djent';

export function applyTheme(themeName) {
  const theme = themeName || DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  return theme;
}

export function loadThemeFromStorage() {
  const stored = localStorage.getItem(THEME_KEY);
  return applyTheme(stored || DEFAULT_THEME);
}

window.CRATE_THEME = { applyTheme, loadThemeFromStorage };
