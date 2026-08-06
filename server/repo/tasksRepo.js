const crypto = require('crypto');
const { db } = require('../db');
const { logEvent } = require('./activityRepo');
const { tagsFor, attachTags } = require('./tagsRepo');
const attachmentsRepo = require('./attachmentsRepo');

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function hydrate(row) {
  return row ? { ...row, tags: tagsFor('task', row.id) } : null;
}

function createTask({ title, notesMd = '', dueAt = null, projectId = null, fromInboxItemId = null, tags = [] } = {}) {
  const id = newId();
  db.prepare(
    `INSERT INTO tasks (id, title, notes_md, status, project_id, due_at, created_at, from_inbox_item_id)
     VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`
  ).run(id, title, notesMd, projectId, dueAt, nowIso(), fromInboxItemId);
  attachTags('task', id, tags);
  logEvent('task', id, 'task_created', { title, fromInboxItemId });
  return id;
}

// Create with a caller-supplied id, idempotent on that id. This is what makes
// syncing from an external system (Monday, ADO, …) safe to re-run: the
// external id becomes the PIP id, so a second sync updates rather than
// duplicates. Mirrors inboxRepo.importDroppedNote.
function importTask({
  id,
  title,
  notesMd = '',
  dueAt = null,
  projectId = null,
  tags = [],
  createdAt,
  sourceType = 'manual',
  sourceUrl = null,
  sourceRef = null,
  detailsMd = null,
  sourceMeta = null
} = {}) {
  if (!id) throw new Error('id is required');
  const already = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (already) return { id, created: false };
  db.prepare(
    `INSERT INTO tasks (id, title, notes_md, status, project_id, due_at, created_at, source_type, source_url, source_ref, details_md, source_meta_json)
     VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    notesMd,
    projectId,
    dueAt,
    createdAt || nowIso(),
    sourceType,
    sourceUrl,
    sourceRef,
    detailsMd,
    sourceMeta ? JSON.stringify(sourceMeta) : null
  );
  attachTags('task', id, tags);
  logEvent('task', id, 'task_created', { title, imported: true, sourceRef });
  return { id, created: true };
}

function listTasks({ status = null, project = null, tag = null, search = '', sort = 'created_desc' } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (project) {
    where.push('project_id = ?');
    params.push(project);
  }
  if (search) {
    where.push('(title LIKE ? OR notes_md LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    where.push(
      `id IN (SELECT et.entity_id FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type='task' AND t.name = ?)`
    );
    params.push(tag.toLowerCase());
  }
  const orderBy =
    {
      created_desc: 'created_at DESC',
      due_asc: 'due_at IS NULL, due_at ASC',
      title_asc: 'title COLLATE NOCASE ASC'
    }[sort] || 'created_at DESC';

  return db
    .prepare(`SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`)
    .all(...params)
    .map(hydrate);
}

function getTask(id) {
  return hydrate(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function setTaskStatus(id, status) {
  const completedAt = status === 'done' ? nowIso() : null;
  db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(status, completedAt, id);
  logEvent('task', id, status === 'done' ? 'task_completed' : 'task_status_changed', { status });
}

function updateFields(id, fields = {}) {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!existing) return null;
  const next = {
    title: fields.title !== undefined ? fields.title : existing.title,
    notes_md: fields.notesMd !== undefined ? fields.notesMd : existing.notes_md,
    due_at: fields.dueAt !== undefined ? fields.dueAt : existing.due_at,
    project_id: fields.projectId !== undefined ? fields.projectId : existing.project_id,
    // Lets a re-sync backfill the ticket number/link onto tasks imported
    // before those columns existed.
    source_type: fields.sourceType !== undefined ? fields.sourceType : existing.source_type,
    source_url: fields.sourceUrl !== undefined ? fields.sourceUrl : existing.source_url,
    source_ref: fields.sourceRef !== undefined ? fields.sourceRef : existing.source_ref,
    details_md: fields.detailsMd !== undefined ? fields.detailsMd : existing.details_md,
    source_meta_json:
      fields.sourceMeta !== undefined ? JSON.stringify(fields.sourceMeta) : existing.source_meta_json
  };
  db.prepare(
    `UPDATE tasks SET title=?, notes_md=?, due_at=?, project_id=?, source_type=?, source_url=?, source_ref=?,
       details_md=?, source_meta_json=? WHERE id=?`
  ).run(
    next.title,
    next.notes_md,
    next.due_at,
    next.project_id,
    next.source_type,
    next.source_url,
    next.source_ref,
    next.details_md,
    next.source_meta_json,
    id
  );
  if (fields.tags !== undefined) attachTags('task', id, fields.tags);
  logEvent('task', id, 'task_updated', { fields: Object.keys(fields) });
  return getTask(id);
}

function deleteTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  db.prepare("DELETE FROM entity_tags WHERE entity_type='task' AND entity_id = ?").run(id);
  // Attachments have no FK to cascade from — see attachmentsRepo.
  attachmentsRepo.deleteForEntity('task', id);
}

function listTasksFromInboxItem(inboxItemId) {
  return db
    .prepare('SELECT * FROM tasks WHERE from_inbox_item_id = ? ORDER BY created_at ASC')
    .all(inboxItemId)
    .map(hydrate);
}

function taskCounts() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all();
  const out = { open: 0, doing: 0, done: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

module.exports = {
  createTask,
  importTask,
  listTasks,
  getTask,
  setTaskStatus,
  updateFields,
  deleteTask,
  taskCounts,
  listTasksFromInboxItem
};
