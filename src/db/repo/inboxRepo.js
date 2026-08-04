import { all, get, run } from '../client.js';

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function ensureTag(name) {
  const clean = name.trim().toLowerCase();
  if (!clean) return null;
  const existing = get('SELECT id FROM tags WHERE name = ?', [clean]);
  if (existing) return existing.id;
  const id = newId();
  run('INSERT INTO tags (id, name) VALUES (?, ?)', [id, clean]);
  return id;
}

function tagsForItem(itemId) {
  return all(
    `SELECT t.name FROM tags t
     JOIN inbox_item_tags it ON it.tag_id = t.id
     WHERE it.inbox_item_id = ?
     ORDER BY t.name`,
    [itemId]
  ).map((r) => r.name);
}

function attachTags(itemId, tagNames = []) {
  run('DELETE FROM inbox_item_tags WHERE inbox_item_id = ?', [itemId]);
  for (const name of tagNames) {
    const tagId = ensureTag(name);
    if (!tagId) continue;
    run('INSERT OR IGNORE INTO inbox_item_tags (inbox_item_id, tag_id) VALUES (?, ?)', [
      itemId,
      tagId
    ]);
  }
}

export function findByImportHash(hash) {
  if (!hash) return null;
  return get('SELECT id FROM inbox_items WHERE import_hash = ?', [hash]);
}

// Used by the "Import Notes" flow (drops written by Claude into the
// inbox/drops folder). Idempotent on the note's own id — re-importing the
// same folder never duplicates a note, since the id travels with the file's
// frontmatter rather than being generated fresh each time.
export function importDroppedNote({ id, title = '', bodyMd = '', tags = [], createdAt, source = 'claude' }) {
  const already = get('SELECT id FROM inbox_items WHERE id = ?', [id]);
  if (already) return { id, created: false };
  const created = createdAt || nowIso();
  run(
    `INSERT INTO inbox_items
      (id, title, body_md, source, stage, outcome_md, created_at, stage_changed_at, import_hash)
     VALUES (?, ?, ?, ?, 'new', '', ?, ?, ?)`,
    [id, title, bodyMd, source, created, created, id]
  );
  attachTags(id, tags);
  return { id, created: true };
}

export function createInboxItem({
  title = '',
  bodyMd = '',
  source = 'me',
  tags = [],
  importHash = null,
  createdAt = nowIso()
} = {}) {
  const id = newId();
  run(
    `INSERT INTO inbox_items
      (id, title, body_md, source, stage, outcome_md, created_at, stage_changed_at, import_hash)
     VALUES (?, ?, ?, ?, 'new', '', ?, ?, ?)`,
    [id, title, bodyMd, source, createdAt, createdAt, importHash]
  );
  attachTags(id, tags);
  return id;
}

export function listInboxItems({ stage = null, tag = null, search = '', sort = 'created_desc' } = {}) {
  const where = [];
  const params = [];
  if (stage) {
    where.push('i.stage = ?');
    params.push(stage);
  }
  if (search) {
    where.push('(i.title LIKE ? OR i.body_md LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    where.push(
      `i.id IN (SELECT it.inbox_item_id FROM inbox_item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)`
    );
    params.push(tag.toLowerCase());
  }
  const orderBy =
    {
      created_desc: 'i.created_at DESC',
      created_asc: 'i.created_at ASC',
      stage_changed_desc: 'i.stage_changed_at DESC',
      title_asc: 'i.title COLLATE NOCASE ASC'
    }[sort] || 'i.created_at DESC';

  const sql = `SELECT i.* FROM inbox_items i ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY ${orderBy}`;

  return all(sql, params).map((row) => ({ ...row, tags: tagsForItem(row.id) }));
}

export function getInboxItem(id) {
  const row = get('SELECT * FROM inbox_items WHERE id = ?', [id]);
  return row ? { ...row, tags: tagsForItem(id) } : null;
}

export function setStage(id, stage) {
  run('UPDATE inbox_items SET stage = ?, stage_changed_at = ? WHERE id = ?', [
    stage,
    nowIso(),
    id
  ]);
}

export function updateTags(id, tagNames) {
  attachTags(id, tagNames);
}

export function resolveWithOutcome(id, outcomeMd) {
  run(
    "UPDATE inbox_items SET stage = 'resolved', outcome_md = ?, stage_changed_at = ? WHERE id = ?",
    [outcomeMd, nowIso(), id]
  );
}

export function linkResolvedTask(id, taskId) {
  run('UPDATE inbox_items SET resolved_task_id = ? WHERE id = ?', [taskId, id]);
}

export function archiveItem(id) {
  setStage(id, 'archived');
}

export function deleteItem(id) {
  run('DELETE FROM inbox_items WHERE id = ?', [id]);
}

export function stageCounts() {
  const rows = all('SELECT stage, COUNT(*) AS n FROM inbox_items GROUP BY stage');
  const out = { new: 0, active: 0, resolved: 0, archived: 0 };
  for (const r of rows) out[r.stage] = r.n;
  return out;
}

export function allTagNames() {
  return all('SELECT name FROM tags ORDER BY name').map((r) => r.name);
}
