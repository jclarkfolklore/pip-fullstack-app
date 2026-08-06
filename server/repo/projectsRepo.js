const crypto = require('crypto');
const { db } = require('../db');
const { logEvent } = require('./activityRepo');

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

const STATUSES = ['open', 'closed'];

// Closed projects are still listed by default — closing says the work is
// finished, not that you never want to see it again. That's what `archived`
// is for, and it stays the thing that hides a project.
function listProjects({ includeArchived = false, status = null } = {}) {
  const where = [];
  const params = [];
  if (!includeArchived) where.push('archived = 0');
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const sql = `SELECT * FROM projects ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY status ASC, sort_order ASC, name ASC`;
  return db.prepare(sql).all(...params).map((p) => ({ ...p, counts: projectCounts(p.id) }));
}

function projectCounts(projectId) {
  const inbox = db
    .prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE project_id = ? AND stage NOT IN ('archived')")
    .get(projectId).n;
  const tasks = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status != 'done'")
    .get(projectId).n;
  const notes = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE project_id = ?').get(projectId).n;
  const journal = db.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE project_id = ?').get(projectId).n;
  return { inbox, tasks, notes, journal };
}

function getProject(id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? { ...row, counts: projectCounts(id) } : null;
}

function createProject({ name, color = 'default' } = {}) {
  if (!name || !name.trim()) throw new Error('Project name is required');
  const id = newId();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects').get().m;
  db.prepare('INSERT INTO projects (id, name, color, sort_order, created_at) VALUES (?,?,?,?,?)').run(
    id,
    name.trim(),
    color,
    maxOrder + 1,
    nowIso()
  );
  logEvent('project', id, 'project_created', { name: name.trim() });
  return id;
}

function updateProject(id, { name, color, archived, sortOrder, status } = {}) {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return null;
  if (status !== undefined && !STATUSES.includes(status)) {
    throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  }
  db.prepare(
    'UPDATE projects SET name = ?, color = ?, archived = ?, sort_order = ?, status = ? WHERE id = ?'
  ).run(
    name !== undefined ? name : existing.name,
    color !== undefined ? color : existing.color,
    archived !== undefined ? (archived ? 1 : 0) : existing.archived,
    sortOrder !== undefined ? sortOrder : existing.sort_order,
    status !== undefined ? status : existing.status,
    id
  );
  logEvent('project', id, 'project_updated', { name, color, archived, sortOrder, status });
  return getProject(id);
}

function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  logEvent('project', id, 'project_deleted', {});
}

// Lets a drop-file just name a project ("project: Best Buy") without Claude
// having to look up or pre-create an id first — first mention wins and
// creates it, everything after matches by name (case-insensitive).
function findOrCreateByName(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE').get(clean);
  if (existing) return existing.id;
  return createProject({ name: clean });
}

module.exports = {
  STATUSES,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  projectCounts,
  findOrCreateByName
};
