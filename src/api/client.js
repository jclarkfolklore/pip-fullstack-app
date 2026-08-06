// Thin fetch wrapper + a shared SSE connection for live-refresh. This
// replaces the old sql.js/IndexedDB db/client.js — the frontend now talks to
// the Express backend over the same origin instead of running SQLite itself.
//
// STATIC MODE. The same bundle also runs as a serverless, read-only snapshot
// (scripts/pip-snapshot.js). Everything static-specific is confined to this
// file, which is what lets the snapshot survive UI and data-model changes: no
// widget knows or cares which mode it's in.
//
//   reads   rewritten to the captured .json file for that path
//   search  filtered in the browser against the captured index, because a
//           query's response can't be captured ahead of time
//   writes  refused, loudly enough to debug but without breaking the UI
//   SSE     never opened; nothing can change

const STATIC = typeof window !== 'undefined' && window.__PIP_STATIC__ ? window.__PIP_STATIC__ : null;

export const isStatic = () => Boolean(STATIC);
export const staticInfo = () => STATIC;

// Query params can't survive as filenames, so the snapshot stores the
// unfiltered collection and filtering happens below.
function splitPath(path) {
  const [base, query = ''] = path.split('?');
  return { base, params: new URLSearchParams(query) };
}

let searchIndexCache = null;

async function fetchJsonFile(base) {
  const res = await fetch(`.${base}.json`);
  if (!res.ok) throw new Error(`missing from snapshot: ${base}`);
  return res.json();
}

// Mirrors what the server's search does, over the captured index. The index
// is already SHAPED by searchRepo, so results look identical to live ones —
// only the text match happens here.
async function staticSearch(params) {
  const q = (params.get('q') || '').trim().toLowerCase();
  if (!q) return [];
  if (!searchIndexCache) searchIndexCache = await fetchJsonFile('/api/search/index');
  const limit = Number(params.get('limit')) || 30;
  return searchIndexCache
    .filter((r) => `${r.title || ''} ${r.snippet || ''}`.toLowerCase().includes(q))
    .slice(0, limit);
}

// Generic filtering for the params the widgets actually send. The snapshot
// holds unfiltered collections, so this stands in for the server's WHERE
// clause. It approximates rather than reimplements — this is a read-only
// demo, and an exact copy of every repo's filtering would be the kind of
// duplicated logic that goes stale.
function applyFilters(rows, params) {
  if (!Array.isArray(rows)) return rows;
  let out = rows;
  const eq = (row, col, val) => String(row[col] ?? '') === String(val);

  if (params.get('stage')) out = out.filter((r) => eq(r, 'stage', params.get('stage')));
  if (params.get('status')) out = out.filter((r) => eq(r, 'status', params.get('status')));
  if (params.get('project')) out = out.filter((r) => eq(r, 'project_id', params.get('project')));
  if (params.get('tag')) out = out.filter((r) => (r.tags || []).includes(params.get('tag')));
  if (params.get('search')) {
    const q = params.get('search').toLowerCase();
    out = out.filter((r) =>
      `${r.title || ''} ${r.body_md || ''} ${r.notes_md || ''}`.toLowerCase().includes(q)
    );
  }
  return out;
}

async function staticGet(path) {
  const { base, params } = splitPath(path);

  if (base === '/api/search') return staticSearch(params);

  // Attachments are keyed by entity in the snapshot rather than by query.
  if (base === '/api/attachments') {
    const type = params.get('entityType');
    const ids = params.get('entityIds');
    if (ids) {
      const out = {};
      for (const id of ids.split(',').filter(Boolean)) {
        try {
          out[id] = await fetchJsonFile(`/api/attachments/${type}/${id}`);
        } catch (_) {
          /* no attachments for this one */
        }
      }
      return out;
    }
    try {
      return await fetchJsonFile(`/api/attachments/${type}/${params.get('entityId')}`);
    } catch (_) {
      return [];
    }
  }

  const data = await fetchJsonFile(base);
  return applyFilters(data, params);
}

async function request(method, path, body) {
  if (STATIC) {
    if (method !== 'GET') {
      // Not thrown: a rejected promise here would surface as a broken widget.
      // The UI shows its read-only banner; this is for the console.
      console.warn(`[pip] read-only snapshot — ignored ${method} ${path}`);
      return null;
    }
    return staticGet(path);
  }

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
  // Nothing can change in a snapshot, so opening a connection would only
  // produce a reconnect loop against a 404.
  if (STATIC) return () => {};
  if (!source) connect();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
