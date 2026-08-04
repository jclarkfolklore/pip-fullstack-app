import { all, get, run } from '../client.js';

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

export function createTask({ title, notesMd = '', dueAt = null, fromInboxItemId = null } = {}) {
  const id = newId();
  run(
    `INSERT INTO tasks (id, title, notes_md, status, due_at, created_at, from_inbox_item_id)
     VALUES (?, ?, ?, 'open', ?, ?, ?)`,
    [id, title, notesMd, dueAt, nowIso(), fromInboxItemId]
  );
  return id;
}

export function listTasks({ status = null, sort = 'created_desc' } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const orderBy =
    {
      created_desc: 'created_at DESC',
      due_asc: "due_at IS NULL, due_at ASC",
      title_asc: 'title COLLATE NOCASE ASC'
    }[sort] || 'created_at DESC';

  return all(
    `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`,
    params
  );
}

export function getTask(id) {
  return get('SELECT * FROM tasks WHERE id = ?', [id]);
}

export function setTaskStatus(id, status) {
  const completedAt = status === 'done' ? nowIso() : null;
  run('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?', [status, completedAt, id]);
}

export function deleteTask(id) {
  run('DELETE FROM tasks WHERE id = ?', [id]);
}

export function taskCounts() {
  const rows = all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status');
  const out = { open: 0, doing: 0, done: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
