const { db } = require('../db');

// Cross-entity search — Inbox, Tasks, Notes, Journal and tags, unified into
// one result list. Adding a new searchable entity means adding one query +
// mapping here; the UI doesn't change.
//
// search() and searchIndex() share ONE set of queries and mappings on purpose.
// The static snapshot (scripts/pip-snapshot.js) can't capture search — it's a
// function of the query, not a fixed response — so it ships the index and
// filters in the browser. If the index were built by a second set of queries,
// static results would drift from live results the first time a field changed
// here. Instead `where` is simply omitted when collecting everything.

// Each entity contributes: the SQL projection, how many text columns the
// filtered form searches, and how to shape a row into a result.
const SOURCES = [
  {
    type: 'inbox',
    select: `SELECT id, title, body_md AS snippet, stage, source_type, project_id, created_at FROM inbox_items`,
    where: 'title LIKE ? OR body_md LIKE ? OR outcome_md LIKE ?',
    params: 3,
    order: 'created_at DESC',
    shape: (r) => ({
      type: 'inbox',
      id: r.id,
      title: r.title || '(untitled)',
      snippet: r.snippet,
      meta: r.stage,
      sourceType: r.source_type,
      projectId: r.project_id,
      date: r.created_at
    })
  },
  {
    type: 'task',
    select: `SELECT id, title, notes_md AS snippet, status, project_id, created_at FROM tasks`,
    where: 'title LIKE ? OR notes_md LIKE ?',
    params: 2,
    order: 'created_at DESC',
    shape: (r) => ({
      type: 'task',
      id: r.id,
      title: r.title,
      snippet: r.snippet,
      meta: r.status,
      sourceType: null,
      projectId: r.project_id,
      date: r.created_at
    })
  },
  {
    type: 'note',
    select: `SELECT id, title, body_md AS snippet, source_type, project_id, created_at FROM notes`,
    where: 'title LIKE ? OR body_md LIKE ?',
    params: 2,
    order: 'created_at DESC',
    shape: (r) => ({
      type: 'note',
      id: r.id,
      title: r.title || '(untitled)',
      snippet: r.snippet,
      meta: null,
      sourceType: r.source_type,
      projectId: r.project_id,
      date: r.created_at
    })
  },
  {
    // Journal entries have no title — the date is the identity.
    type: 'journal',
    select: `SELECT id, body_md AS snippet, project_id, created_at FROM journal_entries`,
    where: 'body_md LIKE ?',
    params: 1,
    order: 'created_at DESC',
    shape: (r) => ({
      type: 'journal',
      id: r.id,
      title: new Date(r.created_at).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }),
      snippet: r.snippet,
      meta: null,
      sourceType: null,
      projectId: r.project_id,
      date: r.created_at
    })
  }
];

// `like` of null collects everything — that's the index.
function collect(like, limit) {
  const out = [];
  for (const src of SOURCES) {
    const sql =
      like === null
        ? `${src.select} ORDER BY ${src.order} LIMIT ?`
        : `${src.select} WHERE ${src.where} ORDER BY ${src.order} LIMIT ?`;
    const params = like === null ? [limit] : [...Array(src.params).fill(like), limit];
    for (const row of db.prepare(sql).all(...params)) out.push(src.shape(row));
  }
  return out;
}

const TAG_TABLE = { inbox: 'inbox_items', task: 'tasks', note: 'notes' };

function tagMatchToRow({ entity_type: entityType, entity_id: entityId }) {
  const table = TAG_TABLE[entityType];
  if (!table) return null;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entityId);
  if (!row) return null;
  return {
    type: entityType,
    id: row.id,
    title: row.title || '(untitled)',
    snippet: row.body_md !== undefined ? row.body_md : row.notes_md,
    meta: row.stage || row.status || null,
    sourceType: row.source_type || null,
    projectId: row.project_id || null,
    date: row.created_at,
    matchedTag: true
  };
}

function dedupe(rows, limit) {
  const seen = new Set();
  const out = rows.filter((row) => {
    const key = `${row.type}:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  out.sort((a, b) => new Date(b.date) - new Date(a.date));
  return out.slice(0, limit);
}

function search(query, { limit = 30 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const like = `%${q}%`;

  const tagRows = db
    .prepare(
      `SELECT et.entity_type, et.entity_id FROM entity_tags et
       JOIN tags t ON t.id = et.tag_id
       WHERE t.name LIKE ?`
    )
    .all(like)
    .map(tagMatchToRow)
    .filter(Boolean);

  return dedupe([...collect(like, limit), ...tagRows], limit);
}

// Every searchable row, already shaped. Served at /api/search/index and
// captured by the static snapshot, which filters it in the browser.
function searchIndex({ limit = 5000 } = {}) {
  return dedupe(collect(null, limit), limit);
}

module.exports = { search, searchIndex };
