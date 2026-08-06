const { db } = require('../db');

// Cross-entity search — Inbox notes + Tasks + Notes + tags, unified into one
// result list. Adding a new searchable entity later just means adding
// another query + result mapping here; the UI (search panel/overlay)
// doesn't need to change.
function search(query, { limit = 30 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const like = `%${q}%`;

  const inboxRows = db
    .prepare(
      `SELECT id, title, body_md AS snippet, stage, source_type, project_id, created_at
       FROM inbox_items
       WHERE title LIKE ? OR body_md LIKE ? OR outcome_md LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, like, limit)
    .map((r) => ({
      type: 'inbox',
      id: r.id,
      title: r.title || '(untitled)',
      snippet: r.snippet,
      meta: r.stage,
      sourceType: r.source_type,
      projectId: r.project_id,
      date: r.created_at
    }));

  const taskRows = db
    .prepare(
      `SELECT id, title, notes_md AS snippet, status, project_id, created_at
       FROM tasks
       WHERE title LIKE ? OR notes_md LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limit)
    .map((r) => ({
      type: 'task',
      id: r.id,
      title: r.title,
      snippet: r.snippet,
      meta: r.status,
      sourceType: null,
      projectId: r.project_id,
      date: r.created_at
    }));

  const noteRows = db
    .prepare(
      `SELECT id, title, body_md AS snippet, source_type, project_id, created_at
       FROM notes
       WHERE title LIKE ? OR body_md LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limit)
    .map((r) => ({
      type: 'note',
      id: r.id,
      title: r.title || '(untitled)',
      snippet: r.snippet,
      meta: null,
      sourceType: r.source_type,
      projectId: r.project_id,
      date: r.created_at
    }));

  // Journal entries have no title — the date is the identity, so that's what
  // the result shows. They were missing from search entirely, which made the
  // work journal the one thing you couldn't find anything in.
  const journalRows = db
    .prepare(
      `SELECT id, body_md AS snippet, created_at
       FROM journal_entries
       WHERE body_md LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, limit)
    .map((r) => ({
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
      projectId: null,
      date: r.created_at
    }));

  const tagRows = db
    .prepare(
      `SELECT et.entity_type, et.entity_id FROM entity_tags et
       JOIN tags t ON t.id = et.tag_id
       WHERE t.name LIKE ?`
    )
    .all(like)
    .map((r) => tagMatchToRow(r))
    .filter(Boolean);

  const seen = new Set();
  const combined = [...inboxRows, ...taskRows, ...noteRows, ...journalRows, ...tagRows].filter((row) => {
    const key = `${row.type}:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  return combined.slice(0, limit);
}

function tagMatchToRow({ entity_type: entityType, entity_id: entityId }) {
  const table = { inbox: 'inbox_items', task: 'tasks', note: 'notes' }[entityType];
  if (!table) return null;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entityId);
  if (!row) return null;
  const titleField = row.title;
  const snippet = row.body_md !== undefined ? row.body_md : row.notes_md;
  return {
    type: entityType,
    id: row.id,
    title: titleField || '(untitled)',
    snippet,
    meta: row.stage || row.status || null,
    sourceType: row.source_type || null,
    projectId: row.project_id || null,
    date: row.created_at,
    matchedTag: true
  };
}

module.exports = { search };
