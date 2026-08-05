// Thin fetch wrapper + a shared SSE connection for live-refresh. This
// replaces the old sql.js/IndexedDB db/client.js — the frontend now talks to
// the Express backend over the same origin instead of running SQLite itself.

async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch (_) {
      /* ignore */
    }
    throw new Error(`${method} ${path} failed: ${res.status} ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const apiGet = (path) => request('GET', path);
export const apiPost = (path, body) => request('POST', path, body);
export const apiPatch = (path, body) => request('PATCH', path, body);
export const apiDelete = (path) => request('DELETE', path);

export function qs(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

// --- live refresh -----------------------------------------------------
// One shared EventSource for the whole app; widgets subscribe via onChange
// the same way they used to subscribe to the old sql.js in-process pub/sub.
// Because the server polls SQLite's own PRAGMA data_version, this fires for
// changes made through the API *and* for changes Claude makes by editing
// the .sqlite file directly — the whole point of moving to a real server.
const listeners = new Set();
let source = null;
let reconnectTimer = null;

function connect() {
  source = new EventSource('/api/events');
  source.addEventListener('changed', () => {
    for (const fn of listeners) fn();
  });
  source.onerror = () => {
    source.close();
    source = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };
}

export function onChange(fn) {
  if (!source) connect();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
