// Whether the desktop nav panel is shown, and a way to react when it changes.
//
// Off by default: on desktop those four buttons cost a whole panel at the top
// of the right column, and everything they do is reachable elsewhere — HOME
// from each view's own back button, back/forward from the browser, theme from
// Settings. That space is better spent on Clu3, the forecast and search.
//
// DESKTOP ONLY. On narrow screens the same markup is the bottom tab bar, and
// it holds the only route to search (the side panel is hidden there and search
// opens as an overlay). Hiding it there would strand you, so the CSS scopes
// this to the desktop breakpoint — see device.css.
//
// localStorage rather than app_meta, deliberately: it's a per-device display
// preference, and it keeps working in a read-only snapshot, which can't write
// to the server at all.

const KEY = 'pip-nav-visible';

export function getNavVisible() {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch (_) {
    return false;
  }
}

const listeners = new Set();

export function onNavVisibleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setNavVisible(visible) {
  try {
    localStorage.setItem(KEY, visible ? 'true' : 'false');
  } catch (_) {
    /* private browsing — it just won't persist */
  }
  applyNavVisible();
  for (const fn of listeners) fn(visible);
}

// The layout carries the state as a data attribute so it's pure CSS from
// there, and the rule can be scoped to the desktop breakpoint.
export function applyNavVisible() {
  const layout = document.querySelector('.pip-layout');
  if (layout) layout.dataset.nav = getNavVisible() ? 'shown' : 'hidden';
}
