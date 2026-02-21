(function attachThemeApi() {
  const storageKey = 'crate.theme';
  function apply(themeId) {
    const next = themeId || 'neon-djent';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(storageKey, next);
    return next;
  }
  window.CRATE_THEME = {
    init(defaultTheme) {
      const stored = localStorage.getItem(storageKey);
      return apply(stored || defaultTheme || 'neon-djent');
    },
    apply,
    get() {
      return document.documentElement.getAttribute('data-theme') || localStorage.getItem(storageKey) || 'neon-djent';
    }
  };
})();
