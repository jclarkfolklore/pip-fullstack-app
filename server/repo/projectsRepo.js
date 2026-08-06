const crypto = require('crypto');
const { db } = require('../db');
const { logEvent } = require('./activityRepo');
const attachmentsRepo = require('./attachmentsRepo');

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

// Everything belonging to a project, for the detail view. Uses the entity
// tables directly rather than the search index: search answers "what matches
// these words", this answers "what belongs here", and a project with no
// matching text still has its work.
function projectContents(id, { limit = 50 } = {}) {
  const inbox = db
    .prepare("SELECT * FROM inbox_items WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(id, limit);
  const tasks = db
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(id, limit);
  const notes = db
    .prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(id, limit);
  const journal = db
    .prepare('SELECT * FROM journal_entries WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(id, limit);
  return { inbox, tasks, notes, journal };
}

// ---- contacts ----------------------------------------------------------

function listContacts(projectId) {
  return db
    .prepare('SELECT * FROM project_contacts WHERE project_id = ? ORDER BY sort_order ASC, name ASC')
    .all(projectId);
}

function addContact(projectId, { name, role = null, org = null, email = null, handle = null, notesMd = null } = {}) {
  if (!name || !name.trim()) throw new Error('Contact name is required');
  const id = newId();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM project_contacts WHERE project_id = ?')
    .get(projectId).m;
  db.prepare(
    `INSERT INTO project_contacts (id, project_id, name, role, org, email, handle, notes_md, sort_order, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, projectId, name.trim(), role, org, email, handle, notesMd, maxOrder + 1, nowIso());
  logEvent('project', projectId, 'project_contact_added', { name: name.trim(), role });
  return db.prepare('SELECT * FROM project_contacts WHERE id = ?').get(id);
}

function updateContact(id, fields = {}) {
  const existing = db.prepare('SELECT * FROM project_contacts WHERE id = ?').get(id);
  if (!existing) return null;
  const pick = (k, col) => (fields[k] !== undefined ? fields[k] : existing[col]);
  db.prepare(
    'UPDATE project_contacts SET name=?, role=?, org=?, email=?, handle=?, notes_md=?, sort_order=? WHERE id=?'
  ).run(
    pick('name', 'name'),
    pick('role', 'role'),
    pick('org', 'org'),
    pick('email', 'email'),
    pick('handle', 'handle'),
    pick('notesMd', 'notes_md'),
    pick('sortOrder', 'sort_order'),
    id
  );
  logEvent('project', existing.project_id, 'project_contact_updated', { id });
  return db.prepare('SELECT * FROM project_contacts WHERE id = ?').get(id);
}

function deleteContact(id) {
  const existing = db.prepare('SELECT * FROM project_contacts WHERE id = ?').get(id);
  if (!existing) return false;
  db.prepare('DELETE FROM project_contacts WHERE id = ?').run(id);
  logEvent('project', existing.project_id, 'project_contact_removed', { name: existing.name });
  return true;
}

function deleteProject(id) {
  // Contacts cascade via their FK; attachments can't (polymorphic) — see
  // attachmentsRepo's cleanup contract.
  attachmentsRepo.deleteForEntity('project', id);
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
  projectContents,
  listContacts,
  addContact,
  updateContact,
  deleteContact,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  projectCounts,
  findOrCreateByName
};
