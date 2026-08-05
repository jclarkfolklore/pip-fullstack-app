// Shared theme state — read/written by both the nav-bar cycle button
// (shell.js) and the Settings widget, so the two stay in sync.
export const THEMES = ['default', 'amber', 'mono', 'night'];

const THEME_LABEL = { default: 'Sage', amber: 'Amber', mono: 'Mono', night: 'Night' };

export function themeLabel(name) {
  return THEME_LABEL[name] || name;
}

export function getTheme() {
  try {
    const saved = localStorage.getItem('pip-theme');
    if (THEMES.includes(saved)) return saved;
  } catch (_) {
    /* ignore — falls through to default */
  }
  return 'default';
}

const listeners = new Set();

// Lets any mounted UI (the nav cycle button, the Settings widget) react when
// the theme changes from somewhere else, instead of going stale.
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setTheme(name) {
  const layout = document.querySelector('.pip-layout');
  if (layout) {
    if (name === 'default') delete layout.dataset.theme;
    else layout.dataset.theme = name;
  }
  try {
    localStorage.setItem('pip-theme', name);
  } catch (_) {
    /* ignore — theme just won't persist across reloads */
  }
  for (const fn of listeners) fn(name);
}
