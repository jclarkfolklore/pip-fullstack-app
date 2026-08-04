// Tiny hash router. No history-API/pushState games (keeps it bulletproof
// under file://) — just location.hash, which works identically whether the
// app is served or opened as a local file.

const listeners = new Set();
let current = 'dashboard';

function parseHash() {
  const raw = (location.hash || '#dashboard').replace(/^#\/?/, '');
  return raw || 'dashboard';
}

export function currentView() {
  return current;
}

export function navigateTo(viewId) {
  if (location.hash.replace(/^#\/?/, '') === viewId) {
    // force a re-emit even if the hash didn't change
    emit(viewId, viewId);
    return;
  }
  location.hash = `#/${viewId}`;
}

export function goHome() {
  navigateTo('dashboard');
}

function emit(viewId, previous) {
  current = viewId;
  for (const fn of listeners) fn(viewId, previous);
}

export function onNavigate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener('hashchange', () => {
  const previous = current;
  emit(parseHash(), previous);
});

current = parseHash();
